from django.contrib import admin

from einvoicing.models import EInvoiceDocument, EInvoiceOutbox


@admin.register(EInvoiceDocument)
class EInvoiceDocumentAdmin(admin.ModelAdmin):
    list_display = ("idempotency_key", "status", "source_type", "source_id", "updated_at")
    list_filter = ("status", "source_type")
    search_fields = ("idempotency_key", "provider_ref", "source_id")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(EInvoiceOutbox)
class EInvoiceOutboxAdmin(admin.ModelAdmin):
    list_display = ("id", "event_type", "status", "attempts", "available_at", "processed_at")
    list_filter = ("status", "event_type")
    readonly_fields = ("id", "created_at", "processed_at")
