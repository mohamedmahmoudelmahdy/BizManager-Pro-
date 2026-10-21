import { getJson, postJson } from '@/app/lib/api';

export type ExpenseApi = {
  id: string;
  category: string;
  date: string;
  amount: number | string;
  paid_by: string;
  paid_by_name: string;
  assigned_employee: string | null;
  employee_name: string;
  payroll_type: string;
  payroll_period: string | null;
  linked_source_type: 'manual' | 'payroll' | 'check' | 'debt' | string;
  linked_source_label: string;
  payroll_status?: 'active' | 'reversed';
  notes: string;
  created_at: string;
  updated_at: string;
};

export type DepositApi = {
  id: string;
  date: string;
  amount: number | string;
  from_method: string;
  from_method_name: string;
  to_method: string;
  to_method_name: string;
  notes: string;
  created_at: string;
};

function toList<T>(data: T[] | { results: T[] }): T[] {
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function fetchExpenses(): Promise<ExpenseApi[]> {
  return toList(await getJson<ExpenseApi[] | { results: ExpenseApi[] }>('/expenses/'));
}

export async function createExpense(payload: Record<string, unknown>): Promise<ExpenseApi> {
  return postJson<ExpenseApi>('/expenses/', payload);
}

export async function fetchDeposits(): Promise<DepositApi[]> {
  return toList(await getJson<DepositApi[] | { results: DepositApi[] }>('/deposits/'));
}

export async function createDeposit(payload: Record<string, unknown>): Promise<DepositApi> {
  return postJson<DepositApi>('/deposits/', payload);
}
