"""Platform-level revenue attribution aggregates."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db.models import Sum

from marketing.models import CampaignSpend, MarketingPlatform
from marketing.services.revenue_attribution.calculations import (
    marketing_contribution,
    marketing_roi,
    money_to_str,
    quantize_money,
    rate_to_str,
    roas,
    roas_to_str,
)
from marketing.services.revenue_attribution.customer_scope import apply_lead_filters
from marketing.services.revenue_attribution.filters import parse_revenue_filters
from marketing.services.revenue_attribution.financial_adapter import financial_for_customers
from marketing.services.revenue_attribution.permissions import ensure_revenue_detail_permission
from marketing.services.revenue_attribution.visibility import visible_converted_leads

User = get_user_model()


def build_platforms_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_detail_permission(actor)
    filters = parse_revenue_filters(params, allow_pagination=True)
    leads = apply_lead_filters(visible_converted_leads(actor), filters)

    by_platform: dict[UUID | None, dict] = defaultdict(
        lambda: {"customers": set(), "campaigns": set(), "leads": 0}
    )
    for platform_id, customer_id, campaign_id in leads.values_list(
        "platform_id", "linked_customer_id", "campaign_id"
    ):
        by_platform[platform_id]["leads"] += 1
        if customer_id:
            by_platform[platform_id]["customers"].add(customer_id)
        if campaign_id:
            by_platform[platform_id]["campaigns"].add(campaign_id)

    platforms = {
        p.pk: p
        for p in MarketingPlatform.objects.select_related("channel").filter(
            pk__in=[k for k in by_platform if k]
        )
    }

    rows = []
    for platform_id, bucket in by_platform.items():
        fin = financial_for_customers(
            bucket["customers"], date_from=filters.date_from, date_to=filters.date_to
        )
        spend_qs = CampaignSpend.objects.filter(campaign_id__in=bucket["campaigns"])
        if filters.has_financial_period:
            spend_qs = spend_qs.filter(
                spend_date__gte=filters.date_from, spend_date__lte=filters.date_to
            )
        spend = quantize_money(spend_qs.aggregate(s=Sum("amount")).get("s") or Decimal("0"))
        contrib = marketing_contribution(fin["net_profit"], spend)
        p = platforms.get(platform_id) if platform_id else None
        rows.append(
            {
                "platform": (
                    {"id": str(p.pk), "name": p.name, "code": p.code}
                    if p
                    else {"id": None, "name": None, "code": None}
                ),
                "channel": (
                    {
                        "id": str(p.channel_id),
                        "name": p.channel.name,
                        "code": p.channel.code,
                    }
                    if p
                    else {"id": None, "name": None, "code": None}
                ),
                "leads": bucket["leads"],
                "converted_customers": len(bucket["customers"]),
                "procedures": fin["procedures"],
                "collected_revenue": money_to_str(fin["collected_revenue"]),
                "net_profit": money_to_str(fin["net_profit"]),
                "campaign_spend": money_to_str(spend),
                "marketing_contribution": money_to_str(contrib),
                "roas": roas_to_str(roas(fin["collected_revenue"], spend)),
                "marketing_roi": rate_to_str(marketing_roi(contrib, spend)),
            }
        )

    page = filters.page
    page_size = filters.page_size
    total = len(rows)
    start = (page - 1) * page_size
    return {
        "filters": filters.to_dict(),
        "count": total,
        "page": page,
        "page_size": page_size,
        "results": rows[start : start + page_size],
    }
