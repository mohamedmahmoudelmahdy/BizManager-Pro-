"""Assignment workload reporting aggregates."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Count, Q

from marketing.models import LeadAssignment
from marketing.services.reporting.filters import parse_report_filters
from marketing.services.reporting.querysets import (
    base_operational_leads,
    filter_assigned_to,
    has_active_assignment_exists,
)
from marketing.services.reporting.visibility import (
    ensure_report_permission,
    visible_report_leads,
)

User = get_user_model()


def build_assignment_workload_report(actor: User, params: dict) -> dict:
    ensure_report_permission(actor)
    filters = parse_report_filters(params)

    visible = visible_report_leads(actor)
    operational = filter_assigned_to(base_operational_leads(visible, filters), filters)

    unassigned_leads = (
        operational.annotate(_has_active=has_active_assignment_exists())
        .filter(_has_active=False)
        .count()
    )

    assignments = LeadAssignment.objects.filter(lead_id__in=operational.values("pk"))
    if filters.assigned_to is not None:
        assignments = assignments.filter(operations_employee_id=filters.assigned_to)

    summary = assignments.aggregate(
        pending=Count("id", filter=Q(status=LeadAssignment.Status.PENDING)),
        accepted=Count("id", filter=Q(status=LeadAssignment.Status.ACCEPTED)),
        completed=Count("id", filter=Q(status=LeadAssignment.Status.COMPLETED)),
        rejected=Count("id", filter=Q(status=LeadAssignment.Status.REJECTED)),
        cancelled=Count("id", filter=Q(status=LeadAssignment.Status.CANCELLED)),
        reassigned=Count("id", filter=Q(status=LeadAssignment.Status.REASSIGNED)),
        completed_in_range=Count(
            "id",
            filter=Q(
                status=LeadAssignment.Status.COMPLETED,
                completed_at__gte=filters.range_start,
                completed_at__lt=filters.range_end_exclusive,
            ),
        ),
    )
    summary["active_total"] = summary["pending"] + summary["accepted"]
    summary["unassigned_leads"] = unassigned_leads

    by_status = [
        {"code": code, "count": summary[code]}
        for code in (
            "pending",
            "accepted",
            "completed",
            "rejected",
            "cancelled",
            "reassigned",
        )
    ]

    assignee_rows = (
        assignments.filter(operations_employee_id__isnull=False)
        .values(
            "operations_employee_id",
            "operations_employee__first_name",
            "operations_employee__last_name",
            "operations_employee__username",
        )
        .annotate(
            pending=Count("id", filter=Q(status=LeadAssignment.Status.PENDING)),
            accepted=Count("id", filter=Q(status=LeadAssignment.Status.ACCEPTED)),
            completed_in_range=Count(
                "id",
                filter=Q(
                    status=LeadAssignment.Status.COMPLETED,
                    completed_at__gte=filters.range_start,
                    completed_at__lt=filters.range_end_exclusive,
                ),
            ),
            rejected=Count("id", filter=Q(status=LeadAssignment.Status.REJECTED)),
            cancelled=Count("id", filter=Q(status=LeadAssignment.Status.CANCELLED)),
            reassigned=Count("id", filter=Q(status=LeadAssignment.Status.REASSIGNED)),
        )
        .order_by("operations_employee__username")
    )

    by_assignee = []
    for row in assignee_rows:
        first = row["operations_employee__first_name"] or ""
        last = row["operations_employee__last_name"] or ""
        full = f"{first} {last}".strip()
        pending = row["pending"]
        accepted = row["accepted"]
        by_assignee.append(
            {
                "user_id": row["operations_employee_id"],
                "display_name": full or row["operations_employee__username"],
                "pending": pending,
                "accepted": accepted,
                "active_total": pending + accepted,
                "completed_in_range": row["completed_in_range"],
                "rejected": row["rejected"],
                "cancelled": row["cancelled"],
                "reassigned": row["reassigned"],
            }
        )

    return {
        "filters": filters.to_dict(),
        "meta": {
            "active_assignment_definition": "pending OR accepted",
            "unassigned_definition": "no active assignment",
            "lead_visibility_applied": True,
        },
        "summary": summary,
        "by_status": by_status,
        "by_assignee": by_assignee,
    }
