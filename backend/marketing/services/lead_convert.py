"""Transactional Lead → Customer conversion (Phase 2C.4).

Modes:
  create_customer           — create a new Customer from Lead (+ optional fields)
  link_existing_customer    — link an explicitly selected phone match

No conversion_type schema field exists; mode is request-only.
Does not mutate assignments, follow-ups, or create procedures/payments/expenses.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from customers.models import Customer
from customers.serializers import CustomerSerializer
from marketing.exceptions import (
    ConversionFailedError,
    CustomerAlreadyAttributedError,
    CustomerCreationFailedError,
    CustomerMatchNotFoundError,
    InvalidConversionModeError,
    InvalidCustomerLinkError,
    LeadAlreadyConvertedError,
    LeadNotConvertibleError,
    MatchingCustomerFoundError,
    OperationNotPermittedError,
)
from marketing.models import Lead
from marketing.services.customer_matching import CustomerPhoneMatch, find_customers_by_phone
from marketing.services.lead_support import ensure_permission
from marketing.services.operations_visibility import lead_is_visible_to

User = get_user_model()

MODE_CREATE_CUSTOMER = "create_customer"
MODE_LINK_EXISTING = "link_existing_customer"
VALID_MODES = frozenset({MODE_CREATE_CUSTOMER, MODE_LINK_EXISTING})


def safe_customer_match_summaries(matches: list[CustomerPhoneMatch]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(m.customer_id),
            "display_name": m.display_name,
            "matched_field": m.matched_field,
            "matched_raw_phone": m.matched_raw_value,
            "normalized_phone": m.normalized_value,
            "phone": m.phone or "",
            "phone_secondary": m.phone_secondary or "",
            "customer_type": m.customer_type or "",
        }
        for m in matches
    ]


def list_lead_customer_matches(*, actor: User, lead: Lead) -> list[dict[str, Any]]:
    """
    Read-only phone matches for conversion UX.

    Requires Lead view permission and Lead visibility. Does not mutate.
    """
    ensure_permission(actor, "marketing.view_lead")
    if not lead_is_visible_to(actor, lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    normalized = (lead.normalized_phone or "").strip()
    if not normalized:
        return []
    matches = find_customers_by_phone(normalized_phone=normalized)
    return safe_customer_match_summaries(matches)


def _create_customer_for_lead(*, lead: Lead, customer_data: dict[str, Any]) -> Customer:
    """
    Create a Customer using CustomerSerializer conventions (no duplicated rules).

    Defaults from Lead when fields are omitted. Does not set balance/account fields.
    """
    data = dict(customer_data or {})
    # Strip read-only / financial fields if a client sent them.
    for blocked in (
        "id",
        "balance",
        "debt_status",
        "last_activity",
        "account_status",
        "closed_at",
        "closed_by",
        "closure_reason",
        "created_at",
        "updated_at",
    ):
        data.pop(blocked, None)

    if not data.get("name"):
        data["name"] = lead.name
    if "phone" not in data or data.get("phone") in (None, ""):
        data["phone"] = lead.raw_phone
    if "email" not in data:
        data["email"] = lead.email or ""
    if not data.get("type"):
        data["type"] = Customer.CustomerType.INDIVIDUAL

    serializer = CustomerSerializer(data=data)
    if not serializer.is_valid():
        # Language-neutral field keys only — not English message text as contract.
        field_errors = {
            field: ["invalid"] for field in serializer.errors.keys()
        }
        raise CustomerCreationFailedError(details={"fields": field_errors})

    try:
        customer = serializer.save()
    except Exception as exc:
        raise CustomerCreationFailedError(details={"reason": "save_failed"}) from exc
    return customer


def _ensure_customer_not_already_attributed(*, customer: Customer, excluding_lead_id=None) -> None:
    """One Customer may be linked to at most one converted Lead."""
    qs = Lead.objects.filter(
        linked_customer_id=customer.pk,
        status=Lead.Status.CONVERTED,
    )
    if excluding_lead_id is not None:
        qs = qs.exclude(pk=excluding_lead_id)
    other = qs.only("id", "lead_number").first()
    if other is not None:
        raise CustomerAlreadyAttributedError(
            details={
                "customer_id": str(customer.pk),
                "existing_lead_id": str(other.pk),
                "existing_lead_number": other.lead_number,
            }
        )


def _apply_conversion(
    *,
    lead: Lead,
    actor: User,
    customer: Customer,
) -> Lead:
    _ensure_customer_not_already_attributed(customer=customer, excluding_lead_id=lead.pk)
    lead.linked_customer = customer
    lead.status = Lead.Status.CONVERTED
    lead.converted_at = timezone.now()
    lead.converted_by = actor
    try:
        lead.full_clean()
    except DjangoValidationError as exc:
        raise ConversionFailedError(
            details={"fields": list(getattr(exc, "message_dict", {}).keys())}
        ) from exc
    lead.save(
        update_fields=[
            "linked_customer",
            "status",
            "converted_at",
            "converted_by",
            "updated_at",
        ]
    )
    return lead


@transaction.atomic
def convert_lead_atomic(
    *,
    lead: Lead,
    actor: User,
    mode: str,
    customer_id: UUID | None = None,
    customer_data: dict[str, Any] | None = None,
) -> Lead:
    """
    Convert a Lead to a linked Customer in one atomic transaction.

    Locks the Lead row. Create-new and link-existing share the same lock so
    concurrent conversions cannot double-create or double-link.
    """
    ensure_permission(actor, "marketing.convert_lead")

    if not lead_is_visible_to(actor, lead):
        raise OperationNotPermittedError(details={"reason": "lead_not_visible"})

    # Do not select_related() nullable FKs here: on PostgreSQL, SELECT FOR UPDATE
    # cannot lock the nullable side of an OUTER JOIN (linked_customer is null=True).
    # linked_customer_id alone is enough for already-converted error details.
    locked = Lead.objects.select_for_update().get(pk=lead.pk)

    if locked.status == Lead.Status.CONVERTED or locked.converted_at is not None:
        raise LeadAlreadyConvertedError(
            details={
                "lead_id": str(locked.pk),
                "lead_number": locked.lead_number,
                "linked_customer_id": str(locked.linked_customer_id)
                if locked.linked_customer_id
                else None,
            }
        )

    if locked.status == Lead.Status.ARCHIVED or locked.archived_at is not None:
        raise LeadNotConvertibleError(
            details={"lead_id": str(locked.pk), "reason": "archived"}
        )

    mode = (mode or "").strip()
    if mode not in VALID_MODES:
        raise InvalidConversionModeError(details={"mode": mode, "allowed": sorted(VALID_MODES)})

    normalized = (locked.normalized_phone or "").strip()
    if not normalized:
        raise ConversionFailedError(details={"field": "normalized_phone", "reason": "missing"})

    matches = find_customers_by_phone(normalized_phone=normalized)
    match_summaries = safe_customer_match_summaries(matches)

    if mode == MODE_LINK_EXISTING:
        if customer_data:
            raise InvalidConversionModeError(
                details={"reason": "customer_payload_not_allowed_for_link"}
            )
        if not matches:
            raise CustomerMatchNotFoundError(
                details={"normalized_phone": normalized, "matches": []}
            )
        if customer_id is None:
            raise MatchingCustomerFoundError(details={"matches": match_summaries})
        match_ids = {m.customer_id for m in matches}
        if customer_id not in match_ids:
            raise InvalidCustomerLinkError(
                details={
                    "selected_customer_id": str(customer_id),
                    "matches": match_summaries,
                }
            )
        customer = Customer.objects.get(pk=customer_id)
        # Do not mutate Customer.
        return _apply_conversion(lead=locked, actor=actor, customer=customer)

    # mode == MODE_CREATE_CUSTOMER
    if customer_id is not None:
        raise InvalidConversionModeError(
            details={"reason": "customer_id_not_allowed_for_create"}
        )
    if matches:
        raise MatchingCustomerFoundError(details={"matches": match_summaries})

    customer = _create_customer_for_lead(lead=locked, customer_data=customer_data or {})
    return _apply_conversion(lead=locked, actor=actor, customer=customer)
