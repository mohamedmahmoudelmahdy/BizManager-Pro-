"""Apply / revert Payment balance effects (single source of truth).

Used by PaymentViewSet and Procedure create (initial cash-in → Payment).
"""
from __future__ import annotations

from decimal import Decimal

from customers.models import Customer
from payments.models import Payment
from procedures.models import Procedure


def apply_payment_effects(payment: Payment) -> None:
    """Credit bank, reduce customer balance, increase procedure.paid when linked."""
    amount = Decimal(str(payment.amount or 0))
    if payment.bank_card_id:
        locked_card = payment.bank_card.__class__.objects.select_for_update().get(
            pk=payment.bank_card_id
        )
        locked_card.balance = locked_card.balance + amount
        locked_card.save(update_fields=["balance"])

    if payment.customer_id:
        locked_customer = Customer.objects.select_for_update().get(pk=payment.customer_id)
        locked_customer.balance = locked_customer.balance - amount
        if payment.date:
            locked_customer.last_activity = payment.date
        locked_customer.save(update_fields=["balance", "last_activity"])

    if payment.procedure_id:
        locked_procedure = Procedure.objects.select_for_update().get(pk=payment.procedure_id)
        locked_procedure.paid = (locked_procedure.paid or 0) + amount
        locked_procedure.save(update_fields=["paid"])


def revert_payment_effects(payment: Payment) -> None:
    """Undo apply_payment_effects."""
    amount = Decimal(str(payment.amount or 0))
    if payment.bank_card_id:
        locked_card = payment.bank_card.__class__.objects.select_for_update().get(
            pk=payment.bank_card_id
        )
        locked_card.balance = locked_card.balance - amount
        locked_card.save(update_fields=["balance"])

    if payment.customer_id:
        locked_customer = Customer.objects.select_for_update().get(pk=payment.customer_id)
        locked_customer.balance = locked_customer.balance + amount
        locked_customer.save(update_fields=["balance"])

    if payment.procedure_id:
        locked_procedure = Procedure.objects.select_for_update().get(pk=payment.procedure_id)
        new_paid = (locked_procedure.paid or 0) - amount
        if new_paid < 0:
            new_paid = Decimal("0")
        locked_procedure.paid = new_paid
        locked_procedure.save(update_fields=["paid"])
