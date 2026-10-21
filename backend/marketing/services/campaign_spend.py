"""CampaignSpend create / update services.

No archive fields on the model in Phase 2B — archive endpoint is not provided.
Expense / Financial Control posting is out of scope; ``expense_id`` is stored as
a nullable UUID only (no FK lookup, no ledger updates).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from marketing.exceptions import ImmutableFieldError
from marketing.models import CampaignSpend
from marketing.services.campaign_validation import validate_spend_hierarchy
from marketing.services.hierarchy_support import map_model_validation_error, reject_immutable_keys
from marketing.services.lead_support import ensure_permission

User = get_user_model()

IMMUTABLE_FIELDS = frozenset(
    {
        "id",
        "created_by",
        "created_at",
        "updated_at",
        "integration_status",
        "financial_reference",
        "integration_error",
        "integrated_at",
    }
)


@transaction.atomic
def create_campaign_spend(
    *,
    actor: User,
    campaign_id: UUID,
    spend_date,
    amount: Decimal,
    currency: str = "AED",
    description: str = "",
    external_reference: str = "",
    ad_set_id: UUID | None = None,
    advertisement_id: UUID | None = None,
    expense_id: UUID | None = None,
) -> CampaignSpend:
    """
    Create a CRM-side spend row.

    Does not look up Expense, create Expenses, or post to Financial Control.
    ``expense_id`` is accepted as an opaque UUID when provided.
    """
    ensure_permission(actor, "marketing.add_campaignspend")
    # manage_campaign_spend is an additional capability for managers; add is enough for create.
    validate_spend_hierarchy(
        campaign_id=campaign_id,
        ad_set_id=ad_set_id,
        advertisement_id=advertisement_id,
    )

    spend = CampaignSpend(
        campaign_id=campaign_id,
        ad_set_id=ad_set_id,
        advertisement_id=advertisement_id,
        spend_date=spend_date,
        amount=amount,
        currency=(currency or "AED").strip() or "AED",
        description=(description or "").strip(),
        external_reference=(external_reference or "").strip(),
        expense_id=expense_id,
        created_by=actor,
        integration_status=CampaignSpend.IntegrationStatus.PENDING,
    )
    try:
        spend.full_clean()
        spend.save()
    except DjangoValidationError as exc:
        map_model_validation_error(exc)
        raise
    return spend


@transaction.atomic
def update_campaign_spend(
    *,
    spend: CampaignSpend,
    actor: User,
    updates: dict[str, Any],
) -> CampaignSpend:
    ensure_permission(actor, "marketing.change_campaignspend")
    locked = CampaignSpend.objects.select_for_update().get(pk=spend.pk)
    reject_immutable_keys(updates, IMMUTABLE_FIELDS)

    update_fields: list[str] = []
    campaign_id = locked.campaign_id
    ad_set_id = locked.ad_set_id
    advertisement_id = locked.advertisement_id

    if "campaign_id" in updates:
        campaign_id = updates["campaign_id"]
        locked.campaign_id = campaign_id
        update_fields.append("campaign_id")
    if "ad_set_id" in updates:
        ad_set_id = updates["ad_set_id"]
        locked.ad_set_id = ad_set_id
        update_fields.append("ad_set_id")
    if "advertisement_id" in updates:
        advertisement_id = updates["advertisement_id"]
        locked.advertisement_id = advertisement_id
        update_fields.append("advertisement_id")

    if {"campaign_id", "ad_set_id", "advertisement_id"} & set(updates):
        validate_spend_hierarchy(
            campaign_id=campaign_id,
            ad_set_id=ad_set_id,
            advertisement_id=advertisement_id,
        )

    for field in ("spend_date", "amount", "expense_id"):
        if field in updates:
            setattr(locked, field, updates[field])
            update_fields.append(field)
    for field in ("currency", "description", "external_reference"):
        if field in updates:
            value = updates[field]
            if isinstance(value, str):
                value = value.strip()
            setattr(locked, field, value)
            update_fields.append(field)

    # Integration fields are immutable via this API (no financial posting in 2C.2).
    for blocked in (
        "integration_status",
        "financial_reference",
        "integration_error",
        "integrated_at",
    ):
        if blocked in updates:
            raise ImmutableFieldError(details={"fields": [blocked], "reason": "financial_posting_out_of_scope"})

    if not update_fields:
        return locked

    try:
        locked.full_clean()
        locked.save(update_fields=[*update_fields, "updated_at"])
    except DjangoValidationError as exc:
        map_model_validation_error(exc)
        raise
    return locked
