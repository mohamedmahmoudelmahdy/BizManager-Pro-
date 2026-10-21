"""Operations CRM lead visibility rules (Phase 2C.3).

Marketing Managers / admin|manager roles: all leads.
Marketing Employees: all leads they are permitted to view (no assignment filter).
Operations CRM users: leads assigned to self (active) OR unassigned.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Exists, OuterRef, Q, QuerySet

from marketing.permissions import (
    GROUP_MARKETING_MANAGER,
    GROUP_OPERATIONS_CRM_USER,
)
from marketing.models import Lead, LeadAssignment

User = get_user_model()


def is_marketing_manager(user: User) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    if getattr(user, "role", None) in ("admin", "manager"):
        return True
    return user.groups.filter(name=GROUP_MARKETING_MANAGER).exists()


def is_operations_crm_user(user: User) -> bool:
    """True when the user is in the Operations CRM group and is not a manager."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if is_marketing_manager(user):
        return False
    return user.groups.filter(name=GROUP_OPERATIONS_CRM_USER).exists()


def active_assignment_subquery():
    return LeadAssignment.objects.filter(
        lead_id=OuterRef("pk"),
        status__in=LeadAssignment.ACTIVE_STATUSES,
    )


def visible_leads_for(user: User, *, base_qs: QuerySet | None = None) -> QuerySet:
    """
    Return a Lead queryset scoped to the caller's Operations visibility rules.

    Does not replace Django permission checks — call after permission is granted.
    """
    qs = base_qs if base_qs is not None else Lead.objects.all()

    if is_marketing_manager(user):
        return qs

    if is_operations_crm_user(user):
        active_for_self = LeadAssignment.objects.filter(
            lead_id=OuterRef("pk"),
            status__in=LeadAssignment.ACTIVE_STATUSES,
            operations_employee_id=user.pk,
        )
        any_active = active_assignment_subquery()
        # Assigned to self OR no active assignment (unassigned).
        return qs.annotate(
            _assigned_to_self=Exists(active_for_self),
            _has_active_assignment=Exists(any_active),
        ).filter(Q(_assigned_to_self=True) | Q(_has_active_assignment=False))

    # Marketing employees and other permitted users: no assignment-based filter.
    return qs


def lead_is_visible_to(user: User, lead: Lead) -> bool:
    return visible_leads_for(user, base_qs=Lead.objects.filter(pk=lead.pk)).exists()
