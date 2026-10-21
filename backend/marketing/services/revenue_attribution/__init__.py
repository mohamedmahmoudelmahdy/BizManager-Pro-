"""Marketing Revenue Attribution (Phase 4.1) — read-only aggregates."""

from marketing.services.revenue_attribution.campaigns import build_campaigns_revenue
from marketing.services.revenue_attribution.channels import build_channels_revenue
from marketing.services.revenue_attribution.customers import build_customers_revenue
from marketing.services.revenue_attribution.leads import build_leads_revenue
from marketing.services.revenue_attribution.overview import build_overview_revenue
from marketing.services.revenue_attribution.platforms import build_platforms_revenue
from marketing.services.revenue_attribution.procedure_types import build_procedure_types_revenue

__all__ = [
    "build_overview_revenue",
    "build_channels_revenue",
    "build_platforms_revenue",
    "build_campaigns_revenue",
    "build_leads_revenue",
    "build_customers_revenue",
    "build_procedure_types_revenue",
]
