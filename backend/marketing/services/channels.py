"""MarketingChannel create / update / inactivate services."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import DuplicateChannelError, EntityHasChildrenError, ImmutableFieldError
from marketing.models import MarketingChannel, MarketingPlatform
from marketing.services.hierarchy_support import (
    map_model_validation_error,
    map_unique_validation_error,
    raise_if_inactive,
    reject_immutable_keys,
)
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset({"id", "code", "created_at", "updated_at"})
MUTABLE_FIELDS = frozenset({"name", "description", "is_active"})


@transaction.atomic
def create_channel(
    *,
    actor: User,
    name: str,
    code: str,
    description: str = "",
    is_active: bool = True,
) -> MarketingChannel:
    ensure_permission(actor, "marketing.add_marketingchannel")
    channel = MarketingChannel(
        name=(name or "").strip(),
        code=(code or "").strip(),
        description=(description or "").strip(),
        is_active=is_active,
    )
    try:
        channel.full_clean()
        channel.save()
    except DjangoValidationError as exc:
        map_unique_validation_error(
            exc,
            DuplicateChannelError,
            details={"name": channel.name, "code": channel.code},
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateChannelError(details={"name": channel.name, "code": channel.code}) from exc
    return channel


@transaction.atomic
def update_channel(
    *,
    channel: MarketingChannel,
    actor: User,
    updates: dict[str, Any],
) -> MarketingChannel:
    ensure_permission(actor, "marketing.change_marketingchannel")
    locked = MarketingChannel.objects.select_for_update().get(pk=channel.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
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
            DuplicateChannelError,
            details={"name": locked.name, "code": locked.code},
        )
        map_model_validation_error(exc)
        raise
    except IntegrityError as exc:
        raise DuplicateChannelError(details={"name": locked.name, "code": locked.code}) from exc
    return locked


@transaction.atomic
def archive_channel(*, channel: MarketingChannel, actor: User) -> MarketingChannel:
    """Inactivate a Channel (``is_active=False``). Blocked while active Platforms exist."""
    ensure_permission(actor, "marketing.change_marketingchannel")
    locked = MarketingChannel.objects.select_for_update().get(pk=channel.pk)
    raise_if_inactive(locked, entity_type="channel")

    active_children = MarketingPlatform.objects.filter(channel_id=locked.pk, is_active=True).count()
    if active_children:
        raise EntityHasChildrenError(
            details={
                "entity_type": "channel",
                "id": str(locked.pk),
                "child_type": "platform",
                "active_count": active_children,
            }
        )

    locked.is_active = False
    locked.save(update_fields=["is_active", "updated_at"])
    return locked
