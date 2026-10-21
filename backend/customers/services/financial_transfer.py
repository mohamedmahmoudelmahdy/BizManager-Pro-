"""Atomic Procedure / Payment transfer between Customer accounts.

Not a simple FK update: reverses source customer balance effects and applies
identical effects to the target. Bank/payment-method balances are not
double-mutated (net unchanged). Linked Procedure↔Payment ownership stays valid.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from customers.models import Customer, CustomerFinancialTransfer
from customers.services.account_controls import ensure_customer_account_active
from payments.models import Payment
from procedures.models import Procedure

CUSTOMER_CARD_BANK_NAME = "Customer Card / كرت العميل"

# Stable structured error codes (also returned in ValidationError detail.payload)
ERR_SAME_CUSTOMER = "transfer_same_customer"
ERR_REASON_REQUIRED = "transfer_reason_required"
ERR_TARGET_NOT_FOUND = "target_customer_not_found"
ERR_TARGET_INACTIVE = "target_customer_inactive"
ERR_PROCEDURE_NOT_ALLOWED = "procedure_transfer_not_allowed"
ERR_PAYMENT_NOT_ALLOWED = "payment_transfer_not_allowed"
ERR_CROSS_CUSTOMER_LINK = "cross_customer_procedure_link"
ERR_LINKED_PAYMENTS = "linked_payments_require_transfer"
ERR_PERMISSION = "permission_denied"


def _decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"))


def _is_customer_card(card) -> bool:
    if not card:
        return False
    return (
        getattr(card, "bank_name", None) == CUSTOMER_CARD_BANK_NAME
        or str(getattr(card, "pk", "")) == "CUSTOMER_CARD"
    )


def procedure_customer_delta(procedure: Procedure) -> Decimal:
    """Exact existing formula used by Procedure create/update/delete accounting."""
    selling = _decimal(procedure.selling_price)
    cost = _decimal(procedure.cost)
    paid = _decimal(procedure.paid)
    if _is_customer_card(procedure.cash_out_type):
        return selling - cost
    return selling - paid


def _raise(code: str, message: str, field: str | None = None):
    payload: dict[str, Any] = {"code": code, "detail": message}
    if field:
        raise ValidationError({field: [message], "code": code, "detail": message})
    raise ValidationError(payload)


def _require_reason(reason: str | None) -> str:
    clean = str(reason or "").strip()
    if not clean:
        _raise(ERR_REASON_REQUIRED, "Transfer reason is required.", field="reason")
    return clean


def _ensure_transfer_actor(actor) -> None:
    if actor is None or not getattr(actor, "is_authenticated", False):
        raise PermissionDenied(ERR_PERMISSION)
    if getattr(actor, "is_superuser", False):
        return
    role = getattr(actor, "role", None)
    if role in ("admin", "manager", "employee"):
        return
    if actor.has_perm("customers.transfer_procedure") or actor.has_perm(
        "customers.transfer_payment"
    ):
        return
    raise PermissionDenied(ERR_PERMISSION)


def _lock_customers(*customer_ids: UUID) -> dict[UUID, Customer]:
    ids = sorted({cid for cid in customer_ids if cid}, key=str)
    locked = {
        c.pk: c
        for c in Customer.objects.select_for_update().filter(pk__in=ids)
    }
    return locked


def _get_active_target(locked: dict[UUID, Customer], target_id: UUID) -> Customer:
    target = locked.get(target_id)
    if target is None:
        _raise(ERR_TARGET_NOT_FOUND, "Target customer was not found.", field="target_customer_id")
    try:
        ensure_customer_account_active(target)
    except ValidationError:
        _raise(
            ERR_TARGET_INACTIVE,
            "Target customer account is closed and cannot receive transfers.",
            field="target_customer_id",
        )
    return target


def _move_customer_balance(
    *,
    source: Customer,
    target: Customer,
    delta: Decimal,
    activity_date=None,
) -> None:
    """Move a positive customer-balance debit effect from source to target.

    Procedure charge delta: source -= delta, target += delta
    (caller passes +delta for charges).
    """
    source.balance = _decimal(source.balance) - delta
    target.balance = _decimal(target.balance) + delta
    fields_source = ["balance", "updated_at"]
    fields_target = ["balance", "updated_at"]
    if activity_date:
        target.last_activity = activity_date
        fields_target.append("last_activity")
    source.save(update_fields=fields_source)
    target.save(update_fields=fields_target)


def _move_payment_customer_effect(
    *,
    source: Customer,
    target: Customer,
    amount: Decimal,
    activity_date=None,
) -> None:
    """Payment reduces customer balance: reverse on source, apply on target."""
    source.balance = _decimal(source.balance) + amount
    target.balance = _decimal(target.balance) - amount
    fields_source = ["balance", "updated_at"]
    fields_target = ["balance", "updated_at"]
    if activity_date:
        target.last_activity = activity_date
        fields_target.append("last_activity")
    source.save(update_fields=fields_source)
    target.save(update_fields=fields_target)


@transaction.atomic
def transfer_procedure_to_customer_atomic(
    *,
    procedure_id,
    target_customer_id,
    actor,
    reason: str,
    transfer_linked_payments: bool = True,
) -> dict:
    """
    Transfer a Procedure (and its linked Payments) to another Customer.

    - Customer balance: reverse procedure delta on source, apply on target.
    - Linked Payments: move ownership and customer balance effects together.
    - Bank/payment-method balances: unchanged (not customer-specific).
    - procedure.paid / amounts / status / methods: preserved.
    """
    _ensure_transfer_actor(actor)
    reason = _require_reason(reason)

    # PostgreSQL rejects FOR UPDATE on nullable OUTER JOINs from select_related
    # (cash_out_type / cash_in_type are nullable). Lock the procedure row only.
    procedure = Procedure.objects.select_for_update().get(pk=procedure_id)
    source_id = procedure.customer_id
    target_id = UUID(str(target_customer_id))

    if source_id == target_id:
        _raise(
            ERR_SAME_CUSTOMER,
            "Source and target customers must be different.",
            field="target_customer_id",
        )

    locked_customers = _lock_customers(source_id, target_id)
    source = locked_customers.get(source_id)
    if source is None:
        _raise(ERR_PROCEDURE_NOT_ALLOWED, "Source customer for this procedure was not found.")
    target = _get_active_target(locked_customers, target_id)

    linked_payments = list(
        Payment.objects.select_for_update()
        .filter(procedure_id=procedure.pk)
        .order_by("date", "id")
    )
    if linked_payments and not transfer_linked_payments:
        _raise(
            ERR_LINKED_PAYMENTS,
            "This procedure has linked payments. Transfer linked payments together.",
            field="transfer_linked_payments",
        )

    selling = _decimal(procedure.selling_price)
    cost = _decimal(procedure.cost)
    paid = _decimal(procedure.paid)
    linked_sum = sum((_decimal(p.amount) for p in linked_payments), Decimal("0.00"))
    is_cc = _is_customer_card(procedure.cash_out_type)

    # Avoid double-counting when procedure.paid already includes linked Payment amounts.
    # Charge moved separately from payment credits; prepaid not from payments reduces charge.
    if is_cc:
        charge_delta = selling - cost
    else:
        paid_from_linked = min(paid, linked_sum)
        prepaid_not_from_payments = paid - paid_from_linked
        charge_delta = selling - prepaid_not_from_payments

    source_balance_before = _decimal(source.balance)
    target_balance_before = _decimal(target.balance)

    # Move procedure charge effect
    _move_customer_balance(
        source=source,
        target=target,
        delta=charge_delta,
        activity_date=procedure.date,
    )

    # Move linked payments' customer effects (bank cards untouched)
    payment_ids = []
    for payment in linked_payments:
        amount = _decimal(payment.amount)
        source = Customer.objects.select_for_update().get(pk=source.pk)
        target = Customer.objects.select_for_update().get(pk=target.pk)
        _move_payment_customer_effect(
            source=source,
            target=target,
            amount=amount,
            activity_date=payment.date,
        )
        payment.customer_id = target.pk
        payment.save(update_fields=["customer"])
        payment_ids.append(str(payment.pk))

    procedure.customer_id = target.pk
    procedure.save(update_fields=["customer", "updated_at"])

    source.refresh_from_db()
    target.refresh_from_db()

    transfer = CustomerFinancialTransfer.objects.create(
        transfer_type=CustomerFinancialTransfer.TransferType.PROCEDURE,
        procedure=procedure,
        payment=None,
        source_customer=source,
        target_customer=target,
        amount_snapshot=charge_delta,
        reason=reason,
        transferred_by=actor if getattr(actor, "is_authenticated", False) else None,
        metadata={
            "procedure_category": procedure.category,
            "selling_price": str(selling),
            "cost": str(cost),
            "paid": str(paid),
            "charge_delta": str(charge_delta),
            "linked_payments_total": str(linked_sum),
            "customer_card_mode": is_cc,
            "linked_payment_ids": payment_ids,
            "source_balance_before": str(source_balance_before),
            "target_balance_before": str(target_balance_before),
            "source_balance_after": str(_decimal(source.balance)),
            "target_balance_after": str(_decimal(target.balance)),
            "transferred_at": timezone.now().isoformat(),
        },
    )

    return {
        "transfer_id": str(transfer.pk),
        "transfer_type": transfer.transfer_type,
        "procedure_id": str(procedure.pk),
        "source_customer_id": str(source.pk),
        "target_customer_id": str(target.pk),
        "linked_payment_ids": payment_ids,
        "customer_delta": str(charge_delta),
        "source_balance": str(_decimal(source.balance)),
        "target_balance": str(_decimal(target.balance)),
        "reason": reason,
    }


@transaction.atomic
def transfer_payment_to_customer_atomic(
    *,
    payment_id,
    target_customer_id,
    actor,
    reason: str,
    target_procedure_id=None,
) -> dict:
    """
    Transfer a Payment to another Customer.

    - Customer balance: +amount on source, -amount on target.
    - Bank/payment-method balance: unchanged.
    - If linked to a Procedure: target_procedure must belong to target customer,
      or target_procedure_id may be null to unlink (unallocated payment).
    - Updates procedure.paid when link changes (symmetric with apply/revert).
    """
    _ensure_transfer_actor(actor)
    reason = _require_reason(reason)

    # Lock payment row only — nullable procedure/bank_card select_related breaks
    # PostgreSQL FOR UPDATE (outer join on nullable side).
    payment = Payment.objects.select_for_update().get(pk=payment_id)
    source_id = payment.customer_id
    target_id = UUID(str(target_customer_id))

    if source_id == target_id:
        _raise(
            ERR_SAME_CUSTOMER,
            "Source and target customers must be different.",
            field="target_customer_id",
        )

    locked_customers = _lock_customers(source_id, target_id)
    source = locked_customers.get(source_id)
    if source is None:
        _raise(ERR_PAYMENT_NOT_ALLOWED, "Source customer for this payment was not found.")
    target = _get_active_target(locked_customers, target_id)

    amount = _decimal(payment.amount)
    old_procedure = None
    if payment.procedure_id:
        old_procedure = Procedure.objects.select_for_update().get(pk=payment.procedure_id)

    # Procedure link policy:
    # - target_procedure_id set → must belong to target customer
    # - target_procedure_id null/omitted → unallocated (unlink from source procedure)
    # Never keep a link to a procedure still owned by the source customer.
    raw_target_proc = target_procedure_id
    new_procedure = None
    if raw_target_proc not in (None, "", "null"):
        try:
            new_procedure = Procedure.objects.select_for_update().get(pk=raw_target_proc)
        except Procedure.DoesNotExist:
            _raise(
                ERR_CROSS_CUSTOMER_LINK,
                "Target procedure was not found.",
                field="target_procedure_id",
            )
        if new_procedure.customer_id != target.pk:
            _raise(
                ERR_CROSS_CUSTOMER_LINK,
                "Target procedure must belong to the target customer.",
                field="target_procedure_id",
            )
    elif old_procedure is not None and old_procedure.customer_id == target.pk:
        # Procedure already on target (e.g. transferred first) — keep link if omitted
        new_procedure = old_procedure

    unlink = new_procedure is None

    source_balance_before = _decimal(source.balance)
    target_balance_before = _decimal(target.balance)

    # Adjust procedure.paid on unlink / relink
    if old_procedure and (unlink or (new_procedure and new_procedure.pk != old_procedure.pk)):
        old_procedure.paid = _decimal(old_procedure.paid) - amount
        old_procedure.save(update_fields=["paid", "updated_at"])

    if new_procedure and (old_procedure is None or old_procedure.pk != new_procedure.pk):
        new_procedure.paid = _decimal(new_procedure.paid) + amount
        new_procedure.save(update_fields=["paid", "updated_at"])

    _move_payment_customer_effect(
        source=source,
        target=target,
        amount=amount,
        activity_date=payment.date,
    )

    payment.customer_id = target.pk
    payment.procedure_id = None if unlink else (new_procedure.pk if new_procedure else None)
    payment.save(update_fields=["customer", "procedure"])

    source.refresh_from_db()
    target.refresh_from_db()

    transfer = CustomerFinancialTransfer.objects.create(
        transfer_type=CustomerFinancialTransfer.TransferType.PAYMENT,
        procedure=new_procedure,
        payment=payment,
        source_customer=source,
        target_customer=target,
        amount_snapshot=amount,
        reason=reason,
        transferred_by=actor if getattr(actor, "is_authenticated", False) else None,
        metadata={
            "amount": str(amount),
            "payment_type": payment.type,
            "bank_card_id": str(payment.bank_card_id) if payment.bank_card_id else None,
            "old_procedure_id": str(old_procedure.pk) if old_procedure else None,
            "new_procedure_id": str(new_procedure.pk) if new_procedure else None,
            "unlinked": unlink,
            "bank_balance_unchanged": True,
            "source_balance_before": str(source_balance_before),
            "target_balance_before": str(target_balance_before),
            "source_balance_after": str(_decimal(source.balance)),
            "target_balance_after": str(_decimal(target.balance)),
            "transferred_at": timezone.now().isoformat(),
        },
    )

    return {
        "transfer_id": str(transfer.pk),
        "transfer_type": transfer.transfer_type,
        "payment_id": str(payment.pk),
        "source_customer_id": str(source.pk),
        "target_customer_id": str(target.pk),
        "target_procedure_id": str(new_procedure.pk) if new_procedure else None,
        "amount": str(amount),
        "source_balance": str(_decimal(source.balance)),
        "target_balance": str(_decimal(target.balance)),
        "reason": reason,
    }
