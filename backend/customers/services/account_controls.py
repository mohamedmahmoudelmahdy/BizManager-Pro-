from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from customers.models import Customer, CustomerAccountEvent, CustomerFinancialAdjustment

CLOSED_ACCOUNT_MESSAGE = (
    "This customer account is closed. Reopen it before creating financial or operational records."
)


def _decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"))


def customer_outstanding_amount(customer: Customer) -> Decimal:
    balance = _decimal(customer.balance)
    return balance if balance > Decimal("0.00") else Decimal("0.00")


def ensure_customer_account_active(customer: Customer):
    if customer.account_status == Customer.AccountStatus.CLOSED:
        raise ValidationError({"detail": CLOSED_ACCOUNT_MESSAGE})


def _require_reason(reason: str | None) -> str:
    clean = str(reason or "").strip()
    if not clean:
        raise ValidationError({"reason": "Reason is required."})
    return clean


@transaction.atomic
def apply_customer_discount_atomic(
    *,
    customer_id,
    amount,
    date,
    reason: str,
    notes: str = "",
    created_by=None,
) -> CustomerFinancialAdjustment:
    amount = _decimal(amount)
    if amount <= Decimal("0.00"):
        raise ValidationError({"amount": "Amount must be greater than 0."})

    reason = _require_reason(reason)
    customer = Customer.objects.select_for_update().get(pk=customer_id)
    ensure_customer_account_active(customer)

    outstanding = customer_outstanding_amount(customer)
    if outstanding <= Decimal("0.00"):
        raise ValidationError({"amount": "Direct discount is only allowed for customers with an outstanding debit balance."})
    if amount > outstanding:
        raise ValidationError({"amount": "Discount amount cannot exceed the current outstanding balance."})

    customer.balance = _decimal(customer.balance) - amount
    if date:
        customer.last_activity = date
    customer.save(update_fields=["balance", "last_activity", "updated_at"])

    return CustomerFinancialAdjustment.objects.create(
        customer=customer,
        adjustment_type=CustomerFinancialAdjustment.AdjustmentType.DISCOUNT,
        amount=amount,
        date=date,
        reason=reason,
        notes=str(notes or "").strip(),
        created_by=created_by if getattr(created_by, "is_authenticated", False) else None,
    )


@transaction.atomic
def reverse_customer_financial_adjustment_atomic(
    *,
    adjustment_id,
    reason: str,
    reversed_by=None,
) -> CustomerFinancialAdjustment:
    reason = _require_reason(reason)
    adjustment = (
        CustomerFinancialAdjustment.objects.select_for_update()
        .select_related("customer")
        .get(pk=adjustment_id)
    )

    if adjustment.status == CustomerFinancialAdjustment.Status.REVERSED:
        raise ValidationError({"detail": "This adjustment has already been reversed."})

    customer = Customer.objects.select_for_update().get(pk=adjustment.customer_id)
    if adjustment.adjustment_type == CustomerFinancialAdjustment.AdjustmentType.DISCOUNT:
        customer.balance = _decimal(customer.balance) + _decimal(adjustment.amount)
        customer.save(update_fields=["balance", "updated_at"])
    else:
        raise ValidationError({"adjustment_type": "Only discount adjustments can be reversed."})

    adjustment.status = CustomerFinancialAdjustment.Status.REVERSED
    adjustment.reversed_at = timezone.now()
    adjustment.reversed_by = reversed_by if getattr(reversed_by, "is_authenticated", False) else None
    adjustment.reversal_reason = reason
    adjustment.save(
        update_fields=[
            "status",
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "updated_at",
        ]
    )
    return adjustment


@transaction.atomic
def close_customer_account_atomic(*, customer_id, reason: str, closed_by=None) -> Customer:
    reason = _require_reason(reason)
    customer = Customer.objects.select_for_update().get(pk=customer_id)
    if customer.account_status == Customer.AccountStatus.CLOSED:
        raise ValidationError({"detail": "This customer account is already closed."})

    customer.account_status = Customer.AccountStatus.CLOSED
    customer.closed_at = timezone.now()
    customer.closed_by = closed_by if getattr(closed_by, "is_authenticated", False) else None
    customer.closure_reason = reason
    customer.save(update_fields=["account_status", "closed_at", "closed_by", "closure_reason", "updated_at"])
    CustomerAccountEvent.objects.create(
        customer=customer,
        event_type=CustomerAccountEvent.EventType.CLOSED,
        reason=reason,
        created_by=closed_by if getattr(closed_by, "is_authenticated", False) else None,
    )
    return customer


@transaction.atomic
def reopen_customer_account_atomic(*, customer_id, reason: str, reopened_by=None) -> Customer:
    reason = _require_reason(reason)
    customer = Customer.objects.select_for_update().get(pk=customer_id)
    if customer.account_status == Customer.AccountStatus.ACTIVE:
        raise ValidationError({"detail": "This customer account is already active."})

    customer.account_status = Customer.AccountStatus.ACTIVE
    customer.closed_at = None
    customer.closed_by = None
    customer.closure_reason = ""
    customer.save(update_fields=["account_status", "closed_at", "closed_by", "closure_reason", "updated_at"])
    CustomerAccountEvent.objects.create(
        customer=customer,
        event_type=CustomerAccountEvent.EventType.REOPENED,
        reason=reason,
        created_by=reopened_by if getattr(reopened_by, "is_authenticated", False) else None,
    )
    return customer
