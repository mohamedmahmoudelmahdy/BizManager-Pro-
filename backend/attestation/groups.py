"""Attestation Django group + permissions seeders."""

from __future__ import annotations

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType

from attestation.models import AttestationApplication, AttestationBatch

GROUP_HR_PORTAL = "Attestation HR Portal"
GROUP_ATTESTATION_EMPLOYEE = "Attestation Employee"

HR_PORTAL_PERMISSION_CODENAMES = (
    "view_hr_attestation_portal",
    "view_hr_attestationapplication",
    "download_hr_attestationdocument",
)

# Full operational workflow for internal staff (view + edit notes + process).
# Content-type split: default model perms live on AttestationApplication;
# custom workflow/notes perms are declared on AttestationBatch.Meta.permissions.
# Explicitly EXCLUDES manage_attestationbatch and all HR portal permissions.
ATTESTATION_EMPLOYEE_APPLICATION_CODENAMES = (
    "view_attestationapplication",
    "change_attestationapplication",
)
ATTESTATION_EMPLOYEE_BATCH_CODENAMES = (
    "process_attestationapplication",
    "view_internal_notes",
)


def seed_hr_portal_groups() -> Group:
    """Idempotently create the HR portal group with attestation HR permissions."""
    group, _ = Group.objects.get_or_create(name=GROUP_HR_PORTAL)
    ct = ContentType.objects.get_for_model(AttestationBatch)
    perms = Permission.objects.filter(
        content_type=ct, codename__in=HR_PORTAL_PERMISSION_CODENAMES
    )
    group.permissions.set(perms)
    return group


def seed_attestation_employee_groups() -> Group:
    """
    Idempotently create Attestation Employee with full operational access.

    Grants view/change/process/notes. Does NOT grant batch management or HR portal.
    Existing group members inherit updates on the next seed/sync (/api/me).
    """
    group, _ = Group.objects.get_or_create(name=GROUP_ATTESTATION_EMPLOYEE)
    app_ct = ContentType.objects.get_for_model(AttestationApplication)
    batch_ct = ContentType.objects.get_for_model(AttestationBatch)
    perms = list(
        Permission.objects.filter(
            content_type=app_ct, codename__in=ATTESTATION_EMPLOYEE_APPLICATION_CODENAMES
        )
    ) + list(
        Permission.objects.filter(
            content_type=batch_ct, codename__in=ATTESTATION_EMPLOYEE_BATCH_CODENAMES
        )
    )
    group.permissions.set(perms)
    return group
