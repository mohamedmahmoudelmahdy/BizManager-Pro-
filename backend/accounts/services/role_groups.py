"""
Synchronize role-managed Django Groups from User.role.

Source of truth:
- User.role identifies the user category (compatibility / UX).
- Django Groups + permissions authorize access.

Only groups listed in ROLE_MANAGED_GROUPS are added/removed by this sync.
Unrelated group memberships are always preserved.
"""

from __future__ import annotations

from django.contrib.auth.models import Group
from django.db import transaction

from attestation.groups import (
    GROUP_ATTESTATION_EMPLOYEE,
    GROUP_HR_PORTAL,
    seed_attestation_employee_groups,
    seed_hr_portal_groups,
)
from expenses.groups import GROUP_EXPENSE_EMPLOYEE, seed_expense_groups
from marketing.groups import seed_marketing_groups
from marketing.permissions import GROUP_MARKETING_EMPLOYEE, GROUP_MARKETING_MARKETER

# role code → frozenset of group names managed for that role
ROLE_MANAGED_GROUPS: dict[str, frozenset[str]] = {
    "marketer": frozenset({GROUP_MARKETING_MARKETER}),
    # Operational employees: Marketing CRM + own expenses + Attestation read.
    "employee": frozenset(
        {
            GROUP_MARKETING_EMPLOYEE,
            GROUP_EXPENSE_EMPLOYEE,
            GROUP_ATTESTATION_EMPLOYEE,
        }
    ),
    "hr_client": frozenset({GROUP_HR_PORTAL}),
}

ALL_ROLE_MANAGED_GROUP_NAMES: frozenset[str] = frozenset().union(
    *ROLE_MANAGED_GROUPS.values()
)


def ensure_role_managed_groups_exist() -> None:
    """Idempotently ensure Marketing + Expense + Attestation role-managed groups exist."""
    seed_marketing_groups()
    seed_expense_groups()
    seed_attestation_employee_groups()
    seed_hr_portal_groups()


def _clear_perm_cache(user) -> None:
    for attr in ("_perm_cache", "_user_perm_cache", "_group_perm_cache"):
        if hasattr(user, attr):
            delattr(user, attr)


def role_managed_groups_aligned(user) -> bool:
    """True when the user's role-managed group set already matches user.role."""
    desired = set(ROLE_MANAGED_GROUPS.get(getattr(user, "role", None), frozenset()))
    current = set(
        user.groups.filter(name__in=ALL_ROLE_MANAGED_GROUP_NAMES).values_list(
            "name", flat=True
        )
    )
    if current != desired:
        return False
    if not desired:
        return True
    # Desired groups must exist; otherwise a later seed/sync is still required.
    existing = set(
        Group.objects.filter(name__in=desired).values_list("name", flat=True)
    )
    return existing == desired


@transaction.atomic
def sync_role_managed_groups(user) -> None:
    """
    Align the user's role-managed groups with user.role.

    - role=marketer → Marketing Marketer
    - role=employee → Marketing Employee + Expense Employee + Attestation Employee
    - role=hr_client → Attestation HR Portal
    - other roles → remove only these managed groups
    - never remove unrelated groups
    """
    ensure_role_managed_groups_exist()
    desired = ROLE_MANAGED_GROUPS.get(getattr(user, "role", None), frozenset())

    for group_name in ALL_ROLE_MANAGED_GROUP_NAMES:
        group = Group.objects.filter(name=group_name).first()
        if group is None:
            continue
        if group_name in desired:
            user.groups.add(group)
        else:
            user.groups.remove(group)

    _clear_perm_cache(user)


def sync_role_managed_groups_if_needed(user) -> bool:
    """
    Hot-path helper for /api/me/: skip expensive group seeding when already aligned.
    Returns True when a sync ran.
    """
    if role_managed_groups_aligned(user):
        return False
    sync_role_managed_groups(user)
    return True
