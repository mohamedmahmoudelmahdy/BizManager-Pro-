from django.contrib import admin

from .models import Payment, PaymentRefund


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("customer", "amount", "type", "date", "bank_card")
    search_fields = ("customer__name", "procedure__category")
    list_filter = ("type",)


@admin.register(PaymentRefund)
class PaymentRefundAdmin(admin.ModelAdmin):
    list_display = ("customer", "amount", "date", "payment_method", "payment", "created_by")
    search_fields = ("customer__name", "reason", "notes")
    list_filter = ("date",)
    readonly_fields = (
        "id",
        "payment",
        "customer",
        "amount",
        "date",
        "payment_method",
        "reason",
        "notes",
        "created_by",
        "created_at",
    )
