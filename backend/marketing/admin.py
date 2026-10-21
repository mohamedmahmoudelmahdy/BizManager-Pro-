from django.contrib import admin

from . import models


@admin.register(models.LeadNumberSequence)
class LeadNumberSequenceAdmin(admin.ModelAdmin):
    list_display = ("scope_key", "next_value", "updated_at")
    search_fields = ("scope_key",)
    readonly_fields = ("updated_at",)
    ordering = ("scope_key",)


@admin.register(models.MarketingChannel)
class MarketingChannelAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_active", "created_at")
    search_fields = ("name", "code", "description")
    list_filter = ("is_active",)
    readonly_fields = ("id", "created_at", "updated_at")
    ordering = ("name",)


@admin.register(models.MarketingPlatform)
class MarketingPlatformAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "channel", "is_active", "created_at")
    search_fields = ("name", "code", "description")
    list_filter = ("is_active", "channel")
    readonly_fields = ("id", "created_at", "updated_at")
    ordering = ("name",)


@admin.register(models.MarketingCampaign)
class MarketingCampaignAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "platform", "status", "is_active", "budget", "created_at")
    search_fields = ("name", "code", "description", "objective")
    list_filter = ("status", "is_active", "platform")
    readonly_fields = ("id", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(models.MarketingAdSet)
class MarketingAdSetAdmin(admin.ModelAdmin):
    list_display = ("name", "campaign", "is_active", "budget", "created_at")
    search_fields = ("name", "external_reference")
    list_filter = ("is_active",)
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(models.MarketingAdvertisement)
class MarketingAdvertisementAdmin(admin.ModelAdmin):
    list_display = ("name", "campaign", "ad_set", "is_active", "created_at")
    search_fields = ("name", "external_reference", "creative_reference")
    list_filter = ("is_active",)
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(models.CampaignSpend)
class CampaignSpendAdmin(admin.ModelAdmin):
    list_display = (
        "campaign",
        "spend_date",
        "amount",
        "currency",
        "integration_status",
        "expense_id",
        "created_at",
    )
    search_fields = ("description", "external_reference", "financial_reference")
    list_filter = ("integration_status", "currency", "spend_date")
    readonly_fields = ("id", "created_at", "updated_at", "integrated_at")
    ordering = ("-spend_date",)


@admin.register(models.Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = (
        "lead_number",
        "name",
        "normalized_phone",
        "status",
        "outcome",
        "campaign",
        "marketing_owner",
        "linked_customer",
        "created_at",
    )
    search_fields = ("lead_number", "name", "raw_phone", "normalized_phone", "email")
    list_filter = ("status", "outcome", "campaign")
    readonly_fields = (
        "id",
        "lead_number",
        "normalized_phone",
        "converted_at",
        "converted_by",
        "archived_at",
        "archived_by",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at",)


@admin.register(models.LeadActivity)
class LeadActivityAdmin(admin.ModelAdmin):
    list_display = ("lead", "activity_type", "subject", "occurred_at", "created_by")
    search_fields = ("subject", "notes", "lead__lead_number", "lead__name")
    list_filter = ("activity_type",)
    readonly_fields = ("id", "created_at")
    ordering = ("-occurred_at",)


@admin.register(models.LeadFollowUp)
class LeadFollowUpAdmin(admin.ModelAdmin):
    list_display = ("lead", "assigned_to", "scheduled_for", "status", "completed_at")
    search_fields = ("notes", "lead__lead_number", "lead__name")
    list_filter = ("status",)
    readonly_fields = ("id", "created_at", "updated_at")
    ordering = ("scheduled_for",)


@admin.register(models.LeadAssignment)
class LeadAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        "lead",
        "operations_employee",
        "status",
        "assigned_at",
        "accepted_at",
        "completed_at",
    )
    search_fields = ("notes", "lead__lead_number", "lead__name")
    list_filter = ("status",)
    readonly_fields = ("id", "assigned_at")
    ordering = ("-assigned_at",)
