import uuid
from django.db import models

from banking.models import BankCard


class Deposit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    from_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="deposits_out"
    )
    to_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="deposits_in"
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.amount} on {self.date}"
