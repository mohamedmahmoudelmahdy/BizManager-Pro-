"""Append-only LeadActivity services."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from marketing.exceptions import ActivityInvalidError, OperationNotPermittedError
from marketing.models import Lead, LeadActivity
from marketing.services.lead_support import ensure_permission
from marketing.services.operations_visibility import lead_is_visible_to

User = get_user_model()


def _ensure_activity_permission(actor: User) -> None:
    """Create/list uses manage_lead_activity or add/view leadactivity."""
    if getattr(actor, "is_superuser", False) or getattr(actor, "role", None) in ("admin", "manager"):
        return
    if actor.has_perm("marketing.manage_lead_activity") or actor.has_perm("marketing.add_leadactivity"):
        return
    if actor.has_perm("marketing.view_leadactivity"):
        return
    raise OperationNotPermittedError(details={"permission": "marketing.manage_lead_activity"})


@transaction.atomic
def create_activity(
    *,
    actor: User,
    lead_id: UUID,
    activity_type: str,
    notes: str = "",
    subject: str = "",
    occurred_at: datetime | None = None,
    due_at: datetime | None = None,
    metadata: dict[str, Any] | None = None,
) -> LeadActivity:
    """
    Append a LeadActivity. Actor is always set server-side.
    No update/delete path exists.
    """
    ensure_permission(actor, "marketing.view_lead")
    if not (
        getattr(actor, "is_superuser", False)
        or getattr(actor, "role", None) in ("admin", "manager")
        or actor.has_perm("marketing.manage_lead_activity")
        or actor.has_perm("marketing.add_leadactivity")
    ):
        raise OperationNotPermittedError(details={"permission": "marketing.add_leadactivity"})

    try:
        lead = Lead.objects.select_for_update().get(pk=lead_id)
    except Lead.DoesNotExist as exc:
        raise ActivityInvalidError(details={"field": "lead_id", "reason": "not_found"}) from exc

    if not lead_is_visible_to(actor, lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    if not activity_type:
        raise ActivityInvalidError(details={"field": "activity_type"})

    activity = LeadActivity(
        lead=lead,
        activity_type=activity_type,
        subject=(subject or "").strip(),
        notes=(notes or "").strip(),
        occurred_at=occurred_at or timezone.now(),
        due_at=due_at,
        created_by=actor,
        metadata=metadata or {},
    )
    try:
        activity.full_clean()
        activity.save()
    except DjangoValidationError as exc:
        raise ActivityInvalidError(
            details={"fields": getattr(exc, "message_dict", {}) or {"non_field": exc.messages}}
        ) from exc
    return activity


def record_assignment_activity(
    *,
    actor: User,
    lead: Lead,
    subject: str,
    notes: str = "",
    metadata: dict[str, Any] | None = None,
) -> LeadActivity:
    """Internal helper: append an ASSIGNMENT activity without re-checking add perm."""
    activity = LeadActivity(
        lead=lead,
        activity_type=LeadActivity.ActivityType.ASSIGNMENT,
        subject=subject,
        notes=notes,
        occurred_at=timezone.now(),
        created_by=actor,
        metadata=metadata or {},
    )
    activity.full_clean()
    activity.save()
    return activity
