"""Customer payment refunds — append-only money-out against a historical Payment.

Accounting effects (single atomic path, no Expense double-count):
  * debit selected payment method (BankCard balance -= refund)
  * increase Customer.balance by refund (credit shrinks / debt grows)
  * if Payment is linked to a Procedure: Procedure.paid -= refund (clamp ≥ 0)
  * create PaymentRefund audit row referencing the original Payment

Original Payment amount and row remain immutable.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum
from django.utils.dateparse import parse_date
from rest_framework.exceptions import PermissionDenied, ValidationError

from banking.models import BankCard
from customers.models import Customer
from customers.services.account_controls import ensure_customer_account_active
from procedures.models import Procedure

from payments.models import Payment, PaymentRefund

MONEY_ZERO = Decimal("0.00")
MONEY_QUANT = Decimal("0.01")


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value if value is not None else "0")).quantize(MONEY_QUANT)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(
            {"code": "invalid_refund_amount", "detail": "Invalid monetary amount.", "amount": "Invalid monetary amount."}
        ) from exc


def _refund_error(code: str, detail: str, field: str | None = None) -> None:
    payload: dict = {"code": code, "detail": detail}
    if field:
        payload[field] = detail
    raise ValidationError(payload)


def debt_status_for_balance(balance: Decimal) -> str:
    """Authoritative sign convention: >0 debt, <0 credit, 0 settled/clear."""
    bal = _dec(balance)
    if bal > MONEY_ZERO:
        return "in_debt"
    if bal < MONEY_ZERO:
        return "credit"
    return "clear"


def balance_display(balance: Decimal) -> dict:
    """UI-facing absolute amount + label for the balance sign convention."""
    bal = _dec(balance)
    status = debt_status_for_balance(bal)
    return {
        "balance": str(bal),
        "absolute_amount": str(abs(bal)),
        "debt_status_display": status,
        "label": (
            "debt" if status == "in_debt" else "credit" if status == "credit" else "settled"
        ),
    }


def payment_refund_totals(payment: Payment) -> dict:
    # Prefer prefetched refunds on list endpoints (avoids 1–3 aggregates per row).
    # Do not cache across mutations — refund creation must re-read totals.
    prefetched = getattr(payment, "_prefetched_objects_cache", None)
    if prefetched is not None and "refunds" in prefetched:
        refunded_amount = MONEY_ZERO
        for row in payment.refunds.all():
            refunded_amount = _dec(refunded_amount + _dec(row.amount))
    else:
        refunded = (
            PaymentRefund.objects.filter(payment_id=payment.pk)
            .aggregate(t=Sum("amount"))
            .get("t")
        )
        refunded_amount = _dec(refunded)

    original = _dec(payment.amount)
    refundable = _dec(original - refunded_amount)
    if refundable < MONEY_ZERO:
        refundable = MONEY_ZERO
    return {
        "original_amount": original,
        "refunded_amount": refunded_amount,
        "refundable_amount": refundable,
    }


def user_can_refund_payment(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    if getattr(user, "is_superuser", False):
        return True
    if getattr(user, "role", None) in ("admin", "manager"):
        return True
    return user.has_perm("payments.refund_payment")


def ensure_can_refund(user) -> None:
    if not user_can_refund_payment(user):
        raise PermissionDenied(
            {"code": "permission_denied", "detail": "You do not have permission to refund payments."}
        )


def refunds_sum(
    *,
    customer_ids=None,
    payment_ids=None,
    date_from=None,
    date_to=None,
) -> Decimal:
    """Σ PaymentRefund.amount with optional customer/payment/date filters."""
    qs = PaymentRefund.objects.all()
    if customer_ids is not None:
        ids = list(customer_ids)
        if not ids:
            return MONEY_ZERO
        qs = qs.filter(customer_id__in=ids)
    if payment_ids is not None:
        ids = list(payment_ids)
        if not ids:
            return MONEY_ZERO
        qs = qs.filter(payment_id__in=ids)
    if date_from is not None:
        qs = qs.filter(date__gte=date_from)
    if date_to is not None:
        qs = qs.filter(date__lte=date_to)
    return _dec(qs.aggregate(t=Sum("amount")).get("t"))


@transaction.atomic
def refund_payment_atomic(
    *,
    payment_id,
    amount,
    payment_method_id,
    date,
    reason: str,
    notes: str = "",
    created_by=None,
) -> dict:
    """Create a customer refund and apply all financial effects atomically."""
    ensure_can_refund(created_by)

    amount_dec = _dec(amount)
    if amount_dec <= MONEY_ZERO:
        _refund_error(
            "invalid_refund_amount",
            "Refund amount must be greater than zero.",
            field="amount",
        )

    reason_clean = str(reason or "").strip()
    if not reason_clean:
        _refund_error("invalid_refund_amount", "Refund reason is required.", field="reason")

    if not payment_method_id:
        _refund_error(
            "invalid_refund_account",
            "Refund payment method is required.",
            field="payment_method",
        )

    refund_date = date
    if isinstance(refund_date, str):
        refund_date = parse_date(refund_date)
    if refund_date is None:
        _refund_error("invalid_refund_amount", "Invalid refund date.", field="date")

    try:
        # Lock only the Payment row. Do NOT select_related nullable FKs
        # (procedure/bank_card) with select_for_update — PostgreSQL rejects
        # FOR UPDATE on the nullable side of an outer join.
        payment = Payment.objects.select_for_update().get(pk=payment_id)
    except Payment.DoesNotExist as exc:
        raise ValidationError(
            {"code": "payment_not_refundable", "detail": "Payment not found."}
        ) from exc

    customer = Customer.objects.select_for_update().get(pk=payment.customer_id)
    ensure_customer_account_active(customer)

    if payment.customer_id != customer.pk:
        _refund_error(
            "refund_customer_mismatch",
            "Refund customer does not match the payment owner.",
        )

    totals = payment_refund_totals(payment)
    if totals["refundable_amount"] <= MONEY_ZERO:
        _refund_error(
            "payment_already_fully_refunded",
            "This payment has already been fully refunded.",
            field="amount",
        )
    if amount_dec > totals["refundable_amount"]:
        _refund_error(
            "refund_exceeds_payment",
            "Refund amount exceeds the remaining refundable amount.",
            field="amount",
        )

    try:
        method = BankCard.objects.select_for_update().get(pk=payment_method_id)
    except BankCard.DoesNotExist as exc:
        raise ValidationError(
            {
                "code": "invalid_refund_account",
                "detail": "Invalid refund payment method.",
                "payment_method": "Invalid refund payment method.",
            }
        ) from exc

    method_balance = _dec(method.balance)
    if method_balance - amount_dec < MONEY_ZERO:
        _refund_error(
            "invalid_refund_account",
            "Insufficient balance on the selected payment method.",
            field="payment_method",
        )

    balance_before = _dec(customer.balance)

    # Cash leaves the business via the selected method (not necessarily original receipt method).
    method.balance = method_balance - amount_dec
    method.save(update_fields=["balance"])

    # Refund increases customer balance (credit → less credit / more debt).
    customer.balance = balance_before + amount_dec
    customer.last_activity = refund_date
    customer.save(update_fields=["balance", "last_activity", "updated_at"])

    # Preserve historical Payment↔Procedure link; reduce allocated paid if linked.
    if payment.procedure_id:
        procedure = Procedure.objects.select_for_update().get(pk=payment.procedure_id)
        new_paid = _dec(procedure.paid) - amount_dec
        if new_paid < MONEY_ZERO:
            new_paid = MONEY_ZERO
        procedure.paid = new_paid
        procedure.save(update_fields=["paid"])

    refund = PaymentRefund.objects.create(
        payment=payment,
        customer=customer,
        amount=amount_dec,
        date=refund_date,
        payment_method=method,
        reason=reason_clean,
        notes=str(notes or "").strip(),
        created_by=created_by if getattr(created_by, "is_authenticated", False) else None,
    )

    # Drop any stale prefetch so post-insert totals hit the DB.
    cache = getattr(payment, "_prefetched_objects_cache", None)
    if cache is not None:
        cache.pop("refunds", None)

    # Re-read totals after insert (still under payment lock).
    totals_after = payment_refund_totals(payment)
    balance_after = _dec(customer.balance)

    # Lazy import avoids circular dependency with financial_summary.
    from customers.services.financial_summary import build_customer_financial_summary

    summary = build_customer_financial_summary(customer)

    return {
        "refund": refund,
        "payment": payment,
        "original_amount": str(totals_after["original_amount"]),
        "refunded_amount": str(totals_after["refunded_amount"]),
        "refundable_amount": str(totals_after["refundable_amount"]),
        "balance_before": balance_display(balance_before),
        "balance_after": balance_display(balance_after),
        "customer_financial_summary": summary,
    }
