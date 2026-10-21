"""Transactional lead creation service."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

from marketing.exceptions import DuplicateLeadPhoneError
from marketing.models import Lead
from marketing.services.lead_numbers import DEFAULT_SCOPE_KEY, allocate_lead_number
from marketing.services.lead_support import (
    ensure_permission,
    lead_summary,
    map_hierarchy_validation_error,
    normalize_lead_phone,
    raise_if_duplicate,
    resolve_customer_link,
)

User = get_user_model()


def create_lead(
    *,
    actor: User,
    name: str,
    raw_phone: str,
    selected_customer_id: UUID | None = None,
    email: str = "",
    notes: str = "",
    status: str | None = None,
    outcome: str = "",
    channel_id: UUID | None = None,
    platform_id: UUID | None = None,
    campaign_id: UUID | None = None,
    ad_set_id: UUID | None = None,
    advertisement_id: UUID | None = None,
    marketing_owner_id: UUID | None = None,
    scope_key: str = DEFAULT_SCOPE_KEY,
    **_ignored: Any,
) -> Lead:
    """
    Create a Lead with phone normalization, duplicate checks, optional explicit
    customer link, campaign hierarchy validation, and sequential numbering.

    Lead-number policy: permanent reservation. ``allocate_lead_number`` commits
    in its own durable transaction *before* the Lead row is written. If Lead
    creation later fails, the number is not reused (a gap may remain).

    Does not create Customers, convert leads, or create related activity records.
    """
    ensure_permission(actor, "marketing.add_lead")

    raw, normalized = normalize_lead_phone(raw_phone)
    raise_if_duplicate(normalized_phone=normalized)

    linked_customer_id, _matches = resolve_customer_link(
        normalized_phone=normalized,
        selected_customer_id=selected_customer_id,
    )

    # Reserve outside the Lead-write atomic so the number survives create failures.
    lead_number = allocate_lead_number(scope_key=scope_key)

    with transaction.atomic():
        lead = Lead(
            lead_number=lead_number,
            name=(name or "").strip(),
            raw_phone=raw,
            normalized_phone=normalized,
            email=(email or "").strip(),
            notes=(notes or "").strip(),
            status=status or Lead.Status.NEW,
            outcome=outcome or "",
            channel_id=channel_id,
            platform_id=platform_id,
            campaign_id=campaign_id,
            ad_set_id=ad_set_id,
            advertisement_id=advertisement_id,
            marketing_owner_id=marketing_owner_id,
            linked_customer_id=linked_customer_id,
            created_by=actor,
        )
        try:
            lead.full_clean()
        except DjangoValidationError as exc:
            map_hierarchy_validation_error(exc)
            raise
        try:
            lead.save()
        except IntegrityError as exc:
            existing = Lead.objects.filter(normalized_phone=normalized).first()
            if existing is not None:
                raise DuplicateLeadPhoneError(details={"lead": lead_summary(existing)}) from exc
            raise DuplicateLeadPhoneError(details={"lead": None}) from exc
        return lead
