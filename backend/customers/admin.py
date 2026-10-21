from django.contrib import admin

from .models import (
    Customer,
    CompanyEmployee,
    CustomerAccountEvent,
    CustomerFinancialAdjustment,
    CustomerFinancialTransfer,
)


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "company_name", "type", "phone", "balance", "debt_status", "account_status")
    search_fields = ("name", "company_name", "phone", "email")
    list_filter = ("type", "debt_status", "account_status")


@admin.register(CustomerFinancialAdjustment)
class CustomerFinancialAdjustmentAdmin(admin.ModelAdmin):
    list_display = ("customer", "adjustment_type", "amount", "date", "status", "created_by")
    search_fields = ("customer__name", "customer__company_name", "reason", "notes")
    list_filter = ("adjustment_type", "status", "date")
    readonly_fields = ("created_at", "updated_at", "reversed_at")


@admin.register(CustomerAccountEvent)
class CustomerAccountEventAdmin(admin.ModelAdmin):
    list_display = ("customer", "event_type", "created_by", "created_at")
    search_fields = ("customer__name", "customer__company_name", "reason")
    list_filter = ("event_type",)
    readonly_fields = ("created_at",)


@admin.register(CompanyEmployee)
class CompanyEmployeeAdmin(admin.ModelAdmin):
    list_display = ("name", "company", "residency_expiry", "insurance_expiry")
    search_fields = ("name", "company__name")


@admin.register(CustomerFinancialTransfer)
class CustomerFinancialTransferAdmin(admin.ModelAdmin):
    list_display = (
        "transfer_type",
        "source_customer",
        "target_customer",
        "amount_snapshot",
        "transferred_by",
        "transferred_at",
    )
    search_fields = (
        "reason",
        "source_customer__name",
        "target_customer__name",
        "source_customer__company_name",
        "target_customer__company_name",
    )
    list_filter = ("transfer_type", "transferred_at")
    readonly_fields = (
        "id",
        "transfer_type",
        "procedure",
        "payment",
        "source_customer",
        "target_customer",
        "amount_snapshot",
        "reason",
        "transferred_by",
        "transferred_at",
        "metadata",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
