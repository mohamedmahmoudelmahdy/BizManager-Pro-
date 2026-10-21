from decimal import Decimal
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from accounts.permissions import IsAdminManagerEmployee, IsAdminManagerEmployeeCashier, IsAdminOrManager

from .models import Customer, CompanyEmployee, CustomerFinancialAdjustment
from .serializers import (
    CustomerAccountActionSerializer,
    CustomerFinancialAdjustmentCreateSerializer,
    CustomerFinancialAdjustmentReverseSerializer,
    CustomerFinancialAdjustmentSerializer,
    CustomerSerializer,
    CompanyEmployeeSerializer,
)
from .services.account_controls import (
    apply_customer_discount_atomic,
    close_customer_account_atomic,
    ensure_customer_account_active,
    reopen_customer_account_atomic,
    reverse_customer_financial_adjustment_atomic,
)
from .services.financial_summary import build_customer_financial_summary
from .services.worker_csv_import import import_worker_csv, preview_worker_csv_import


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().order_by("-created_at")
    serializer_class = CustomerSerializer
    permission_classes = [IsAdminManagerEmployeeCashier]
    pagination_class = None

    def get_permissions(self):
        if self.action in ("destroy", "import_workers_csv"):
            return [IsAdminManagerEmployee()]
        if self.action in ("financial_adjustments", "close_account", "reopen_account"):
            return [IsAdminOrManager()]
        return [IsAdminManagerEmployeeCashier()]

    @action(detail=True, methods=["get"], url_path="financial-summary")
    def financial_summary(self, request, pk=None):
        customer = self.get_object()
        return Response(build_customer_financial_summary(customer))

    @action(detail=True, methods=["post"], url_path="financial-adjustments")
    def financial_adjustments(self, request, pk=None):
        customer = self.get_object()
        serializer = CustomerFinancialAdjustmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        adjustment = apply_customer_discount_atomic(
            customer_id=customer.pk,
            amount=serializer.validated_data["amount"],
            date=serializer.validated_data["date"],
            reason=serializer.validated_data["reason"],
            notes=serializer.validated_data.get("notes", ""),
            created_by=request.user,
        )
        return Response(CustomerFinancialAdjustmentSerializer(adjustment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="close-account")
    def close_account(self, request, pk=None):
        serializer = CustomerAccountActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        customer = close_customer_account_atomic(
            customer_id=pk,
            reason=serializer.validated_data["reason"],
            closed_by=request.user,
        )
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["post"], url_path="reopen-account")
    def reopen_account(self, request, pk=None):
        serializer = CustomerAccountActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        customer = reopen_customer_account_atomic(
            customer_id=pk,
            reason=serializer.validated_data["reason"],
            reopened_by=request.user,
        )
        return Response(CustomerSerializer(customer).data)

    @action(
        detail=True,
        methods=["post"],
        url_path="workers/import-csv",
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_workers_csv(self, request, pk=None):
        customer = self.get_object()
        if customer.type != Customer.CustomerType.COMPANY:
            return Response(
                {"detail": "Worker CSV import is only available for company customers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "CSV file is required."}, status=status.HTTP_400_BAD_REQUEST)

        filename = (upload.name or "").lower()
        if not filename.endswith(".csv"):
            return Response({"detail": "Only .csv files are supported."}, status=status.HTTP_400_BAD_REQUEST)

        confirm = str(request.data.get("confirm", "")).lower() in {"1", "true", "yes", "on"}
        if confirm:
            ensure_customer_account_active(customer)

        try:
            if confirm:
                result = import_worker_csv(customer, upload)
                return Response({"preview": False, **result})
            preview = preview_worker_csv_import(customer, upload)
            return Response({"preview": True, **preview})
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response(
                {"detail": "Failed to parse CSV file. Check encoding and column layout."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def perform_destroy(self, instance):
        if Decimal(instance.balance or 0) != Decimal("0"):
            raise ValidationError(
                {"detail": "Customer can only be deleted when balance is exactly 0."}
            )
        if instance.procedures.exists() or instance.payments.exists():
            raise ValidationError(
                {
                    "detail": (
                        "Customer can only be deleted when there are no related procedures "
                        "and no related payments."
                    )
                }
            )
        instance.delete()


class CompanyEmployeeViewSet(viewsets.ModelViewSet):
    queryset = CompanyEmployee.objects.select_related("company").all()
    serializer_class = CompanyEmployeeSerializer
    permission_classes = [IsAdminManagerEmployee]
    pagination_class = None

    def get_permissions(self):
        if self.action == "destroy":
            return [IsAdminManagerEmployee()]
        return [IsAdminManagerEmployee()]

    def perform_create(self, serializer):
        company = serializer.validated_data.get("company")
        if company:
            ensure_customer_account_active(company)
        serializer.save()


class CustomerFinancialAdjustmentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CustomerFinancialAdjustment.objects.select_related(
        "customer", "created_by", "reversed_by"
    ).all()
    serializer_class = CustomerFinancialAdjustmentSerializer
    permission_classes = [IsAdminOrManager]
    pagination_class = None

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse(self, request, pk=None):
        serializer = CustomerFinancialAdjustmentReverseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        adjustment = reverse_customer_financial_adjustment_atomic(
            adjustment_id=pk,
            reason=serializer.validated_data["reason"],
            reversed_by=request.user,
        )
        return Response(CustomerFinancialAdjustmentSerializer(adjustment).data)
