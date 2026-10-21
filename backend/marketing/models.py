import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from customers.models import Customer


class LeadNumberSequence(models.Model):
    """
    Sequential lead-number counter.

    scope_key defaults to \"default\" for the current single-company deployment.
    Future per-company sequences can use distinct scope_key values without a
    tenant FK in this phase. Number allocation is implemented in Phase 2C.
    """

    scope_key = models.CharField(max_length=100, unique=True, default="default")
    next_value = models.PositiveBigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope_key"]

    def clean(self):
        if self.next_value is not None and self.next_value < 1:
            raise ValidationError({"next_value": "next_value must be >= 1."})

    def __str__(self):
        return f"LeadNumberSequence({self.scope_key}) next={self.next_value}"


class MarketingChannel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    code = models.SlugField(max_length=64, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class MarketingPlatform(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.ForeignKey(
        MarketingChannel,
        on_delete=models.PROTECT,
        related_name="platforms",
    )
    name = models.CharField(max_length=255)
    code = models.SlugField(max_length=64, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["channel", "name"], name="uniq_marketing_platform_channel_name"),
        ]

    def __str__(self):
        return f"{self.name} ({self.channel.code})"


class MarketingCampaign(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    platform = models.ForeignKey(
        MarketingPlatform,
        on_delete=models.PROTECT,
        related_name="campaigns",
    )
    name = models.CharField(max_length=255)
    code = models.SlugField(max_length=64, unique=True)
    description = models.TextField(blank=True)
    objective = models.CharField(max_length=255, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=8, default="AED")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_marketing_campaigns",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "name"]
        indexes = [
            models.Index(fields=["status", "is_active"]),
            models.Index(fields=["platform", "status"]),
        ]

    def clean(self):
        errors = {}
        if self.start_date and self.end_date and self.end_date < self.start_date:
            errors["end_date"] = "end_date must be on or after start_date."
        if self.budget is not None and self.budget < Decimal("0"):
            errors["budget"] = "Budget cannot be negative."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.name} [{self.code}]"


class MarketingAdSet(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(
        MarketingCampaign,
        on_delete=models.PROTECT,
        related_name="ad_sets",
    )
    name = models.CharField(max_length=255)
    external_reference = models.CharField(max_length=255, blank=True)
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["campaign", "is_active"]),
        ]

    def clean(self):
        errors = {}
        if self.start_date and self.end_date and self.end_date < self.start_date:
            errors["end_date"] = "end_date must be on or after start_date."
        if self.budget is not None and self.budget < Decimal("0"):
            errors["budget"] = "Budget cannot be negative."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.name} ({self.campaign.code})"


class MarketingAdvertisement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(
        MarketingCampaign,
        on_delete=models.PROTECT,
        related_name="advertisements",
    )
    ad_set = models.ForeignKey(
        MarketingAdSet,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="advertisements",
    )
    name = models.CharField(max_length=255)
    external_reference = models.CharField(max_length=255, blank=True)
    creative_reference = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["campaign", "is_active"]),
        ]

    def clean(self):
        if self.ad_set_id and self.campaign_id and self.ad_set.campaign_id != self.campaign_id:
            raise ValidationError({"ad_set": "Ad Set must belong to the selected Campaign."})

    def __str__(self):
        return f"{self.name} ({self.campaign.code})"


class CampaignSpend(models.Model):
    """
    CRM-side record of campaign spend.

    Financial posting to Expense / Financial Control is deferred.
    expense_id is a nullable UUID reference (no FK) so Phase 2C+ can link
    idempotently without circular app coupling in this phase.
    """

    class IntegrationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        INTEGRATED = "integrated", "Integrated"
        FAILED = "failed", "Failed"
        NOT_REQUIRED = "not_required", "Not required"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(
        MarketingCampaign,
        on_delete=models.PROTECT,
        related_name="spends",
    )
    ad_set = models.ForeignKey(
        MarketingAdSet,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="spends",
    )
    advertisement = models.ForeignKey(
        MarketingAdvertisement,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="spends",
    )
    spend_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=8, default="AED")
    description = models.TextField(blank=True)
    external_reference = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_campaign_spends",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    integration_status = models.CharField(
        max_length=20,
        choices=IntegrationStatus.choices,
        default=IntegrationStatus.PENDING,
    )
    # Soft link to expenses.Expense.id — no FK to avoid coupling/posting in this phase.
    expense_id = models.UUIDField(null=True, blank=True)
    financial_reference = models.CharField(max_length=255, blank=True)
    integration_error = models.TextField(blank=True)
    integrated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-spend_date", "-created_at"]
        indexes = [
            models.Index(fields=["campaign", "spend_date"]),
            models.Index(fields=["integration_status"]),
            models.Index(fields=["expense_id"]),
        ]

    def clean(self):
        errors = {}
        if self.amount is None or self.amount <= Decimal("0"):
            errors["amount"] = "Amount must be greater than 0."
        if self.ad_set_id and self.campaign_id and self.ad_set.campaign_id != self.campaign_id:
            errors["ad_set"] = "Ad Set must belong to the selected Campaign."
        if (
            self.advertisement_id
            and self.campaign_id
            and self.advertisement.campaign_id != self.campaign_id
        ):
            errors["advertisement"] = "Advertisement must belong to the selected Campaign."
        if (
            self.advertisement_id
            and self.ad_set_id
            and self.advertisement.ad_set_id
            and self.advertisement.ad_set_id != self.ad_set_id
        ):
            errors["advertisement"] = "Advertisement must belong to the selected Ad Set."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.campaign.code} {self.amount} {self.currency} on {self.spend_date}"


class Lead(models.Model):
    class Status(models.TextChoices):
        NEW = "new", "New"
        CONTACTED = "contacted", "Contacted"
        QUALIFIED = "qualified", "Qualified"
        ASSIGNED = "assigned", "Assigned"
        IN_PROGRESS = "in_progress", "In progress"
        CONVERTED = "converted", "Converted"
        LOST = "lost", "Lost"
        ARCHIVED = "archived", "Archived"

    class Outcome(models.TextChoices):
        INTERESTED = "interested", "Interested"
        NOT_INTERESTED = "not_interested", "Not interested"
        NO_ANSWER = "no_answer", "No answer"
        WRONG_NUMBER = "wrong_number", "Wrong number"
        DUPLICATE = "duplicate", "Duplicate"
        FUTURE_OPPORTUNITY = "future_opportunity", "Future opportunity"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead_number = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    raw_phone = models.CharField(max_length=50)
    normalized_phone = models.CharField(max_length=50, unique=True)
    email = models.EmailField(blank=True)
    notes = models.TextField(blank=True, default="")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    outcome = models.CharField(max_length=32, choices=Outcome.choices, blank=True, default="")

    channel = models.ForeignKey(
        MarketingChannel,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leads",
    )
    platform = models.ForeignKey(
        MarketingPlatform,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leads",
    )
    campaign = models.ForeignKey(
        MarketingCampaign,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leads",
    )
    ad_set = models.ForeignKey(
        MarketingAdSet,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leads",
    )
    advertisement = models.ForeignKey(
        MarketingAdvertisement,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="leads",
    )

    marketing_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_leads",
    )
    linked_customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="linked_leads",
    )

    converted_at = models.DateTimeField(null=True, blank=True)
    converted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="converted_leads",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_leads",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="archived_leads",
    )
    archive_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at", "lead_number"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["outcome"]),
            models.Index(fields=["campaign", "status"]),
            models.Index(fields=["marketing_owner", "status"]),
            models.Index(fields=["linked_customer"]),
            models.Index(fields=["created_at"]),
        ]
        constraints = [
            # One Customer → at most one converted Lead (Phase 4.1 attribution integrity).
            models.UniqueConstraint(
                fields=["linked_customer"],
                condition=models.Q(
                    status="converted",
                    linked_customer__isnull=False,
                ),
                name="uniq_converted_lead_per_customer",
            ),
        ]
        permissions = [
            ("view_marketing_dashboard", "Can view marketing dashboard"),
            ("import_lead", "Can import leads"),
            ("assign_lead", "Can assign leads"),
            ("convert_lead", "Can convert leads"),
            ("manage_lead_activity", "Can manage lead activities"),
            ("view_marketing_report", "Can view marketing reports"),
            ("export_marketing_report", "Can export marketing reports"),
            ("manage_campaign_spend", "Can manage campaign spend"),
        ]

    def clean(self):
        errors = {}
        if not (self.normalized_phone or "").strip():
            errors["normalized_phone"] = "normalized_phone is required."

        # Hierarchy consistency when fields are present.
        if self.platform_id and self.channel_id and self.platform.channel_id != self.channel_id:
            errors["platform"] = "Platform must belong to the selected Channel."
        if self.campaign_id and self.platform_id and self.campaign.platform_id != self.platform_id:
            errors["campaign"] = "Campaign must belong to the selected Platform."
        if self.campaign_id and self.channel_id:
            # Derive channel via platform when campaign set
            if self.campaign.platform.channel_id != self.channel_id:
                errors["campaign"] = "Campaign channel must match the selected Channel."
        if self.ad_set_id and self.campaign_id and self.ad_set.campaign_id != self.campaign_id:
            errors["ad_set"] = "Ad Set must belong to the selected Campaign."
        if (
            self.advertisement_id
            and self.campaign_id
            and self.advertisement.campaign_id != self.campaign_id
        ):
            errors["advertisement"] = "Advertisement must belong to the selected Campaign."
        if (
            self.advertisement_id
            and self.ad_set_id
            and self.advertisement.ad_set_id
            and self.advertisement.ad_set_id != self.ad_set_id
        ):
            errors["advertisement"] = "Advertisement must belong to the selected Ad Set."

        if self.status == self.Status.CONVERTED:
            if not self.converted_at:
                errors["converted_at"] = "converted_at is required when status is converted."
        if self.converted_at and self.status != self.Status.CONVERTED:
            # Allow converted_at only with converted status (soft consistency)
            errors["converted_at"] = "converted_at may only be set when status is converted."

        if self.status == self.Status.ARCHIVED:
            if not self.archived_at:
                errors["archived_at"] = "archived_at is required when status is archived."
        if self.archived_at and self.status != self.Status.ARCHIVED:
            errors["archived_at"] = "archived_at may only be set when status is archived."

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.lead_number} — {self.name}"


class LeadActivity(models.Model):
    class ActivityType(models.TextChoices):
        CALL = "call", "Call"
        WHATSAPP = "whatsapp", "WhatsApp"
        EMAIL = "email", "Email"
        MEETING = "meeting", "Meeting"
        NOTE = "note", "Note"
        FOLLOW_UP = "follow_up", "Follow-up"
        STATUS_CHANGE = "status_change", "Status change"
        ASSIGNMENT = "assignment", "Assignment"
        CONVERSION = "conversion", "Conversion"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.PROTECT, related_name="activities")
    activity_type = models.CharField(max_length=32, choices=ActivityType.choices)
    subject = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    occurred_at = models.DateTimeField()
    due_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_lead_activities",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-occurred_at", "-created_at"]
        verbose_name_plural = "Lead activities"
        indexes = [
            models.Index(fields=["lead", "occurred_at"]),
            models.Index(fields=["activity_type"]),
            models.Index(fields=["due_at"]),
            models.Index(fields=["completed_at"]),
        ]

    def __str__(self):
        return f"{self.activity_type} on {self.lead.lead_number}"


class LeadFollowUp(models.Model):
    """
    CRM-specific follow-up schedule (not dashboard alerts).

    Overdue is derived: status=pending and scheduled_for < now.
    Do not persist an \"overdue\" status.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.PROTECT, related_name="follow_ups")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lead_follow_ups",
    )
    scheduled_for = models.DateTimeField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="completed_lead_follow_ups",
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_lead_follow_ups",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_for", "created_at"]
        indexes = [
            models.Index(fields=["assigned_to", "status", "scheduled_for"]),
            models.Index(fields=["lead", "scheduled_for"]),
        ]

    def clean(self):
        errors = {}
        if self.status == self.Status.COMPLETED and not self.completed_at:
            errors["completed_at"] = "completed_at is required when status is completed."
        if self.status != self.Status.COMPLETED and self.completed_at:
            errors["completed_at"] = "completed_at may only be set when status is completed."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"Follow-up {self.lead.lead_number} @ {self.scheduled_for}"


class LeadAssignment(models.Model):
    """
    Operations assignment history for a lead.

    Status design:
      pending     — assigned, awaiting acceptance
      accepted    — operations employee accepted the lead
      rejected    — declined
      completed   — work finished
      reassigned  — superseded by a newer assignment
      cancelled   — withdrawn

    \"Active\" assignments = pending OR accepted.
    One-active-assignment enforcement is deferred to the locked service in Phase 2C
    (no engine-specific partial unique constraint in this phase).
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        COMPLETED = "completed", "Completed"
        REASSIGNED = "reassigned", "Reassigned"
        CANCELLED = "cancelled", "Cancelled"

    ACTIVE_STATUSES = (Status.PENDING, Status.ACCEPTED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.PROTECT, related_name="assignments")
    operations_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operations_lead_assignments",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_leads_by",
    )
    assigned_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-assigned_at", "-id"]
        indexes = [
            models.Index(fields=["lead", "status"]),
            models.Index(fields=["operations_employee", "status"]),
            models.Index(fields=["assigned_at"]),
        ]

    def clean(self):
        errors = {}
        if self.status == self.Status.ACCEPTED and not self.accepted_at:
            errors["accepted_at"] = "accepted_at is required when status is accepted."
        if self.status == self.Status.REJECTED and not self.rejected_at:
            errors["rejected_at"] = "rejected_at is required when status is rejected."
        if self.status == self.Status.COMPLETED and not self.completed_at:
            errors["completed_at"] = "completed_at is required when status is completed."

        if self.accepted_at and self.status not in (
            self.Status.ACCEPTED,
            self.Status.COMPLETED,
            self.Status.REASSIGNED,
        ):
            errors["accepted_at"] = "accepted_at is incompatible with this status."
        if self.rejected_at and self.status != self.Status.REJECTED:
            errors["rejected_at"] = "rejected_at may only be set when status is rejected."
        if self.completed_at and self.status not in (
            self.Status.COMPLETED,
            self.Status.REASSIGNED,
        ):
            errors["completed_at"] = "completed_at is incompatible with this status."

        if self.accepted_at and self.rejected_at:
            errors["rejected_at"] = "An assignment cannot be both accepted and rejected."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.lead.lead_number} → {self.operations_employee_id} [{self.status}]"
