"""Expense ViewSet — operational paid ledger + employee claim workflow."""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from accounts.permissions import IsAdminManagerEmployee, permission_required
from banking.models import BankCard
from expenses.exceptions import ExpenseBusinessError, ExpenseNotPayableError, raise_expense_error
from expenses.models import Expense, ExpenseAttachment, ExpenseAuditEvent
from expenses.serializers import (
    EmployeeExpenseCreateSerializer,
    EmployeeExpenseUpdateSerializer,
    ExpenseDetailSerializer,
    ExpenseSerializer,
    MarkPaidSerializer,
    ReasonSerializer,
)
from expenses.services.workflow import (
    add_receipt,
    allocate_expense_number,
    approve_expense,
    mark_expense_paid,
    record_audit,
    reject_expense,
    return_expense,
    submit_expense,
    visible_expenses_for,
    withdraw_expense,
)


class OptionalExpensePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer
    permission_classes = [IsAdminManagerEmployee]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    pagination_class = None
    # PATCH + POST workflow only; no PUT replace. DELETE disabled.
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        action = getattr(self, "action", None)
        if action in ("list", "retrieve"):
            return [
                permission_required(
                    "expenses.view_expense",
                    "expenses.view_own_expense",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if action == "create":
            return [
                permission_required(
                    "expenses.add_expense",
                    "expenses.add_own_expense",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if action in ("partial_update", "upload_receipt"):
            return [
                permission_required(
                    "expenses.change_expense",
                    "expenses.change_own_expense",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        if action == "submit":
            return [permission_required("expenses.submit_expense", allow_admin_manager=True)()]
        if action == "withdraw":
            return [permission_required("expenses.withdraw_expense", allow_admin_manager=True)()]
        if action == "approve":
            return [permission_required("expenses.approve_expense", allow_admin_manager=True)()]
        if action == "reject":
            return [permission_required("expenses.reject_expense", allow_admin_manager=True)()]
        if action == "return_for_correction":
            return [permission_required("expenses.return_expense", allow_admin_manager=True)()]
        if action == "mark_paid":
            return [permission_required("expenses.mark_expense_paid", allow_admin_manager=True)()]
        if action == "download_receipt":
            return [
                permission_required(
                    "expenses.view_expense",
                    "expenses.view_own_expense",
                    any_of=True,
                    allow_admin_manager=True,
                )()
            ]
        return [IsAdminManagerEmployee()]

    def get_queryset(self):
        qs = Expense.objects.select_related(
            "assigned_employee",
            "paid_by",
            "submitted_by",
            "expense_for",
            "created_by",
            "approved_by",
            "rejected_by",
            "returned_by",
            "payment_recorded_by",
        ).prefetch_related(
            Prefetch("attachments", queryset=ExpenseAttachment.objects.order_by("created_at")),
            Prefetch(
                "audit_events",
                queryset=ExpenseAuditEvent.objects.select_related("actor").order_by("created_at"),
            ),
        )
        qs = visible_expenses_for(self.request.user, base_qs=qs)

        if getattr(self, "action", None) in (
            "retrieve",
            "partial_update",
            "submit",
            "withdraw",
            "approve",
            "reject",
            "return_for_correction",
            "mark_paid",
            "upload_receipt",
            "download_receipt",
        ):
            return qs

        params = self.request.query_params
        status_filter = (params.get("status") or params.get("workflow_status") or "").strip()
        if status_filter:
            qs = qs.filter(workflow_status=status_filter)
        if params.get("category"):
            qs = qs.filter(category=params["category"])
        if params.get("date_from"):
            qs = qs.filter(date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(date__lte=params["date_to"])
        if params.get("mine", "").lower() in ("1", "true", "yes"):
            qs = qs.filter(
                Q(expense_for_id=self.request.user.pk)
                | Q(submitted_by_id=self.request.user.pk)
            )
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(expense_number__icontains=search)
                | Q(merchant__icontains=search)
                | Q(notes__icontains=search)
                | Q(business_purpose__icontains=search)
            )
        ordering = (params.get("ordering") or "-date").strip()
        allowed = {
            "date",
            "-date",
            "amount",
            "-amount",
            "created_at",
            "-created_at",
            "workflow_status",
            "-workflow_status",
            "expense_number",
            "-expense_number",
        }
        qs = qs.order_by(ordering if ordering in allowed else "-date", "-created_at")
        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ExpenseDetailSerializer
        if self.action == "create" and not self.request.data.get("paid_by"):
            return EmployeeExpenseCreateSerializer
        if self.action == "partial_update":
            instance = getattr(self, "expense_instance", None) or self.get_object()
            if instance.workflow_status in Expense.EDITABLE_STATUSES:
                return EmployeeExpenseUpdateSerializer
        return ExpenseSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if getattr(self, "action", None) == "list":
            from financial_control.models import DebtPayment, LedgerEntry

            context["expense_debt_labels"] = dict(
                DebtPayment.objects.filter(linked_expense__isnull=False).values_list(
                    "linked_expense_id", "debt__name"
                )
            )
            context["expense_check_labels"] = dict(
                LedgerEntry.objects.filter(
                    related_expense__isnull=False,
                    source_type=LedgerEntry.SourceType.CHECK,
                ).values_list("related_expense_id", "description")
            )
        return context

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        # Optional pagination when ?page= is provided (preserves unpaginated FC clients).
        if request.query_params.get("page"):
            paginator = OptionalExpensePagination()
            page = paginator.paginate_queryset(queryset, request, view=self)
            serializer = self.get_serializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        # Employee claim path (no bank card): draft / optional submit.
        if not request.data.get("paid_by"):
            serializer = EmployeeExpenseCreateSerializer(
                data=request.data, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            expense = serializer.save()
            return Response(
                ExpenseDetailSerializer(expense, context=self.get_serializer_context()).data,
                status=status.HTTP_201_CREATED,
            )

        # Operational paid path (existing behaviour).
        serializer = ExpenseSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        expense = serializer.instance
        return Response(
            ExpenseDetailSerializer(expense, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_create(self, serializer):
        paid_by = serializer.validated_data.get("paid_by")
        if not paid_by:
            raise ValidationError({"paid_by": "Payment method is required."})

        amount = Decimal(serializer.validated_data.get("amount") or 0)
        actor = self.request.user
        with transaction.atomic():
            locked = paid_by.__class__.objects.select_for_update().get(pk=paid_by.pk)
            if locked.balance - amount < 0:
                raise ValidationError({"amount": "Insufficient balance for this expense."})
            locked.balance = locked.balance - amount
            locked.save(update_fields=["balance"])
            expense = serializer.save(
                paid_by=locked,
                workflow_status=Expense.WorkflowStatus.PAID,
                paid_at=timezone.now(),
                created_by=actor,
                payment_recorded_by=actor,
                expense_number=allocate_expense_number(),
            )
            if expense.assigned_employee_id and not expense.expense_for_id:
                expense.expense_for_id = expense.assigned_employee_id
                expense.save(update_fields=["expense_for"])
            record_audit(
                expense=expense,
                actor=actor,
                action=ExpenseAuditEvent.Action.CREATED,
                to_status=expense.workflow_status,
                metadata={"path": "operational"},
            )

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        self.expense_instance = instance
        if instance.workflow_status in Expense.EDITABLE_STATUSES:
            serializer = EmployeeExpenseUpdateSerializer(
                instance, data=request.data, partial=True, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            expense = serializer.save()
            return Response(ExpenseDetailSerializer(expense, context=self.get_serializer_context()).data)
        raise ValidationError(
            {"error": {"code": "expense_not_editable", "message": "expense_not_editable", "details": {}}}
        )

    def destroy(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def _workflow_response(self, expense: Expense) -> Response:
        expense = self.get_queryset().get(pk=expense.pk)
        return Response(ExpenseDetailSerializer(expense, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, pk=None):
        try:
            expense = submit_expense(actor=request.user, expense_id=self.get_object().pk)
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="withdraw")
    def withdraw(self, request, pk=None):
        try:
            expense = withdraw_expense(actor=request.user, expense_id=self.get_object().pk)
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        try:
            expense = approve_expense(actor=request.user, expense_id=self.get_object().pk)
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            expense = reject_expense(
                actor=request.user,
                expense_id=self.get_object().pk,
                reason=ser.validated_data["reason"],
            )
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="return")
    def return_for_correction(self, request, pk=None):
        ser = ReasonSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            expense = return_expense(
                actor=request.user,
                expense_id=self.get_object().pk,
                reason=ser.validated_data["reason"],
            )
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        ser = MarkPaidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            expense = mark_expense_paid(
                actor=request.user,
                expense_id=self.get_object().pk,
                paid_by_card_id=ser.validated_data["paid_by"],
                payment_reference=ser.validated_data.get("payment_reference", ""),
            )
        except BankCard.DoesNotExist:
            raise_expense_error(ExpenseNotPayableError(details={"field": "paid_by", "reason": "not_found"}))
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(detail=True, methods=["post"], url_path="receipts", parser_classes=[MultiPartParser, FormParser])
    def upload_receipt(self, request, pk=None):
        uploaded = request.FILES.get("file") or request.FILES.get("receipt")
        if not uploaded:
            raise ValidationError(
                {"error": {"code": "receipt_required", "message": "receipt_required", "details": {}}}
            )
        try:
            add_receipt(actor=request.user, expense_id=self.get_object().pk, uploaded=uploaded)
            expense = self.get_object()
        except ExpenseBusinessError as exc:
            raise_expense_error(exc)
        return self._workflow_response(expense)

    @action(
        detail=True,
        methods=["get"],
        url_path=r"receipts/(?P<attachment_id>[^/.]+)/download",
    )
    def download_receipt(self, request, pk=None, attachment_id=None):
        expense = self.get_object()
        try:
            attachment = expense.attachments.get(pk=attachment_id)
        except ExpenseAttachment.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return FileResponse(
            attachment.file.open("rb"),
            as_attachment=True,
            filename=attachment.original_name or "receipt",
        )