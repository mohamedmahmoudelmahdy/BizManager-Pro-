"""Visible converted-lead scope for revenue attribution."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import QuerySet

from marketing.models import Lead
from marketing.services.operations_visibility import visible_leads_for
from marketing.services.reporting.querysets import CONVERTED_Q

User = get_user_model()


def visible_converted_leads(actor: User) -> QuerySet[Lead]:
    """Converted leads visible to the actor (attribution universe)."""
    return visible_leads_for(actor).filter(CONVERTED_Q).select_related(
        "channel",
        "platform",
        "campaign",
        "ad_set",
        "advertisement",
        "linked_customer",
    )
