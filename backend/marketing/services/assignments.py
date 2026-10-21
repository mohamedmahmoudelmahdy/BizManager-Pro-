"""Transactional LeadAssignment workflow (append-only history).

Status values (Phase 2B model):
  pending     — assigned, awaiting acceptance  (maps to workflow \"Assigned\")
  accepted    — operations employee accepted
  rejected    — declined
  completed   — work finished
  reassigned  — superseded by a newer assignment
  cancelled   — withdrawn

Active assignments = pending OR accepted. Exactly one active per Lead.
"""

from __future__ import annotations

from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from marketing.exceptions import (
    AssignmentAlreadyCompletedError,
    AssignmentNotFoundError,
    AssignmentNotOwnedError,
    DuplicateActiveAssignmentError,
    InvalidAssignmentTransitionError,
    OperationNotPermittedError,
)
from marketing.models import Lead, LeadAssignment
from marketing.services.activities import record_assignment_activity
from marketing.services.lead_support import ensure_permission
from marketing.services.operations_visibility import lead_is_visible_to

User = get_user_model()


def get_active_assignment(*, lead_id: UUID, for_update: bool = False) -> LeadAssignment | None:
    qs = LeadAssignment.objects.filter(
        lead_id=lead_id,
        status__in=LeadAssignment.ACTIVE_STATUSES,
    ).order_by("-assigned_at", "-id")
    if for_update:
        qs = qs.select_for_update()
    return qs.first()


def _ensure_can_assign(actor: User) -> None:
    ensure_permission(actor, "marketing.assign_lead")


def _ensure_can_transition(actor: User) -> None:
    """Accept/reject/complete/cancel: change_leadassignment or assign_lead or manager."""
    if getattr(actor, "is_superuser", False) or getattr(actor, "role", None) in ("admin", "manager"):
        return
    if actor.has_perm("marketing.change_leadassignment") or actor.has_perm("marketing.assign_lead"):
        return
    raise OperationNotPermittedError(details={"permission": "marketing.change_leadassignment"})


def _require_owner(assignment: LeadAssignment, actor: User) -> None:
    if getattr(actor, "is_superuser", False) or getattr(actor, "role", None) in ("admin", "manager"):
        return
    if assignment.operations_employee_id != actor.pk:
        raise AssignmentNotOwnedError(
            details={
                "assignment_id": str(assignment.pk),
                "operations_employee_id": assignment.operations_employee_id,
            }
        )


def _close_active(
    *,
    active: LeadAssignment,
    terminal_status: str,
) -> LeadAssignment:
    now = timezone.now()
    active.status = terminal_status
    update_fields = ["status"]
    if terminal_status == LeadAssignment.Status.REASSIGNED:
        # Preserve accepted_at if present; set completed_at for model.clean compatibility
        # when leaving accepted → reassigned (model allows completed_at with REASSIGNED).
        if active.accepted_at and not active.completed_at:
            active.completed_at = now
            update_fields.append("completed_at")
    elif terminal_status == LeadAssignment.Status.CANCELLED:
        pass
    active.full_clean()
    active.save(update_fields=[*update_fields])
    return active


def _set_lead_assigned(lead: Lead) -> None:
    if lead.status in (Lead.Status.ARCHIVED, Lead.Status.CONVERTED):
        return
    if lead.status != Lead.Status.ASSIGNED:
        lead.status = Lead.Status.ASSIGNED
        lead.save(update_fields=["status", "updated_at"])


@transaction.atomic
def assign_lead(
    *,
    actor: User,
    lead_id: UUID,
    operations_employee_id: int,
    notes: str = "",
) -> LeadAssignment:
    """
    Create a pending assignment. Fails if an active assignment already exists
    (use reassign_lead instead).
    """
    _ensure_can_assign(actor)

    lead = Lead.objects.select_for_update().get(pk=lead_id)
    if lead.status == Lead.Status.ARCHIVED:
        raise InvalidAssignmentTransitionError(details={"reason": "lead_archived"})

    active = get_active_assignment(lead_id=lead.pk, for_update=True)
    if active is not None:
        raise DuplicateActiveAssignmentError(
            details={
                "lead_id": str(lead.pk),
                "active_assignment_id": str(active.pk),
                "active_status": active.status,
            }
        )

    assignment = LeadAssignment(
        lead=lead,
        operations_employee_id=operations_employee_id,
        assigned_by=actor,
        assigned_at=timezone.now(),
        status=LeadAssignment.Status.PENDING,
        notes=(notes or "").strip(),
    )
    assignment.full_clean()
    assignment.save()
    _set_lead_assigned(lead)
    record_assignment_activity(
        actor=actor,
        lead=lead,
        subject="Lead assigned",
        notes=notes or "",
        metadata={
            "assignment_id": str(assignment.pk),
            "operations_employee_id": operations_employee_id,
            "transition": "assign",
        },
    )
    return assignment


@transaction.atomic
def reassign_lead(
    *,
    actor: User,
    lead_id: UUID,
    operations_employee_id: int,
    notes: str = "",
) -> LeadAssignment:
    """Close active assignment as reassigned and append a new pending assignment."""
    _ensure_can_assign(actor)

    lead = Lead.objects.select_for_update().get(pk=lead_id)
    active = get_active_assignment(lead_id=lead.pk, for_update=True)
    if active is None:
        raise AssignmentNotFoundError(details={"lead_id": str(lead.pk), "reason": "no_active"})

    if active.status not in LeadAssignment.ACTIVE_STATUSES:
        raise InvalidAssignmentTransitionError(
            details={"from": active.status, "to": "reassign"}
        )

    _close_active(active=active, terminal_status=LeadAssignment.Status.REASSIGNED)

    assignment = LeadAssignment(
        lead=lead,
        operations_employee_id=operations_employee_id,
        assigned_by=actor,
        assigned_at=timezone.now(),
        status=LeadAssignment.Status.PENDING,
        notes=(notes or "").strip(),
    )
    assignment.full_clean()
    assignment.save()
    _set_lead_assigned(lead)
    record_assignment_activity(
        actor=actor,
        lead=lead,
        subject="Lead reassigned",
        notes=notes or "",
        metadata={
            "previous_assignment_id": str(active.pk),
            "assignment_id": str(assignment.pk),
            "operations_employee_id": operations_employee_id,
            "transition": "reassign",
        },
    )
    return assignment


@transaction.atomic
def accept_assignment(*, actor: User, assignment_id: UUID) -> LeadAssignment:
    _ensure_can_transition(actor)
    locked = LeadAssignment.objects.select_for_update().select_related("lead").get(pk=assignment_id)
    _require_owner(locked, actor)

    if locked.status != LeadAssignment.Status.PENDING:
        raise InvalidAssignmentTransitionError(
            details={"from": locked.status, "to": LeadAssignment.Status.ACCEPTED}
        )

    locked.status = LeadAssignment.Status.ACCEPTED
    locked.accepted_at = timezone.now()
    locked.full_clean()
    locked.save(update_fields=["status", "accepted_at"])

    lead = locked.lead
    if lead.status not in (Lead.Status.ARCHIVED, Lead.Status.CONVERTED, Lead.Status.IN_PROGRESS):
        lead.status = Lead.Status.IN_PROGRESS
        lead.save(update_fields=["status", "updated_at"])

    record_assignment_activity(
        actor=actor,
        lead=lead,
        subject="Assignment accepted",
        metadata={"assignment_id": str(locked.pk), "transition": "accept"},
    )
    return locked


@transaction.atomic
def reject_assignment(*, actor: User, assignment_id: UUID, notes: str = "") -> LeadAssignment:
    _ensure_can_transition(actor)
    locked = LeadAssignment.objects.select_for_update().select_related("lead").get(pk=assignment_id)
    _require_owner(locked, actor)

    if locked.status != LeadAssignment.Status.PENDING:
        raise InvalidAssignmentTransitionError(
            details={"from": locked.status, "to": LeadAssignment.Status.REJECTED}
        )

    locked.status = LeadAssignment.Status.REJECTED
    locked.rejected_at = timezone.now()
    if notes:
        locked.notes = (locked.notes + "\n" + notes.strip()).strip() if locked.notes else notes.strip()
    locked.full_clean()
    locked.save(update_fields=["status", "rejected_at", "notes"])

    record_assignment_activity(
        actor=actor,
        lead=locked.lead,
        subject="Assignment rejected",
        notes=notes or "",
        metadata={"assignment_id": str(locked.pk), "transition": "reject"},
    )
    return locked


@transaction.atomic
def complete_assignment(*, actor: User, assignment_id: UUID, notes: str = "") -> LeadAssignment:
    _ensure_can_transition(actor)
    locked = LeadAssignment.objects.select_for_update().select_related("lead").get(pk=assignment_id)
    _require_owner(locked, actor)

    if locked.status == LeadAssignment.Status.COMPLETED:
        raise AssignmentAlreadyCompletedError(details={"assignment_id": str(locked.pk)})

    if locked.status != LeadAssignment.Status.ACCEPTED:
        raise InvalidAssignmentTransitionError(
            details={"from": locked.status, "to": LeadAssignment.Status.COMPLETED}
        )

    locked.status = LeadAssignment.Status.COMPLETED
    locked.completed_at = timezone.now()
    if notes:
        locked.notes = (locked.notes + "\n" + notes.strip()).strip() if locked.notes else notes.strip()
    locked.full_clean()
    locked.save(update_fields=["status", "completed_at", "notes"])

    record_assignment_activity(
        actor=actor,
        lead=locked.lead,
        subject="Assignment completed",
        notes=notes or "",
        metadata={"assignment_id": str(locked.pk), "transition": "complete"},
    )
    return locked


@transaction.atomic
def cancel_assignment(*, actor: User, assignment_id: UUID, notes: str = "") -> LeadAssignment:
    """Cancel a pending or accepted assignment (assigner/manager)."""
    _ensure_can_assign(actor)  # cancel reserved for assign capability
    locked = LeadAssignment.objects.select_for_update().select_related("lead").get(pk=assignment_id)

    if locked.status not in LeadAssignment.ACTIVE_STATUSES:
        raise InvalidAssignmentTransitionError(
            details={"from": locked.status, "to": LeadAssignment.Status.CANCELLED}
        )

    locked.status = LeadAssignment.Status.CANCELLED
    if notes:
        locked.notes = (locked.notes + "\n" + notes.strip()).strip() if locked.notes else notes.strip()
    locked.full_clean()
    locked.save(update_fields=["status", "notes"])

    record_assignment_activity(
        actor=actor,
        lead=locked.lead,
        subject="Assignment cancelled",
        notes=notes or "",
        metadata={"assignment_id": str(locked.pk), "transition": "cancel"},
    )
    return locked
