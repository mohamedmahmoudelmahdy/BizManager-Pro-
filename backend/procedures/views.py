from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils.dateparse import parse_date
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.permissions import IsAdmin, IsAdminManagerEmployee, IsAdminOrManager

from .models import DeletedProcedureLog, Procedure, ProcedureCategory
from .serializers import ProcedureSerializer, ProcedureCategorySerializer
from .services.create_with_accounting import create_procedure_with_accounting
from .services.export_csv import build_procedure_export_csv
from customers.serializers_transfer import ProcedureTransferSerializer
from customers.services.financial_transfer import transfer_procedure_to_customer_atomic
from payments.models import Payment


def _subtract_months(from_date: date, months: int) -> date:
    year, month = from_date.year, from_date.month - months
    while month <= 0:
        month += 12
        year -= 1
    last_day = monthrange(year, month)[1]
    return date(year, month, min(from_date.day, last_day))


def _apply_procedure_query_filters(queryset, query_params):
    assigned_employee = query_params.get("assigned_employee")
    if assigned_employee:
        queryset = queryset.filter(assigned_employee_id=assigned_employee)

    status_param = query_params.get("status")
    if status_param:
        queryset = queryset.filter(status=status_param)

    date_from = parse_date(query_params.get("date_from") or "")
    if date_from:
        queryset = queryset.filter(date__gte=date_from)

    date_to = parse_date(query_params.get("date_to") or "")
    if date_to:
        queryset = queryset.filter(date__lte=date_to)

    months_param = query_params.get("months")
    has_range_filter = bool(date_from or date_to or months_param)

    if months_param:
        try:
            months = int(months_param)
            if months > 0:
                cutoff = _subtract_months(date.today(), months)
                queryset = queryset.filter(date__gte=cutoff)
        except (TypeError, ValueError):
            pass

    single_date = parse_date(query_params.get("date") or "")
    if single_date and not has_range_filter:
        queryset = queryset.filter(date=single_date)

    customer_id = query_params.get("customer")
    if customer_id:
        queryset = queryset.filter(customer_id=customer_id)

    return queryset

# Special cash-out "method": no debit from any card; only (selling_price - cost) added to customer balance.
CUSTOMER_CARD_BANK_NAME = "Customer Card / كرت العميل"


def _is_customer_card(card):
    if not card:
        return False
    return getattr(card, "bank_name", None) == CUSTOMER_CARD_BANK_NAME or str(getattr(card, "pk", "")) == "CUSTOMER_CARD"

def _truthy(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


class ProcedureCategoryViewSet(viewsets.ModelViewSet):
    """List and create procedure categories (procedure types). Destroy admin-only."""
    queryset = ProcedureCategory.objects.all()
    serializer_class = ProcedureCategorySerializer
    permission_classes = [IsAdminManagerEmployee]
    pagination_class = None

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAdmin()]
        return [IsAdminManagerEmployee()]


class ProcedureViewSet(viewsets.ModelViewSet):
    serializer_class = ProcedureSerializer
    permission_classes = [IsAdminManagerEmployee]
    pagination_class = None

    def get_queryset(self):
        queryset = Procedure.objects.select_related(
            "customer",
            "assigned_employee",
            "assigned_employee__employee_profile",
            "cash_out_type",
            "cash_in_type",
        ).all()
        user = self.request.user
        if user.is_authenticated and user.role == "employee":
            status_param = self.request.query_params.get("status")
            if status_param:
                queryset = queryset.filter(status=status_param)
            else:
                queryset = queryset.filter(assigned_employee=user)
            customer_id = self.request.query_params.get("customer")
            if customer_id:
                queryset = queryset.filter(customer_id=customer_id)
            return queryset

        return _apply_procedure_query_filters(queryset, self.request.query_params)

    @action(detail=False, methods=["get"], url_path="export")
    def export_csv(self, request):
        """Admin/manager CSV export using the same filters as the procedures list."""
        user = request.user
        if not user.is_authenticated or user.role not in ("admin", "manager"):
            raise PermissionDenied("Only admin and manager users can export procedures.")

        queryset = Procedure.objects.select_related(
            "customer",
            "assigned_employee",
            "assigned_employee__employee_profile",
            "cash_out_type",
            "cash_in_type",
        ).all()
        queryset = _apply_procedure_query_filters(queryset, request.query_params)
        content = build_procedure_export_csv(queryset)
        filename = "procedures-audit.csv"
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="transfer-customer")
    def transfer_customer(self, request, pk=None):
        """Atomically move a Procedure (and linked Payments) to another Customer."""
        serializer = ProcedureTransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = transfer_procedure_to_customer_atomic(
            procedure_id=pk,
            target_customer_id=data["target_customer_id"],
            actor=request.user,
            reason=data["reason"],
            transfer_linked_payments=data.get("transfer_linked_payments", True),
        )
        procedure = Procedure.objects.select_related(
            "customer", "assigned_employee", "cash_out_type", "cash_in_type"
        ).get(pk=pk)
        return Response(
            {
                "procedure": ProcedureSerializer(procedure).data,
                "transfer": result,
            }
        )

    def perform_create(self, serializer):
        user = self.request.user
        if user.is_authenticated and user.role == "employee":
            assignee = serializer.validated_data.get("assigned_employee")
            if assignee and assignee.pk != user.pk:
                raise PermissionDenied("Employees can only create procedures assigned to themselves.")
        serializer.instance = create_procedure_with_accounting(
            user=self.request.user,
            validated_data=dict(serializer.validated_data),
            raw_data=self.request.data,
        )

    def perform_destroy(self, instance):
        """Revert customer and payment method balances when a procedure is deleted. Log for admin."""
        user = self.request.user
        if user.is_authenticated and getattr(user, "role", None) == "employee":
            if instance.assigned_employee_id != user.id:
                raise PermissionDenied("You can only delete procedures assigned to you.")

        linked_payments = Payment.objects.filter(procedure_id=instance.pk).count()
        if linked_payments:
            raise ValidationError(
                {
                    "detail": (
                        "Cannot delete a procedure with linked payments. "
                        "Delete or unlink payments first so collections stay consistent."
                    ),
                    "code": "procedure_has_payments",
                    "payment_count": linked_payments,
                }
            )

        cash_out_type = instance.cash_out_type
        cash_in_type = instance.cash_in_type
        customer = instance.customer
        cost = Decimal(instance.cost or 0)
        selling_price = Decimal(instance.selling_price or 0)
        paid = Decimal(instance.paid or 0)
        procedure_date = instance.date
        # Snapshot for audit log before delete
        procedure_id = instance.id
        customer_name = getattr(customer, "company_name", None) or getattr(customer, "name", "") if customer else ""
        category = instance.category

        with transaction.atomic():
            # Revert cash out: add cost back (Customer Card was not debited, so nothing to add back)
            if cash_out_type and not _is_customer_card(cash_out_type):
                locked_out = cash_out_type.__class__.objects.select_for_update().get(pk=cash_out_type.pk)
                locked_out.balance = locked_out.balance + cost
                locked_out.save(update_fields=["balance"])

            # Legacy cash-in without Payment rows (historical). New creates use Payment only.
            if cash_in_type and paid:
                locked_in = cash_in_type.__class__.objects.select_for_update().get(pk=cash_in_type.pk)
                locked_in.balance = locked_in.balance - paid
                locked_in.save(update_fields=["balance"])

            if customer:
                locked_customer = customer.__class__.objects.select_for_update().get(pk=customer.pk)
                # New create path charges full selling then Payment reduces; with paid=0 and no payments,
                # revert is full selling (or customer-card selling-cost).
                revert_delta = (selling_price - cost) if _is_customer_card(cash_out_type) else (selling_price - paid)
                locked_customer.balance = locked_customer.balance - revert_delta
                if procedure_date:
                    locked_customer.last_activity = procedure_date
                locked_customer.save(update_fields=["balance", "last_activity"])

            instance.delete()

            DeletedProcedureLog.objects.create(
                procedure_id=procedure_id,
                deleted_by=user if user.is_authenticated else None,
                customer_name=customer_name,
                category=category,
                selling_price=selling_price,
                date=procedure_date,
            )

    def perform_update(self, serializer):
        user = self.request.user
        instance = self.get_object()
        serializer.validated_data.pop("customer_card_mode", None)
        # Procedure.paid is derived from Payment/PaymentRefund — never mutate here.
        serializer.validated_data.pop("paid", None)
        if user.is_authenticated and getattr(user, "role", None) == "employee":
            if instance.assigned_employee_id != user.id:
                raise PermissionDenied("You can only edit procedures assigned to you.")
        new_date = serializer.validated_data.get("date", instance.date)

        old_customer = instance.customer
        new_customer = serializer.validated_data.get("customer", old_customer)
        old_selling = Decimal(instance.selling_price or 0)
        # Locked: paid only changes via Payment / Refund effects.
        locked_paid = Decimal(instance.paid or 0)
        new_selling = Decimal(serializer.validated_data.get("selling_price", old_selling))
        old_cost = Decimal(instance.cost or 0)
        new_cost = Decimal(serializer.validated_data.get("cost", old_cost))

        old_cash_out = instance.cash_out_type
        new_cash_out = serializer.validated_data.get("cash_out_type", old_cash_out)
        # cash_in_type may still be stored for UI; bank cash-in is owned by Payment rows.
        raw_customer_card_mode = self.request.data.get("customer_card_mode", None)
        if raw_customer_card_mode is None and "cash_out_type" in self.request.data:
            raw_customer_card_mode = str(self.request.data.get("cash_out_type", "")) == "CUSTOMER_CARD"
        use_customer_card_mode = _truthy(raw_customer_card_mode) if raw_customer_card_mode is not None else _is_customer_card(new_cash_out)

        if use_customer_card_mode:
            if new_cost != Decimal("0"):
                raise ValidationError({"cost": "Cost must be 0 when cash out type is Customer Card."})
            if new_selling < Decimal("0"):
                raise ValidationError({"selling_price": "Selling price cannot be negative."})

        with transaction.atomic():
            # Cash out: cost is paid from method → revert old (+old_cost), apply new (-new_cost); skip for Customer Card
            old_is_cc = _is_customer_card(old_cash_out)
            new_is_cc = use_customer_card_mode or _is_customer_card(new_cash_out)
            if old_cash_out and new_cash_out and old_cash_out.pk == new_cash_out.pk and not old_is_cc:
                diff_out = old_cost - new_cost
                if diff_out != 0:
                    locked_out = old_cash_out.__class__.objects.select_for_update().get(pk=old_cash_out.pk)
                    if diff_out < 0 and locked_out.balance + diff_out < 0:
                        raise ValidationError({"cost": "Insufficient balance in the selected cash-out method."})
                    locked_out.balance = locked_out.balance + diff_out
                    locked_out.save(update_fields=["balance"])
            else:
                if old_cash_out and not old_is_cc:
                    locked_old = old_cash_out.__class__.objects.select_for_update().get(pk=old_cash_out.pk)
                    locked_old.balance = locked_old.balance + old_cost
                    locked_old.save(update_fields=["balance"])
                if new_cash_out and not new_is_cc:
                    locked_new = new_cash_out.__class__.objects.select_for_update().get(pk=new_cash_out.pk)
                    if locked_new.balance - new_cost < 0:
                        raise ValidationError({"cost": "Insufficient balance in the selected cash-out method."})
                    locked_new.balance = locked_new.balance - new_cost
                    locked_new.save(update_fields=["balance"])

            # Do NOT adjust BankCard for cash_in / procedure.paid on update.
            # Customer cash movement is owned exclusively by Payment / PaymentRefund.

            # Customer charge: non-CC uses selling − locked_paid (collections already applied).
            old_delta = (old_selling - old_cost) if old_is_cc else (old_selling - locked_paid)
            new_delta = (new_selling - new_cost) if new_is_cc else (new_selling - locked_paid)
            if old_customer.pk == new_customer.pk:
                locked_customer = old_customer.__class__.objects.select_for_update().get(pk=old_customer.pk)
                locked_customer.balance = locked_customer.balance + (new_delta - old_delta)
                if new_date:
                    locked_customer.last_activity = new_date
                locked_customer.save(update_fields=["balance", "last_activity"])
            else:
                locked_old_customer = old_customer.__class__.objects.select_for_update().get(pk=old_customer.pk)
                locked_old_customer.balance = locked_old_customer.balance - old_delta
                locked_old_customer.save(update_fields=["balance"])
                locked_new_customer = new_customer.__class__.objects.select_for_update().get(pk=new_customer.pk)
                locked_new_customer.balance = locked_new_customer.balance + new_delta
                if new_date:
                    locked_new_customer.last_activity = new_date
                locked_new_customer.save(update_fields=["balance", "last_activity"])

            serializer.save()
