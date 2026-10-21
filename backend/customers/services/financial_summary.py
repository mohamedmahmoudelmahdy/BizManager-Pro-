from decimal import Decimal

from customers.models import Customer


def _debt_status_display(balance: Decimal) -> str:
    """Authoritative sign convention: >0 debt, <0 credit, 0 clear."""
    if balance > Decimal("0"):
        return "in_debt"
    if balance < Decimal("0"):
        return "credit"
    return "clear"


def build_customer_financial_summary(customer: Customer) -> dict:
    procedures = list(
        customer.procedures.select_related("cash_out_type", "cash_in_type").order_by("date", "id")
    )
    payments = list(
        customer.payments.select_related("procedure", "bank_card", "recorded_by").order_by("date", "id")
    )
    refunds = list(
        customer.payment_refunds.select_related(
            "payment", "payment_method", "created_by"
        ).order_by("date", "created_at", "id")
    )
    adjustments = list(
        customer.financial_adjustments.select_related("created_by", "reversed_by").order_by("date", "created_at", "id")
    )
    account_events = list(
        customer.account_events.select_related("created_by").order_by("created_at", "id")
    )

    total_charges = Decimal("0")
    procedure_rows = []
    for proc in procedures:
        charge = Decimal(proc.selling_price or 0)
        cost = Decimal(proc.cost or 0)
        paid = Decimal(proc.paid or 0)
        total_charges += charge
        procedure_rows.append(
            {
                "id": str(proc.id),
                "customer_id": str(proc.customer_id),
                "date": proc.date.isoformat() if proc.date else None,
                "category": proc.category,
                "description": proc.description or "",
                "status": proc.status,
                "selling_price": str(charge),
                "cost": str(cost),
                "paid": str(paid),
                "outstanding": str(charge - paid),
            }
        )

    refunds_by_payment: dict[str, Decimal] = {}
    for refund in refunds:
        pid = str(refund.payment_id)
        refunds_by_payment[pid] = refunds_by_payment.get(pid, Decimal("0")) + Decimal(refund.amount or 0)

    total_payments = Decimal("0")
    payment_rows = []
    for payment in payments:
        amount = Decimal(payment.amount or 0)
        total_payments += amount
        refunded = refunds_by_payment.get(str(payment.id), Decimal("0")).quantize(Decimal("0.01"))
        refundable = (amount - refunded).quantize(Decimal("0.01"))
        if refundable < 0:
            refundable = Decimal("0.00")
        payment_rows.append(
            {
                "id": str(payment.id),
                "customer_id": str(payment.customer_id),
                "date": payment.date.isoformat() if payment.date else None,
                "amount": str(amount),
                "original_amount": str(amount),
                "refunded_amount": str(refunded),
                "refundable_amount": str(refundable),
                "type": payment.type,
                "procedure_id": str(payment.procedure_id) if payment.procedure_id else None,
                "procedure_category": payment.procedure.category if payment.procedure else "",
                "bank_card_id": str(payment.bank_card_id) if payment.bank_card_id else None,
                "bank_card_name": payment.bank_card.bank_name if payment.bank_card else "",
                "notes": payment.notes or "",
                "recorded_by_name": _recorded_by_name(payment),
            }
        )

    total_refunds = Decimal("0")
    refund_rows = []
    for refund in refunds:
        amount = Decimal(refund.amount or 0)
        total_refunds += amount
        refund_rows.append(
            {
                "id": str(refund.id),
                "payment_id": str(refund.payment_id),
                "customer_id": str(refund.customer_id),
                "date": refund.date.isoformat() if refund.date else None,
                "amount": str(amount),
                "payment_method_id": str(refund.payment_method_id) if refund.payment_method_id else None,
                "payment_method_name": refund.payment_method.bank_name if refund.payment_method else "",
                "reason": refund.reason or "",
                "notes": refund.notes or "",
                "created_by_name": _user_display(refund.created_by),
            }
        )

    total_adjustments = Decimal("0")
    total_reversed_adjustments = Decimal("0")
    adjustment_rows = []
    for adjustment in adjustments:
        amount = Decimal(adjustment.amount or 0)
        if adjustment.adjustment_type == "discount":
            total_adjustments += amount
            if adjustment.status == "reversed":
                total_reversed_adjustments += amount
        adjustment_rows.append(
            {
                "id": str(adjustment.id),
                "date": adjustment.date.isoformat() if adjustment.date else None,
                "adjustment_type": adjustment.adjustment_type,
                "amount": str(amount),
                "reason": adjustment.reason,
                "notes": adjustment.notes or "",
                "status": adjustment.status,
                "reversed_at": adjustment.reversed_at.isoformat() if adjustment.reversed_at else None,
                "reversal_reason": adjustment.reversal_reason or "",
            }
        )

    statement_entries = []
    for proc in procedures:
        charge = Decimal(proc.selling_price or 0)
        statement_entries.append(
            {
                "id": f"proc-{proc.id}",
                "date": proc.date.isoformat() if proc.date else None,
                "kind": "procedure",
                "description": proc.category,
                "status": proc.status,
                "debit": str(charge),
                "credit": "0",
            }
        )
    for payment in payments:
        amount = Decimal(payment.amount or 0)
        statement_entries.append(
            {
                "id": f"pay-{payment.id}",
                "date": payment.date.isoformat() if payment.date else None,
                "kind": "payment",
                "description": payment.procedure.category if payment.procedure else "Payment",
                "status": payment.type,
                "debit": "0",
                "credit": str(amount),
            }
        )
    for refund in refunds:
        amount = Decimal(refund.amount or 0)
        statement_entries.append(
            {
                "id": f"refund-{refund.id}",
                "date": refund.date.isoformat() if refund.date else None,
                "kind": "refund",
                "description": f"Refund — {refund.reason}" if refund.reason else "Refund",
                "status": "refund",
                "debit": str(amount),
                "credit": "0",
            }
        )
    for adjustment in adjustments:
        amount = Decimal(adjustment.amount or 0)
        if adjustment.adjustment_type != "discount":
            continue
        statement_entries.append(
            {
                "id": f"adj-{adjustment.id}",
                "date": adjustment.date.isoformat() if adjustment.date else None,
                "kind": "adjustment",
                "description": f"Direct discount — {adjustment.reason}",
                "status": adjustment.status,
                "debit": "0",
                "credit": str(amount),
            }
        )
        if adjustment.status == "reversed" and adjustment.reversed_at:
            statement_entries.append(
                {
                    "id": f"adj-rev-{adjustment.id}",
                    "date": adjustment.reversed_at.date().isoformat(),
                    "kind": "adjustment_reversal",
                    "description": f"Reversal — Direct discount — {adjustment.reversal_reason}",
                    "status": "reversed",
                    "debit": str(amount),
                    "credit": "0",
                }
            )
    for event in account_events:
        statement_entries.append(
            {
                "id": f"acct-{event.id}",
                "date": event.created_at.date().isoformat() if event.created_at else None,
                "kind": "account_event",
                "description": event.reason,
                "status": event.event_type,
                "debit": "0",
                "credit": "0",
            }
        )

    statement_entries.sort(
        key=lambda row: (
            row["date"] or "",
            {
                "procedure": 0,
                "payment": 1,
                "refund": 2,
                "adjustment": 3,
                "adjustment_reversal": 4,
                "account_event": 5,
            }.get(row["kind"], 9),
            row["id"],
        )
    )

    running = Decimal("0")
    statement_rows = []
    for entry in statement_entries:
        debit = Decimal(entry["debit"])
        credit = Decimal(entry["credit"])
        running += debit - credit
        statement_rows.append({**entry, "running_balance": str(running)})

    recorded_balance = Decimal(customer.balance or 0)
    net_collected = total_payments - total_refunds
    # Balance = Charges − Payments + Refunds − Discounts + Reversed discounts
    computed_balance = (
        total_charges - total_payments + total_refunds - total_adjustments + total_reversed_adjustments
    )
    balance_mismatch = abs(computed_balance - recorded_balance) > Decimal("0.01")

    display_name = customer.company_name or customer.name

    return {
        "customer": {
            "id": str(customer.id),
            "type": customer.type,
            "name": customer.name,
            "company_name": customer.company_name,
            "display_name": display_name,
            "phone": customer.phone,
            "phone_secondary": customer.phone_secondary,
            "email": customer.email,
            "balance": str(recorded_balance),
            "debt_status": customer.debt_status,
            "debt_status_display": _debt_status_display(recorded_balance),
            "last_activity": customer.last_activity.isoformat() if customer.last_activity else None,
            "account_status": customer.account_status,
            "closed_at": customer.closed_at.isoformat() if customer.closed_at else None,
            "closure_reason": customer.closure_reason,
        },
        "totals": {
            "procedure_count": len(procedure_rows),
            "total_procedure_charges": str(total_charges),
            "total_payments": str(total_payments),
            "total_refunds": str(total_refunds),
            "net_collected": str(net_collected),
            "total_adjustments": str(total_adjustments),
            "total_reversed_adjustments": str(total_reversed_adjustments),
            "computed_statement_balance": str(computed_balance),
            "recorded_balance": str(recorded_balance),
            "balance_mismatch": balance_mismatch,
        },
        "procedures": procedure_rows,
        "payments": payment_rows,
        "refunds": refund_rows,
        "adjustments": adjustment_rows,
        "statement": statement_rows,
    }


def _recorded_by_name(payment) -> str:
    return _user_display(payment.recorded_by)


def _user_display(user) -> str:
    if not user:
        return ""
    profile = getattr(user, "employee_profile", None)
    if profile and profile.full_name:
        return profile.full_name
    return user.get_full_name() or user.username or ""
