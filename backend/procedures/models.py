import uuid
from django.conf import settings
from django.db import models

from customers.models import Customer
from banking.models import BankCard


class ProcedureCategory(models.Model):
    """Procedure type/category name (e.g. إقامة وهويّة, عقد عمل). Users can add new ones."""
    name = models.CharField(max_length=255, unique=True)
    order = models.PositiveSmallIntegerField(default=0, help_text="Display order (lower first)")

    class Meta:
        ordering = ["order", "name"]
        verbose_name_plural = "Procedure categories"

    def __str__(self):
        return self.name


class Procedure(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        IN_PROCESS = "in-process", "In Process"
        NEED_INFO = "need-info", "Need Information"
        DONE = "done", "Done"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="procedures")
    category = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2)
    cash_in = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_out_type = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="procedures_out"
    )
    cash_in_type = models.ForeignKey(BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="procedures")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    assigned_employee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_procedures")
    date = models.DateField()
    paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.category} - {self.customer}"


class DeletedProcedureLog(models.Model):
    """Audit log for deleted procedures; visible in Django admin."""
    procedure_id = models.UUIDField(editable=False)
    deleted_at = models.DateTimeField(auto_now_add=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="deleted_procedure_logs"
    )
    customer_name = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=255, blank=True)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-deleted_at"]
        verbose_name = "Deleted procedure log"
        verbose_name_plural = "Deleted procedure logs"

    def __str__(self):
        return f"{self.category} - deleted {self.deleted_at}"
