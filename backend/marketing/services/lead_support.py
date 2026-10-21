"""Shared helpers for lead mutation services."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError

from marketing.exceptions import (
    DuplicateLeadPhoneError,
    ImmutableFieldError,
    InvalidCampaignHierarchyError,
    InvalidCustomerLinkError,
    InvalidPhoneError,
    MarketingPermissionDeniedError,
    MatchingCustomerFoundError,
)
from marketing.models import Lead
from marketing.services.customer_matching import CustomerPhoneMatch, find_customers_by_phone
from marketing.services.phone_normalization import PhoneNormalizationError, normalize_phone

User = get_user_model()

IMMUTABLE_CREATE_FIELDS = frozenset(
    {
        "id",
        "lead_number",
        "normalized_phone",
        "created_by",
        "created_at",
        "updated_at",
        "converted_at",
        "converted_by",
        "archived_at",
        "archived_by",
        "archive_reason",
    }
)

IMMUTABLE_UPDATE_FIELDS = frozenset(
    {
        "id",
        "lead_number",
        "normalized_phone",
        "created_by",
        "created_at",
        "updated_at",
        "converted_at",
        "converted_by",
        "archived_at",
        "archived_by",
        "archive_reason",
    }
)


def ensure_permission(actor: User, perm: str) -> None:
    if actor is None or not getattr(actor, "is_authenticated", False):
        raise MarketingPermissionDeniedError()
    if not getattr(actor, "is_active", True):
        raise MarketingPermissionDeniedError()
    if getattr(actor, "is_superuser", False):
        return
    role = getattr(actor, "role", None)
    if role in ("admin", "manager"):
        return
    if not actor.has_perm(perm):
        raise MarketingPermissionDeniedError(details={"permission": perm})


def normalize_lead_phone(raw_phone: str) -> tuple[str, str]:
    """Return (raw_phone preserved trimmed, normalized_phone)."""
    if raw_phone is None:
        raise InvalidPhoneError(details={"field": "raw_phone"})
    raw = str(raw_phone).strip()
    try:
        normalized = normalize_phone(raw)
    except PhoneNormalizationError as exc:
        raise InvalidPhoneError(
            details={"field": "raw_phone", "reason": getattr(exc, "code", None) or "invalid"}
        ) from exc
    return raw, normalized


def lead_summary(lead: Lead) -> dict[str, Any]:
    return {
        "id": str(lead.pk),
        "lead_number": lead.lead_number,
        "name": lead.name,
        "status": lead.status,
        "normalized_phone": lead.normalized_phone,
    }


def matches_payload(matches: list[CustomerPhoneMatch]) -> list[dict[str, Any]]:
    return [m.to_dict() for m in matches]


def find_duplicate_lead(*, normalized_phone: str, exclude_lead_id: UUID | None = None) -> Lead | None:
    qs = Lead.objects.filter(normalized_phone=normalized_phone)
    if exclude_lead_id is not None:
        qs = qs.exclude(pk=exclude_lead_id)
    return qs.first()


def raise_if_duplicate(*, normalized_phone: str, exclude_lead_id: UUID | None = None) -> None:
    existing = find_duplicate_lead(normalized_phone=normalized_phone, exclude_lead_id=exclude_lead_id)
    if existing is not None:
        raise DuplicateLeadPhoneError(details={"lead": lead_summary(existing)})


def resolve_customer_link(
    *,
    normalized_phone: str,
    selected_customer_id: UUID | None,
) -> tuple[UUID | None, list[CustomerPhoneMatch]]:
    """
    Enforce explicit customer linking when matches exist.

    Returns (linked_customer_id or None, matches).
    """
    matches = find_customers_by_phone(normalized_phone=normalized_phone)
    if not matches:
        if selected_customer_id is not None:
            raise InvalidCustomerLinkError(
                details={
                    "selected_customer_id": str(selected_customer_id),
                    "matches": [],
                }
            )
        return None, matches

    if selected_customer_id is None:
        raise MatchingCustomerFoundError(details={"matches": matches_payload(matches)})

    match_ids = {m.customer_id for m in matches}
    if selected_customer_id not in match_ids:
        raise InvalidCustomerLinkError(
            details={
                "selected_customer_id": str(selected_customer_id),
                "matches": matches_payload(matches),
            }
        )
    return selected_customer_id, matches


def map_hierarchy_validation_error(exc: DjangoValidationError) -> None:
    """Map Lead.full_clean hierarchy failures to invalid_campaign_hierarchy."""
    if hasattr(exc, "message_dict"):
        message_dict = exc.message_dict
        hierarchy_fields = {"channel", "platform", "campaign", "ad_set", "advertisement"}
        if hierarchy_fields.intersection(message_dict.keys()):
            raise InvalidCampaignHierarchyError(
                details={
                    "fields": {
                        field: [str(m) for m in msgs]
                        for field, msgs in message_dict.items()
                        if field in hierarchy_fields
                    }
                }
            ) from exc
    raise exc


def reject_immutable_keys(updates: dict, immutable: frozenset[str]) -> None:
    present = sorted(k for k in updates if k in immutable)
    if present:
        raise ImmutableFieldError(details={"fields": present})


def coerce_uuid(value: Any) -> UUID | None:
    if value is None or value == "":
        return None
    if isinstance(value, UUID):
        return value
    return UUID(str(value))
