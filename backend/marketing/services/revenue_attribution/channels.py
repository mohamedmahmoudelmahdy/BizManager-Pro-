"""Channel-level revenue attribution aggregates."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from django.contrib.auth import get_user_model

from marketing.models import CampaignSpend, MarketingChannel
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


def _paginate(rows: list, page: int, page_size: int) -> tuple[list, int]:
    total = len(rows)
    start = (page - 1) * page_size
    return rows[start : start + page_size], total


def build_channels_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_detail_permission(actor)
    filters = parse_revenue_filters(params, allow_pagination=True)
    leads = apply_lead_filters(visible_converted_leads(actor), filters)

    # Group without deferred/select_related conflict.
    by_channel: dict[UUID | None, dict] = defaultdict(
        lambda: {"customers": set(), "campaigns": set(), "leads": 0}
    )
    for channel_id, customer_id, campaign_id in leads.values_list(
        "channel_id", "linked_customer_id", "campaign_id"
    ):
        by_channel[channel_id]["leads"] += 1
        if customer_id:
            by_channel[channel_id]["customers"].add(customer_id)
        if campaign_id:
            by_channel[channel_id]["campaigns"].add(campaign_id)

    channel_ids = [cid for cid in by_channel.keys() if cid is not None]
    channels = {
        c.pk: c for c in MarketingChannel.objects.filter(pk__in=channel_ids)
    }

    rows = []
    for channel_id, bucket in by_channel.items():
        fin = financial_for_customers(
            bucket["customers"],
            date_from=filters.date_from,
            date_to=filters.date_to,
        )
        spend_qs = CampaignSpend.objects.filter(campaign_id__in=bucket["campaigns"])
        if filters.has_financial_period:
            spend_qs = spend_qs.filter(
                spend_date__gte=filters.date_from, spend_date__lte=filters.date_to
            )
        from django.db.models import Sum

        spend = quantize_money(spend_qs.aggregate(s=Sum("amount")).get("s") or Decimal("0"))
        contrib = marketing_contribution(fin["net_profit"], spend)
        ch = channels.get(channel_id) if channel_id else None
        rows.append(
            {
                "channel": (
                    {"id": str(ch.pk), "code": ch.code, "name": ch.name}
                    if ch
                    else {"id": None, "code": None, "name": None}
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

    ordering = filters.ordering or "-collected_revenue"
    reverse = ordering.startswith("-")
    key = ordering.lstrip("-")
    allowed = {
        "collected_revenue",
        "net_profit",
        "campaign_spend",
        "marketing_contribution",
        "leads",
        "converted_customers",
    }
    if key in allowed:
        rows.sort(
            key=lambda r: (
                Decimal(r[key]) if key in ("collected_revenue", "net_profit", "campaign_spend", "marketing_contribution") else r[key]
            ),
            reverse=reverse,
        )

    page_rows, total = _paginate(rows, filters.page, filters.page_size)
    return {
        "filters": filters.to_dict(),
        "count": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "results": page_rows,
    }
