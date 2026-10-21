"""LeadFollowUp create / update / complete services."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from marketing.exceptions import (
    FollowUpCompletedError,
    FollowUpInvalidDateError,
    ImmutableFieldError,
    OperationNotPermittedError,
)
from marketing.models import Lead, LeadFollowUp
from marketing.services.lead_support import ensure_permission, reject_immutable_keys
from marketing.services.operations_visibility import lead_is_visible_to

User = get_user_model()

IMMUTABLE_WHEN_COMPLETED = frozenset(
    {
        "id",
        "lead_id",
        "scheduled_for",
        "assigned_to_id",
        "notes",
        "status",
        "completed_at",
        "completed_by",
        "created_by",
        "created_at",
    }
)


def _can_manage_followup(actor: User) -> bool:
    if getattr(actor, "is_superuser", False) or getattr(actor, "role", None) in ("admin", "manager"):
        return True
    return actor.has_perm("marketing.add_leadfollowup") or actor.has_perm(
        "marketing.change_leadfollowup"
    ) or actor.has_perm("marketing.manage_lead_activity")


@transaction.atomic
def create_followup(
    *,
    actor: User,
    lead_id: UUID,
    scheduled_for: datetime,
    assigned_to_id: int | None = None,
    notes: str = "",
) -> LeadFollowUp:
    ensure_permission(actor, "marketing.view_lead")
    if not _can_manage_followup(actor):
        raise OperationNotPermittedError(details={"permission": "marketing.add_leadfollowup"})

    if scheduled_for is None:
        raise FollowUpInvalidDateError(details={"field": "scheduled_for"})

    try:
        lead = Lead.objects.select_for_update().get(pk=lead_id)
    except Lead.DoesNotExist as exc:
        raise FollowUpInvalidDateError(details={"field": "lead_id", "reason": "not_found"}) from exc

    if not lead_is_visible_to(actor, lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    followup = LeadFollowUp(
        lead=lead,
        assigned_to_id=assigned_to_id,
        scheduled_for=scheduled_for,
        status=LeadFollowUp.Status.PENDING,
        notes=(notes or "").strip(),
        created_by=actor,
    )
    try:
        followup.full_clean()
        followup.save()
    except DjangoValidationError as exc:
        raise FollowUpInvalidDateError(
            details={"fields": getattr(exc, "message_dict", {}) or {}}
        ) from exc
    return followup


@transaction.atomic
def update_followup(
    *,
    followup: LeadFollowUp,
    actor: User,
    updates: dict[str, Any],
) -> LeadFollowUp:
    ensure_permission(actor, "marketing.view_lead")
    if not (
        getattr(actor, "is_superuser", False)
        or getattr(actor, "role", None) in ("admin", "manager")
        or actor.has_perm("marketing.change_leadfollowup")
        or actor.has_perm("marketing.manage_lead_activity")
    ):
        raise OperationNotPermittedError(details={"permission": "marketing.change_leadfollowup"})

    locked = LeadFollowUp.objects.select_for_update().select_related("lead").get(pk=followup.pk)
    if not lead_is_visible_to(actor, locked.lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    if locked.status == LeadFollowUp.Status.COMPLETED:
        raise FollowUpCompletedError(details={"id": str(locked.pk)})

    reject_immutable_keys(
        updates,
        frozenset({"id", "lead_id", "created_by", "created_at", "completed_at", "completed_by"}),
    )

    update_fields: list[str] = []
    if "scheduled_for" in updates:
        if updates["scheduled_for"] is None:
            raise FollowUpInvalidDateError(details={"field": "scheduled_for"})
        locked.scheduled_for = updates["scheduled_for"]
        update_fields.append("scheduled_for")
    if "assigned_to_id" in updates:
        locked.assigned_to_id = updates["assigned_to_id"]
        update_fields.append("assigned_to_id")
    if "notes" in updates:
        locked.notes = (updates["notes"] or "").strip()
        update_fields.append("notes")
    if "status" in updates:
        # Completion must use complete_followup.
        if updates["status"] == LeadFollowUp.Status.COMPLETED:
            raise ImmutableFieldError(details={"fields": ["status"], "reason": "use_complete"})
        locked.status = updates["status"]
        update_fields.append("status")

    if not update_fields:
        return locked

    try:
        locked.full_clean()
        locked.save(update_fields=[*update_fields, "updated_at"])
    except DjangoValidationError as exc:
        raise FollowUpInvalidDateError(
            details={"fields": getattr(exc, "message_dict", {}) or {}}
        ) from exc
    return locked


@transaction.atomic
def complete_followup(
    *,
    followup: LeadFollowUp,
    actor: User,
    notes: str | None = None,
) -> LeadFollowUp:
    ensure_permission(actor, "marketing.view_lead")
    if not (
        getattr(actor, "is_superuser", False)
        or getattr(actor, "role", None) in ("admin", "manager")
        or actor.has_perm("marketing.change_leadfollowup")
        or actor.has_perm("marketing.manage_lead_activity")
    ):
        raise OperationNotPermittedError(details={"permission": "marketing.change_leadfollowup"})

    locked = LeadFollowUp.objects.select_for_update().select_related("lead").get(pk=followup.pk)
    if not lead_is_visible_to(actor, locked.lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    if locked.status == LeadFollowUp.Status.COMPLETED:
        raise FollowUpCompletedError(details={"id": str(locked.pk)})

    locked.status = LeadFollowUp.Status.COMPLETED
    locked.completed_at = timezone.now()
    locked.completed_by = actor
    update_fields = ["status", "completed_at", "completed_by", "updated_at"]
    if notes is not None:
        locked.notes = notes.strip()
        update_fields.append("notes")

    locked.full_clean()
    locked.save(update_fields=update_fields)
    return locked
