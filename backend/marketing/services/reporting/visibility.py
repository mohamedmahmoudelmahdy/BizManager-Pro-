"""
Reporting permission and visibility helpers.

Permission mapping (Phase 3.3A):
- overview → marketing.view_marketing_dashboard OR marketing.view_marketing_report
- lead-trends / campaign-performance / followup-workload / assignment-workload
  → marketing.view_marketing_report
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import QuerySet

from marketing.exceptions import ReportPermissionDeniedError
from marketing.models import Lead
from marketing.services.operations_visibility import visible_leads_for

User = get_user_model()

PERM_DASHBOARD = "marketing.view_marketing_dashboard"
PERM_REPORT = "marketing.view_marketing_report"


def user_has_any_perm(user: User, *perms: str) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    if getattr(user, "role", None) in ("admin", "manager"):
        return True
    return any(user.has_perm(p) for p in perms)


def ensure_dashboard_or_report_permission(actor: User) -> None:
    if user_has_any_perm(actor, PERM_DASHBOARD, PERM_REPORT):
        return
    raise ReportPermissionDeniedError(
        details={"required_any_of": [PERM_DASHBOARD, PERM_REPORT]}
    )


def ensure_report_permission(actor: User) -> None:
    if user_has_any_perm(actor, PERM_REPORT):
        return
    raise ReportPermissionDeniedError(details={"permission": PERM_REPORT})


def can_view_spend_metrics(actor: User) -> bool:
    """
    CampaignSpend has no Lead visibility relation.

    Policy: any caller who passed dashboard/report permission may see Spend.
    Seeded Operations CRM users lack those permissions, so they cannot reach
    global Spend via reporting endpoints.
    """
    return user_has_any_perm(
        actor, PERM_DASHBOARD, PERM_REPORT, "marketing.view_campaignspend"
    )


def visible_report_leads(user: User, *, base_qs: QuerySet | None = None) -> QuerySet:
    """Apply Operations visibility before any reporting aggregation."""
    return visible_leads_for(
        user, base_qs=base_qs if base_qs is not None else Lead.objects.all()
    )
