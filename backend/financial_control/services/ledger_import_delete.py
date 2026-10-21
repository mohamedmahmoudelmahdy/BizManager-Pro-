"""Safe deletion of Excel-imported ledger accounts and their draft import entries."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from financial_control.models import (
    CheckPDC,
    DebtLiability,
    EmployeeAdvance,
    FinancialImportRow,
    LedgerAccount,
    LedgerEntry,
)

OPERATIONAL_SOURCE_TYPES = {
    LedgerEntry.SourceType.MANUAL,
    LedgerEntry.SourceType.EXPENSE,
    LedgerEntry.SourceType.PAYMENT,
    LedgerEntry.SourceType.DEPOSIT,
    LedgerEntry.SourceType.CHECK,
    LedgerEntry.SourceType.DEBT_PAYMENT,
    LedgerEntry.SourceType.PAYROLL,
    LedgerEntry.SourceType.OTHER,
}


def account_created_by_import(account: LedgerAccount) -> bool:
    return FinancialImportRow.objects.filter(
        linked_object_type="ledger_account",
        linked_object_id=str(account.id),
    ).exists()


def is_import_only_account(account: LedgerAccount) -> bool:
    if account_created_by_import(account):
        return True
    entries = account.entries.all()
    if not entries.exists():
        return False
    return not entries.exclude(source_type=LedgerEntry.SourceType.IMPORT).exists()


def _import_draft_entries(account: LedgerAccount):
    return account.entries.filter(
        source_type=LedgerEntry.SourceType.IMPORT,
        status=LedgerEntry.Status.DRAFT,
    )


def can_delete_imported_ledger_account(account: LedgerAccount) -> tuple[bool, str, dict]:
    """Return (allowed, reason, stats) for admin import-only ledger deletion."""
    entries_qs = account.entries.all()
    total_entries = entries_qs.count()
    import_draft_count = _import_draft_entries(account).count()
    import_created = account_created_by_import(account)
    import_only = is_import_only_account(account)

    stats = {
        "import_created": import_created,
        "import_only": import_only,
        "total_entry_count": total_entries,
        "import_draft_entry_count": import_draft_count,
        "current_balance": float(account.current_balance or 0),
    }

    if account.linked_customer_id or account.linked_employee_id or account.linked_payment_method_id:
        return False, "Account is linked to a customer, employee, or payment method.", stats

    if CheckPDC.objects.filter(linked_ledger_account_id=account.id).exists():
        return False, "Account is linked to post-dated checks.", stats

    if DebtLiability.objects.filter(linked_ledger_account_id=account.id).exists():
        return False, "Account is linked to office debts.", stats

    if EmployeeAdvance.objects.filter(linked_ledger_account_id=account.id).exists():
        return False, "Account is linked to employee advances.", stats

    if Decimal(str(account.current_balance or 0)) != Decimal("0"):
        return False, "Account balance must be zero.", stats

    if not import_only:
        return False, "This ledger account is not import-only.", stats

    if total_entries == 0:
        return True, "", stats

    if entries_qs.filter(
        status__in=[LedgerEntry.Status.POSTED, LedgerEntry.Status.RECONCILED]
    ).exists():
        return False, "Account has posted or reconciled entries.", stats

    if entries_qs.filter(status=LedgerEntry.Status.REVERSED).exists():
        return False, "Account has reversed entries.", stats

    if entries_qs.filter(reversal_of__isnull=False).exists():
        return False, "Account has reversal entries.", stats

    if entries_qs.filter(source_type__in=OPERATIONAL_SOURCE_TYPES).exists():
        return False, "Account has operational (non-import) entries.", stats

    if entries_qs.filter(affects_payment_method=True).exists():
        return False, "Account has payment-method-affecting entries.", stats

    if entries_qs.filter(related_payment_method__isnull=False).exists():
        return False, "Account has entries linked to a payment method.", stats

    if entries_qs.filter(
        Q(related_expense__isnull=False)
        | Q(related_payment__isnull=False)
        | Q(related_procedure__isnull=False)
        | Q(related_customer__isnull=False)
        | Q(related_employee__isnull=False)
    ).exists():
        return False, "Account has entries linked to operational records.", stats

    non_deletable = entries_qs.exclude(
        source_type=LedgerEntry.SourceType.IMPORT,
        status=LedgerEntry.Status.DRAFT,
    )
    if non_deletable.exists():
        return (
            False,
            "Only draft import entries can be deleted with this account.",
            stats,
        )

    return True, "", stats


@transaction.atomic
def delete_imported_ledger_account(account: LedgerAccount) -> dict:
    """Delete an import-only ledger account and its draft import entries."""
    locked = LedgerAccount.objects.select_for_update().get(pk=account.pk)
    allowed, reason, stats = can_delete_imported_ledger_account(locked)
    if not allowed:
        raise ValueError(reason)

    entries = list(
        _import_draft_entries(locked).select_for_update().values_list("id", flat=True)
    )
    entry_ids = [str(eid) for eid in entries]

    LedgerEntry.objects.filter(id__in=entries).delete()
    deleted_entry_count = len(entry_ids)

    FinancialImportRow.objects.filter(
        linked_object_type="ledger_entry",
        linked_object_id__in=entry_ids,
    ).update(linked_object_type="", linked_object_id="", linked_ledger_entry=None)

    FinancialImportRow.objects.filter(
        linked_object_type="ledger_account",
        linked_object_id=str(locked.id),
    ).update(linked_object_type="", linked_object_id="")

    account_name = locked.name
    locked.delete()

    return {
        **stats,
        "deleted_account_name": account_name,
        "deleted_entry_count": deleted_entry_count,
        "deleted_account_count": 1,
    }
