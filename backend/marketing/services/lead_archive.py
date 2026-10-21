"""Transactional lead archive service."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from marketing.exceptions import ArchiveReasonRequiredError, LeadAlreadyArchivedError
from marketing.models import Lead
from marketing.services.lead_support import ensure_permission, lead_summary, map_hierarchy_validation_error

User = get_user_model()


@transaction.atomic
def archive_lead(
    *,
    lead: Lead,
    actor: User,
    reason: str,
) -> Lead:
    """
    Soft-archive a Lead. Requires a non-blank reason.

    Uses ``marketing.change_lead`` (no separate archive permission in Phase 2A).
    Does not hard-delete or provide unarchive.
    """
    ensure_permission(actor, "marketing.change_lead")

    trimmed = (reason or "").strip()
    if not trimmed:
        raise ArchiveReasonRequiredError(details={"field": "reason"})

    locked = Lead.objects.select_for_update().get(pk=lead.pk)

    if locked.status == Lead.Status.ARCHIVED or locked.archived_at is not None:
        raise LeadAlreadyArchivedError(details={"lead": lead_summary(locked)})

    locked.status = Lead.Status.ARCHIVED
    locked.archived_at = timezone.now()
    locked.archived_by = actor
    locked.archive_reason = trimmed

    try:
        locked.full_clean()
    except DjangoValidationError as exc:
        map_hierarchy_validation_error(exc)
        raise

    locked.save(
        update_fields=[
            "status",
            "archived_at",
            "archived_by",
            "archive_reason",
            "updated_at",
        ]
    )
    return locked
