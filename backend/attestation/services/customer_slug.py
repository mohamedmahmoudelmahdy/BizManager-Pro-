"""Customer slug helpers and public/active-batch resolution for attestation."""

from __future__ import annotations

import unicodedata

from django.db import transaction
from django.utils.text import slugify

from attestation.exceptions import AttestationBatchUnavailableError
from attestation.models import AttestationBatch
from customers.models import Customer


def normalize_apply_slug(raw: str) -> str:
    value = slugify(unicodedata.normalize("NFKD", (raw or "").strip()))[:64]
    return value.strip("-")


def allocate_unique_customer_apply_slug(base: str, *, exclude_customer_id=None) -> str:
    """Return a unique Customer.attestation_apply_slug derived from base."""
    root = normalize_apply_slug(base) or "customer"
    candidate = root[:64]
    n = 2
    while True:
        qs = Customer.objects.filter(attestation_apply_slug=candidate)
        if exclude_customer_id is not None:
            qs = qs.exclude(pk=exclude_customer_id)
        if not qs.exists():
            return candidate
        suffix = f"-{n}"
        candidate = f"{root[: max(1, 64 - len(suffix))]}{suffix}"
        n += 1
        if n > 10_000:
            raise ValueError("Unable to allocate unique attestation apply slug")


def get_active_batch_for_customer_slug(slug: str) -> AttestationBatch:
    """
    Resolve public apply slug → Customer.attestation_apply_slug → active batch.

    Falls back to AttestationBatch.public_slug for legacy seed/API callers.
    """
    cleaned = (slug or "").strip()
    if not cleaned:
        raise AttestationBatchUnavailableError(details={"reason": "missing_slug"})

    customer = (
        Customer.objects.filter(attestation_apply_slug=cleaned)
        .only("id", "attestation_apply_slug", "name", "company_name")
        .first()
    )
    if customer is not None:
        batch = (
            AttestationBatch.objects.select_related("customer", "linked_procedure")
            .filter(customer_id=customer.pk, is_active=True)
            .order_by("-created_at")
            .first()
        )
        if batch is None:
            raise AttestationBatchUnavailableError(
                details={
                    "attestation_apply_slug": cleaned,
                    "reason": "no_active_batch",
                }
            )
        return batch

    # Legacy: batch public_slug (seed / older links)
    try:
        batch = AttestationBatch.objects.select_related(
            "customer", "linked_procedure"
        ).get(public_slug=cleaned)
    except AttestationBatch.DoesNotExist as exc:
        raise AttestationBatchUnavailableError(
            details={"public_slug": cleaned, "reason": "not_found"}
        ) from exc
    if not batch.is_active:
        raise AttestationBatchUnavailableError(
            details={"public_slug": cleaned, "reason": "inactive"}
        )
    return batch


@transaction.atomic
def ensure_single_active_batch(*, customer_id, activating_batch_id=None) -> None:
    """Deactivate other active batches when activating one for a customer."""
    qs = AttestationBatch.objects.filter(customer_id=customer_id, is_active=True)
    if activating_batch_id is not None:
        qs = qs.exclude(pk=activating_batch_id)
    qs.update(is_active=False)
