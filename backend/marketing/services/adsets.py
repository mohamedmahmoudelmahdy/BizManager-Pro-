"""MarketingAdSet create / update / inactivate services."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import DuplicateAdSetError, EntityHasChildrenError, ImmutableFieldError
from marketing.models import MarketingAdSet, MarketingAdvertisement
from marketing.services.campaign_validation import validate_adset_campaign
from marketing.services.hierarchy_support import (
    map_model_validation_error,
    raise_if_inactive,
    reject_immutable_keys,
)
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset({"id", "created_at", "updated_at"})


@transaction.atomic
def create_adset(
    *,
    actor: User,
    campaign_id: UUID,
    name: str,
    external_reference: str = "",
    budget: Decimal | None = None,
    start_date=None,
    end_date=None,
    is_active: bool = True,
) -> MarketingAdSet:
    ensure_permission(actor, "marketing.add_marketingadset")
    validate_adset_campaign(campaign_id=campaign_id)

    ad_set = MarketingAdSet(
        campaign_id=campaign_id,
        name=(name or "").strip(),
        external_reference=(external_reference or "").strip(),
        budget=budget,
        start_date=start_date,
        end_date=end_date,
        is_active=is_active,
    )
    try:
        ad_set.full_clean()
        ad_set.save()
    except DjangoValidationError as exc:
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateAdSetError(details={"name": ad_set.name, "campaign_id": str(campaign_id)}) from exc
    return ad_set


@transaction.atomic
def update_adset(
    *,
    ad_set: MarketingAdSet,
    actor: User,
    updates: dict[str, Any],
) -> MarketingAdSet:
    ensure_permission(actor, "marketing.change_marketingadset")
    locked = MarketingAdSet.objects.select_for_update().get(pk=ad_set.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
    if "campaign_id" in updates:
        validate_adset_campaign(campaign_id=updates["campaign_id"])
        locked.campaign_id = updates["campaign_id"]
        update_fields.append("campaign_id")
    if "name" in updates:
        locked.name = (updates["name"] or "").strip()
        update_fields.append("name")
    if "external_reference" in updates:
        locked.external_reference = (updates["external_reference"] or "").strip()
        update_fields.append("external_reference")
    for field in ("budget", "start_date", "end_date"):
        if field in updates:
            setattr(locked, field, updates[field])
            update_fields.append(field)
    if "is_active" in updates:
        raise ImmutableFieldError(details={"fields": ["is_active"], "reason": "use_archive"})

    if not update_fields:
        return locked

    try:
        locked.full_clean()
        locked.save(update_fields=[*update_fields, "updated_at"])
    except DjangoValidationError as exc:
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateAdSetError(
            details={"name": locked.name, "campaign_id": str(locked.campaign_id)}
        ) from exc
    return locked


@transaction.atomic
def archive_adset(*, ad_set: MarketingAdSet, actor: User) -> MarketingAdSet:
    ensure_permission(actor, "marketing.change_marketingadset")
    locked = MarketingAdSet.objects.select_for_update().get(pk=ad_set.pk)
    raise_if_inactive(locked, entity_type="ad_set")

    active_ads = MarketingAdvertisement.objects.filter(ad_set_id=locked.pk, is_active=True).count()
    if active_ads:
        raise EntityHasChildrenError(
            details={
                "entity_type": "ad_set",
                "id": str(locked.pk),
                "child_type": "advertisement",
                "active_count": active_ads,
            }
        )

    locked.is_active = False
    locked.save(update_fields=["is_active", "updated_at"])
    return locked
