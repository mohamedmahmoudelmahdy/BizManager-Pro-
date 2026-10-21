/**
 * Expense permission codes and UX helpers.
 * Backend remains authoritative; these gate navigation and actions only.
 */

export const EXPENSE_PERMISSIONS = {
  viewOwn: 'expenses.view_own_expense',
  addOwn: 'expenses.add_own_expense',
  changeOwn: 'expenses.change_own_expense',
  submit: 'expenses.submit_expense',
  withdraw: 'expenses.withdraw_expense',
  view: 'expenses.view_expense',
  review: 'expenses.review_expense',
  approve: 'expenses.approve_expense',
  reject: 'expenses.reject_expense',
  return: 'expenses.return_expense',
  markPaid: 'expenses.mark_expense_paid',
  add: 'expenses.add_expense',
  change: 'expenses.change_expense',
} as const;

/** Any of these grants entry to the employee expenses hub. */
export const EXPENSE_MODULE_ENTRY_PERMISSIONS = [
  EXPENSE_PERMISSIONS.viewOwn,
  EXPENSE_PERMISSIONS.view,
  EXPENSE_PERMISSIONS.addOwn,
  EXPENSE_PERMISSIONS.review,
  EXPENSE_PERMISSIONS.approve,
  EXPENSE_PERMISSIONS.reject,
  EXPENSE_PERMISSIONS.return,
  EXPENSE_PERMISSIONS.markPaid,
] as const;

/** Permissions that unlock the Review tab / queue. */
export const EXPENSE_REVIEW_PERMISSIONS = [
  EXPENSE_PERMISSIONS.view,
  EXPENSE_PERMISSIONS.review,
  EXPENSE_PERMISSIONS.approve,
  EXPENSE_PERMISSIONS.reject,
  EXPENSE_PERMISSIONS.return,
  EXPENSE_PERMISSIONS.markPaid,
] as const;
