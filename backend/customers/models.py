import uuid
from django.conf import settings
from django.db import models


class Customer(models.Model):
    class CustomerType(models.TextChoices):
        INDIVIDUAL = "individual", "Individual"
        COMPANY = "company", "Company"

    class AccountStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=20, choices=CustomerType.choices)
    name = models.CharField(max_length=255)
    company_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True, default="")
    phone_secondary = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    emirates_id = models.CharField(max_length=64, blank=True)
    trade_license = models.CharField(max_length=128, blank=True)
    license_expiry = models.DateField(null=True, blank=True)
    establishment_card_expiry = models.DateField(null=True, blank=True)
    workers_expiry = models.DateField(null=True, blank=True)
    echannel_expiry = models.DateField(null=True, blank=True)
    echannel_email = models.EmailField(blank=True)
    echannel_password = models.CharField(max_length=255, blank=True)
    no_health_insurance = models.BooleanField(default=False)
    health_insurance_expiry = models.DateField(null=True, blank=True)
    visa_expiry = models.DateField(null=True, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)
    extra_data = models.JSONField(default=dict, blank=True)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    debt_status = models.CharField(max_length=20, default="clear")
    last_activity = models.DateField(null=True, blank=True)
    account_status = models.CharField(
        max_length=20,
        choices=AccountStatus.choices,
        default=AccountStatus.ACTIVE,
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_customers",
    )
    closure_reason = models.TextField(blank=True)
    # Stable public apply path segment: /attestation/apply/{attestation_apply_slug}
    attestation_apply_slug = models.SlugField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        help_text="Public attestation apply slug (one stable link per customer).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.company_name or self.name


class CustomerFinancialAdjustment(models.Model):
    class AdjustmentType(models.TextChoices):
        DISCOUNT = "discount", "Discount"
        DEBIT_ADJUSTMENT = "debit_adjustment", "Debit adjustment"
        CREDIT_ADJUSTMENT = "credit_adjustment", "Credit adjustment"

    class Status(models.TextChoices):
        POSTED = "posted", "Posted"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="financial_adjustments")
    adjustment_type = models.CharField(max_length=32, choices=AdjustmentType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    reason = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_customer_financial_adjustments",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.POSTED)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reversed_customer_financial_adjustments",
    )
    reversal_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "created_at", "id"]

    def __str__(self):
        return f"{self.customer} - {self.adjustment_type} {self.amount}"


class CustomerAccountEvent(models.Model):
    class EventType(models.TextChoices):
        CLOSED = "closed", "Closed"
        REOPENED = "reopened", "Reopened"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="account_events")
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    reason = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_account_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.customer} - {self.event_type}"


class CompanyEmployee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="employees")
    name = models.CharField(max_length=255)
    residency_expiry = models.DateField(null=True, blank=True)
    no_health_insurance = models.BooleanField(default=False)
    insurance_expiry = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.name


class CustomerFinancialTransfer(models.Model):
    """Append-only audit record for Procedure/Payment transfers between customers."""

    class TransferType(models.TextChoices):
        PROCEDURE = "procedure", "Procedure"
        PAYMENT = "payment", "Payment"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transfer_type = models.CharField(max_length=20, choices=TransferType.choices)
    procedure = models.ForeignKey(
        "procedures.Procedure",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_transfers",
    )
    payment = models.ForeignKey(
        "payments.Payment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_transfers",
    )
    source_customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="financial_transfers_out",
    )
    target_customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="financial_transfers_in",
    )
    amount_snapshot = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reason = models.TextField()
    transferred_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_financial_transfers",
    )
    transferred_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-transferred_at", "-id"]
        permissions = [
            ("transfer_procedure", "Can transfer procedures between customers"),
            ("transfer_payment", "Can transfer payments between customers"),
        ]

    def __str__(self):
        return f"{self.transfer_type} {self.source_customer_id} → {self.target_customer_id}"
