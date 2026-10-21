/**
 * Expense Management (employee claims) API types.
 * Actor fields (submitted_by, approved_by, paid_by user, status) are backend-owned.
 */

export type ExpenseUserSummary = {
  id: number | string;
  username: string;
  first_name?: string;
  last_name?: string;
};

export type ExpenseCategory = 'salaries' | 'office' | 'government-fees' | 'misc' | string;

export type ExpenseWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'returned'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'cancelled'
  | string;

export type ExpenseAttachment = {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export type ExpenseAuditEvent = {
  id: string;
  action: string;
  actor: ExpenseUserSummary | null;
  from_status: string;
  to_status: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ExpenseSummary = {
  id: string;
  expense_number: string | null;
  category: ExpenseCategory;
  date: string;
  amount: string | number;
  paid_by: string | null;
  paid_by_name?: string | null;
  assigned_employee?: number | string | null;
  employee_name?: string | null;
  expense_for?: number | string | null;
  expense_for_user: ExpenseUserSummary | null;
  submitted_by: ExpenseUserSummary | null;
  merchant: string;
  business_purpose: string;
  workflow_status: ExpenseWorkflowStatus;
  submitted_at?: string | null;
  approved_at?: string | null;
  approved_by_user: ExpenseUserSummary | null;
  rejected_at?: string | null;
  rejection_reason: string;
  returned_at?: string | null;
  return_reason: string;
  paid_at?: string | null;
  payment_recorded_by_user?: ExpenseUserSummary | null;
  payment_reference: string;
  notes: string;
  attachments: ExpenseAttachment[];
  created_at: string;
  updated_at: string;
};

export type ExpenseDetail = ExpenseSummary & {
  audit_events: ExpenseAuditEvent[];
};

/** Create employee claim — never include actor/status/paid_by (user). */
export type CreateEmployeeExpenseInput = {
  category: ExpenseCategory;
  date: string;
  amount: string | number;
  merchant?: string;
  business_purpose?: string;
  notes?: string;
  /** When true, backend submits immediately after create. */
  submit?: boolean;
};

/** Patch draft/returned claim fields only. */
export type UpdateEmployeeExpenseInput = {
  category?: ExpenseCategory;
  date?: string;
  amount?: string | number;
  merchant?: string;
  business_purpose?: string;
  notes?: string;
};

export type MarkExpensePaidInput = {
  /** Bank card UUID — payment method, not a user id. */
  paid_by: string;
  payment_reference?: string;
};

export type ExpenseReasonInput = {
  reason: string;
};

export type ExpenseListParams = {
  mine?: boolean | 1 | '1';
  status?: ExpenseWorkflowStatus;
  workflow_status?: ExpenseWorkflowStatus;
  category?: ExpenseCategory;
  date_from?: string;
  date_to?: string;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
};

export type PaginatedExpenses = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ExpenseSummary[];
};

export type ExpenseApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export const EXPENSE_CATEGORIES = [
  'office',
  'government-fees',
  'salaries',
  'misc',
] as const;

export const EXPENSE_WORKFLOW_STATUSES = [
  'draft',
  'submitted',
  'returned',
  'approved',
  'rejected',
  'paid',
  'cancelled',
] as const;

export const EXPENSE_EDITABLE_STATUSES = new Set(['draft', 'returned']);
