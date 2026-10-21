"""Read-only payment method (BankCard) statement aggregation."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.utils.dateparse import parse_date

from banking.models import BankCard
from deposits.models import Deposit
from expenses.models import Expense
from financial_control.models import CheckPDC, DebtPayment, EmployeeAdvance, EmployeeAdvanceRepayment, LedgerEntry
from payments.models import Payment, PaymentRefund
from procedures.models import Procedure

CUSTOMER_CARD_BANK_NAME = "Customer Card / كرت العميل"
ADVANCE_MARKER = "[advance]"


def _dec(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _money_str(value: Decimal) -> str:
    return f"{_dec(value):.2f}"


def _user_name(user) -> str:
    if not user:
        return ""
    profile = getattr(user, "employee_profile", None)
    if profile and getattr(profile, "full_name", None):
        return profile.full_name
    return user.get_full_name() or getattr(user, "username", "") or ""


def _is_customer_card(card) -> bool:
    if not card:
        return False
    return getattr(card, "bank_name", None) == CUSTOMER_CARD_BANK_NAME


def _customer_display(customer) -> str:
    if not customer:
        return ""
    return customer.company_name or customer.name or ""


def _in_date_range(row_date: date | None, date_from: date | None, date_to: date | None) -> bool:
    if row_date is None:
        return True
    if date_from and row_date < date_from:
        return False
    if date_to and row_date > date_to:
        return False
    return True


def _classify_expense_source(expense: Expense) -> str:
    notes = expense.notes or ""
    if expense.payroll_type == Expense.PayrollType.SALARY:
        return "salary_payment"
    if expense.payroll_type == Expense.PayrollType.COMMISSION:
        return "commission_payment"
    if ADVANCE_MARKER in notes:
        return "employee_advance"
    if "Check deducted" in notes or "check deducted" in notes.lower():
        return "check_deduction"
    if DebtPayment.objects.filter(linked_expense_id=expense.id).exists():
        return "debt_payment"
    return "expense"


def _build_raw_rows(card: BankCard) -> list[dict]:
    card_id = card.pk
    rows: list[dict] = []

    for payment in Payment.objects.filter(bank_card_id=card_id).select_related(
        "customer", "procedure", "recorded_by"
    ):
        amount = _dec(payment.amount)
        if amount <= 0:
            continue
        rows.append(
            {
                "date": payment.date,
                "description": f"Customer payment — {payment.customer.name if payment.customer else ''}".strip(),
                "source_type": "customer_payment",
                "money_in": amount,
                "money_out": Decimal("0"),
                "customer_name": _customer_display(payment.customer),
                "procedure_name": payment.procedure.category if payment.procedure else "",
                "reference": str(payment.id),
                "created_by": _user_name(payment.recorded_by),
                "status": payment.type,
                "sort_key": 2,
            }
        )

    for refund in PaymentRefund.objects.filter(payment_method_id=card_id).select_related(
        "customer", "payment", "payment__procedure", "created_by"
    ):
        amount = _dec(refund.amount)
        if amount <= 0:
            continue
        rows.append(
            {
                "date": refund.date,
                "description": f"Customer refund — {refund.customer.name if refund.customer else ''}".strip(),
                "source_type": "customer_payment_refund",
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": _customer_display(refund.customer),
                "procedure_name": (
                    refund.payment.procedure.category
                    if refund.payment and refund.payment.procedure
                    else ""
                ),
                "reference": str(refund.id),
                "created_by": _user_name(refund.created_by),
                "status": "refund",
                "sort_key": 2,
            }
        )

    for proc in Procedure.objects.filter(cash_in_type_id=card_id).select_related("customer"):
        paid = _dec(proc.paid)
        if paid <= 0:
            continue
        rows.append(
            {
                "date": proc.date,
                "description": f"Procedure cash in — {proc.category}",
                "source_type": "procedure_cash_in",
                "money_in": paid,
                "money_out": Decimal("0"),
                "customer_name": _customer_display(proc.customer),
                "procedure_name": proc.category,
                "reference": str(proc.id),
                "created_by": "",
                "status": proc.status,
                "sort_key": 1,
            }
        )

    for proc in Procedure.objects.filter(cash_out_type_id=card_id).select_related(
        "customer", "cash_out_type"
    ):
        if _is_customer_card(proc.cash_out_type):
            continue
        cost = _dec(proc.cost)
        if cost <= 0:
            continue
        rows.append(
            {
                "date": proc.date,
                "description": f"Procedure cash out — {proc.category}",
                "source_type": "procedure_cash_out",
                "money_in": Decimal("0"),
                "money_out": cost,
                "customer_name": _customer_display(proc.customer),
                "procedure_name": proc.category,
                "reference": str(proc.id),
                "created_by": "",
                "status": proc.status,
                "sort_key": 1,
            }
        )

    debt_linked_expense_ids = set(
        DebtPayment.objects.filter(
            payment_method_id=card_id, linked_expense_id__isnull=False
        ).values_list("linked_expense_id", flat=True)
    )
    advance_linked_expense_ids = set(
        EmployeeAdvance.objects.filter(
            source_account_id=card_id, linked_expense_id__isnull=False
        ).values_list("linked_expense_id", flat=True)
    )
    skip_expense_ids = debt_linked_expense_ids | advance_linked_expense_ids

    for expense in Expense.objects.filter(paid_by_id=card_id).select_related("assigned_employee"):
        if expense.id in skip_expense_ids:
            continue
        if expense.payroll_status == Expense.PayrollStatus.REVERSED:
            continue
        amount = _dec(expense.amount)
        if amount <= 0:
            continue
        source_type = _classify_expense_source(expense)
        rows.append(
            {
                "date": expense.date,
                "description": expense.notes or f"Expense — {expense.get_category_display()}",
                "source_type": source_type,
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": "",
                "procedure_name": "",
                "reference": str(expense.id),
                "created_by": _user_name(expense.assigned_employee),
                "status": expense.category,
                "sort_key": 3,
            }
        )

    for debt_pay in DebtPayment.objects.filter(payment_method_id=card_id).select_related(
        "debt", "created_by"
    ):
        amount = _dec(debt_pay.amount)
        if amount <= 0:
            continue
        rows.append(
            {
                "date": debt_pay.payment_date,
                "description": f"Debt payment — {debt_pay.debt.name if debt_pay.debt else ''}",
                "source_type": "debt_payment",
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": "",
                "procedure_name": "",
                "reference": debt_pay.reference_number or str(debt_pay.id),
                "created_by": _user_name(debt_pay.created_by),
                "status": "posted",
                "sort_key": 4,
            }
        )

    for advance in EmployeeAdvance.objects.filter(source_account_id=card_id).select_related(
        "employee", "created_by"
    ):
        if advance.status in (EmployeeAdvance.Status.CANCELLED, EmployeeAdvance.Status.REVERSED):
            continue
        amount = _dec(advance.amount)
        if amount <= 0:
            continue
        rows.append(
            {
                "date": advance.date,
                "description": f"Employee advance — {_user_name(advance.employee)}",
                "source_type": "employee_advance",
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": "",
                "procedure_name": "",
                "reference": str(advance.id),
                "created_by": _user_name(advance.created_by),
                "status": advance.status,
                "sort_key": 4,
            }
        )

    for repayment in EmployeeAdvanceRepayment.objects.filter(
        payment_method_id=card_id,
        status=EmployeeAdvanceRepayment.Status.ACTIVE,
    ).select_related("employee", "created_by", "advance"):
        amount = _dec(repayment.amount)
        if amount <= 0:
            continue
        rows.append(
            {
                "date": repayment.date,
                "description": f"Advance repayment — {_user_name(repayment.employee)}",
                "source_type": "advance_repayment",
                "money_in": amount,
                "money_out": Decimal("0"),
                "customer_name": "",
                "procedure_name": "",
                "reference": str(repayment.id),
                "created_by": _user_name(repayment.created_by),
                "status": repayment.status,
                "sort_key": 4,
            }
        )

    for check in CheckPDC.objects.filter(
        bank_account_id=card_id, status=CheckPDC.Status.DEDUCTED
    ).select_related("created_by"):
        if Expense.objects.filter(
            paid_by_id=card_id, notes__icontains=check.check_number
        ).exists():
            continue
        amount = _dec(check.amount)
        if amount <= 0:
            continue
        deduct_date = check.deducted_at.date() if check.deducted_at else check.due_date
        rows.append(
            {
                "date": deduct_date,
                "description": f"Check deducted — {check.check_number} ({check.payee})",
                "source_type": "check_deduction",
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": "",
                "procedure_name": "",
                "reference": check.check_number,
                "created_by": _user_name(check.created_by),
                "status": check.status,
                "sort_key": 4,
            }
        )

    for deposit in Deposit.objects.filter(to_method_id=card_id).select_related("from_method"):
        amount = _dec(deposit.amount)
        if amount <= 0:
            continue
        from_name = deposit.from_method.bank_name if deposit.from_method else ""
        rows.append(
            {
                "date": deposit.date,
                "description": f"Transfer in from {from_name}".strip(),
                "source_type": "transfer_in",
                "money_in": amount,
                "money_out": Decimal("0"),
                "customer_name": "",
                "procedure_name": "",
                "reference": str(deposit.id),
                "created_by": "",
                "status": "completed",
                "sort_key": 5,
            }
        )

    for deposit in Deposit.objects.filter(from_method_id=card_id).select_related("to_method"):
        amount = _dec(deposit.amount)
        if amount <= 0:
            continue
        to_name = deposit.to_method.bank_name if deposit.to_method else ""
        rows.append(
            {
                "date": deposit.date,
                "description": f"Transfer out to {to_name}".strip(),
                "source_type": "transfer_out",
                "money_in": Decimal("0"),
                "money_out": amount,
                "customer_name": "",
                "procedure_name": "",
                "reference": str(deposit.id),
                "created_by": "",
                "status": "completed",
                "sort_key": 5,
            }
        )

    for entry in LedgerEntry.objects.filter(
        related_payment_method_id=card_id,
        affects_payment_method=True,
        source_type=LedgerEntry.SourceType.MANUAL,
        status__in=[
            LedgerEntry.Status.POSTED,
            LedgerEntry.Status.RECONCILED,
            LedgerEntry.Status.DRAFT,
        ],
    ).select_related("created_by", "related_customer", "related_procedure"):
        amount = _dec(entry.amount)
        if amount <= 0:
            continue
        is_in = entry.entry_type == LedgerEntry.EntryType.CREDIT
        rows.append(
            {
                "date": entry.date,
                "description": entry.description,
                "source_type": "ledger_manual",
                "money_in": amount if is_in else Decimal("0"),
                "money_out": Decimal("0") if is_in else amount,
                "customer_name": _customer_display(entry.related_customer),
                "procedure_name": entry.related_procedure.category if entry.related_procedure else "",
                "reference": str(entry.id),
                "created_by": _user_name(entry.created_by),
                "status": entry.status,
                "sort_key": 6,
            }
        )

    return rows


def build_payment_method_statement(
    card: BankCard,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    source_type: str | None = None,
) -> dict:
    parsed_from = parse_date(date_from or "")
    parsed_to = parse_date(date_to or "")

    raw_rows = _build_raw_rows(card)
    if source_type:
        raw_rows = [r for r in raw_rows if r["source_type"] == source_type]

    raw_rows = [
        r
        for r in raw_rows
        if _in_date_range(r["date"], parsed_from, parsed_to)
    ]

    raw_rows.sort(key=lambda r: (r["date"] or date.min, r["sort_key"], r["reference"]))

    total_in = sum((r["money_in"] for r in raw_rows), Decimal("0"))
    total_out = sum((r["money_out"] for r in raw_rows), Decimal("0"))
    net_change = _dec(total_in - total_out)
    current_balance = _dec(card.balance)
    opening_balance = _dec(current_balance - net_change)

    running = opening_balance
    statement_rows = []
    for idx, row in enumerate(raw_rows):
        running = _dec(running + row["money_in"] - row["money_out"])
        statement_rows.append(
            {
                "id": f"{row['source_type']}-{row['reference']}-{idx}",
                "date": row["date"].isoformat() if row["date"] else None,
                "description": row["description"],
                "source_type": row["source_type"],
                "money_in": _money_str(row["money_in"]),
                "money_out": _money_str(row["money_out"]),
                "running_balance": _money_str(running),
                "customer_name": row["customer_name"],
                "procedure_name": row["procedure_name"],
                "reference": row["reference"],
                "created_by": row["created_by"],
                "status": row["status"],
            }
        )

    masked = ""
    if card.last4:
        masked = f"**** **** **** {card.last4}"
    elif card.card_number:
        masked = f"**** **** **** {str(card.card_number)[-4:]}"

    return {
        "payment_method": {
            "id": card.id,
            "name": card.bank_name,
            "method_type": card.method_type,
            "card_type": card.card_type or "",
            "masked_number": masked,
            "iban": card.iban or "",
            "account_number": card.account_number or "",
            "notes": card.notes or "",
            "current_balance": _money_str(current_balance),
        },
        "opening_balance": _money_str(opening_balance),
        "opening_balance_estimated": True,
        "current_balance": _money_str(current_balance),
        "totals": {
            "money_in": _money_str(total_in),
            "money_out": _money_str(total_out),
            "net_change": _money_str(net_change),
        },
        "rows": statement_rows,
    }
