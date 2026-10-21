"""Resolve dashboard expiry alerts by updating source customer/worker fields."""
from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from customers.models import CompanyEmployee, Customer
from customers.serializers import CompanyEmployeeSerializer, CustomerSerializer
from procedures.serializers import ProcedureSerializer
from procedures.services.create_with_accounting import create_procedure_with_accounting

User = get_user_model()

ALERT_THRESHOLD_DAYS = 30

CUSTOMER_FIELD_ALERT_TYPES: dict[str, set[str]] = {
    "license_expiry": {
        "license_expiry",
        "licenseExpiry",
        "trade_license_expiry",
        "tradeLicenseExpiry",
        "license",
    },
    "establishment_card_expiry": {
        "establishment_card_expiry",
        "establishmentCardExpiry",
        "establishment_card",
    },
    "workers_expiry": {"workers_expiry", "workersExpiry", "workers"},
    "health_insurance_expiry": {
        "health_insurance_expiry",
        "healthInsuranceExpiry",
        "health_insurance",
        "insurance",
    },
    "echannel_expiry": {"echannel_expiry", "echannelExpiry", "echannel"},
    "visa_expiry": {"visa_expiry", "visaExpiry", "visa", "residency_visa_expiry"},
    "insurance_expiry": {"insurance_expiry", "insuranceExpiry", "individual_insurance_expiry"},
}

WORKER_FIELD_ALERT_TYPES: dict[str, set[str]] = {
    "residency_expiry": {
        "worker_residency_expiry",
        "residency",
        "residency_expiry",
        "residencyExpiry",
    },
    "insurance_expiry": {
        "worker_insurance_expiry",
        "worker_insurance",
        "workerInsuranceExpiry",
    },
}

PROCEDURE_STATUS_MAP = {
    "submitted": "submitted",
    "in_process": "in-process",
    "in-process": "in-process",
    "completed": "done",
    "done": "done",
    "need-info": "need-info",
    "rejected": "rejected",
}


def _normalize_field(field: str, alert_type: str, *, worker_id=None) -> tuple[str, str]:
    if worker_id:
        for worker_field, aliases in WORKER_FIELD_ALERT_TYPES.items():
            if field == worker_field or alert_type in aliases or field in aliases:
                return "worker", worker_field
    if field in CUSTOMER_FIELD_ALERT_TYPES:
        return "customer", field
    if field in WORKER_FIELD_ALERT_TYPES:
        return "worker", field
    for customer_field, aliases in CUSTOMER_FIELD_ALERT_TYPES.items():
        if alert_type in aliases or field in aliases:
            return "customer", customer_field
    for worker_field, aliases in WORKER_FIELD_ALERT_TYPES.items():
        if alert_type in aliases or field in aliases:
            return "worker", worker_field
    raise ValidationError({"field": f"Unsupported alert field: {field or alert_type}"})


def _can_edit_customer(user) -> bool:
    return bool(user and user.is_authenticated and user.role in ("admin", "manager", "employee", "cashier"))


def _can_edit_worker_or_create_procedure(user) -> bool:
    return bool(user and user.is_authenticated and user.role in ("admin", "manager", "employee"))


def _days_until_expiry(expiry: date | None) -> int | None:
    if not expiry:
        return None
    today = timezone.localdate()
    return (expiry - today).days


def resolve_dashboard_alert(*, user, payload: dict) -> dict:
    alert_type = str(payload.get("alert_type") or "").strip()
    field = str(payload.get("field") or alert_type).strip()
    customer_id = payload.get("customer_id")
    worker_id = payload.get("worker_id")
    new_expiry_raw = payload.get("new_expiry_date")
    notes = str(payload.get("notes") or "").strip()
    create_procedure = bool(payload.get("create_procedure"))

    if not customer_id:
        raise ValidationError({"customer_id": "customer_id is required."})
    if not new_expiry_raw:
        raise ValidationError({"new_expiry_date": "new_expiry_date is required."})

    try:
        new_expiry_date = date.fromisoformat(str(new_expiry_raw))
    except ValueError as exc:
        raise ValidationError({"new_expiry_date": "Invalid date format. Use YYYY-MM-DD."}) from exc

    target_kind, resolved_field = _normalize_field(field, alert_type, worker_id=worker_id)

    if target_kind == "customer" and not _can_edit_customer(user):
        raise PermissionDenied("You do not have permission to update customer expiry dates.")
    if target_kind == "worker" and not _can_edit_worker_or_create_procedure(user):
        raise PermissionDenied("You do not have permission to update worker expiry dates.")
    if create_procedure and not _can_edit_worker_or_create_procedure(user):
        raise PermissionDenied("You do not have permission to create procedures.")

    try:
        customer = Customer.objects.get(pk=customer_id)
    except Customer.DoesNotExist as exc:
        raise ValidationError({"customer_id": "Customer not found."}) from exc

    updated_customer = None
    updated_worker = None

    if target_kind == "customer":
        if resolved_field == "health_insurance_expiry" and customer.no_health_insurance:
            raise ValidationError({"field": "Customer is marked as having no health insurance."})
        setattr(customer, resolved_field, new_expiry_date)
        if notes:
            extra = dict(customer.extra_data or {})
            extra.setdefault("alert_resolution_notes", [])
            if isinstance(extra["alert_resolution_notes"], list):
                extra["alert_resolution_notes"].append(
                    {
                        "field": resolved_field,
                        "notes": notes,
                        "resolved_at": timezone.now().isoformat(),
                        "resolved_by": getattr(user, "username", ""),
                    }
                )
            customer.extra_data = extra
            customer.save(update_fields=[resolved_field, "extra_data", "updated_at"])
        else:
            customer.save(update_fields=[resolved_field, "updated_at"])
        updated_customer = customer
    else:
        if not worker_id:
            raise ValidationError({"worker_id": "worker_id is required for worker expiry alerts."})
        try:
            worker = CompanyEmployee.objects.select_related("company").get(pk=worker_id, company=customer)
        except CompanyEmployee.DoesNotExist as exc:
            raise ValidationError({"worker_id": "Worker not found for this customer."}) from exc
        if resolved_field == "insurance_expiry" and worker.no_health_insurance:
            raise ValidationError({"field": "Worker is marked as having no health insurance."})
        setattr(worker, resolved_field, new_expiry_date)
        worker.save(update_fields=[resolved_field])
        updated_worker = worker

    created_procedure = None
    if create_procedure:
        procedure_payload = dict(payload.get("procedure") or {})
        category = str(procedure_payload.get("category") or "").strip()
        if not category:
            raise ValidationError({"procedure": {"category": "Procedure category is required."}})

        status_value = PROCEDURE_STATUS_MAP.get(
            str(procedure_payload.get("status") or "submitted").strip(),
            "submitted",
        )
        assigned_employee = procedure_payload.get("assigned_employee") or None
        if assigned_employee:
            try:
                assigned_employee = User.objects.get(pk=assigned_employee)
            except User.DoesNotExist as exc:
                raise ValidationError({"procedure": {"assigned_employee": "Employee not found."}}) from exc

        raw_procedure = {
            "customer": customer.pk,
            "category": category,
            "description": procedure_payload.get("description") or "",
            "notes": notes,
            "cost": procedure_payload.get("cost") or 0,
            "selling_price": procedure_payload.get("selling_price") or 0,
            "cash_in": procedure_payload.get("cash_in") or 0,
            "paid": procedure_payload.get("paid") or procedure_payload.get("cash_in") or 0,
            "cash_out_type": procedure_payload.get("cash_out_type") or None,
            "cash_in_type": procedure_payload.get("cash_in_type") or None,
            "customer_card_mode": procedure_payload.get("customer_card_mode", False),
            "status": status_value,
            "assigned_employee": getattr(assigned_employee, "pk", None),
            "date": procedure_payload.get("date") or timezone.localdate().isoformat(),
        }
        serializer = ProcedureSerializer(data=raw_procedure)
        serializer.is_valid(raise_exception=True)
        created_procedure = create_procedure_with_accounting(
            user=user,
            validated_data=dict(serializer.validated_data),
            raw_data=raw_procedure,
        )

    days_until = _days_until_expiry(new_expiry_date)
    alert_may_remain = days_until is not None and days_until <= ALERT_THRESHOLD_DAYS
    warning = None
    if alert_may_remain:
        if days_until is not None and days_until < 0:
            warning = "Updated date is still expired; alert may remain visible."
        else:
            warning = (
                f"Updated date is still within the {ALERT_THRESHOLD_DAYS}-day alert window; "
                "alert may remain visible."
            )

    response = {
        "customer": CustomerSerializer(updated_customer).data if updated_customer else None,
        "worker": CompanyEmployeeSerializer(updated_worker).data if updated_worker else None,
        "procedure": ProcedureSerializer(created_procedure).data if created_procedure else None,
        "alert_may_remain": alert_may_remain,
        "days_until_expiry": days_until,
        "warning": warning,
        "field": resolved_field,
        "target": target_kind,
    }
    return response
