"""Resolve attributed converted leads and customer IDs under filters."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db.models import QuerySet

from marketing.models import CampaignSpend, Lead
from marketing.services.revenue_attribution.filters import RevenueFilters
from marketing.services.revenue_attribution.visibility import visible_converted_leads

User = get_user_model()


@dataclass
class AttributionScope:
    leads: QuerySet[Lead]
    customer_ids: list[UUID]
    campaign_ids: list[UUID]


def apply_lead_filters(qs: QuerySet[Lead], filters: RevenueFilters) -> QuerySet[Lead]:
    if not filters.include_archived:
        qs = qs.exclude(status=Lead.Status.ARCHIVED)
    if filters.channel_id:
        qs = qs.filter(channel_id=filters.channel_id)
    if filters.platform_id:
        qs = qs.filter(platform_id=filters.platform_id)
    if filters.campaign_id:
        qs = qs.filter(campaign_id=filters.campaign_id)
    if filters.adset_id:
        qs = qs.filter(ad_set_id=filters.adset_id)
    if filters.advertisement_id:
        qs = qs.filter(advertisement_id=filters.advertisement_id)
    if filters.lead_id:
        qs = qs.filter(pk=filters.lead_id)
    if filters.customer_id:
        qs = qs.filter(linked_customer_id=filters.customer_id)
    if filters.has_conversion_cohort:
        qs = qs.filter(
            converted_at__gte=filters.conversion_range_start,
            converted_at__lt=filters.conversion_range_end_exclusive,
        )
    if filters.search:
        from django.db.models import Q

        term = filters.search
        qs = qs.filter(
            Q(lead_number__icontains=term)
            | Q(name__icontains=term)
            | Q(linked_customer__name__icontains=term)
            | Q(linked_customer__company_name__icontains=term)
            | Q(campaign__name__icontains=term)
        )
    return qs


def resolve_scope(actor: User, filters: RevenueFilters) -> AttributionScope:
    leads = apply_lead_filters(visible_converted_leads(actor), filters)
    customer_ids = list(
        leads.exclude(linked_customer_id=None)
        .values_list("linked_customer_id", flat=True)
        .distinct()
    )
    campaign_ids = list(
        leads.exclude(campaign_id=None).values_list("campaign_id", flat=True).distinct()
    )
    return AttributionScope(leads=leads, customer_ids=customer_ids, campaign_ids=campaign_ids)


def campaign_spend_total(
    campaign_ids: list[UUID],
    filters: RevenueFilters,
):
    from decimal import Decimal

    from django.db.models import Sum

    from marketing.services.revenue_attribution.calculations import quantize_money

    if not campaign_ids:
        return Decimal("0")
    qs = CampaignSpend.objects.filter(campaign_id__in=campaign_ids)
    if filters.adset_id:
        qs = qs.filter(ad_set_id=filters.adset_id)
    if filters.advertisement_id:
        qs = qs.filter(advertisement_id=filters.advertisement_id)
    if filters.has_financial_period:
        qs = qs.filter(
            spend_date__gte=filters.date_from,
            spend_date__lte=filters.date_to,
        )
    total = qs.aggregate(s=Sum("amount")).get("s")
    return quantize_money(total or Decimal("0"))
