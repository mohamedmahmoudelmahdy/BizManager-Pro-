"""Idempotent Marketing CRM group seeding (safe to rerun after Phase 2B)."""

from __future__ import annotations

from dataclasses import dataclass, field

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType

from marketing.permissions import GROUP_PERMISSION_MATRIX


@dataclass
class SeedResult:
    created_groups: list[str] = field(default_factory=list)
    existing_groups: list[str] = field(default_factory=list)
    assigned_permissions: list[tuple[str, str]] = field(default_factory=list)
    already_assigned: list[tuple[str, str]] = field(default_factory=list)
    missing_permissions: list[str] = field(default_factory=list)
    removed_permissions: list[tuple[str, str]] = field(default_factory=list)

    @property
    def missing_unique(self) -> list[str]:
        return sorted(set(self.missing_permissions))


def _parse_perm(code: str) -> tuple[str, str]:
    if "." not in code:
        raise ValueError(f"Invalid permission string (expected app_label.codename): {code}")
    app_label, codename = code.split(".", 1)
    return app_label, codename


def resolve_permission(code: str) -> Permission | None:
    """Look up a Permission by fully qualified app_label.codename."""
    app_label, codename = _parse_perm(code)
    return (
        Permission.objects.filter(content_type__app_label=app_label, codename=codename)
        .select_related("content_type")
        .first()
    )


def seed_marketing_groups(*, sync: bool = False) -> SeedResult:
    """
    Create Marketing CRM groups and assign permissions that currently exist.

    Missing permissions are recorded on the result (not raised).
    When sync=True, remove group permissions that are not in the expected matrix
    for that group (only among permissions whose app_label is 'marketing').
    """
    result = SeedResult()

    for group_name, expected_codes in GROUP_PERMISSION_MATRIX.items():
        group, created = Group.objects.get_or_create(name=group_name)
        if created:
            result.created_groups.append(group_name)
        else:
            result.existing_groups.append(group_name)

        desired_permission_ids: set[int] = set()
        for code in expected_codes:
            perm = resolve_permission(code)
            if perm is None:
                result.missing_permissions.append(code)
                continue
            desired_permission_ids.add(perm.pk)
            if group.permissions.filter(pk=perm.pk).exists():
                result.already_assigned.append((group_name, code))
            else:
                group.permissions.add(perm)
                result.assigned_permissions.append((group_name, code))

        if sync:
            marketing_cts = ContentType.objects.filter(app_label="marketing")
            current = group.permissions.filter(content_type__in=marketing_cts)
            for perm in current:
                code = f"{perm.content_type.app_label}.{perm.codename}"
                if perm.pk not in desired_permission_ids:
                    group.permissions.remove(perm)
                    result.removed_permissions.append((group_name, code))

    return result
