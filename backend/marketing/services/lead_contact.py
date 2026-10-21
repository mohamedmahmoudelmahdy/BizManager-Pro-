"""Lead last-contact annotations derived from append-only LeadActivity.

Definition of ``last_contacted_by`` / ``last_contacted_at``:

  The ``created_by`` and ``occurred_at`` of the most recent LeadActivity whose
  ``activity_type`` is a real customer-contact interaction.

Verified contact types: call, whatsapp, email, meeting.

Non-contact (excluded): note, follow_up, status_change, assignment, conversion.

There is no ``message`` activity type in the product model; WhatsApp covers
messaging contact. Contacted By is never inferred from owner, assignee,
created_by, or status=contacted alone.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.contrib.auth import get_user_model
from django.db.models import OuterRef, QuerySet, Subquery

from marketing.exceptions import InvalidOutcomeError
from marketing.models import Lead, LeadActivity

User = get_user_model()

CONTACT_ACTIVITY_TYPES: tuple[str, ...] = (
    LeadActivity.ActivityType.CALL,
    LeadActivity.ActivityType.WHATSAPP,
    LeadActivity.ActivityType.EMAIL,
    LeadActivity.ActivityType.MEETING,
)

# Explicit blank-outcome filter (Lead.outcome default is "").
OUTCOME_BLANK_FILTER = "__blank__"


def annotate_last_contact(qs: QuerySet[Lead]) -> QuerySet[Lead]:
    """
    Annotate each Lead with ``last_contacted_at`` and ``_last_contacted_by_id``
    from the latest qualifying contact activity (by occurred_at, then created_at).
    """
    latest = LeadActivity.objects.filter(
        lead_id=OuterRef("pk"),
        activity_type__in=CONTACT_ACTIVITY_TYPES,
    ).order_by("-occurred_at", "-created_at")

    return qs.annotate(
        last_contacted_at=Subquery(latest.values("occurred_at")[:1]),
        _last_contacted_by_id=Subquery(latest.values("created_by_id")[:1]),
    )


def load_users_by_ids(user_ids: Iterable[int | None]) -> dict[int, Any]:
    ids = {uid for uid in user_ids if uid is not None}
    if not ids:
        return {}
    return {u.pk: u for u in User.objects.filter(pk__in=ids)}


def contact_user_ids_from_leads(leads: Iterable[Lead]) -> list[int | None]:
    return [getattr(lead, "_last_contacted_by_id", None) for lead in leads]


def apply_outcome_filter(qs: QuerySet[Lead], raw: str | None) -> QuerySet[Lead]:
    """
    Apply ``outcome`` query param.

    - omitted / None: no filter
    - ``__blank__``: leads with empty outcome
    - valid Outcome code: exact match
    - anything else: structured 400 ``invalid_outcome``
    """
    if raw is None:
        return qs
    value = str(raw).strip()
    if value == "":
        # Bare empty query string is treated as no filter (param present but blank).
        return qs
    if value == OUTCOME_BLANK_FILTER:
        return qs.filter(outcome="")
    allowed = {choice.value for choice in Lead.Outcome}
    if value not in allowed:
        raise InvalidOutcomeError(
            details={
                "field": "outcome",
                "value": value,
                "allowed": sorted(allowed) + [OUTCOME_BLANK_FILTER],
            }
        )
    return qs.filter(outcome=value)
