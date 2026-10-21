"""Revenue attribution overview."""

from __future__ import annotations

from django.contrib.auth import get_user_model

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
from marketing.services.revenue_attribution.customer_scope import (
    campaign_spend_total,
    resolve_scope,
)
from marketing.services.revenue_attribution.filters import parse_revenue_filters
from marketing.services.revenue_attribution.financial_adapter import financial_for_customers
from marketing.services.revenue_attribution.permissions import ensure_revenue_overview_permission

User = get_user_model()


def build_overview_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_overview_permission(actor)
    filters = parse_revenue_filters(params)
    scope = resolve_scope(actor, filters)

    fin = financial_for_customers(
        scope.customer_ids,
        date_from=filters.date_from,
        date_to=filters.date_to,
    )
    spend = campaign_spend_total(scope.campaign_ids, filters)
    contrib = marketing_contribution(fin["net_profit"], spend)
    converted = len(scope.customer_ids)
    leads = scope.leads.count()

    avg_rev = safe_divide(fin["collected_revenue"], converted)
    avg_profit = safe_divide(fin["net_profit"], converted)
    cac = safe_divide(spend, converted)

    return {
        "filters": filters.to_dict(),
        "summary": {
            "leads": leads,
            "converted_customers": converted,
            "procedures": fin["procedures"],
            "collected_revenue": money_to_str(fin["collected_revenue"]),
            "gross_collected_revenue": money_to_str(fin.get("gross_collected_revenue")),
            "refunds": money_to_str(fin.get("refunds")),
            "net_profit": money_to_str(fin["net_profit"]),
            "campaign_spend": money_to_str(spend),
            "marketing_contribution": money_to_str(contrib),
            "roas": roas_to_str(roas(fin["collected_revenue"], spend)),
            "marketing_roi": rate_to_str(marketing_roi(contrib, spend)),
            "customer_acquisition_cost": money_to_str(
                quantize_money(cac) if cac is not None else None
            ),
            "average_customer_revenue": money_to_str(
                quantize_money(avg_rev) if avg_rev is not None else None
            ),
            "average_customer_net_profit": money_to_str(
                quantize_money(avg_profit) if avg_profit is not None else None
            ),
        },
        "meta": {
            "currency": "AED",
            "revenue_label": "collected_revenue",
            "refunds_supported": True,
            "procedure_type_revenue_allocatable": False,
        },
    }
