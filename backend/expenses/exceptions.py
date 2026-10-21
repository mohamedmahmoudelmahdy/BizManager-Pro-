"""Structured Expense CRM business exceptions and DRF mapping."""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.exceptions import APIException


class ExpenseBusinessError(Exception):
    code: str = "expense_error"
    http_status: int = status.HTTP_400_BAD_REQUEST

    def __init__(self, *, details: dict[str, Any] | None = None, message: str | None = None):
        self.details = details or {}
        self.message = message or self.code
        super().__init__(self.message)


class ExpenseNotFoundError(ExpenseBusinessError):
    code = "expense_not_found"
    http_status = status.HTTP_404_NOT_FOUND


class ExpenseNotEditableError(ExpenseBusinessError):
    code = "expense_not_editable"


class ExpenseNotSubmittableError(ExpenseBusinessError):
    code = "expense_not_submittable"


class ExpenseAlreadySubmittedError(ExpenseBusinessError):
    code = "expense_already_submitted"
    http_status = status.HTTP_409_CONFLICT


class ExpenseNotApprovableError(ExpenseBusinessError):
    code = "expense_not_approvable"


class ExpenseNotPayableError(ExpenseBusinessError):
    code = "expense_not_payable"


class SelfApprovalNotAllowedError(ExpenseBusinessError):
    code = "self_approval_not_allowed"
    http_status = status.HTTP_403_FORBIDDEN


class ReceiptRequiredError(ExpenseBusinessError):
    code = "receipt_required"


class InvalidExpenseAmountError(ExpenseBusinessError):
    code = "invalid_expense_amount"


class InvalidExpenseDateError(ExpenseBusinessError):
    code = "invalid_expense_date"


class InvalidExpenseTransitionError(ExpenseBusinessError):
    code = "invalid_expense_transition"


class DuplicatePaymentError(ExpenseBusinessError):
    code = "duplicate_payment"
    http_status = status.HTTP_409_CONFLICT


class ExpensePermissionDeniedError(ExpenseBusinessError):
    code = "permission_denied"
    http_status = status.HTTP_403_FORBIDDEN


class ExpenseOperationNotPermittedError(ExpenseBusinessError):
    code = "operation_not_permitted"
    http_status = status.HTTP_403_FORBIDDEN


class ExpenseAPIException(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "expense_error"
    default_code = "expense_error"

    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ):
        self.status_code = status_code or self.status_code
        self.detail = {
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            }
        }


def raise_expense_error(exc: ExpenseBusinessError) -> None:
    raise ExpenseAPIException(
        code=exc.code,
        message=exc.message,
        details=exc.details,
        status_code=exc.http_status,
    )
