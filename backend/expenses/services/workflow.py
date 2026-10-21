"""Expense numbering, visibility, audit, and employee-claim workflow services."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from banking.models import BankCard
from expenses.exceptions import (
    DuplicatePaymentError,
    ExpenseAlreadySubmittedError,
    ExpenseNotApprovableError,
    ExpenseNotEditableError,
    ExpenseNotFoundError,
    ExpenseNotPayableError,
    ExpenseNotSubmittableError,
    ExpenseOperationNotPermittedError,
    ExpensePermissionDeniedError,
    InvalidExpenseAmountError,
    InvalidExpenseDateError,
    InvalidExpenseTransitionError,
    ReceiptRequiredError,
    SelfApprovalNotAllowedError,
)
from expenses.models import Expense, ExpenseAttachment, ExpenseAuditEvent

User = get_user_model()

ALLOWED_RECEIPT_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
    }
)
ALLOWED_RECEIPT_EXTENSIONS = frozenset({".pdf", ".jpg", ".jpeg", ".png"})
MAX_RECEIPT_BYTES = 5 * 1024 * 1024  # 5 MiB
MAX_RECEIPTS_PER_EXPENSE = 5


def _is_admin_or_manager(user) -> bool:
    return getattr(user, "is_superuser", False) or getattr(user, "role", None) in (
        "admin",
        "manager",
    )


def user_has_expense_perm(user, codename: str) -> bool:
    if _is_admin_or_manager(user):
        return True
    return user.has_perm(f"expenses.{codename}")


def ensure_expense_perm(user, *codenames: str, any_of: bool = False) -> None:
    if _is_admin_or_manager(user):
        return
    ok = (
        any(user.has_perm(f"expenses.{c}") for c in codenames)
        if any_of
        else all(user.has_perm(f"expenses.{c}") for c in codenames)
    )
    if not ok:
        raise ExpensePermissionDeniedError(details={"permissions": list(codenames)})


def allocate_expense_number() -> str:
    """Allocate EXP-YYYYMMDD-##### using today's count (transaction-safe enough for MVP)."""
    today = timezone.localdate()
    prefix = f"EXP-{today.strftime('%Y%m%d')}-"
    existing = (
        Expense.objects.filter(expense_number__startswith=prefix)
        .order_by("-expense_number")
        .values_list("expense_number", flat=True)
        .first()
    )
    seq = 1
    if existing:
        try:
            seq = int(existing.rsplit("-", 1)[-1]) + 1
        except ValueError:
            seq = Expense.objects.filter(expense_number__startswith=prefix).count() + 1
    return f"{prefix}{seq:05d}"


def record_audit(
    *,
    expense: Expense,
    actor,
    action: str,
    from_status: str = "",
    to_status: str = "",
    message: str = "",
    metadata: dict[str, Any] | None = None,
) -> ExpenseAuditEvent:
    return ExpenseAuditEvent.objects.create(
        expense=expense,
        action=action,
        actor=actor,
        from_status=from_status or "",
        to_status=to_status or "",
        message=message or "",
        metadata=metadata or {},
    )


def visible_expenses_for(user, base_qs: QuerySet[Expense] | None = None) -> QuerySet[Expense]:
    """
    Visibility:
    - admin/manager or expenses.view_expense: all
    - expenses.view_own_expense: expense_for or submitted_by or assigned_employee = user
    - else: none
    """
    qs = base_qs if base_qs is not None else Expense.objects.all()
    if _is_admin_or_manager(user) or user.has_perm("expenses.view_expense"):
        return qs
    if user.has_perm("expenses.view_own_expense"):
        return qs.filter(
            Q(expense_for_id=user.pk)
            | Q(submitted_by_id=user.pk)
            | Q(assigned_employee_id=user.pk)
        )
    return qs.none()


def _parse_amount(raw) -> Decimal:
    try:
        amount = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise InvalidExpenseAmountError(details={"reason": "invalid"}) from exc
    if amount <= 0:
        raise InvalidExpenseAmountError(details={"reason": "must_be_positive"})
    return amount.quantize(Decimal("0.01"))


@transaction.atomic
def create_employee_expense(
    *,
    actor,
    category: str,
    date,
    amount,
    merchant: str = "",
    business_purpose: str = "",
    notes: str = "",
    submit: bool = False,
) -> Expense:
    ensure_expense_perm(actor, "add_own_expense", "add_expense", any_of=True)
    if not date:
        raise InvalidExpenseDateError(details={"field": "date"})
    amount_dec = _parse_amount(amount)
    if not category:
        raise ExpenseNotSubmittableError(details={"field": "category"})

    expense = Expense(
        expense_number=allocate_expense_number(),
        category=category,
        date=date,
        amount=amount_dec,
        merchant=(merchant or "").strip(),
        business_purpose=(business_purpose or "").strip(),
        notes=(notes or "").strip(),
        submitted_by=actor,
        expense_for=actor,
        assigned_employee=actor,
        created_by=actor,
        workflow_status=Expense.WorkflowStatus.DRAFT,
        paid_by=None,
    )
    expense.full_clean()
    expense.save()
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.CREATED,
        to_status=expense.workflow_status,
    )
    if submit:
        return submit_expense(actor=actor, expense_id=expense.pk)
    return expense


@transaction.atomic
def update_employee_expense(*, actor, expense_id: UUID, updates: dict[str, Any]) -> Expense:
    ensure_expense_perm(actor, "change_own_expense", "change_expense", any_of=True)
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    if not visible_expenses_for(actor).filter(pk=expense.pk).exists():
        raise ExpenseOperationNotPermittedError(details={"reason": "not_visible"})

    if expense.workflow_status not in Expense.EDITABLE_STATUSES:
        raise ExpenseNotEditableError(details={"status": expense.workflow_status})

    # Own-only editors cannot edit others' claims.
    if not user_has_expense_perm(actor, "change_expense"):
        owner_id = expense.expense_for_id or expense.submitted_by_id
        if owner_id != actor.pk:
            raise ExpenseOperationNotPermittedError(details={"reason": "not_owner"})

    allowed = {"category", "date", "amount", "merchant", "business_purpose", "notes"}
    for key, value in updates.items():
        if key not in allowed:
            continue
        if key == "amount":
            expense.amount = _parse_amount(value)
        elif key == "merchant":
            expense.merchant = (value or "").strip()
        elif key == "business_purpose":
            expense.business_purpose = (value or "").strip()
        elif key == "notes":
            expense.notes = (value or "").strip()
        else:
            setattr(expense, key, value)

    from_status = expense.workflow_status
    expense.full_clean()
    expense.save()
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.UPDATED,
        from_status=from_status,
        to_status=expense.workflow_status,
        metadata={"fields": sorted(k for k in updates if k in allowed)},
    )
    return expense


def _require_receipts_if_policy(expense: Expense) -> None:
    # No configured threshold — receipts recommended but not mandatory unless
    # product later sets a threshold. Keep hook for ReceiptRequiredError.
    _ = expense
    return


@transaction.atomic
def submit_expense(*, actor, expense_id: UUID) -> Expense:
    ensure_expense_perm(actor, "submit_expense")
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    if not visible_expenses_for(actor).filter(pk=expense.pk).exists():
        raise ExpenseOperationNotPermittedError(details={"reason": "not_visible"})

    owner_id = expense.expense_for_id or expense.submitted_by_id
    if owner_id != actor.pk and not user_has_expense_perm(actor, "change_expense"):
        raise ExpenseOperationNotPermittedError(details={"reason": "not_owner"})

    if expense.workflow_status == Expense.WorkflowStatus.SUBMITTED:
        raise ExpenseAlreadySubmittedError(details={"status": expense.workflow_status})
    if expense.workflow_status not in Expense.EDITABLE_STATUSES:
        raise ExpenseNotSubmittableError(details={"status": expense.workflow_status})

    if not expense.category or not expense.date or expense.amount is None:
        raise ExpenseNotSubmittableError(details={"reason": "missing_required_fields"})
    if not (expense.business_purpose or "").strip():
        raise ExpenseNotSubmittableError(details={"field": "business_purpose"})

    _require_receipts_if_policy(expense)

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.SUBMITTED
    expense.submitted_at = timezone.now()
    if not expense.submitted_by_id:
        expense.submitted_by = actor
    expense.save(
        update_fields=["workflow_status", "submitted_at", "submitted_by", "updated_at"]
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.SUBMITTED,
        from_status=from_status,
        to_status=expense.workflow_status,
    )
    return expense


@transaction.atomic
def withdraw_expense(*, actor, expense_id: UUID) -> Expense:
    ensure_expense_perm(actor, "withdraw_expense")
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    if not visible_expenses_for(actor).filter(pk=expense.pk).exists():
        raise ExpenseOperationNotPermittedError(details={"reason": "not_visible"})

    owner_id = expense.expense_for_id or expense.submitted_by_id
    if owner_id != actor.pk and not user_has_expense_perm(actor, "change_expense"):
        raise ExpenseOperationNotPermittedError(details={"reason": "not_owner"})

    if expense.workflow_status != Expense.WorkflowStatus.SUBMITTED:
        raise InvalidExpenseTransitionError(
            details={"from": expense.workflow_status, "action": "withdraw"}
        )

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.DRAFT
    expense.save(update_fields=["workflow_status", "updated_at"])
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.WITHDRAWN,
        from_status=from_status,
        to_status=expense.workflow_status,
    )
    return expense


@transaction.atomic
def approve_expense(*, actor, expense_id: UUID) -> Expense:
    ensure_expense_perm(actor, "approve_expense")
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    owner_id = expense.expense_for_id or expense.submitted_by_id
    if owner_id == actor.pk:
        raise SelfApprovalNotAllowedError(details={"expense_id": str(expense.pk)})

    if expense.workflow_status != Expense.WorkflowStatus.SUBMITTED:
        raise ExpenseNotApprovableError(details={"status": expense.workflow_status})

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.APPROVED
    expense.approved_at = timezone.now()
    expense.approved_by = actor
    expense.rejection_reason = ""
    expense.return_reason = ""
    expense.save(
        update_fields=[
            "workflow_status",
            "approved_at",
            "approved_by",
            "rejection_reason",
            "return_reason",
            "updated_at",
        ]
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.APPROVED,
        from_status=from_status,
        to_status=expense.workflow_status,
    )
    return expense


@transaction.atomic
def reject_expense(*, actor, expense_id: UUID, reason: str) -> Expense:
    ensure_expense_perm(actor, "reject_expense")
    reason = (reason or "").strip()
    if not reason:
        raise InvalidExpenseTransitionError(details={"field": "rejection_reason", "reason": "required"})

    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    owner_id = expense.expense_for_id or expense.submitted_by_id
    if owner_id == actor.pk:
        raise SelfApprovalNotAllowedError(details={"expense_id": str(expense.pk)})

    if expense.workflow_status != Expense.WorkflowStatus.SUBMITTED:
        raise InvalidExpenseTransitionError(
            details={"from": expense.workflow_status, "action": "reject"}
        )

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.REJECTED
    expense.rejected_at = timezone.now()
    expense.rejected_by = actor
    expense.rejection_reason = reason
    expense.save(
        update_fields=[
            "workflow_status",
            "rejected_at",
            "rejected_by",
            "rejection_reason",
            "updated_at",
        ]
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.REJECTED,
        from_status=from_status,
        to_status=expense.workflow_status,
        message=reason,
    )
    return expense


@transaction.atomic
def return_expense(*, actor, expense_id: UUID, reason: str) -> Expense:
    ensure_expense_perm(actor, "return_expense")
    reason = (reason or "").strip()
    if not reason:
        raise InvalidExpenseTransitionError(details={"field": "return_reason", "reason": "required"})

    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    owner_id = expense.expense_for_id or expense.submitted_by_id
    if owner_id == actor.pk:
        raise SelfApprovalNotAllowedError(details={"expense_id": str(expense.pk)})

    if expense.workflow_status != Expense.WorkflowStatus.SUBMITTED:
        raise InvalidExpenseTransitionError(
            details={"from": expense.workflow_status, "action": "return"}
        )

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.RETURNED
    expense.returned_at = timezone.now()
    expense.returned_by = actor
    expense.return_reason = reason
    expense.save(
        update_fields=[
            "workflow_status",
            "returned_at",
            "returned_by",
            "return_reason",
            "updated_at",
        ]
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.RETURNED,
        from_status=from_status,
        to_status=expense.workflow_status,
        message=reason,
    )
    return expense


@transaction.atomic
def mark_expense_paid(
    *,
    actor,
    expense_id: UUID,
    paid_by_card_id,
    payment_reference: str = "",
) -> Expense:
    """
    Mark an approved employee claim as paid and debit the BankCard.
    Approval and payment remain separate; only approved claims can be paid once.
    """
    ensure_expense_perm(actor, "mark_expense_paid")
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    if expense.workflow_status == Expense.WorkflowStatus.PAID and expense.paid_at:
        raise DuplicatePaymentError(details={"expense_id": str(expense.pk)})
    if expense.workflow_status != Expense.WorkflowStatus.APPROVED:
        raise ExpenseNotPayableError(details={"status": expense.workflow_status})
    if not paid_by_card_id:
        raise ExpenseNotPayableError(details={"field": "paid_by", "reason": "required"})

    locked_card = BankCard.objects.select_for_update().get(pk=paid_by_card_id)
    amount = Decimal(expense.amount).quantize(Decimal("0.01"))
    if locked_card.balance - amount < 0:
        raise ExpenseNotPayableError(details={"reason": "insufficient_balance"})

    locked_card.balance = locked_card.balance - amount
    locked_card.save(update_fields=["balance"])

    from_status = expense.workflow_status
    expense.workflow_status = Expense.WorkflowStatus.PAID
    expense.paid_by = locked_card
    expense.paid_at = timezone.now()
    expense.payment_recorded_by = actor
    expense.payment_reference = (payment_reference or "").strip()
    expense.save(
        update_fields=[
            "workflow_status",
            "paid_by",
            "paid_at",
            "payment_recorded_by",
            "payment_reference",
            "updated_at",
        ]
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.PAID,
        from_status=from_status,
        to_status=expense.workflow_status,
        metadata={"payment_reference": expense.payment_reference},
    )
    return expense


def validate_receipt_file(uploaded) -> None:
    name = (getattr(uploaded, "name", "") or "").lower()
    content_type = (getattr(uploaded, "content_type", "") or "").lower()
    size = int(getattr(uploaded, "size", 0) or 0)
    if size <= 0 or size > MAX_RECEIPT_BYTES:
        raise ReceiptRequiredError(details={"reason": "invalid_size", "max_bytes": MAX_RECEIPT_BYTES})
    ext_ok = any(name.endswith(ext) for ext in ALLOWED_RECEIPT_EXTENSIONS)
    type_ok = content_type in ALLOWED_RECEIPT_CONTENT_TYPES or content_type == ""
    if not ext_ok or not type_ok:
        raise ReceiptRequiredError(
            details={
                "reason": "invalid_type",
                "allowed": sorted(ALLOWED_RECEIPT_EXTENSIONS),
            }
        )


@transaction.atomic
def add_receipt(*, actor, expense_id: UUID, uploaded) -> ExpenseAttachment:
    ensure_expense_perm(actor, "change_own_expense", "add_own_expense", "change_expense", any_of=True)
    try:
        expense = Expense.objects.select_for_update().get(pk=expense_id)
    except Expense.DoesNotExist as exc:
        raise ExpenseNotFoundError(details={"id": str(expense_id)}) from exc

    if not visible_expenses_for(actor).filter(pk=expense.pk).exists():
        raise ExpenseOperationNotPermittedError(details={"reason": "not_visible"})
    if expense.workflow_status not in Expense.EDITABLE_STATUSES:
        raise ExpenseNotEditableError(details={"status": expense.workflow_status})

    if expense.attachments.count() >= MAX_RECEIPTS_PER_EXPENSE:
        raise ReceiptRequiredError(details={"reason": "max_attachments", "max": MAX_RECEIPTS_PER_EXPENSE})

    validate_receipt_file(uploaded)
    attachment = ExpenseAttachment.objects.create(
        expense=expense,
        file=uploaded,
        original_name=getattr(uploaded, "name", "") or "",
        content_type=getattr(uploaded, "content_type", "") or "",
        size_bytes=int(getattr(uploaded, "size", 0) or 0),
        uploaded_by=actor,
    )
    record_audit(
        expense=expense,
        actor=actor,
        action=ExpenseAuditEvent.Action.ATTACHMENT_ADDED,
        metadata={"attachment_id": str(attachment.pk)},
    )
    return attachment
