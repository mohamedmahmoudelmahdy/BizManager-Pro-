"""Permission checks for revenue attribution endpoints."""

from __future__ import annotations

from django.contrib.auth import get_user_model

from marketing.exceptions import MarketingPermissionDeniedError, RevenuePermissionDeniedError

User = get_user_model()

PERM_DASHBOARD = "marketing.view_marketing_dashboard"
PERM_REPORT = "marketing.view_marketing_report"


def _is_admin_manager(actor: User) -> bool:
    if getattr(actor, "is_superuser", False):
        return True
    if not getattr(actor, "is_active", True):
        return False
    return getattr(actor, "role", None) in ("admin", "manager")


def _has_perm(actor: User, perm: str) -> bool:
    if actor is None or not getattr(actor, "is_authenticated", False):
        return False
    if _is_admin_manager(actor):
        return True
    return actor.has_perm(perm)


def ensure_revenue_overview_permission(actor: User) -> None:
    if _has_perm(actor, PERM_DASHBOARD) or _has_perm(actor, PERM_REPORT):
        return
    raise RevenuePermissionDeniedError(details={"permission": PERM_REPORT})


def ensure_revenue_detail_permission(actor: User) -> None:
    if _has_perm(actor, PERM_REPORT):
        return
    raise RevenuePermissionDeniedError(details={"permission": PERM_REPORT})
