"""Campaign-level revenue attribution aggregates."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db.models import Sum

from marketing.models import CampaignSpend, MarketingCampaign
from marketing.services.revenue_attribution.calculations import (
    marketing_contribution,
    marketing_roi,
    money_to_str,
    quantize_money,
    rate_to_str,
    roas,
    roas_to_str,
    safe_divide,
)
from marketing.services.revenue_attribution.customer_scope import apply_lead_filters
from marketing.services.revenue_attribution.filters import parse_revenue_filters
from marketing.services.revenue_attribution.financial_adapter import financial_for_customers
from marketing.services.revenue_attribution.permissions import ensure_revenue_detail_permission
from marketing.services.revenue_attribution.visibility import visible_converted_leads

User = get_user_model()


def build_campaigns_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_detail_permission(actor)
    filters = parse_revenue_filters(params, allow_pagination=True)
    leads = apply_lead_filters(visible_converted_leads(actor), filters)

    by_campaign: dict[UUID | None, dict] = defaultdict(
        lambda: {"customers": set(), "leads": 0}
    )
    for campaign_id, customer_id in leads.values_list("campaign_id", "linked_customer_id"):
        by_campaign[campaign_id]["leads"] += 1
        if customer_id:
            by_campaign[campaign_id]["customers"].add(customer_id)

    campaigns = {
        c.pk: c
        for c in MarketingCampaign.objects.select_related(
            "platform", "platform__channel"
        ).filter(pk__in=[k for k in by_campaign if k])
    }

    rows = []
    for campaign_id, bucket in by_campaign.items():
        fin = financial_for_customers(
            bucket["customers"], date_from=filters.date_from, date_to=filters.date_to
        )
        spend_qs = CampaignSpend.objects.filter(campaign_id=campaign_id) if campaign_id else CampaignSpend.objects.none()
        if filters.has_financial_period:
            spend_qs = spend_qs.filter(
                spend_date__gte=filters.date_from, spend_date__lte=filters.date_to
            )
        if filters.adset_id:
            spend_qs = spend_qs.filter(ad_set_id=filters.adset_id)
        if filters.advertisement_id:
            spend_qs = spend_qs.filter(advertisement_id=filters.advertisement_id)
        spend = quantize_money(spend_qs.aggregate(s=Sum("amount")).get("s") or Decimal("0"))
        contrib = marketing_contribution(fin["net_profit"], spend)
        converted = len(bucket["customers"])
        leads_n = bucket["leads"]
        c = campaigns.get(campaign_id) if campaign_id else None
        cpl = safe_divide(spend, leads_n)
        cac = safe_divide(spend, converted)
        rows.append(
            {
                "campaign": (
                    {"id": str(c.pk), "code": c.code, "name": c.name}
                    if c
                    else {"id": None, "code": None, "name": None}
                ),
                "platform": (
                    {"id": str(c.platform_id), "name": c.platform.name}
                    if c
                    else {"id": None, "name": None}
                ),
                "channel": (
                    {
                        "id": str(c.platform.channel_id),
                        "name": c.platform.channel.name,
                    }
                    if c
                    else {"id": None, "name": None}
                ),
                "leads": leads_n,
                "converted_customers": converted,
                "procedures": fin["procedures"],
                "collected_revenue": money_to_str(fin["collected_revenue"]),
                "net_profit": money_to_str(fin["net_profit"]),
                "campaign_spend": money_to_str(spend),
                "marketing_contribution": money_to_str(contrib),
                "cost_per_lead": money_to_str(quantize_money(cpl) if cpl is not None else None),
                "customer_acquisition_cost": money_to_str(
                    quantize_money(cac) if cac is not None else None
                ),
                "roas": roas_to_str(roas(fin["collected_revenue"], spend)),
                "marketing_roi": rate_to_str(marketing_roi(contrib, spend)),
            }
        )

    total = len(rows)
    start = (filters.page - 1) * filters.page_size
    return {
        "filters": filters.to_dict(),
        "count": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "results": rows[start : start + filters.page_size],
    }
