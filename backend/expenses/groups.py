"""Expense permission groups for employee claim workflow."""

from __future__ import annotations

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType

from expenses.models import Expense

GROUP_EXPENSE_EMPLOYEE = "Expense Employee"
GROUP_EXPENSE_REVIEWER = "Expense Reviewer"

EMPLOYEE_PERM_CODENAMES = (
    "view_own_expense",
    "add_own_expense",
    "change_own_expense",
    "submit_expense",
    "withdraw_expense",
)

REVIEWER_PERM_CODENAMES = EMPLOYEE_PERM_CODENAMES + (
    "view_expense",
    "review_expense",
    "approve_expense",
    "reject_expense",
    "return_expense",
    "mark_expense_paid",
)


def _expense_perms(*codenames: str):
    ct = ContentType.objects.get_for_model(Expense)
    return list(Permission.objects.filter(content_type=ct, codename__in=codenames))


def seed_expense_groups() -> None:
    """Idempotently create Expense Employee / Reviewer groups with permissions."""
    emp, _ = Group.objects.get_or_create(name=GROUP_EXPENSE_EMPLOYEE)
    emp.permissions.set(_expense_perms(*EMPLOYEE_PERM_CODENAMES))

    rev, _ = Group.objects.get_or_create(name=GROUP_EXPENSE_REVIEWER)
    rev.permissions.set(_expense_perms(*REVIEWER_PERM_CODENAMES))
