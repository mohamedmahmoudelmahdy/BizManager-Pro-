"""MarketingPlatform create / update / inactivate services."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import (
    DuplicatePlatformError,
    EntityHasChildrenError,
    ImmutableFieldError,
)
from marketing.models import MarketingCampaign, MarketingPlatform
from marketing.services.campaign_validation import validate_platform_channel
from marketing.services.hierarchy_support import (
    map_model_validation_error,
    map_unique_validation_error,
    raise_if_inactive,
    reject_immutable_keys,
)
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset({"id", "code", "created_at", "updated_at"})


@transaction.atomic
def create_platform(
    *,
    actor: User,
    channel_id: UUID,
    name: str,
    code: str,
    description: str = "",
    is_active: bool = True,
) -> MarketingPlatform:
    ensure_permission(actor, "marketing.add_marketingplatform")
    validate_platform_channel(channel_id=channel_id)

    platform = MarketingPlatform(
        channel_id=channel_id,
        name=(name or "").strip(),
        code=(code or "").strip(),
        description=(description or "").strip(),
        is_active=is_active,
    )
    try:
        platform.full_clean()
        platform.save()
    except DjangoValidationError as exc:
        map_unique_validation_error(
            exc,
            DuplicatePlatformError,
            details={"name": platform.name, "code": platform.code, "channel_id": str(channel_id)},
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicatePlatformError(
            details={"name": platform.name, "code": platform.code, "channel_id": str(channel_id)}
        ) from exc
    return platform


@transaction.atomic
def update_platform(
    *,
    platform: MarketingPlatform,
    actor: User,
    updates: dict[str, Any],
) -> MarketingPlatform:
    ensure_permission(actor, "marketing.change_marketingplatform")
    locked = MarketingPlatform.objects.select_for_update().select_related("channel").get(pk=platform.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
    if "channel_id" in updates:
        validate_platform_channel(channel_id=updates["channel_id"])
        locked.channel_id = updates["channel_id"]
        update_fields.append("channel_id")
    if "name" in updates:
        locked.name = (updates["name"] or "").strip()
        update_fields.append("name")
    if "description" in updates:
        locked.description = (updates["description"] or "").strip()
        update_fields.append("description")
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
            DuplicatePlatformError,
            details={
                "name": locked.name,
                "code": locked.code,
                "channel_id": str(locked.channel_id),
            },
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicatePlatformError(
            details={"name": locked.name, "code": locked.code, "channel_id": str(locked.channel_id)}
        ) from exc
    return locked


@transaction.atomic
def archive_platform(*, platform: MarketingPlatform, actor: User) -> MarketingPlatform:
    ensure_permission(actor, "marketing.change_marketingplatform")
    locked = MarketingPlatform.objects.select_for_update().get(pk=platform.pk)
    raise_if_inactive(locked, entity_type="platform")

    active_children = MarketingCampaign.objects.filter(platform_id=locked.pk, is_active=True).count()
    if active_children:
        raise EntityHasChildrenError(
            details={
                "entity_type": "platform",
                "id": str(locked.pk),
                "child_type": "campaign",
                "active_count": active_children,
            }
        )

    locked.is_active = False
    locked.save(update_fields=["is_active", "updated_at"])
    return locked
