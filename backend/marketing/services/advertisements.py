"""MarketingAdvertisement create / update / inactivate services."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import DuplicateAdvertisementError, ImmutableFieldError
from marketing.models import MarketingAdvertisement
from marketing.services.campaign_validation import validate_advertisement
from marketing.services.hierarchy_support import (
    map_model_validation_error,
    raise_if_inactive,
    reject_immutable_keys,
)
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset({"id", "created_at", "updated_at"})


@transaction.atomic
def create_advertisement(
    *,
    actor: User,
    campaign_id: UUID,
    name: str,
    ad_set_id: UUID | None = None,
    external_reference: str = "",
    creative_reference: str = "",
    is_active: bool = True,
) -> MarketingAdvertisement:
    ensure_permission(actor, "marketing.add_marketingadvertisement")
    validate_advertisement(campaign_id=campaign_id, ad_set_id=ad_set_id)

    ad = MarketingAdvertisement(
        campaign_id=campaign_id,
        ad_set_id=ad_set_id,
        name=(name or "").strip(),
        external_reference=(external_reference or "").strip(),
        creative_reference=(creative_reference or "").strip(),
        is_active=is_active,
    )
    try:
        ad.full_clean()
        ad.save()
    except DjangoValidationError as exc:
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateAdvertisementError(
            details={"name": ad.name, "campaign_id": str(campaign_id)}
        ) from exc
    return ad


@transaction.atomic
def update_advertisement(
    *,
    advertisement: MarketingAdvertisement,
    actor: User,
    updates: dict[str, Any],
) -> MarketingAdvertisement:
    ensure_permission(actor, "marketing.change_marketingadvertisement")
    locked = MarketingAdvertisement.objects.select_for_update().get(pk=advertisement.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
    campaign_id = locked.campaign_id
    ad_set_id = locked.ad_set_id
    if "campaign_id" in updates:
        campaign_id = updates["campaign_id"]
        locked.campaign_id = campaign_id
        update_fields.append("campaign_id")
    if "ad_set_id" in updates:
        ad_set_id = updates["ad_set_id"]
        locked.ad_set_id = ad_set_id
        update_fields.append("ad_set_id")
    if "campaign_id" in updates or "ad_set_id" in updates:
        validate_advertisement(campaign_id=campaign_id, ad_set_id=ad_set_id)

    for field in ("name", "external_reference", "creative_reference"):
        if field in updates:
            setattr(locked, field, (updates[field] or "").strip())
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
        raise DuplicateAdvertisementError(
            details={"name": locked.name, "campaign_id": str(locked.campaign_id)}
        ) from exc
    return locked


@transaction.atomic
def archive_advertisement(
    *,
    advertisement: MarketingAdvertisement,
    actor: User,
) -> MarketingAdvertisement:
    ensure_permission(actor, "marketing.change_marketingadvertisement")
    locked = MarketingAdvertisement.objects.select_for_update().get(pk=advertisement.pk)
    raise_if_inactive(locked, entity_type="advertisement")
    locked.is_active = False
    locked.save(update_fields=["is_active", "updated_at"])
    return locked
