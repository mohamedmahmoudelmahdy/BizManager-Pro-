"""Shared queryset builders for Marketing reporting."""

from __future__ import annotations

from django.db.models import Exists, OuterRef, Q, QuerySet

from marketing.models import CampaignSpend, Lead, LeadAssignment
from marketing.services.reporting.filters import ReportFilters


TERMINAL_LEAD_STATUSES = (
    Lead.Status.CONVERTED,
    Lead.Status.LOST,
    Lead.Status.ARCHIVED,
)

CONVERTED_Q = Q(
    status=Lead.Status.CONVERTED,
    linked_customer_id__isnull=False,
    converted_at__isnull=False,
)


def apply_hierarchy_to_leads(qs: QuerySet, filters: ReportFilters) -> QuerySet:
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
    return qs


def apply_hierarchy_to_spend(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    if filters.campaign_id:
        qs = qs.filter(campaign_id=filters.campaign_id)
    elif filters.platform_id:
        qs = qs.filter(campaign__platform_id=filters.platform_id)
    elif filters.channel_id:
        qs = qs.filter(campaign__platform__channel_id=filters.channel_id)
    if filters.adset_id:
        qs = qs.filter(ad_set_id=filters.adset_id)
    if filters.advertisement_id:
        qs = qs.filter(advertisement_id=filters.advertisement_id)
    return qs


def apply_lead_status_outcome(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    if filters.status:
        qs = qs.filter(status=filters.status)
    if filters.outcome is not None:
        qs = qs.filter(outcome=filters.outcome)
    return qs


def exclude_archived_unless_requested(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    if not filters.include_archived:
        qs = qs.exclude(status=Lead.Status.ARCHIVED)
    return qs


def leads_created_in_range(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    return qs.filter(
        created_at__gte=filters.range_start,
        created_at__lt=filters.range_end_exclusive,
    )


def leads_converted_in_range(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    return qs.filter(
        CONVERTED_Q,
        converted_at__gte=filters.range_start,
        converted_at__lt=filters.range_end_exclusive,
    )


def spend_in_range(filters: ReportFilters) -> QuerySet:
    qs = CampaignSpend.objects.filter(
        spend_date__gte=filters.date_from,
        spend_date__lte=filters.date_to,
    )
    return apply_hierarchy_to_spend(qs, filters)


def base_operational_leads(visible_qs: QuerySet, filters: ReportFilters) -> QuerySet:
    """Visible leads with hierarchy + archive policy (not date-scoped)."""
    qs = apply_hierarchy_to_leads(visible_qs, filters)
    qs = exclude_archived_unless_requested(qs, filters)
    qs = apply_lead_status_outcome(qs, filters)
    return qs


def has_active_assignment_exists() -> Exists:
    return Exists(
        LeadAssignment.objects.filter(
            lead_id=OuterRef("pk"),
            status__in=LeadAssignment.ACTIVE_STATUSES,
        )
    )


def filter_assigned_to(qs: QuerySet, filters: ReportFilters) -> QuerySet:
    """Filter leads that currently have an active assignment to ``assigned_to``."""
    if filters.assigned_to is None:
        return qs
    return qs.filter(
        Exists(
            LeadAssignment.objects.filter(
                lead_id=OuterRef("pk"),
                status__in=LeadAssignment.ACTIVE_STATUSES,
                operations_employee_id=filters.assigned_to,
            )
        )
    )
