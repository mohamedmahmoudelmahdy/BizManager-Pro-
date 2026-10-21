"""Transactional lead update service."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import DuplicateLeadPhoneError, ImmutableFieldError
from marketing.models import Lead
from marketing.services.lead_support import (
    IMMUTABLE_UPDATE_FIELDS,
    ensure_permission,
    lead_summary,
    map_hierarchy_validation_error,
    normalize_lead_phone,
    raise_if_duplicate,
    reject_immutable_keys,
    resolve_customer_link,
)

User = get_user_model()

MUTABLE_FIELDS = frozenset(
    {
        "name",
        "raw_phone",
        "email",
        "notes",
        "status",
        "outcome",
        "channel_id",
        "platform_id",
        "campaign_id",
        "ad_set_id",
        "advertisement_id",
        "marketing_owner_id",
        "linked_customer_id",
        "selected_customer_id",
        "clear_linked_customer",
    }
)

# Status values that must not be set via generic update in 2C.1
BLOCKED_STATUS_VALUES = frozenset({Lead.Status.ARCHIVED, Lead.Status.CONVERTED})


@transaction.atomic
def update_lead(
    *,
    lead: Lead,
    actor: User,
    updates: dict[str, Any],
    selected_customer_id: UUID | None = None,
) -> Lead:
    """
    Update mutable Lead fields. Archive and conversion must use dedicated services.

    When ``raw_phone`` changes, customer matching is re-run and an explicit
    ``selected_customer_id`` is required if matches exist.
    """
    ensure_permission(actor, "marketing.change_lead")

    locked = Lead.objects.select_for_update().get(pk=lead.pk)

    # Reject unknown / immutable keys early.
    reject_immutable_keys(updates, IMMUTABLE_UPDATE_FIELDS)

    unknown = sorted(k for k in updates if k not in MUTABLE_FIELDS and k not in IMMUTABLE_UPDATE_FIELDS)
    # Also reject direct client attempts to set normalized_phone via alias keys already covered.
    if "normalized_phone" in updates:
        raise ImmutableFieldError(details={"fields": ["normalized_phone"]})

    phone_changed = False
    update_fields: list[str] = []

    if "name" in updates:
        locked.name = (updates["name"] or "").strip()
        update_fields.append("name")
    if "email" in updates:
        locked.email = (updates["email"] or "").strip()
        update_fields.append("email")
    if "notes" in updates:
        locked.notes = (updates["notes"] or "").strip()
        update_fields.append("notes")
    if "outcome" in updates:
        locked.outcome = updates["outcome"] or ""
        update_fields.append("outcome")
    if "status" in updates:
        new_status = updates["status"]
        if new_status in BLOCKED_STATUS_VALUES:
            raise ImmutableFieldError(
                details={"fields": ["status"], "reason": "use_dedicated_workflow"}
            )
        locked.status = new_status
        update_fields.append("status")

    for fk_field in (
        "channel_id",
        "platform_id",
        "campaign_id",
        "ad_set_id",
        "advertisement_id",
        "marketing_owner_id",
    ):
        if fk_field in updates:
            # Preserve historical attribution after conversion (Phase 4.1).
            if locked.status == Lead.Status.CONVERTED and fk_field in {
                "channel_id",
                "platform_id",
                "campaign_id",
                "ad_set_id",
                "advertisement_id",
            }:
                raise ImmutableFieldError(
                    details={"fields": [fk_field], "reason": "attribution_locked_after_conversion"}
                )
            setattr(locked, fk_field, updates[fk_field])
            update_fields.append(fk_field)

    clear_linked = bool(updates.get("clear_linked_customer"))
    explicit_selected = selected_customer_id
    if "selected_customer_id" in updates and explicit_selected is None:
        explicit_selected = updates.get("selected_customer_id")

    if locked.status == Lead.Status.CONVERTED and (
        clear_linked or explicit_selected is not None or "linked_customer_id" in updates
    ):
        raise ImmutableFieldError(
            details={
                "fields": ["linked_customer"],
                "reason": "attribution_locked_after_conversion",
            }
        )

    if "raw_phone" in updates:
        raw, normalized = normalize_lead_phone(updates["raw_phone"])
        if normalized != locked.normalized_phone:
            phone_changed = True
            raise_if_duplicate(normalized_phone=normalized, exclude_lead_id=locked.pk)
            linked_id, _matches = resolve_customer_link(
                normalized_phone=normalized,
                selected_customer_id=explicit_selected,
            )
            locked.raw_phone = raw
            locked.normalized_phone = normalized
            locked.linked_customer_id = linked_id
            update_fields.extend(["raw_phone", "normalized_phone", "linked_customer_id"])
        else:
            locked.raw_phone = raw
            update_fields.append("raw_phone")

    if not phone_changed:
        if clear_linked:
            locked.linked_customer_id = None
            update_fields.append("linked_customer_id")
        elif explicit_selected is not None:
            # Allow explicit re-link only against current phone matches.
            linked_id, _matches = resolve_customer_link(
                normalized_phone=locked.normalized_phone,
                selected_customer_id=explicit_selected,
            )
            locked.linked_customer_id = linked_id
            update_fields.append("linked_customer_id")
        elif "linked_customer_id" in updates:
            # Direct linked_customer_id without matching validation is rejected.
            raise ImmutableFieldError(
                details={"fields": ["linked_customer_id"], "reason": "use_selected_customer_id"}
            )

    # Deduplicate update_fields while preserving order
    seen: set[str] = set()
    unique_fields: list[str] = []
    for f in update_fields:
        if f not in seen:
            seen.add(f)
            unique_fields.append(f)

    if not unique_fields and unknown:
        raise ImmutableFieldError(details={"fields": unknown})

    try:
        locked.full_clean()
    except DjangoValidationError as exc:
        map_hierarchy_validation_error(exc)
        raise

    if unique_fields:
        unique_fields.append("updated_at")
        try:
            locked.save(update_fields=unique_fields)
        except IntegrityError as exc:
            existing = (
                Lead.objects.filter(normalized_phone=locked.normalized_phone)
                .exclude(pk=locked.pk)
                .first()
            )
            if existing is not None:
                raise DuplicateLeadPhoneError(details={"lead": lead_summary(existing)}) from exc
            raise DuplicateLeadPhoneError(details={"lead": None}) from exc

    return locked
