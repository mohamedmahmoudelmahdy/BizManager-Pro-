"""Create a procedure and apply the same balance accounting as ProcedureViewSet.perform_create.

Initial customer cash-in (paid > 0 + cash_in_type) creates an authoritative Payment
row so collections reporting has a durable source of truth. Bank/Customer/Procedure.paid
effects for that cash are applied exactly once via payment_effects.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from banking.models import BankCard
from customers.services.account_controls import ensure_customer_account_active
from payments.models import Payment
from payments.services.payment_effects import apply_payment_effects
from procedures.models import Procedure

CUSTOMER_CARD_BANK_NAME = "Customer Card / كرت العميل"
INITIAL_PAYMENT_NOTE = "[procedure-initial-payment]"


def _is_customer_card(card) -> bool:
    if not card:
        return False
    return getattr(card, "bank_name", None) == CUSTOMER_CARD_BANK_NAME or str(
        getattr(card, "pk", "")
    ) == "CUSTOMER_CARD"


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _payment_type_for_card(card: BankCard) -> str:
    if card.method_type == BankCard.MethodType.CASH:
        return Payment.PaymentType.CASH
    return Payment.PaymentType.TRANSFER


@transaction.atomic
def create_procedure_with_accounting(*, user, validated_data: dict, raw_data: dict | None = None) -> Procedure:
    raw_data = raw_data or {}
    data = dict(validated_data)
    procedure_date = data.get("date")

    cash_out_type = data.get("cash_out_type")
    cash_in_type = data.get("cash_in_type")
    customer_card_mode = (
        bool(data.pop("customer_card_mode", False))
        or str(raw_data.get("cash_out_type", "")) == "CUSTOMER_CARD"
    )
    cost = Decimal(data.get("cost") or 0)
    selling_price = Decimal(data.get("selling_price") or 0)
    paid = Decimal(data.get("paid") or 0)
    customer = data.get("customer")
    locked_customer = None

    if customer:
        locked_customer = customer.__class__.objects.select_for_update().get(pk=customer.pk)
        ensure_customer_account_active(locked_customer)

    if customer_card_mode or _is_customer_card(cash_out_type):
        if cost != Decimal("0"):
            raise ValidationError({"cost": "Cost must be 0 when cash out type is Customer Card."})
        if selling_price < Decimal("0"):
            raise ValidationError({"selling_price": "Selling price cannot be negative."})

    if paid < Decimal("0"):
        raise ValidationError({"paid": "Paid amount cannot be negative."})

    # Initial cash-in must go through Payment (durable collection record).
    initial_cash = paid
    if initial_cash > Decimal("0") and not cash_in_type:
        raise ValidationError(
            {
                "cash_in_type": "Payment method is required when recording an initial paid amount."
            }
        )

    # Charge customer for full selling (or customer-card delta); payment row reduces balance.
    create_paid = Decimal("0")
    data["paid"] = create_paid
    if "cash_in" in data:
        data["cash_in"] = create_paid

    if cash_out_type and not (customer_card_mode or _is_customer_card(cash_out_type)):
        locked_out = cash_out_type.__class__.objects.select_for_update().get(pk=cash_out_type.pk)
        if locked_out.balance - cost < 0:
            raise ValidationError({"cost": "Insufficient balance in the selected cash-out method."})
        locked_out.balance = locked_out.balance - cost
        locked_out.save(update_fields=["balance"])

    # Do NOT credit cash_in here when initial_cash > 0 — Payment applies that once.
    if cash_in_type and initial_cash == Decimal("0"):
        # No cash receipt; nothing to credit.
        pass

    if locked_customer:
        customer_delta = (
            (selling_price - cost)
            if (customer_card_mode or _is_customer_card(cash_out_type))
            else selling_price  # full charge; Payment will reduce by initial_cash
        )
        locked_customer.balance = locked_customer.balance + customer_delta
        if procedure_date:
            locked_customer.last_activity = procedure_date
        locked_customer.save(update_fields=["balance", "last_activity"])

    if user and user.is_authenticated and user.role == "employee":
        requested_assignee = data.pop("assigned_employee", None)
        if requested_assignee and requested_assignee.pk != user.pk:
            raise PermissionDenied("Employees can only create procedures assigned to themselves.")
        data["assigned_employee"] = user

    procedure = Procedure.objects.create(**data)

    if initial_cash > Decimal("0") and cash_in_type and customer:
        payment = Payment.objects.create(
            amount=initial_cash,
            date=procedure_date or procedure.date,
            type=_payment_type_for_card(cash_in_type),
            customer=customer,
            procedure=procedure,
            bank_card=cash_in_type,
            recorded_by=user if user and getattr(user, "is_authenticated", False) else None,
            notes=INITIAL_PAYMENT_NOTE,
        )
        apply_payment_effects(payment)
        # In-memory instance still has paid=0; payment_effects updated DB.
        procedure.refresh_from_db()
        # Keep denormalized cash_in aligned with receipt method for UI.
        if procedure.cash_in != initial_cash:
            procedure.cash_in = initial_cash
            procedure.save(update_fields=["cash_in"])

    return procedure
