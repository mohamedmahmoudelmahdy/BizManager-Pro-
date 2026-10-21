"""Campaign performance reporting (paginated campaign rows)."""

from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, DecimalField, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from marketing.models import CampaignSpend, Lead, MarketingCampaign
from marketing.services.reporting.calculations import (
    as_decimal,
    decimal_to_str,
    quantize_money,
    rate_to_str,
    safe_ratio,
)
from marketing.services.reporting.filters import parse_report_filters
from marketing.services.reporting.querysets import CONVERTED_Q
from marketing.services.reporting.visibility import (
    ensure_report_permission,
    visible_report_leads,
)

User = get_user_model()


def _money_div(num: Decimal, den: int) -> Decimal | None:
    if den == 0:
        return None
    return quantize_money(as_decimal(num) / Decimal(den))


def build_campaign_performance_report(actor: User, params: dict) -> dict:
    ensure_report_permission(actor)
    filters = parse_report_filters(params, allow_pagination=True)

    visible_leads = visible_report_leads(actor)
    if not filters.include_archived:
        visible_leads = visible_leads.exclude(status=Lead.Status.ARCHIVED)

    lead_filter = Q(
        campaign_id=OuterRef("pk"),
        created_at__gte=filters.range_start,
        created_at__lt=filters.range_end_exclusive,
    )
    # Restrict annotated lead counts to visible lead IDs via subquery filter.
    visible_ids = visible_leads.values("pk")

    leads_created_sq = (
        Lead.objects.filter(lead_filter, pk__in=visible_ids)
        .order_by()
        .values("campaign_id")
        .annotate(c=Count("id"))
        .values("c")
    )
    converted_sq = (
        Lead.objects.filter(lead_filter, CONVERTED_Q, pk__in=visible_ids)
        .order_by()
        .values("campaign_id")
        .annotate(c=Count("id"))
        .values("c")
    )

    spend_filter = Q(
        campaign_id=OuterRef("pk"),
        spend_date__gte=filters.date_from,
        spend_date__lte=filters.date_to,
    )
    if filters.adset_id:
        spend_filter &= Q(ad_set_id=filters.adset_id)
    if filters.advertisement_id:
        spend_filter &= Q(advertisement_id=filters.advertisement_id)

    spend_sq = (
        CampaignSpend.objects.filter(spend_filter)
        .order_by()
        .values("campaign_id")
        .annotate(s=Sum("amount"))
        .values("s")
    )

    campaigns = MarketingCampaign.objects.select_related(
        "platform", "platform__channel"
    ).all()

    if filters.campaign_id:
        campaigns = campaigns.filter(pk=filters.campaign_id)
    if filters.platform_id:
        campaigns = campaigns.filter(platform_id=filters.platform_id)
    if filters.channel_id:
        campaigns = campaigns.filter(platform__channel_id=filters.channel_id)

    if filters.search:
        campaigns = campaigns.filter(
            Q(name__icontains=filters.search) | Q(code__icontains=filters.search)
        )

    zero_dec = Value(Decimal("0"), output_field=DecimalField(max_digits=14, decimal_places=2))

    campaigns = campaigns.annotate(
        leads_created=Coalesce(
            Subquery(leads_created_sq, output_field=IntegerField()),
            Value(0),
        ),
        converted_leads=Coalesce(
            Subquery(converted_sq, output_field=IntegerField()),
            Value(0),
        ),
        spend_total=Coalesce(
            Subquery(spend_sq, output_field=DecimalField(max_digits=14, decimal_places=2)),
            zero_dec,
        ),
    )

    # Python-side rate/cost for sorting stability across SQLite/PG
    rows = list(
        campaigns.values(
            "id",
            "code",
            "name",
            "is_active",
            "platform_id",
            "platform__name",
            "platform__channel_id",
            "platform__channel__name",
            "leads_created",
            "converted_leads",
            "spend_total",
        )
    )

    enriched = []
    for row in rows:
        leads_created = int(row["leads_created"] or 0)
        converted = int(row["converted_leads"] or 0)
        spend = quantize_money(row["spend_total"] or Decimal("0"))
        rate = safe_ratio(converted, leads_created)
        cpl = _money_div(spend, leads_created)
        cpc = _money_div(spend, converted)
        enriched.append(
            {
                "campaign_id": str(row["id"]),
                "campaign_code": row["code"],
                "campaign_name": row["name"],
                "is_active": row["is_active"],
                "platform": {
                    "id": str(row["platform_id"]),
                    "name": row["platform__name"],
                },
                "channel": {
                    "id": str(row["platform__channel_id"]),
                    "name": row["platform__channel__name"],
                },
                "leads_created": leads_created,
                "converted_leads": converted,
                "conversion_rate": rate_to_str(rate),
                "spend": decimal_to_str(spend),
                "cost_per_lead": decimal_to_str(cpl) if cpl is not None else None,
                "cost_per_conversion": decimal_to_str(cpc) if cpc is not None else None,
                "_sort_conversion_rate": float(rate) if rate is not None else -1.0,
                "_sort_cpl": float(cpl) if cpl is not None else -1.0,
                "_sort_cpc": float(cpc) if cpc is not None else -1.0,
                "_sort_spend": float(spend),
                "_sort_name": row["name"].lower(),
            }
        )

    ordering = filters.ordering or "campaign_name"
    reverse = ordering.startswith("-")
    key = ordering.lstrip("-")
    sort_map = {
        "campaign_name": "_sort_name",
        "leads_created": "leads_created",
        "converted_leads": "converted_leads",
        "conversion_rate": "_sort_conversion_rate",
        "spend": "_sort_spend",
        "cost_per_lead": "_sort_cpl",
        "cost_per_conversion": "_sort_cpc",
    }
    sort_key = sort_map.get(key, "_sort_name")
    enriched.sort(key=lambda r: r[sort_key], reverse=reverse)

    total = len(enriched)
    page = filters.page
    page_size = filters.page_size
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = enriched[start:end]

    for row in page_rows:
        for k in list(row):
            if k.startswith("_sort"):
                del row[k]

    return {
        "filters": filters.to_dict(),
        "meta": {
            "conversion_rate_definition": "converted_leads / leads_created (cohort)",
            "conversion_rate_scale": "ratio_0_to_1",
            "spend_basis": "campaign_spend.spend_date",
            "lead_visibility_applied": True,
        },
        "count": total,
        "page": page,
        "page_size": page_size,
        "results": page_rows,
    }
