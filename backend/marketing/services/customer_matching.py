"""Customer phone matching for Marketing CRM leads.

Isolates the current non-indexed Customer phone scan so a later indexed
lookup can replace the implementation without changing callers.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from uuid import UUID

from customers.models import Customer
from marketing.services.phone_normalization import PhoneNormalizationError, normalize_phone


@dataclass(frozen=True)
class CustomerPhoneMatch:
    customer_id: UUID
    matched_field: str
    matched_raw_value: str
    normalized_value: str
    display_name: str
    phone: str
    phone_secondary: str
    customer_type: str

    def to_dict(self) -> dict:
        data = asdict(self)
        data["customer_id"] = str(self.customer_id)
        return data


def _customer_display_name(customer: Customer) -> str:
    return (customer.company_name or customer.name or "").strip() or str(customer.pk)


def _customers_with_phone_q():
    from django.db.models import Q

    return (Q(phone__isnull=False) & ~Q(phone="")) | (
        Q(phone_secondary__isnull=False) & ~Q(phone_secondary="")
    )


def _safe_normalize(raw: str) -> str | None:
    if not raw:
        return None
    try:
        return normalize_phone(raw)
    except PhoneNormalizationError:
        return None


def find_customers_by_phone(*, normalized_phone: str) -> list[CustomerPhoneMatch]:
    """
    Return every Customer whose primary or secondary phone normalizes to
    ``normalized_phone``. Same Customer is returned once (prefer primary match).
    """
    target = (normalized_phone or "").strip()
    if not target:
        return []

    matches_by_id: dict[UUID, CustomerPhoneMatch] = {}

    # Non-indexed scan: normalize candidate non-blank phone fields in Python.
    # Isolated here so an indexed lookup can replace this later without API changes.
    candidates = Customer.objects.filter(_customers_with_phone_q()).order_by(
        "name", "company_name", "id"
    )

    for customer in candidates:
        primary_raw = (customer.phone or "").strip()
        secondary_raw = (customer.phone_secondary or "").strip()

        primary_norm = _safe_normalize(primary_raw)
        secondary_norm = _safe_normalize(secondary_raw)

        matched_field = None
        matched_raw = None
        matched_norm = None
        if primary_norm == target:
            matched_field = "phone"
            matched_raw = primary_raw
            matched_norm = primary_norm
        elif secondary_norm == target:
            matched_field = "phone_secondary"
            matched_raw = secondary_raw
            matched_norm = secondary_norm

        if not matched_field:
            continue

        matches_by_id[customer.pk] = CustomerPhoneMatch(
            customer_id=customer.pk,
            matched_field=matched_field,
            matched_raw_value=matched_raw or "",
            normalized_value=matched_norm or target,
            display_name=_customer_display_name(customer),
            phone=primary_raw,
            phone_secondary=secondary_raw,
            customer_type=customer.type,
        )

    return sorted(
        matches_by_id.values(),
        key=lambda m: (m.display_name.casefold(), str(m.customer_id)),
    )
