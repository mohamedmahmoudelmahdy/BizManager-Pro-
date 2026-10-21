from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from .models import (
    CheckPDC,
    DebtLiability,
    DebtPayment,
    EmployeeAdvance,
    EmployeeAdvanceDeduction,
    EmployeeAdvanceRepayment,
    FinancialImportJob,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)
from .services.ledger import unreconciled_count
from .services.ledger_import_delete import can_delete_imported_ledger_account


class LedgerAccountSerializer(serializers.ModelSerializer):
    linked_customer_name = serializers.CharField(source="linked_customer.name", read_only=True, default="")
    linked_employee_name = serializers.CharField(
        source="linked_employee.username", read_only=True, default=""
    )
    linked_payment_method_name = serializers.CharField(
        source="linked_payment_method.bank_name", read_only=True, default=""
    )
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    total_credit = serializers.SerializerMethodField()
    total_debit = serializers.SerializerMethodField()
    unreconciled_count = serializers.SerializerMethodField()
    import_created = serializers.SerializerMethodField()
    import_only = serializers.SerializerMethodField()
    can_delete_imported = serializers.SerializerMethodField()
    delete_imported_reason = serializers.SerializerMethodField()
    import_draft_entry_count = serializers.SerializerMethodField()

    class Meta:
        model = LedgerAccount
        fields = [
            "id",
            "name",
            "account_code",
            "account_type",
            "linked_customer",
            "linked_customer_name",
            "linked_employee",
            "linked_employee_name",
            "linked_payment_method",
            "linked_payment_method_name",
            "linked_vendor_name",
            "status",
            "opening_balance_type",
            "opening_balance_amount",
            "current_balance",
            "total_credit",
            "total_debit",
            "unreconciled_count",
            "import_created",
            "import_only",
            "can_delete_imported",
            "delete_imported_reason",
            "import_draft_entry_count",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "last_activity_at",
            "closed_at",
            "closed_reason",
            "last_reconciled_at",
        ]
        read_only_fields = [
            "id",
            "current_balance",
            "total_credit",
            "total_debit",
            "unreconciled_count",
            "import_created",
            "import_only",
            "can_delete_imported",
            "delete_imported_reason",
            "import_draft_entry_count",
            "created_by",
            "created_at",
            "updated_at",
            "last_activity_at",
            "closed_at",
            "last_reconciled_at",
        ]

    def _entry_totals(self, obj):
        # Cache per-object so total_credit + total_debit don't each re-query.
        cached = getattr(obj, "_entry_totals_cache", None)
        if cached is not None:
            return cached
        posted = obj.entries.filter(
            status__in=[
                LedgerEntry.Status.POSTED,
                LedgerEntry.Status.RECONCILED,
                LedgerEntry.Status.REVERSED,
            ]
        )
        credit = posted.filter(entry_type=LedgerEntry.EntryType.CREDIT).aggregate(
            t=Sum("amount")
        ).get("t") or Decimal("0")
        debit = posted.filter(entry_type=LedgerEntry.EntryType.DEBIT).aggregate(
            t=Sum("amount")
        ).get("t") or Decimal("0")
        obj._entry_totals_cache = (credit, debit)
        return credit, debit

    def get_total_credit(self, obj):
        credit, _ = self._entry_totals(obj)
        return float(credit)

    def get_total_debit(self, obj):
        _, debit = self._entry_totals(obj)
        return float(debit)

    def get_unreconciled_count(self, obj):
        return unreconciled_count(obj)

    def _import_delete_meta(self, obj):
        cached = getattr(obj, "_import_delete_meta_cache", None)
        if cached is not None:
            return cached
        allowed, reason, stats = can_delete_imported_ledger_account(obj)
        cached = (allowed, reason, stats)
        obj._import_delete_meta_cache = cached
        return cached

    def get_import_created(self, obj):
        _, _, stats = self._import_delete_meta(obj)
        return stats.get("import_created", False)

    def get_import_only(self, obj):
        _, _, stats = self._import_delete_meta(obj)
        return stats.get("import_only", False)

    def get_can_delete_imported(self, obj):
        allowed, _, _ = self._import_delete_meta(obj)
        return allowed

    def get_delete_imported_reason(self, obj):
        _, reason, _ = self._import_delete_meta(obj)
        return reason

    def get_import_draft_entry_count(self, obj):
        _, _, stats = self._import_delete_meta(obj)
        return stats.get("import_draft_entry_count", 0)


class LedgerEntrySerializer(serializers.ModelSerializer):
    ledger_account_name = serializers.CharField(source="ledger_account.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    reversed_by_name = serializers.CharField(source="reversed_by.username", read_only=True, default="")
    is_reversal = serializers.SerializerMethodField()
    can_reverse_generically = serializers.SerializerMethodField()
    generic_reverse_block_reason = serializers.SerializerMethodField()

    def get_is_reversal(self, obj):
        return obj.reversal_of_id is not None

    def get_can_reverse_generically(self, obj):
        from financial_control.services import ledger as ledger_svc

        allowed, _ = ledger_svc.can_reverse_ledger_entry_generically(obj)
        return allowed

    def get_generic_reverse_block_reason(self, obj):
        from financial_control.services import ledger as ledger_svc

        _, reason = ledger_svc.can_reverse_ledger_entry_generically(obj)
        return reason

    class Meta:
        model = LedgerEntry
        fields = [
            "id",
            "ledger_account",
            "ledger_account_name",
            "date",
            "description",
            "entry_type",
            "amount",
            "previous_balance",
            "resulting_balance",
            "running_balance",
            "status",
            "reversal_of",
            "is_reversal",
            "can_reverse_generically",
            "generic_reverse_block_reason",
            "reversed_by",
            "reversed_by_name",
            "reversal_reason",
            "source_type",
            "source_id",
            "related_customer",
            "related_employee",
            "related_procedure",
            "related_expense",
            "related_payment",
            "related_payment_method",
            "affects_payment_method",
            "payment_method_balance_before",
            "payment_method_balance_after",
            "attachment",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "reconciled_at",
            "reversed_at",
        ]
        read_only_fields = [
            "id",
            "previous_balance",
            "resulting_balance",
            "running_balance",
            "payment_method_balance_before",
            "payment_method_balance_after",
            "reversal_of",
            "is_reversal",
            "reversed_by",
            "reversal_reason",
            "created_by",
            "created_at",
            "reconciled_at",
            "reversed_at",
        ]

    def validate(self, attrs):
        affects = attrs.get("affects_payment_method", False)
        if affects and not attrs.get("related_payment_method"):
            raise serializers.ValidationError(
                {
                    "related_payment_method": (
                        "A payment method is required when updating the payment method balance."
                    )
                }
            )
        return attrs


class CheckPDCSerializer(serializers.ModelSerializer):
    bank_account_name = serializers.CharField(source="bank_account.bank_name", read_only=True, default="")
    linked_ledger_account_name = serializers.CharField(
        source="linked_ledger_account.name", read_only=True, default=""
    )
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    days_until_due = serializers.SerializerMethodField()

    def get_days_until_due(self, obj):
        from django.utils import timezone

        return (obj.due_date - timezone.localdate()).days

    class Meta:
        model = CheckPDC
        fields = [
            "id",
            "check_number",
            "payee",
            "amount",
            "due_date",
            "bank_account",
            "bank_account_name",
            "linked_ledger_account",
            "linked_ledger_account_name",
            "related_customer",
            "related_employee",
            "related_debt",
            "check_type",
            "status",
            "risk_level",
            "notes",
            "attachment",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "deducted_at",
            "cancelled_at",
            "replaced_by",
            "days_until_due",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_at",
            "updated_at",
            "deducted_at",
            "cancelled_at",
            "replaced_by",
            "days_until_due",
        ]


class DebtLiabilitySerializer(serializers.ModelSerializer):
    linked_ledger_account_name = serializers.CharField(
        source="linked_ledger_account.name", read_only=True, default=""
    )
    default_payment_method_name = serializers.CharField(
        source="default_payment_method.bank_name", read_only=True, default=""
    )
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    display_status = serializers.SerializerMethodField()
    paid_percent = serializers.SerializerMethodField()

    def get_display_status(self, obj):
        from financial_control.services.debts import debt_display_status

        return debt_display_status(obj)

    def get_paid_percent(self, obj):
        if not obj.original_amount:
            return 100
        return round(float(obj.paid_amount or 0) / float(obj.original_amount) * 100)

    class Meta:
        model = DebtLiability
        fields = [
            "id",
            "name",
            "creditor",
            "debt_type",
            "original_amount",
            "paid_amount",
            "remaining_balance",
            "installment_amount",
            "total_installments",
            "due_date",
            "next_payment_date",
            "payment_frequency",
            "linked_ledger_account",
            "linked_ledger_account_name",
            "default_payment_method",
            "default_payment_method_name",
            "status",
            "risk_level",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "closed_at",
            "display_status",
            "paid_percent",
        ]
        read_only_fields = [
            "id",
            "paid_amount",
            "remaining_balance",
            "created_by",
            "created_at",
            "updated_at",
            "closed_at",
            "display_status",
            "paid_percent",
        ]


class DebtPaymentSerializer(serializers.ModelSerializer):
    debt_name = serializers.CharField(source="debt.name", read_only=True)
    payment_method_name = serializers.CharField(
        source="payment_method.bank_name", read_only=True, default=""
    )
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")

    class Meta:
        model = DebtPayment
        fields = [
            "id",
            "debt",
            "debt_name",
            "amount",
            "payment_date",
            "payment_method",
            "payment_method_name",
            "reference_number",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "linked_expense",
            "linked_ledger_entry",
        ]
        read_only_fields = ["id", "created_by", "created_at", "linked_expense", "linked_ledger_entry"]


class FinancialImportRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialImportRow
        fields = [
            "id",
            "job",
            "sheet_name",
            "row_number",
            "detected_type",
            "raw_data_json",
            "normalized_data_json",
            "status",
            "mapping_status",
            "warning_message",
            "error_message",
            "linked_ledger_entry",
            "linked_object_type",
            "linked_object_id",
        ]
        read_only_fields = fields


class FinancialImportJobListSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")

    class Meta:
        model = FinancialImportJob
        fields = [
            "id",
            "original_filename",
            "status",
            "total_sheets",
            "total_rows",
            "valid_rows",
            "warning_rows",
            "error_rows",
            "created_by_name",
            "created_at",
            "completed_at",
            "archived",
            "summary_json",
        ]
        read_only_fields = fields


class FinancialImportJobSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")
    confirmed_by_name = serializers.CharField(source="confirmed_by.username", read_only=True, default="")

    class Meta:
        model = FinancialImportJob
        fields = [
            "id",
            "file",
            "original_filename",
            "status",
            "total_sheets",
            "total_rows",
            "valid_rows",
            "warning_rows",
            "error_rows",
            "duplicate_hash",
            "created_by",
            "created_by_name",
            "created_at",
            "completed_at",
            "confirmed_at",
            "confirmed_by",
            "confirmed_by_name",
            "archived",
            "profile",
            "mapping_json",
            "summary_json",
        ]
        read_only_fields = [
            "id",
            "status",
            "total_sheets",
            "total_rows",
            "valid_rows",
            "warning_rows",
            "error_rows",
            "duplicate_hash",
            "created_by",
            "created_at",
            "completed_at",
            "confirmed_at",
            "confirmed_by",
            "archived",
            "summary_json",
        ]


def _employee_name(user) -> str:
    if not user:
        return ""
    profile = getattr(user, "employee_profile", None)
    if profile and profile.full_name:
        return profile.full_name
    return getattr(user, "username", "") or ""


class EmployeeAdvanceDeductionSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeAdvanceDeduction
        fields = [
            "id",
            "advance",
            "amount",
            "date",
            "period",
            "linked_salary_expense",
            "linked_ledger_entry",
            "created_at",
            "notes",
            "status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "reversal_ledger_entry",
        ]
        read_only_fields = fields


class EmployeeAdvanceRepaymentSerializer(serializers.ModelSerializer):
    payment_method_name = serializers.CharField(
        source="payment_method.bank_name", read_only=True, default=""
    )

    class Meta:
        model = EmployeeAdvanceRepayment
        fields = [
            "id",
            "advance",
            "employee",
            "amount",
            "date",
            "payment_method",
            "payment_method_name",
            "linked_ledger_entry",
            "created_by",
            "created_at",
            "notes",
            "status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
        ]
        read_only_fields = fields


class EmployeeAdvanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    source_account_name = serializers.CharField(
        source="source_account.bank_name", read_only=True, default=""
    )
    created_by_name = serializers.CharField(
        source="created_by.username", read_only=True, default=""
    )
    deductions = EmployeeAdvanceDeductionSerializer(many=True, read_only=True)
    repayments = EmployeeAdvanceRepaymentSerializer(many=True, read_only=True)

    class Meta:
        model = EmployeeAdvance
        fields = [
            "id",
            "employee",
            "employee_name",
            "amount",
            "outstanding_balance",
            "date",
            "reason",
            "status",
            "source_account",
            "source_account_name",
            "linked_expense",
            "linked_ledger_account",
            "linked_ledger_entry",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "reversed_at",
            "reversal_reason",
            "deductions",
            "repayments",
        ]
        read_only_fields = fields

    def get_employee_name(self, obj) -> str:
        return _employee_name(obj.employee)
