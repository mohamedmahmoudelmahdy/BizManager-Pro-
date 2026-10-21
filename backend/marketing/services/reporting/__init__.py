"""
Marketing CRM reporting services (Phase 3.3A).

Read-only aggregations. Metric definitions are documented in
``marketing/docs/reporting_contract.md``.
"""

from marketing.services.reporting.overview import build_overview_report
from marketing.services.reporting.lead_trends import build_lead_trends_report
from marketing.services.reporting.campaign_performance import build_campaign_performance_report
from marketing.services.reporting.followup_workload import build_followup_workload_report
from marketing.services.reporting.assignment_workload import build_assignment_workload_report
from marketing.services.reporting.filters import parse_report_filters

__all__ = [
    "parse_report_filters",
    "build_overview_report",
    "build_lead_trends_report",
    "build_campaign_performance_report",
    "build_followup_workload_report",
    "build_assignment_workload_report",
]
