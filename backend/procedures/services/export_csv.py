"""CSV export for procedure audit (admin/manager)."""
from __future__ import annotations

import csv
import io
from decimal import Decimal

from procedures.models import Procedure

EXPORT_HEADERS = [
    "Serial",
    "Date",
    "Procedure name",
    "Description",
    "Customer",
    "Assigned employee",
    "Status",
    "Sales / Selling price",
    "Cost",
    "Paid / Cash in",
    "Cash out type",
    "Payment method",
    "Created by",
    "Created at",
    "Updated at",
]

STATUS_LABELS = {
    Procedure.Status.SUBMITTED: "Submitted",
    Procedure.Status.IN_PROCESS: "In Process",
    Procedure.Status.NEED_INFO: "Need Information",
    Procedure.Status.DONE: "Completed",
    Procedure.Status.REJECTED: "Rejected",
}


def _employee_display(user) -> str:
    if not user:
        return ""
    profile = getattr(user, "employee_profile", None)
    if profile and profile.full_name:
        return profile.full_name
    return user.get_full_name() or user.username or ""


def _customer_display(customer) -> str:
    if not customer:
        return ""
    return customer.company_name or customer.name or ""


def _card_label(card) -> str:
    if not card:
        return ""
    return card.bank_name or ""


def _money(value) -> str:
    if value is None:
        return ""
    return f"{Decimal(str(value)):.2f}"


def build_procedure_export_csv(queryset) -> bytes:
    """Return UTF-8 CSV bytes with BOM for Excel Arabic support."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_HEADERS)

    ordered = queryset.select_related(
        "customer", "assigned_employee", "cash_out_type", "cash_in_type"
    ).order_by("date", "created_at", "id")

    for serial, procedure in enumerate(ordered, start=1):
        writer.writerow(
            [
                serial,
                procedure.date.isoformat() if procedure.date else "",
                procedure.category or "",
                procedure.description or "",
                _customer_display(procedure.customer),
                _employee_display(procedure.assigned_employee),
                STATUS_LABELS.get(procedure.status, procedure.status),
                _money(procedure.selling_price),
                _money(procedure.cost),
                _money(procedure.paid),
                _card_label(procedure.cash_out_type),
                _card_label(procedure.cash_in_type),
                "",
                procedure.created_at.isoformat(sep=" ", timespec="seconds") if procedure.created_at else "",
                procedure.updated_at.isoformat(sep=" ", timespec="seconds") if procedure.updated_at else "",
            ]
        )

    return ("\ufeff" + buffer.getvalue()).encode("utf-8")
