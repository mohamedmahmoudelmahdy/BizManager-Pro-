from decimal import Decimal
from django.db import transaction
from django.db.models import Prefetch
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from accounts.permissions import (
    IsAdminManagerEmployee,
    IsAdminManagerEmployeeCashier,
)

from customers.models import Customer
from customers.services.account_controls import ensure_customer_account_active
from customers.serializers_transfer import PaymentTransferSerializer
from customers.services.financial_transfer import transfer_payment_to_customer_atomic
from procedures.models import Procedure
from payments.models import Payment, PaymentRefund
from payments.serializers import (
    PaymentRefundCreateSerializer,
    PaymentRefundSerializer,
    PaymentSerializer,
)
from payments.services.payment_effects import apply_payment_effects, revert_payment_effects
from payments.services.refunds import ensure_can_refund, refund_payment_atomic


def _validate_payment_method(payment_type, bank_card):
    if not bank_card:
        raise ValidationError({"bank_card": "Payment method is required."})
    if payment_type == "cash" and bank_card.method_type != "cash":
        raise ValidationError({"bank_card": "Cash payments must use a cash method."})
    if payment_type in ("pos", "transfer") and bank_card.method_type != "bank":
        raise ValidationError({"bank_card": "POS/Transfer payments must use a bank method."})


def _payment_has_refunds(payment) -> bool:
    return PaymentRefund.objects.filter(payment_id=payment.pk).exists()


class PaymentViewSet(viewsets.ModelViewSet):
    serializer_class = PaymentSerializer
    permission_classes = [IsAdminManagerEmployeeCashier]
    pagination_class = None

    def get_permissions(self):
        if getattr(self, "action", None) == "transfer_customer":
            return [IsAdminManagerEmployee()]
        if getattr(self, "action", None) == "refund":
            # Fine-grained check happens in the action via ensure_can_refund.
            return [IsAdminManagerEmployeeCashier()]
        return [IsAdminManagerEmployeeCashier()]

    def get_queryset(self):
        qs = Payment.objects.select_related(
            "customer",
            "procedure",
            "bank_card",
            "recorded_by",
            "recorded_by__employee_profile",
        ).prefetch_related(
            Prefetch("refunds", queryset=PaymentRefund.objects.order_by("date", "created_at"))
        )
        if getattr(self.request.user, "role", None) == "employee":
            qs = qs.filter(recorded_by=self.request.user)
        customer_id = self.request.query_params.get("customer")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)
        return qs

    def _check_employee_can_modify(self, instance):
        user = self.request.user
        if user.is_authenticated and getattr(user, "role", None) == "employee":
            if instance.recorded_by_id != user.id:
                raise PermissionDenied("You can only edit or delete payments you recorded.")

    def perform_create(self, serializer):
        payment_type = serializer.validated_data.get("type")
        bank_card = serializer.validated_data.get("bank_card")
        customer = serializer.validated_data.get("customer")
        _validate_payment_method(payment_type, bank_card)

        with transaction.atomic():
            if customer:
                locked_customer = Customer.objects.select_for_update().get(pk=customer.pk)
                ensure_customer_account_active(locked_customer)
            payment = serializer.save(recorded_by=self.request.user)
            apply_payment_effects(payment)

    def perform_update(self, serializer):
        instance = self.get_object()
        self._check_employee_can_modify(instance)
        if _payment_has_refunds(instance):
            raise ValidationError(
                {
                    "code": "payment_not_refundable",
                    "detail": "Payments with refunds cannot be edited. Issue a refund instead of rewriting history.",
                }
            )

        payment_type = serializer.validated_data.get("type", instance.type)
        bank_card = serializer.validated_data.get("bank_card", instance.bank_card)
        new_customer = serializer.validated_data.get("customer", instance.customer)
        _validate_payment_method(payment_type, bank_card)

        with transaction.atomic():
            if new_customer and new_customer.pk != instance.customer_id:
                locked_customer = Customer.objects.select_for_update().get(pk=new_customer.pk)
                ensure_customer_account_active(locked_customer)
            revert_payment_effects(instance)
            payment = serializer.save()
            apply_payment_effects(payment)

    def perform_destroy(self, instance):
        self._check_employee_can_modify(instance)
        if _payment_has_refunds(instance):
            raise ValidationError(
                {
                    "code": "payment_not_refundable",
                    "detail": "Payments with refunds cannot be deleted.",
                }
            )
        with transaction.atomic():
            revert_payment_effects(instance)
            instance.delete()

    @action(detail=True, methods=["post"], url_path="transfer-customer")
    def transfer_customer(self, request, pk=None):
        """Atomically move a Payment to another Customer without duplicating bank totals."""
        serializer = PaymentTransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = transfer_payment_to_customer_atomic(
            payment_id=pk,
            target_customer_id=data["target_customer_id"],
            actor=request.user,
            reason=data["reason"],
            target_procedure_id=data.get("target_procedure_id"),
        )
        payment = Payment.objects.select_related(
            "customer", "procedure", "bank_card", "recorded_by"
        ).get(pk=pk)
        return Response(
            {
                "payment": PaymentSerializer(payment).data,
                "transfer": result,
            }
        )

    @action(detail=True, methods=["post"], url_path="refund")
    def refund(self, request, pk=None):
        """Issue a full or partial refund against this Payment (append-only)."""
        ensure_can_refund(request.user)
        serializer = PaymentRefundCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = refund_payment_atomic(
            payment_id=pk,
            amount=data["amount"],
            payment_method_id=data["payment_method"],
            date=data["date"],
            reason=data["reason"],
            notes=data.get("notes", ""),
            created_by=request.user,
        )
        payment = (
            Payment.objects.select_related("customer", "procedure", "bank_card", "recorded_by")
            .get(pk=pk)
        )
        return Response(
            {
                "refund": PaymentRefundSerializer(result["refund"]).data,
                "payment": PaymentSerializer(payment).data,
                "original_amount": result["original_amount"],
                "refunded_amount": result["refunded_amount"],
                "refundable_amount": result["refundable_amount"],
                "balance_before": result["balance_before"],
                "balance_after": result["balance_after"],
                "customer_financial_summary": result["customer_financial_summary"],
            }
        )
