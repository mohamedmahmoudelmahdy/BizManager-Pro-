import uuid

from django.conf import settings
from django.db import models

from banking.models import BankCard
from customers.models import Customer
from expenses.models import Expense
from payments.models import Payment
from procedures.models import Procedure


class LedgerAccount(models.Model):
    class AccountType(models.TextChoices):
        INTERNAL = "internal", "Internal"
        CUSTOMER = "customer", "Customer"
        VENDOR = "vendor", "Vendor"
        EMPLOYEE = "employee", "Employee"
        PARTNER = "partner", "Partner"
        GOVERNMENT_PROVIDER = "government_provider", "Government Provider"
        OFFICE_DEBT = "office_debt", "Office Debt"
        VEHICLE = "vehicle", "Vehicle"
        CHECKS = "checks", "Checks"
        OTHER = "other", "Other"

    class OpeningBalanceType(models.TextChoices):
        DEBIT = "debit", "Debit"
        CREDIT = "credit", "Credit"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"
        INACTIVE = "inactive", "Inactive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    account_code = models.CharField(max_length=64, blank=True)
    account_type = models.CharField(max_length=32, choices=AccountType.choices, default=AccountType.OTHER)
    linked_customer = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_accounts"
    )
    linked_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_accounts",
    )
    linked_payment_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_accounts"
    )
    linked_vendor_name = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    opening_balance_type = models.CharField(
        max_length=10, choices=OpeningBalanceType.choices, default=OpeningBalanceType.DEBIT
    )
    opening_balance_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_accounts_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_reason = models.TextField(blank=True)
    last_reconciled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name or str(self.id)


class LedgerEntry(models.Model):
    class EntryType(models.TextChoices):
        CREDIT = "credit", "Credit"
        DEBIT = "debit", "Debit"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        RECONCILED = "reconciled", "Reconciled"
        REVERSED = "reversed", "Reversed"

    class SourceType(models.TextChoices):
        MANUAL = "manual", "Manual"
        EXPENSE = "expense", "Expense"
        PAYMENT = "payment", "Payment"
        DEPOSIT = "deposit", "Deposit"
        CHECK = "check", "Check"
        DEBT_PAYMENT = "debt_payment", "Debt Payment"
        PAYROLL = "payroll", "Payroll"
        IMPORT = "import", "Import"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.PROTECT, related_name="entries"
    )
    date = models.DateField()
    description = models.CharField(max_length=512)
    entry_type = models.CharField(max_length=10, choices=EntryType.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    previous_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    resulting_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    running_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    source_type = models.CharField(max_length=32, choices=SourceType.choices, default=SourceType.MANUAL)
    source_id = models.CharField(max_length=64, blank=True)
    related_customer = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_entries"
    )
    related_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_entries",
    )
    related_procedure = models.ForeignKey(
        Procedure, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_entries"
    )
    related_expense = models.ForeignKey(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_entries"
    )
    related_payment = models.ForeignKey(
        Payment, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_entries"
    )
    related_payment_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="ledger_entries"
    )
    # Opt-in: when True (manual entries only) posting also moves the linked
    # payment method (BankCard) balance. Default False keeps ledger purely
    # accounting and avoids double-mutating money from system-generated entries.
    affects_payment_method = models.BooleanField(default=False)
    payment_method_balance_before = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    payment_method_balance_after = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    attachment = models.FileField(upload_to="financial_control/entries/", blank=True, null=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    # Audit trail for reversals (use these instead of parsing description text).
    reversal_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reversals",
    )
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_entries_reversed",
    )
    reversal_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.ledger_account_id} {self.entry_type} {self.amount}"


class CheckPDC(models.Model):
    class CheckType(models.TextChoices):
        RENT = "rent", "Rent"
        SUPPLIER = "supplier", "Supplier"
        GOVERNMENT = "government", "Government"
        SECURITY = "security", "Security"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DUE_SOON = "due_soon", "Due Soon"
        DEDUCTED = "deducted", "Deducted"
        BOUNCED = "bounced", "Bounced"
        CANCELLED = "cancelled", "Cancelled"
        REPLACED = "replaced", "Replaced"

    class RiskLevel(models.TextChoices):
        NONE = "none", "None"
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    check_number = models.CharField(max_length=64)
    payee = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    due_date = models.DateField()
    bank_account = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="checks"
    )
    linked_ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.SET_NULL, null=True, blank=True, related_name="checks"
    )
    related_customer = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="checks"
    )
    related_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="checks",
    )
    related_debt = models.ForeignKey(
        "DebtLiability",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="checks",
    )
    check_type = models.CharField(max_length=32, choices=CheckType.choices, default=CheckType.OTHER)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    risk_level = models.CharField(max_length=20, choices=RiskLevel.choices, default=RiskLevel.LOW)
    notes = models.TextField(blank=True)
    attachment = models.FileField(upload_to="financial_control/checks/", blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="checks_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deducted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    replaced_by = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replaces",
    )

    class Meta:
        ordering = ["due_date", "-created_at"]

    def __str__(self):
        return f"{self.check_number} — {self.payee}"


class DebtLiability(models.Model):
    class DebtType(models.TextChoices):
        BANK_LOAN = "bank_loan", "Bank Loan"
        VENDOR = "vendor", "Vendor"
        OFFICE = "office", "Office"
        VEHICLE = "vehicle", "Vehicle"
        OTHER = "other", "Other"

    class PaymentFrequency(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        YEARLY = "yearly", "Yearly"
        ONE_TIME = "one_time", "One Time"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"
        DEFAULTED = "defaulted", "Defaulted"

    class RiskLevel(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    creditor = models.CharField(max_length=255)
    debt_type = models.CharField(max_length=32, choices=DebtType.choices, default=DebtType.OTHER)
    original_amount = models.DecimalField(max_digits=14, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    remaining_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    installment_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_installments = models.PositiveIntegerField(default=0)
    due_date = models.DateField(null=True, blank=True)
    next_payment_date = models.DateField(null=True, blank=True)
    payment_frequency = models.CharField(
        max_length=20, choices=PaymentFrequency.choices, default=PaymentFrequency.MONTHLY
    )
    linked_ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.SET_NULL, null=True, blank=True, related_name="debts"
    )
    default_payment_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="debts"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    risk_level = models.CharField(max_length=20, choices=RiskLevel.choices, default=RiskLevel.LOW)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="debts_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class DebtPayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    debt = models.ForeignKey(DebtLiability, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_date = models.DateField()
    payment_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="debt_payments"
    )
    reference_number = models.CharField(max_length=128, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="debt_payments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    linked_expense = models.ForeignKey(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="debt_payments"
    )
    linked_ledger_entry = models.ForeignKey(
        LedgerEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="debt_payments"
    )

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    def __str__(self):
        return f"{self.debt_id} — {self.amount}"


class FinancialImportJob(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PREVIEW = "preview", "Preview"
        VALIDATED = "validated", "Validated"
        IMPORTING = "importing", "Importing"
        CONFIRMED = "confirmed", "Confirmed"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.FileField(upload_to="financial_control/imports/")
    original_filename = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    total_sheets = models.PositiveIntegerField(default=0)
    total_rows = models.PositiveIntegerField(default=0)
    valid_rows = models.PositiveIntegerField(default=0)
    warning_rows = models.PositiveIntegerField(default=0)
    error_rows = models.PositiveIntegerField(default=0)
    duplicate_hash = models.CharField(max_length=64, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_import_jobs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_import_jobs_confirmed",
    )
    archived = models.BooleanField(default=False)
    profile = models.CharField(max_length=32, default="generic")
    mapping_json = models.JSONField(default=dict, blank=True)
    summary_json = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_filename or str(self.id)


class FinancialImportRow(models.Model):
    class RowStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        VALID = "valid", "Valid"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"
        CONFIRMED = "confirmed", "Confirmed"
        IMPORTED = "imported", "Imported"
        SKIPPED = "skipped", "Skipped"

    class DetectedType(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        LEDGER_ACCOUNT = "ledger_account", "Ledger Account"
        LEDGER_ENTRY = "ledger_entry", "Ledger Entry"
        EXPENSE = "expense", "Expense"
        CHECK = "check", "Check"
        DEBT = "debt", "Debt"
        TRANSFER = "transfer", "Transfer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(FinancialImportJob, on_delete=models.CASCADE, related_name="rows")
    sheet_name = models.CharField(max_length=128, blank=True)
    row_number = models.PositiveIntegerField(default=0)
    detected_type = models.CharField(
        max_length=32, choices=DetectedType.choices, default=DetectedType.UNKNOWN
    )
    raw_data_json = models.JSONField(default=dict, blank=True)
    normalized_data_json = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=RowStatus.choices, default=RowStatus.DRAFT)
    mapping_status = models.CharField(max_length=16, default="auto")
    warning_message = models.TextField(blank=True)
    error_message = models.TextField(blank=True)
    linked_ledger_entry = models.ForeignKey(
        LedgerEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="import_rows"
    )
    # Generic reference to the record created from this row (audit trail).
    linked_object_type = models.CharField(max_length=32, blank=True)
    linked_object_id = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["sheet_name", "row_number"]

    def __str__(self):
        return f"{self.job_id} row {self.row_number}"


class EmployeeAdvance(models.Model):
    """A cash advance given to an employee, recovered from future salary."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SETTLED = "settled", "Settled"
        CANCELLED = "cancelled", "Cancelled"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="employee_advances",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    outstanding_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    date = models.DateField()
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    source_account = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="employee_advances"
    )
    linked_expense = models.ForeignKey(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="employee_advances"
    )
    linked_ledger_account = models.ForeignKey(
        LedgerAccount, on_delete=models.SET_NULL, null=True, blank=True, related_name="employee_advances"
    )
    linked_ledger_entry = models.ForeignKey(
        LedgerEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="employee_advances"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_advances_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_advances_reversed",
    )
    reversal_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Advance {self.amount} → {self.employee_id}"


class EmployeeAdvanceDeduction(models.Model):
    """A single deduction applied against an advance during a salary payment."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    advance = models.ForeignKey(
        EmployeeAdvance, on_delete=models.PROTECT, related_name="deductions"
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="advance_deductions",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    date = models.DateField()
    period = models.CharField(max_length=7, blank=True)
    linked_salary_expense = models.ForeignKey(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="advance_deductions"
    )
    linked_ledger_entry = models.ForeignKey(
        LedgerEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="advance_deductions"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_deductions_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_deductions_reversed",
    )
    reversal_reason = models.TextField(blank=True)
    reversal_ledger_entry = models.ForeignKey(
        LedgerEntry,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_deduction_reversals",
    )

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Deduction {self.amount} (advance {self.advance_id})"


class EmployeeAdvanceRepayment(models.Model):
    """Direct cash repayment against an employee advance (not via salary)."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    advance = models.ForeignKey(
        EmployeeAdvance, on_delete=models.PROTECT, related_name="repayments"
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="advance_repayments",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    date = models.DateField()
    payment_method = models.ForeignKey(
        BankCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="advance_repayments"
    )
    linked_ledger_entry = models.ForeignKey(
        LedgerEntry,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_repayments",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_repayments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="advance_repayments_reversed",
    )
    reversal_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Repayment {self.amount} (advance {self.advance_id})"
