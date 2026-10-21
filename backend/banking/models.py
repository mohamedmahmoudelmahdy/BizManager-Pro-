import uuid
from django.db import models


class BankCard(models.Model):
    class MethodType(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"

    id = models.CharField(primary_key=True, max_length=16, default="", editable=False)
    bank_name = models.CharField(max_length=255)
    cardholder_name = models.CharField(max_length=255)
    card_type = models.CharField(max_length=64, blank=True)
    card_number = models.CharField(max_length=32)
    last4 = models.CharField(max_length=4, blank=True)
    expiry_month = models.CharField(max_length=2)
    expiry_year = models.CharField(max_length=4)
    iban = models.CharField(max_length=64, blank=True)
    swift = models.CharField(max_length=32, blank=True)
    account_number = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)
    method_type = models.CharField(max_length=16, choices=MethodType.choices, default=MethodType.BANK)
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = f"CARD{uuid.uuid4().hex[:8].upper()}"
        if self.card_number and not self.last4:
            self.last4 = str(self.card_number)[-4:]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.bank_name} • {self.card_type} • ****{self.last4}"


class BankStatementComparisonJob(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    id = models.CharField(primary_key=True, max_length=16, default="", editable=False)
    payment_method = models.ForeignKey(
        BankCard, on_delete=models.CASCADE, related_name="statement_comparison_jobs"
    )
    file_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    summary_json = models.JSONField(default=dict, blank=True)
    detected_columns_json = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = f"BCMP{uuid.uuid4().hex[:8].upper()}"
        super().save(*args, **kwargs)


class BankStatementRow(models.Model):
    class Source(models.TextChoices):
        BANK = "bank", "Bank"
        SYSTEM = "system", "System"

    class MatchStatus(models.TextChoices):
        EXACT = "exact", "Exact"
        POSSIBLE = "possible", "Possible"
        BANK_ONLY = "bank_only", "Bank Only"
        SYSTEM_ONLY = "system_only", "System Only"

    class Direction(models.TextChoices):
        IN = "in", "In"
        OUT = "out", "Out"

    job = models.ForeignKey(
        BankStatementComparisonJob, on_delete=models.CASCADE, related_name="rows"
    )
    source = models.CharField(max_length=16, choices=Source.choices)
    row_date = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    money_in = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    money_out = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    balance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    reference = models.CharField(max_length=255, blank=True)
    normalized_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    normalized_direction = models.CharField(max_length=8, choices=Direction.choices, blank=True)
    raw_json = models.JSONField(default=dict, blank=True)
    match_status = models.CharField(
        max_length=16, choices=MatchStatus.choices, default=MatchStatus.BANK_ONLY
    )
    system_row_id = models.CharField(max_length=64, blank=True)


class BankStatementMatch(models.Model):
    class MatchType(models.TextChoices):
        EXACT = "exact", "Exact"
        POSSIBLE = "possible", "Possible"

    job = models.ForeignKey(
        BankStatementComparisonJob, on_delete=models.CASCADE, related_name="matches"
    )
    bank_row = models.ForeignKey(
        BankStatementRow, on_delete=models.CASCADE, related_name="bank_matches"
    )
    system_row = models.ForeignKey(
        BankStatementRow, on_delete=models.CASCADE, related_name="system_matches"
    )
    match_type = models.CharField(max_length=16, choices=MatchType.choices)
    confidence = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    reason = models.CharField(max_length=255, blank=True)
