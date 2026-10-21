/** Shared display helpers for expense claims UI. */

import type { ExpenseUserSummary, ExpenseWorkflowStatus } from '@/app/lib/expenseTypes';

export function formatExpenseUserLabel(
  user: ExpenseUserSummary | null | undefined
): string {
  if (!user) return '—';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || '—';
}

export function formatExpenseAmount(
  amount: string | number | null | undefined,
  currency = 'AED'
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${currency} ${n.toLocaleString('en-AE', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function formatExpenseIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatExpenseDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function expenseStatusTone(
  status: ExpenseWorkflowStatus
): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'submitted':
      return 'info';
    case 'returned':
      return 'warning';
    case 'approved':
      return 'success';
    case 'paid':
      return 'success';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const expenseInputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 focus:bg-white disabled:opacity-60';

export const expenseLabelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';
