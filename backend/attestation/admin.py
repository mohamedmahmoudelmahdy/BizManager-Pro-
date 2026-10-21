from django.contrib import admin

from attestation.models import (
    ApplicationDegree,
    ApplicationDocument,
    ApplicationStatusHistory,
    AttestationApplication,
    AttestationAuditEvent,
    AttestationBatch,
    AttestationNumberSequence,
    HRPortalProfile,
)


@admin.register(AttestationBatch)
class AttestationBatchAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "public_slug",
        "customer",
        "linked_procedure",
        "expected_applicant_count",
        "is_active",
        "created_at",
    )
    list_filter = ("is_active",)
    search_fields = ("title", "public_slug", "customer__name")
    readonly_fields = ("id", "created_at", "updated_at")


class ApplicationDegreeInline(admin.TabularInline):
    model = ApplicationDegree
    extra = 0
    readonly_fields = ("id", "created_at")


class ApplicationDocumentInline(admin.TabularInline):
    model = ApplicationDocument
    extra = 0
    readonly_fields = ("id", "uploaded_at", "file", "original_filename")


@admin.register(AttestationApplication)
class AttestationApplicationAdmin(admin.ModelAdmin):
    list_display = (
        "reference_number",
        "full_name",
        "phone",
        "status",
        "batch",
        "submitted_at",
    )
    list_filter = ("status", "batch")
    search_fields = ("reference_number", "full_name", "phone")
    readonly_fields = (
        "id",
        "reference_number",
        "submitted_at",
        "completed_at",
        "created_at",
        "updated_at",
    )
    inlines = [ApplicationDegreeInline, ApplicationDocumentInline]


@admin.register(ApplicationStatusHistory)
class ApplicationStatusHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "application",
        "from_status",
        "to_status",
        "actor_source",
        "changed_by",
        "changed_at",
    )
    readonly_fields = ("id", "changed_at")


@admin.register(AttestationNumberSequence)
class AttestationNumberSequenceAdmin(admin.ModelAdmin):
    list_display = ("scope_key", "next_value", "updated_at")


@admin.register(HRPortalProfile)
class HRPortalProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "customer", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("user__username", "customer__name", "customer__company_name")
    raw_id_fields = ("user", "customer")


@admin.register(AttestationAuditEvent)
class AttestationAuditEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "actor_type", "actor_user", "application", "created_at")
    list_filter = ("event_type", "actor_type")
    readonly_fields = (
        "id",
        "event_type",
        "application",
        "batch",
        "actor_user",
        "actor_type",
        "metadata",
        "created_at",
    )
    search_fields = ("application__reference_number",)
