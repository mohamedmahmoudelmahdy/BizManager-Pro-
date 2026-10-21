"""Procedure-type contribution for attributed customers.

Net Profit is allocatable by Procedure.category.
Collected Revenue is not allocatable at procedure type (payments are not
reliably linked to procedures) — returned as null.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model

from marketing.services.revenue_attribution.calculations import money_to_str
from marketing.services.revenue_attribution.customer_scope import resolve_scope
from marketing.services.revenue_attribution.filters import parse_revenue_filters
from marketing.services.revenue_attribution.financial_adapter import procedure_type_aggregates
from marketing.services.revenue_attribution.permissions import ensure_revenue_detail_permission

User = get_user_model()


def build_procedure_types_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_detail_permission(actor)
    filters = parse_revenue_filters(params, allow_pagination=True)
    scope = resolve_scope(actor, filters)
    rows = procedure_type_aggregates(
        scope.customer_ids,
        date_from=filters.date_from,
        date_to=filters.date_to,
        category=filters.procedure_type_id,
    )
    results = [
        {
            "procedure_type": r["procedure_type"],
            "procedure_count": r["procedure_count"],
            "customer_count": r["customer_count"],
            "collected_revenue": money_to_str(r["collected_revenue"]),
            "net_profit": money_to_str(r["net_profit"]),
            "average_revenue": money_to_str(r["average_revenue"]),
            "average_net_profit": money_to_str(r["average_net_profit"]),
        }
        for r in rows
    ]
    total = len(results)
    start = (filters.page - 1) * filters.page_size
    return {
        "filters": filters.to_dict(),
        "count": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "results": results[start : start + filters.page_size],
        "meta": {
            "collected_revenue_allocatable": False,
            "note": "collected_revenue_null_procedure_type_limitation",
        },
    }
