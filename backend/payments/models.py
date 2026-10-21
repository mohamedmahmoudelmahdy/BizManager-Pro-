import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q, Sum

from customers.models import Customer
from procedures.models import Procedure
from banking.models import BankCard


class Payment(models.Model):
    class PaymentType(models.TextChoices):
        CASH = "cash", "Cash"
        TRANSFER = "transfer", "Transfer"
        POS = "pos", "POS"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    type = models.CharField(max_length=20, choices=PaymentType.choices)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="payments")
    procedure = models.ForeignKey(Procedure, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    bank_card = models.ForeignKey(BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_payments",
    )
    notes = models.TextField(blank=True)

    class Meta:
        permissions = [
            ("refund_payment", "Can refund customer payments"),
        ]

    def __str__(self):
        return f"{self.customer} - {self.amount} ({self.type})"

    def refunded_total(self):
        total = self.refunds.aggregate(t=Sum("amount")).get("t")
        from decimal import Decimal

        return Decimal(str(total or 0)).quantize(Decimal("0.01"))

    def refundable_amount(self):
        from decimal import Decimal

        return (Decimal(str(self.amount or 0)) - self.refunded_total()).quantize(Decimal("0.01"))


class PaymentRefund(models.Model):
    """Append-only customer payout against a historical Payment (money out)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(
        Payment,
        on_delete=models.PROTECT,
        related_name="refunds",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="payment_refunds",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    payment_method = models.ForeignKey(
        BankCard,
        on_delete=models.PROTECT,
        related_name="payment_refunds",
    )
    reason = models.TextField()
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payment_refunds_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["customer", "date"]),
            models.Index(fields=["payment", "date"]),
            models.Index(fields=["payment_method", "date"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=Q(amount__gt=0),
                name="payment_refund_amount_positive",
            ),
        ]

    def __str__(self):
        return f"Refund {self.amount} of payment {self.payment_id}"

    def clean(self):
        if self.payment_id and self.customer_id and self.payment.customer_id != self.customer_id:
            raise ValidationError({"customer": "Refund customer must match the payment owner."})
