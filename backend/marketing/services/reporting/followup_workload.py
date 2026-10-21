"""Follow-up workload reporting aggregates."""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone

from marketing.models import LeadFollowUp
from marketing.services.reporting.filters import parse_report_filters
from marketing.services.reporting.querysets import (
    base_operational_leads,
    filter_assigned_to,
)
from marketing.services.reporting.visibility import (
    ensure_report_permission,
    visible_report_leads,
)

User = get_user_model()


def build_followup_workload_report(actor: User, params: dict) -> dict:
    ensure_report_permission(actor)
    filters = parse_report_filters(params)

    visible = visible_report_leads(actor)
    operational = filter_assigned_to(base_operational_leads(visible, filters), filters)

    now = timezone.now()
    today = timezone.localdate()
    today_start = timezone.make_aware(datetime.combine(today, time.min))
    tomorrow_start = today_start + timedelta(days=1)
    next_7_end = today_start + timedelta(days=8)

    base = LeadFollowUp.objects.filter(lead_id__in=operational.values("pk"))
    if filters.assigned_to is not None:
        base = base.filter(assigned_to_id=filters.assigned_to)

    summary = base.aggregate(
        pending=Count("id", filter=Q(status=LeadFollowUp.Status.PENDING)),
        completed=Count("id", filter=Q(status=LeadFollowUp.Status.COMPLETED)),
        cancelled=Count("id", filter=Q(status=LeadFollowUp.Status.CANCELLED)),
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
    )

    by_status = [
        {"code": LeadFollowUp.Status.PENDING, "count": summary["pending"]},
        {"code": LeadFollowUp.Status.COMPLETED, "count": summary["completed"]},
        {"code": LeadFollowUp.Status.CANCELLED, "count": summary["cancelled"]},
    ]

    assignee_rows = (
        base.filter(assigned_to_id__isnull=False)
        .values(
            "assigned_to_id",
            "assigned_to__first_name",
            "assigned_to__last_name",
            "assigned_to__username",
        )
        .annotate(
            pending=Count("id", filter=Q(status=LeadFollowUp.Status.PENDING)),
            overdue=Count(
                "id",
                filter=Q(status=LeadFollowUp.Status.PENDING, scheduled_for__lt=now),
            ),
            completed=Count("id", filter=Q(status=LeadFollowUp.Status.COMPLETED)),
            total=Count("id"),
        )
        .order_by("assigned_to__username")
    )

    by_assignee = []
    for row in assignee_rows:
        first = row["assigned_to__first_name"] or ""
        last = row["assigned_to__last_name"] or ""
        full = f"{first} {last}".strip()
        by_assignee.append(
            {
                "user_id": row["assigned_to_id"],
                "display_name": full or row["assigned_to__username"],
                "pending": row["pending"],
                "overdue": row["overdue"],
                "completed": row["completed"],
                "total": row["total"],
            }
        )

    unassigned_pending = base.filter(
        assigned_to_id__isnull=True,
        status=LeadFollowUp.Status.PENDING,
    ).count()

    return {
        "filters": filters.to_dict(),
        "meta": {
            "due_field": "scheduled_for",
            "overdue_definition": "status=pending AND scheduled_for < now",
            "lead_visibility_applied": True,
        },
        "summary": {
            "pending": summary["pending"],
            "completed": summary["completed"],
            "cancelled": summary["cancelled"],
            "overdue": summary["overdue"],
            "due_today": summary["due_today"],
            "due_next_7_days": summary["due_next_7_days"],
            "unassigned_pending": unassigned_pending,
        },
        "by_status": by_status,
        "by_assignee": by_assignee,
    }
