"""Attributed customer value rows (safe aggregates only)."""

from __future__ import annotations

from django.contrib.auth import get_user_model

from marketing.services.revenue_attribution.calculations import money_to_str
from marketing.services.revenue_attribution.customer_scope import apply_lead_filters
from marketing.services.revenue_attribution.filters import parse_revenue_filters
from marketing.services.revenue_attribution.financial_adapter import financial_for_customers
from marketing.services.revenue_attribution.permissions import ensure_revenue_detail_permission
from marketing.services.revenue_attribution.visibility import visible_converted_leads

User = get_user_model()


def _display_name(customer) -> str:
    if customer is None:
        return ""
    return (customer.company_name or customer.name or "").strip() or str(customer.pk)


def build_customers_revenue(actor: User, params: dict) -> dict:
    ensure_revenue_detail_permission(actor)
    filters = parse_revenue_filters(params, allow_pagination=True)
    leads = apply_lead_filters(visible_converted_leads(actor), filters).order_by(
        "-converted_at"
    )
    total = leads.count()
    start = (filters.page - 1) * filters.page_size
    page_leads = list(
        leads.select_related("linked_customer", "campaign")[start : start + filters.page_size]
    )

    results = []
    for lead in page_leads:
        cust_ids = [lead.linked_customer_id] if lead.linked_customer_id else []
        fin = financial_for_customers(
            cust_ids, date_from=filters.date_from, date_to=filters.date_to
        )
        results.append(
            {
                "customer": (
                    {
                        "id": str(lead.linked_customer_id),
                        "display_name": _display_name(lead.linked_customer),
                    }
                    if lead.linked_customer_id
                    else None
                ),
                "lead_number": lead.lead_number,
                "lead_id": str(lead.pk),
                "campaign": (
                    {"id": str(lead.campaign_id), "name": lead.campaign.name}
                    if lead.campaign_id
                    else None
                ),
                "converted_at": lead.converted_at.isoformat() if lead.converted_at else None,
                "procedures": fin["procedures"],
                "collected_revenue": money_to_str(fin["collected_revenue"]),
                "net_profit": money_to_str(fin["net_profit"]),
                "first_payment_at": (
                    fin["first_payment_at"].isoformat() if fin["first_payment_at"] else None
                ),
                "latest_payment_at": (
                    fin["latest_payment_at"].isoformat() if fin["latest_payment_at"] else None
                ),
            }
        )

    return {
        "filters": filters.to_dict(),
        "count": total,
        "page": filters.page,
        "page_size": filters.page_size,
        "results": results,
    }
