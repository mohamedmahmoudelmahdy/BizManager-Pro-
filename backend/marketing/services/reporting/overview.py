"""Overview dashboard reporting aggregates."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from marketing.models import Lead, LeadAssignment, LeadFollowUp
from marketing.services.reporting.calculations import (
    as_decimal,
    decimal_to_str,
    quantize_money,
    quantize_rate,
    rate_to_str,
    safe_ratio,
)
from marketing.services.reporting.filters import parse_report_filters
from marketing.services.reporting.querysets import (
    CONVERTED_Q,
    TERMINAL_LEAD_STATUSES,
    base_operational_leads,
    filter_assigned_to,
    has_active_assignment_exists,
    leads_converted_in_range,
    leads_created_in_range,
    spend_in_range,
)
from marketing.services.reporting.visibility import (
    can_view_spend_metrics,
    ensure_dashboard_or_report_permission,
    visible_report_leads,
)

User = get_user_model()


def _money_ratio(numerator: Decimal, denominator: int) -> str | None:
    if denominator == 0:
        return None
    return decimal_to_str(quantize_money(as_decimal(numerator) / Decimal(denominator)))


def build_overview_report(actor: User, params: dict) -> dict:
    ensure_dashboard_or_report_permission(actor)
    filters = parse_report_filters(params)

    visible = visible_report_leads(actor)
    operational = filter_assigned_to(base_operational_leads(visible, filters), filters)

    created_qs = leads_created_in_range(operational, filters)
    total_leads = created_qs.count()

    active_leads = operational.exclude(status__in=TERMINAL_LEAD_STATUSES).count()

    converted_cohort = created_qs.filter(CONVERTED_Q).count()
    conversion_events_qs = leads_converted_in_range(operational, filters)
    conversion_events = conversion_events_qs.count()
    lost_leads = created_qs.filter(status=Lead.Status.LOST).count()

    conversion_rate = safe_ratio(converted_cohort, total_leads)

    duration_expr = ExpressionWrapper(
        F("converted_at") - F("created_at"),
        output_field=DurationField(),
    )
    avg_raw = (
        conversion_events_qs.filter(converted_at__gte=F("created_at"))
        .annotate(_ttc=duration_expr)
        .aggregate(avg=Avg("_ttc"))["avg"]
    )
    avg_hours = None
    if avg_raw is not None:
        avg_hours = quantize_rate(as_decimal(avg_raw.total_seconds()) / Decimal("3600"))

    status_rows = {
        row["status"]: row["count"]
        for row in created_qs.values("status").annotate(count=Count("id"))
    }
    status_breakdown = []
    for code, _label in Lead.Status.choices:
        if not filters.include_archived and code == Lead.Status.ARCHIVED:
            continue
        status_breakdown.append({"code": code, "count": status_rows.get(code, 0)})

    outcome_breakdown = []
    for row in created_qs.values("outcome").annotate(count=Count("id")).order_by("outcome"):
        outcome_breakdown.append(
            {"code": row["outcome"] if row["outcome"] else None, "count": row["count"]}
        )

    spend_payload = {"total": "0.00", "cost_per_lead": None, "cost_per_conversion": None}
    if can_view_spend_metrics(actor):
        total_spend = quantize_money(
            spend_in_range(filters).aggregate(total=Coalesce(Sum("amount"), Decimal("0")))["total"]
        )
        spend_payload = {
            "total": decimal_to_str(total_spend),
            "cost_per_lead": _money_ratio(total_spend, total_leads),
            "cost_per_conversion": _money_ratio(total_spend, converted_cohort),
        }

    now = timezone.now()
    today = timezone.localdate()
    today_start = timezone.make_aware(datetime.combine(today, time.min))
    tomorrow_start = today_start + timedelta(days=1)
    next_7_end = today_start + timedelta(days=8)

    followup_base = LeadFollowUp.objects.filter(lead_id__in=operational.values("pk"))
    followup_agg = followup_base.aggregate(
        pending=Count("id", filter=Q(status=LeadFollowUp.Status.PENDING)),
        overdue=Count(
            "id",
            filter=Q(status=LeadFollowUp.Status.PENDING, scheduled_for__lt=now),
        ),
        due_today=Count(
            "id",
            filter=Q(
                status=LeadFollowUp.Status.PENDING,
                scheduled_for__gte=today_start,
                scheduled_for__lt=tomorrow_start,
            ),
        ),
        due_next_7_days=Count(
            "id",
            filter=Q(
                status=LeadFollowUp.Status.PENDING,
                scheduled_for__gte=tomorrow_start,
                scheduled_for__lt=next_7_end,
            ),
        ),
        completed=Count("id", filter=Q(status=LeadFollowUp.Status.COMPLETED)),
        cancelled=Count("id", filter=Q(status=LeadFollowUp.Status.CANCELLED)),
    )

    unassigned = (
        operational.annotate(_has_active=has_active_assignment_exists())
        .filter(_has_active=False)
        .count()
    )
    assignment_qs = LeadAssignment.objects.filter(lead_id__in=operational.values("pk"))
    assignment_agg = assignment_qs.aggregate(
        pending=Count("id", filter=Q(status=LeadAssignment.Status.PENDING)),
        accepted=Count("id", filter=Q(status=LeadAssignment.Status.ACCEPTED)),
    )

    return {
        "filters": filters.to_dict(),
        "meta": {
            "conversion_rate_definition": "converted_cohort / total_leads",
            "conversion_rate_scale": "ratio_0_to_1",
            "converted_invariant": (
                "status=converted AND linked_customer IS NOT NULL AND converted_at IS NOT NULL"
            ),
            "average_time_to_conversion_basis": "conversion_events_in_range",
            "spend_basis": "campaign_spend.spend_date",
            "include_archived_default": False,
            "followup_due_field": "scheduled_for",
        },
        "leads": {
            "total": total_leads,
            "active": active_leads,
            "converted_cohort": converted_cohort,
            "conversion_events": conversion_events,
            "lost": lost_leads,
            "conversion_rate": rate_to_str(conversion_rate),
            "average_time_to_conversion_hours": (
                format(avg_hours, "f") if avg_hours is not None else None
            ),
        },
        "breakdowns": {
            "status": status_breakdown,
            "outcome": outcome_breakdown,
        },
        "spend": spend_payload,
        "followups": {
            "pending": followup_agg["pending"],
            "overdue": followup_agg["overdue"],
            "due_today": followup_agg["due_today"],
            "due_next_7_days": followup_agg["due_next_7_days"],
            "completed": followup_agg["completed"],
            "cancelled": followup_agg["cancelled"],
        },
        "assignments": {
            "unassigned_leads": unassigned,
            "pending": assignment_agg["pending"],
            "accepted": assignment_agg["accepted"],
            "active_total": assignment_agg["pending"] + assignment_agg["accepted"],
        },
    }
