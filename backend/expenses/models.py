import uuid

from django.conf import settings
from django.db import models
from banking.models import BankCard


class Expense(models.Model):
    class Category(models.TextChoices):
        SALARIES = "salaries", "Salaries"
        OFFICE = "office", "Office"
        GOVERNMENT_FEES = "government-fees", "Government Fees"
        MISC = "misc", "Misc"

    class PayrollType(models.TextChoices):
        SALARY = "salary", "Salary"
        COMMISSION = "commission", "Commission"

    class SalaryPaymentMode(models.TextChoices):
        FULL = "full", "Full"
        PARTIAL = "partial", "Partial"

    class PayrollStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        REVERSED = "reversed", "Reversed"

    class WorkflowStatus(models.TextChoices):
        """Employee claim workflow. Operational/payroll expenses default to PAID."""

        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        RETURNED = "returned", "Returned"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        PAID = "paid", "Paid"
        CANCELLED = "cancelled", "Cancelled"

    EDITABLE_STATUSES = frozenset({WorkflowStatus.DRAFT, WorkflowStatus.RETURNED})
    CONTACT_CLAIM_STATUSES = frozenset(
        {
            WorkflowStatus.DRAFT,
            WorkflowStatus.SUBMITTED,
            WorkflowStatus.RETURNED,
            WorkflowStatus.APPROVED,
            WorkflowStatus.REJECTED,
            WorkflowStatus.CANCELLED,
            WorkflowStatus.PAID,
        }
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    expense_number = models.CharField(max_length=32, unique=True, null=True, blank=True)
    category = models.CharField(max_length=32, choices=Category.choices)
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    paid_by = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )
    assigned_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    # Employee claim ownership (defaults to submitter). Kept alongside assigned_employee
    # so payroll/FC paths remain unchanged.
    expense_for = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_for",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_submitted",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_created",
    )
    merchant = models.CharField(max_length=255, blank=True, default="")
    business_purpose = models.TextField(blank=True, default="")
    workflow_status = models.CharField(
        max_length=20,
        choices=WorkflowStatus.choices,
        default=WorkflowStatus.PAID,
        db_index=True,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_approved",
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_rejected",
    )
    rejection_reason = models.TextField(blank=True, default="")
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_returned",
    )
    return_reason = models.TextField(blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_payment_recorded",
        help_text="User who marked the claim paid (paid_by remains the BankCard).",
    )
    payment_reference = models.CharField(max_length=255, blank=True, default="")
    payroll_type = models.CharField(
        max_length=20, choices=PayrollType.choices, blank=True, default=""
    )
    payroll_period = models.DateField(null=True, blank=True, help_text="First day of payroll month")
    salary_gross = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_advance_deduction = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_manual_deduction = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_remaining_due = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_payment_mode = models.CharField(max_length=10, blank=True, default="")
    salary_manual_deduction_reason = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True)
    payroll_status = models.CharField(
        max_length=20,
        choices=PayrollStatus.choices,
        default=PayrollStatus.ACTIVE,
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_reversed",
    )
    reversal_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        permissions = [
            ("view_own_expense", "Can view own expenses"),
            ("add_own_expense", "Can add own expenses"),
            ("change_own_expense", "Can change own expenses"),
            ("submit_expense", "Can submit expenses for approval"),
            ("withdraw_expense", "Can withdraw submitted expenses"),
            ("review_expense", "Can review submitted expenses"),
            ("approve_expense", "Can approve expenses"),
            ("reject_expense", "Can reject expenses"),
            ("return_expense", "Can return expenses for correction"),
            ("mark_expense_paid", "Can mark expenses as paid"),
        ]

    def __str__(self):
        return f"{self.expense_number or self.pk} — {self.category} - {self.amount}"

    @property
    def is_employee_claim(self) -> bool:
        return self.workflow_status != self.WorkflowStatus.PAID or bool(self.submitted_by_id)

    def is_editable(self) -> bool:
        return self.workflow_status in self.EDITABLE_STATUSES


class ExpenseAttachment(models.Model):
    """Receipt / supporting document for an expense claim."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="expenses/receipts/%Y/%m/")
    original_name = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=100, blank=True, default="")
    size_bytes = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expense_attachments_uploaded",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.original_name or str(self.pk)


class ExpenseAuditEvent(models.Model):
    """Append-only workflow audit trail for expenses (no prior employee-log model existed)."""

    class Action(models.TextChoices):
        CREATED = "expense_created", "Created"
        UPDATED = "expense_updated", "Updated"
        SUBMITTED = "expense_submitted", "Submitted"
        WITHDRAWN = "expense_withdrawn", "Withdrawn"
        RETURNED = "expense_returned", "Returned"
        APPROVED = "expense_approved", "Approved"
        REJECTED = "expense_rejected", "Rejected"
        PAID = "expense_paid", "Paid"
        ARCHIVED = "expense_archived", "Archived"
        ATTACHMENT_ADDED = "expense_attachment_added", "Attachment added"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="audit_events")
    action = models.CharField(max_length=64, choices=Action.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expense_audit_events",
    )
    from_status = models.CharField(max_length=20, blank=True, default="")
    to_status = models.CharField(max_length=20, blank=True, default="")
    message = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.action} on {self.expense_id}"
