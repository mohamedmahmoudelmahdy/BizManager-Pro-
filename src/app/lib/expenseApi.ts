/**
 * Expense Management API client — thin wrappers over shared fetch helpers.
 * Base path: /api/expenses/
 * Mutations: POST create/workflow, PATCH update. No PUT/DELETE.
 */

import { getBlob, getJson, patchJson, postForm, postJson } from '@/app/lib/api';
import type {
  CreateEmployeeExpenseInput,
  ExpenseDetail,
  ExpenseListParams,
  ExpenseSummary,
  MarkExpensePaidInput,
  PaginatedExpenses,
  UpdateEmployeeExpenseInput,
} from '@/app/lib/expenseTypes';

export const EXPENSE_API_BASE = '/expenses';

function expensePath(path = ''): string {
  if (!path) return `${EXPENSE_API_BASE}/`;
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  return `${EXPENSE_API_BASE}${cleaned}`;
}

/** Build query string; omits undefined / null / empty values. */
export function buildExpenseQuery(params?: ExpenseListParams | Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (value === '') continue;
    if (typeof value === 'boolean') {
      if (value) sp.set(key, '1');
      continue;
    }
    if (key === 'mine' && (value === 1 || value === '1')) {
      sp.set(key, '1');
      continue;
    }
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

function normalizeListResponse(
  data: PaginatedExpenses | ExpenseSummary[]
): PaginatedExpenses {
  if (Array.isArray(data)) {
    return { count: data.length, next: null, previous: null, results: data };
  }
  return {
    count: data.count ?? data.results?.length ?? 0,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: data.results ?? [],
  };
}

export const expensesApi = {
  list: async (
    params?: ExpenseListParams,
    init?: RequestInit
  ): Promise<PaginatedExpenses> => {
    const data = await getJson<PaginatedExpenses | ExpenseSummary[]>(
      expensePath(`/${buildExpenseQuery(params)}`),
      init
    );
    return normalizeListResponse(data);
  },

  get: (id: string, init?: RequestInit) =>
    getJson<ExpenseDetail>(expensePath(`/${id}/`), init),

  create: (body: CreateEmployeeExpenseInput) =>
    postJson<ExpenseDetail>(expensePath('/'), body),

  update: (id: string, body: UpdateEmployeeExpenseInput) =>
    patchJson<ExpenseDetail>(expensePath(`/${id}/`), body),

  submit: (id: string) => postJson<ExpenseDetail>(expensePath(`/${id}/submit/`), {}),

  withdraw: (id: string) => postJson<ExpenseDetail>(expensePath(`/${id}/withdraw/`), {}),

  approve: (id: string) => postJson<ExpenseDetail>(expensePath(`/${id}/approve/`), {}),

  reject: (id: string, body: { reason: string }) =>
    postJson<ExpenseDetail>(expensePath(`/${id}/reject/`), body),

  returnForCorrection: (id: string, body: { reason: string }) =>
    postJson<ExpenseDetail>(expensePath(`/${id}/return/`), body),

  markPaid: (id: string, body: MarkExpensePaidInput) =>
    postJson<ExpenseDetail>(expensePath(`/${id}/mark-paid/`), body),

  uploadReceipt: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return postForm<ExpenseDetail>(expensePath(`/${id}/receipts/`), form);
  },

  downloadReceiptBlob: (expenseId: string, attachmentId: string) =>
    getBlob(expensePath(`/${expenseId}/receipts/${attachmentId}/download/`)),
};
