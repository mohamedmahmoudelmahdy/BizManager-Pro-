"""Attestation application reference numbers (ATT-000001)."""

from __future__ import annotations

from django.db import IntegrityError, transaction

from attestation.models import AttestationNumberSequence

DEFAULT_SCOPE_KEY = "default"


def format_attestation_number(value: int) -> str:
    if value < 1:
        raise ValueError("Attestation number value must be >= 1.")
    return f"ATT-{value:06d}"


@transaction.atomic(durable=True)
def allocate_attestation_number(*, scope_key: str = DEFAULT_SCOPE_KEY) -> str:
    """
    Permanently reserve the next ATT-###### value.

    Call outside enclosing write transactions so durable=True can commit.
    """
    scope_key = (scope_key or DEFAULT_SCOPE_KEY).strip() or DEFAULT_SCOPE_KEY

    try:
        sequence = AttestationNumberSequence.objects.select_for_update().get(
            scope_key=scope_key
        )
    except AttestationNumberSequence.DoesNotExist:
        try:
            AttestationNumberSequence.objects.create(scope_key=scope_key, next_value=1)
        except IntegrityError:
            pass
        sequence = AttestationNumberSequence.objects.select_for_update().get(
            scope_key=scope_key
        )

    value = int(sequence.next_value)
    if value < 1:
        value = 1
    number = format_attestation_number(value)
    sequence.next_value = value + 1
    sequence.save(update_fields=["next_value", "updated_at"])
    return number
