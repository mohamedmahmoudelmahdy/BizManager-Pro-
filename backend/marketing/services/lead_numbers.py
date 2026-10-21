"""Lead-number allocation with permanent reservation (non-reuse).

Policy
------
**Permanent reservation:** once ``allocate_lead_number()`` returns a value, that
number is never reused, even if a subsequent Lead insert fails. Failures may
leave gaps in the sequence; that is intentional for CRM auditability.

Implementation
--------------
Uses ``transaction.atomic(durable=True)`` so the sequence increment commits in
its own outermost transaction and cannot nest inside the Lead-creation
transaction (Django nested ``atomic()`` blocks are savepoints and would
otherwise roll the reservation back with the failed Lead).

Callers must invoke ``allocate_lead_number()`` *outside* any enclosing
``atomic()`` that wraps Lead writes. ``create_lead`` follows this pattern.

Concurrency notes
-----------------
- Under PostgreSQL, concurrent allocators serialize on the sequence row via
  ``select_for_update()``.
- Under SQLite (local default), ``select_for_update`` has limited effect;
  uniqueness of ``Lead.lead_number`` remains a safety net. Full multi-threaded
  concurrency tests are not reliable on SQLite.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction

from marketing.models import LeadNumberSequence


DEFAULT_SCOPE_KEY = "default"


def format_lead_number(value: int) -> str:
    if value < 1:
        raise ValueError("Lead number value must be >= 1.")
    return f"L-{value:06d}"


@transaction.atomic(durable=True)
def allocate_lead_number(*, scope_key: str = DEFAULT_SCOPE_KEY) -> str:
    """
    Permanently reserve the next lead number for ``scope_key``.

    Returns values like ``L-000001``. The reservation commits independently of
    any later Lead insert; do not call this inside another ``atomic()`` block
    (``durable=True`` raises ``RuntimeError`` if nested).
    """
    scope_key = (scope_key or DEFAULT_SCOPE_KEY).strip() or DEFAULT_SCOPE_KEY

    try:
        sequence = LeadNumberSequence.objects.select_for_update().get(scope_key=scope_key)
    except LeadNumberSequence.DoesNotExist:
        try:
            LeadNumberSequence.objects.create(scope_key=scope_key, next_value=1)
        except IntegrityError:
            # Another transaction created the row first.
            pass
        sequence = LeadNumberSequence.objects.select_for_update().get(scope_key=scope_key)

    value = int(sequence.next_value)
    if value < 1:
        value = 1
    lead_number = format_lead_number(value)
    sequence.next_value = value + 1
    sequence.save(update_fields=["next_value", "updated_at"])
    return lead_number
