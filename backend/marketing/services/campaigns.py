"""MarketingCampaign create / update / inactivate services."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import (
    CampaignHasChildrenError,
    DuplicateCampaignError,
    ImmutableFieldError,
)
from marketing.models import MarketingAdSet, MarketingAdvertisement, MarketingCampaign
from marketing.services.campaign_validation import validate_campaign_platform
from marketing.services.hierarchy_support import (
    map_model_validation_error,
    map_unique_validation_error,
    raise_if_inactive,
    reject_immutable_keys,
)
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset({"id", "code", "created_by", "created_at", "updated_at"})


@transaction.atomic
def create_campaign(
    *,
    actor: User,
    platform_id: UUID,
    name: str,
    code: str,
    description: str = "",
    objective: str = "",
    start_date=None,
    end_date=None,
    budget: Decimal | None = None,
    currency: str = "AED",
    status: str | None = None,
    is_active: bool = True,
) -> MarketingCampaign:
    ensure_permission(actor, "marketing.add_marketingcampaign")
    validate_campaign_platform(platform_id=platform_id)

    campaign = MarketingCampaign(
        platform_id=platform_id,
        name=(name or "").strip(),
        code=(code or "").strip(),
        description=(description or "").strip(),
        objective=(objective or "").strip(),
        start_date=start_date,
        end_date=end_date,
        budget=budget,
        currency=(currency or "AED").strip() or "AED",
        status=status or MarketingCampaign.Status.DRAFT,
        is_active=is_active,
        created_by=actor,
    )
    try:
        campaign.full_clean()
        campaign.save()
    except DjangoValidationError as exc:
        map_unique_validation_error(
            exc,
            DuplicateCampaignError,
            details={"name": campaign.name, "code": campaign.code},
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateCampaignError(details={"name": campaign.name, "code": campaign.code}) from exc
    return campaign


@transaction.atomic
def update_campaign(
    *,
    campaign: MarketingCampaign,
    actor: User,
    updates: dict[str, Any],
) -> MarketingCampaign:
    ensure_permission(actor, "marketing.change_marketingcampaign")
    locked = MarketingCampaign.objects.select_for_update().get(pk=campaign.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
    if "platform_id" in updates:
        validate_campaign_platform(platform_id=updates["platform_id"])
        locked.platform_id = updates["platform_id"]
        update_fields.append("platform_id")
    for field in ("name", "description", "objective", "currency", "status"):
        if field in updates:
            value = updates[field]
            if isinstance(value, str):
                value = value.strip()
            setattr(locked, field, value)
            update_fields.append(field)
    for field in ("start_date", "end_date", "budget"):
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
        map_unique_validation_error(
            exc,
            DuplicateCampaignError,
            details={"name": locked.name, "code": locked.code},
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateCampaignError(details={"name": locked.name, "code": locked.code}) from exc
    return locked


@transaction.atomic
def archive_campaign(*, campaign: MarketingCampaign, actor: User) -> MarketingCampaign:
    ensure_permission(actor, "marketing.change_marketingcampaign")
    locked = MarketingCampaign.objects.select_for_update().get(pk=campaign.pk)
    raise_if_inactive(locked, entity_type="campaign")

    active_adsets = MarketingAdSet.objects.filter(campaign_id=locked.pk, is_active=True).count()
    active_ads = MarketingAdvertisement.objects.filter(campaign_id=locked.pk, is_active=True).count()
    if active_adsets or active_ads:
        raise CampaignHasChildrenError(
            details={
                "entity_type": "campaign",
                "id": str(locked.pk),
                "active_ad_sets": active_adsets,
                "active_advertisements": active_ads,
            }
        )

    locked.is_active = False
    locked.save(update_fields=["is_active", "updated_at"])
    return locked
