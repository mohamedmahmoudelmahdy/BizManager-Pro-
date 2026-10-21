from django.contrib import admin

from .models import (
    CheckPDC,
    DebtLiability,
    DebtPayment,
    EmployeeAdvance,
    EmployeeAdvanceDeduction,
    FinancialImportJob,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)


@admin.register(LedgerAccount)
class LedgerAccountAdmin(admin.ModelAdmin):
    list_display = ("name", "account_code", "account_type", "status", "current_balance", "created_at")
    search_fields = ("name", "account_code")
    list_filter = ("account_type", "status")


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ("ledger_account", "date", "entry_type", "amount", "status", "source_type")
    list_filter = ("status", "entry_type", "source_type")


@admin.register(CheckPDC)
class CheckPDCAdmin(admin.ModelAdmin):
    list_display = ("check_number", "payee", "amount", "due_date", "status", "risk_level")
    list_filter = ("status", "risk_level")


@admin.register(DebtLiability)
class DebtLiabilityAdmin(admin.ModelAdmin):
    list_display = ("name", "creditor", "remaining_balance", "status", "next_payment_date")
    list_filter = ("status", "debt_type")


@admin.register(DebtPayment)
class DebtPaymentAdmin(admin.ModelAdmin):
    list_display = ("debt", "amount", "payment_date", "payment_method")


@admin.register(FinancialImportJob)
class FinancialImportJobAdmin(admin.ModelAdmin):
    list_display = ("original_filename", "status", "total_rows", "created_at", "created_by")


@admin.register(FinancialImportRow)
class FinancialImportRowAdmin(admin.ModelAdmin):
    list_display = ("job", "sheet_name", "row_number", "detected_type", "status")


@admin.register(EmployeeAdvance)
class EmployeeAdvanceAdmin(admin.ModelAdmin):
    list_display = (
        "employee",
        "amount",
        "outstanding_balance",
        "date",
        "status",
        "source_account",
        "created_at",
    )
    list_filter = ("status", "date")
    search_fields = ("employee__username", "reason")
    readonly_fields = ("created_at", "updated_at", "reversed_at")


@admin.register(EmployeeAdvanceDeduction)
class EmployeeAdvanceDeductionAdmin(admin.ModelAdmin):
    list_display = ("advance", "employee", "amount", "date", "period", "created_at")
    list_filter = ("date", "period")
    search_fields = ("employee__username", "notes")
