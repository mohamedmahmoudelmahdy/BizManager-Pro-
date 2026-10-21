/**
 * Expense stable error-code → i18n key mapping.
 * Backend `error.code` is the contract; UI never shows raw codes as primary copy.
 */

import type { TFunction } from 'i18next';
import { ApiError, formatApiErrorMessage } from '@/app/lib/api';
import type { ExpenseApiErrorBody } from '@/app/lib/expenseTypes';

export const EXPENSE_ERROR_CODES = [
  'expense_not_found',
  'expense_not_editable',
  'expense_not_submittable',
  'expense_already_submitted',
  'expense_not_approvable',
  'expense_not_payable',
  'self_approval_not_allowed',
  'receipt_required',
  'invalid_expense_amount',
  'invalid_expense_date',
  'invalid_expense_transition',
  'duplicate_payment',
  'permission_denied',
  'operation_not_permitted',
] as const;

export type ExpenseErrorCode = (typeof EXPENSE_ERROR_CODES)[number] | string;

export function extractExpenseErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as ExpenseApiErrorBody | Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return null;
  const nested = (body as ExpenseApiErrorBody).error;
  if (nested && typeof nested === 'object' && typeof nested.code === 'string') {
    return nested.code;
  }
  return null;
}

export function extractExpenseErrorDetails(err: unknown): Record<string, unknown> {
  if (!(err instanceof ApiError)) return {};
  const body = err.body as ExpenseApiErrorBody | null;
  if (body?.error?.details && typeof body.error.details === 'object') {
    return body.error.details;
  }
  return {};
}

/**
 * Resolve a user-facing message for an Expense API error.
 * Prefers `expenses.errors.<code>` when present; otherwise falls back.
 */
export function formatExpenseErrorMessage(
  err: unknown,
  t: TFunction,
  fallbackKey = 'expenses.errors.generic'
): string {
  const code = extractExpenseErrorCode(err);
  if (code) {
    const key = `expenses.errors.${code}`;
    const translated = t(key);
    if (translated !== key) {
      return translated;
    }
  }
  const generic = t(fallbackKey);
  if (generic !== fallbackKey) {
    return generic;
  }
  return formatApiErrorMessage(err, t('expenses.errors.generic'));
}
