/**
 * Reports & Analytics — expense reporting-period attribution.
 *
 * Business rule (P&L month):
 * - Payroll (salary / commission) with payroll_period → attribute by payroll_period
 * - All other expenses → attribute by Expense.date (cash/posting date)
 *
 * Cash / Financial Control continues to use Expense.date unchanged.
 * Each Expense row must contribute to exactly one reporting month (or once under "all").
 *
 * Future Export Report must call these same helpers — do not duplicate the rule.
 */

import type { Expense } from '@/app/contexts/DataContext';

export type PayrollExpenseType = 'salary' | 'commission';

/**
 * Extract YYYY-MM from a date-only (or ISO datetime) string without UTC month shift.
 * Prefers a leading YYYY-MM substring so "2026-08-01" never becomes July in local TZ.
 */
export function monthKeyFromDateOnly(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

/** Authoritative payroll detection — payroll_type, not category label. */
export function isPayrollExpense(
  expense: Pick<Expense, 'payrollType'>
): expense is Expense & { payrollType: PayrollExpenseType } {
  return expense.payrollType === 'salary' || expense.payrollType === 'commission';
}

/**
 * True when this expense should be omitted from Reports P&L.
 * Reversed salary restores BankCard and is excluded from settlement / bank statement;
 * it must not reduce profit.
 */
export function isExpenseExcludedFromReports(
  expense: Pick<Expense, 'payrollStatus'>
): boolean {
  return expense.payrollStatus === 'reversed';
}

/**
 * Date used to place an expense into a Reports & Analytics month.
 * Returns a date-only string (YYYY-MM-DD or original date) for month-key extraction.
 */
export function getExpenseReportingDate(
  expense: Pick<Expense, 'date' | 'payrollType' | 'payrollPeriod'>
): string {
  if (isPayrollExpense(expense) && expense.payrollPeriod) {
    return String(expense.payrollPeriod).trim();
  }
  return String(expense.date || '').trim();
}

/** YYYY-MM for the expense's P&L month, or null if unparseable. */
export function getExpenseReportingMonthKey(
  expense: Pick<Expense, 'date' | 'payrollType' | 'payrollPeriod'>
): string | null {
  return monthKeyFromDateOnly(getExpenseReportingDate(expense));
}

/**
 * Whether the expense belongs in the selected Reports month filter.
 * monthFilter "all" → include (once); otherwise compare reporting month keys.
 */
export function matchesExpenseReportingMonth(
  expense: Pick<Expense, 'date' | 'payrollType' | 'payrollPeriod' | 'payrollStatus'>,
  monthFilter: string
): boolean {
  if (isExpenseExcludedFromReports(expense)) return false;
  if (monthFilter === 'all') return true;
  const key = getExpenseReportingMonthKey(expense);
  return !!key && key === monthFilter;
}

/** Sum amounts in fils then convert back — avoids float display artifacts. */
export function sumMoneyAmounts(amounts: Iterable<number>): number {
  let fils = 0;
  for (const raw of amounts) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    fils += Math.round(n * 100);
  }
  return fils / 100;
}

export function formatReportAed(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `AED ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
