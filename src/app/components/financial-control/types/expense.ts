export type { ExpenseApi } from '@/app/lib/operationalFinanceApi';

export const EXPENSE_CATEGORIES = ['salaries', 'office', 'government-fees', 'misc'] as const;

export const EXPENSE_SOURCE_TYPES = ['all', 'manual', 'payroll', 'check', 'debt'] as const;
