import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isWithinInterval,
} from 'date-fns';
import type { Employee, Expense, Payment, Procedure } from '@/app/contexts/DataContext';

export const OPEN_PROCEDURE_STATUSES: Procedure['status'][] = ['submitted', 'in-process', 'need-info'];
export const CLOSED_PROCEDURE_STATUS: Procedure['status'] = 'done';

export type PerformanceLevel = 'High' | 'Medium' | 'Low';
export type PayrollType = 'salary' | 'commission';
export type PeriodGroup = 'day' | 'month' | 'year';

export interface ProcedureStats {
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  closureRatio: number;
  revenue: number;
  paymentsCollected: number;
  netProfit: number;
}

export interface PeriodBucket {
  key: string;
  label: string;
  stats: ProcedureStats;
}

export interface EmployeeMetrics {
  employeeId: string;
  userId: string;
  totalProcedures: number;
  openProcedures: number;
  inProgressProcedures?: number;
  closedProcedures: number;
  closureRatio: number;
  paymentsCollected: number;
  netProfit: number;
  commissionAmount: number;
  performanceScore: number;
  performanceLevel: PerformanceLevel;
  rank: number;
}

const AVATAR_COLORS = [
  'bg-indigo-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-pink-500',
];

export function employeeInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function employeeAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export function procedureNetProfit(procedure: Procedure): number {
  return Math.max(procedure.sellingPrice - procedure.cost, 0);
}

export function isOpenProcedure(status: Procedure['status']): boolean {
  return OPEN_PROCEDURE_STATUSES.includes(status);
}

export function isClosedProcedure(status: Procedure['status']): boolean {
  return status === CLOSED_PROCEDURE_STATUS;
}

export function matchesEmployeeProcedure(procedure: Procedure, employee: Employee): boolean {
  if (employee.userId && procedure.assignedEmployeeId) {
    return procedure.assignedEmployeeId === employee.userId;
  }
  return (
    procedure.assignedEmployee === employee.username ||
    procedure.assignedEmployee === employee.name
  );
}

export function employeeProcedureIds(
  procedures: Procedure[],
  employee: Employee
): Set<string> {
  return new Set(
    procedures.filter((p) => matchesEmployeeProcedure(p, employee)).map((p) => p.id)
  );
}

export function matchesEmployeePayment(
  payment: Payment,
  employee: Employee,
  procedureIds?: Set<string>
): boolean {
  if (employee.userId && payment.recordedById && payment.recordedById === employee.userId) {
    return true;
  }
  if (payment.recordedBy === employee.username || payment.recordedBy === employee.name) {
    return true;
  }
  if (payment.procedureId && procedureIds?.has(payment.procedureId)) {
    return true;
  }
  return false;
}

export function filterEmployeeProcedures(
  procedures: Procedure[],
  employee: Employee,
  range?: { start: Date; end: Date }
): Procedure[] {
  return procedures.filter((procedure) => {
    if (!matchesEmployeeProcedure(procedure, employee)) return false;
    if (!range) return true;
    const date = parseISO(procedure.date);
    return isWithinInterval(date, range);
  });
}

export function filterEmployeePayments(
  payments: Payment[],
  employee: Employee,
  range?: { start: Date; end: Date },
  procedures?: Procedure[]
): Payment[] {
  const procedureIds = procedures ? employeeProcedureIds(procedures, employee) : undefined;
  return payments.filter((payment) => {
    if (!matchesEmployeePayment(payment, employee, procedureIds)) return false;
    if (!range) return true;
    const date = parseISO(payment.date);
    return isWithinInterval(date, range);
  });
}

export function computeProcedureStats(procedures: Procedure[]): ProcedureStats {
  const open = procedures.filter((p) => isOpenProcedure(p.status)).length;
  const inProgress = procedures.filter((p) => p.status === 'in-process').length;
  const closed = procedures.filter((p) => isClosedProcedure(p.status)).length;
  const total = procedures.length;
  const revenue = procedures.reduce((sum, p) => sum + p.sellingPrice, 0);
  const paymentsCollected = procedures.reduce((sum, p) => sum + p.paid, 0);
  const netProfit = procedures
    .filter((p) => isClosedProcedure(p.status))
    .reduce((sum, p) => sum + procedureNetProfit(p), 0);

  return {
    total,
    open,
    inProgress,
    closed,
    closureRatio: total > 0 ? closed / total : 0,
    revenue,
    paymentsCollected,
    netProfit,
  };
}

export function computeCommissionAmount(procedures: Procedure[], commissionRate: number): number {
  const netProfit = procedures
    .filter((p) => isClosedProcedure(p.status))
    .reduce((sum, p) => sum + procedureNetProfit(p), 0);
  return Math.round(netProfit * (commissionRate / 100) * 100) / 100;
}

export function performanceLevelFromScore(score: number): PerformanceLevel {
  if (score >= 75) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

/** MVP score: normalized procedure count, payments, profit, closure ratio (0–100). */
export function computePerformanceScore(
  stats: ProcedureStats,
  paymentsCollected: number,
  teamMax: { procedures: number; payments: number; profit: number }
): number {
  const procNorm = teamMax.procedures > 0 ? stats.total / teamMax.procedures : 0;
  const payNorm = teamMax.payments > 0 ? paymentsCollected / teamMax.payments : 0;
  const profitNorm = teamMax.profit > 0 ? stats.netProfit / teamMax.profit : 0;
  const raw = procNorm * 0.25 + payNorm * 0.25 + profitNorm * 0.25 + stats.closureRatio * 0.25;
  return Math.round(Math.min(100, Math.max(0, raw * 100)));
}

export function buildEmployeeMetrics(
  employees: Employee[],
  procedures: Procedure[],
  payments: Payment[],
  range?: { start: Date; end: Date }
): EmployeeMetrics[] {
  const perEmployee = employees.map((employee) => {
    const empProcedures = filterEmployeeProcedures(procedures, employee, range);
    const empPayments = filterEmployeePayments(payments, employee, range, procedures);
    const stats = computeProcedureStats(empProcedures);
    const paymentsCollected = empPayments.reduce((sum, p) => sum + p.amount, 0);
    const commissionAmount = computeCommissionAmount(empProcedures, employee.commissionRate);

    return {
      employeeId: employee.id,
      userId: employee.userId,
      totalProcedures: stats.total,
      openProcedures: stats.open,
      closedProcedures: stats.closed,
      closureRatio: stats.closureRatio,
      paymentsCollected,
      netProfit: stats.netProfit,
      commissionAmount,
      performanceScore: 0,
      performanceLevel: 'Low' as PerformanceLevel,
      rank: 0,
    };
  });

  const teamMax = {
    procedures: Math.max(1, ...perEmployee.map((m) => m.totalProcedures)),
    payments: Math.max(1, ...perEmployee.map((m) => m.paymentsCollected)),
    profit: Math.max(1, ...perEmployee.map((m) => m.netProfit)),
  };

  const scored = perEmployee.map((m) => {
    const employee = employees.find((e) => e.id === m.employeeId)!;
    const empProcedures = filterEmployeeProcedures(procedures, employee, range);
    const stats = computeProcedureStats(empProcedures);
    const score = computePerformanceScore(stats, m.paymentsCollected, teamMax);
    return {
      ...m,
      performanceScore: score,
      performanceLevel: performanceLevelFromScore(score),
    };
  });

  const sorted = [...scored].sort((a, b) => b.performanceScore - a.performanceScore);
  return sorted.map((m, index) => ({ ...m, rank: index + 1 }));
}

export function getMetricsForEmployee(
  employee: Employee,
  allMetrics: EmployeeMetrics[]
): EmployeeMetrics | undefined {
  return allMetrics.find((m) => m.employeeId === employee.id);
}

export function payrollPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function payrollPeriodDate(year: number, month: number): string {
  return `${payrollPeriodKey(year, month)}-01`;
}

export function payrollNoteMarker(type: PayrollType, periodKey: string): string {
  return `[payroll:${type}:${periodKey}]`;
}

export function parsePayrollFromExpense(expense: Expense): {
  type: PayrollType;
  period: string;
} | null {
  const fromNotes = expense.notes?.match(/\[payroll:(salary|commission):(\d{4}-\d{2})\]/);
  if (fromNotes) {
    return { type: fromNotes[1] as PayrollType, period: fromNotes[2] };
  }
  if (expense.payrollType && expense.payrollPeriod) {
    return { type: expense.payrollType, period: expense.payrollPeriod.slice(0, 7) };
  }
  return null;
}

export function hasPayrollForPeriod(
  expenses: Expense[],
  employee: Employee,
  type: PayrollType,
  periodKey: string
): boolean {
  return expenses.some((expense) => {
    const parsed = parsePayrollFromExpense(expense);
    if (!parsed || parsed.type !== type || parsed.period !== periodKey) return false;
    const matchesUser =
      expense.assignedEmployeeId === employee.userId ||
      expense.assignedEmployee === employee.username ||
      expense.assignedEmployee === employee.name;
    return matchesUser;
  });
}

export function groupProceduresByPeriod(
  procedures: Procedure[],
  groupBy: PeriodGroup
): PeriodBucket[] {
  const buckets = new Map<string, Procedure[]>();

  procedures.forEach((procedure) => {
    const date = parseISO(procedure.date);
    let key: string;
    let label: string;
    if (groupBy === 'day') {
      key = format(date, 'yyyy-MM-dd');
      label = format(date, 'dd MMM yyyy');
    } else if (groupBy === 'month') {
      key = format(date, 'yyyy-MM');
      label = format(date, 'MMM yyyy');
    } else {
      key = format(date, 'yyyy');
      label = format(date, 'yyyy');
    }
    const list = buckets.get(key) || [];
    list.push(procedure);
    buckets.set(key, list);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      key,
      label: list.length ? (groupBy === 'day' ? format(parseISO(list[0].date), 'dd MMM yyyy') : key) : key,
      stats: computeProcedureStats(list),
    }));
}

export function monthlyChartData(procedures: Procedure[], payments: Payment[], employee: Employee) {
  const months: { month: string; procedures: number; payments: number; profit: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const range = { start: startOfMonth(d), end: endOfMonth(d) };
    const empProcedures = filterEmployeeProcedures(procedures, employee, range);
    const empPayments = filterEmployeePayments(payments, employee, range, procedures);
    const stats = computeProcedureStats(empProcedures);
    months.push({
      month: format(d, 'MMM'),
      procedures: stats.total,
      payments: empPayments.reduce((sum, p) => sum + p.amount, 0),
      profit: stats.netProfit,
    });
  }
  return months;
}

export function periodRangeForFilter(
  year: number,
  month: number | null
): { start: Date; end: Date } {
  if (month != null) {
    const start = startOfMonth(new Date(year, month - 1, 1));
    return { start, end: endOfMonth(start) };
  }
  const start = startOfYear(new Date(year, 0, 1));
  return { start, end: endOfYear(start) };
}

export function roleLabelFromApi(role: string): string {
  if (role === 'admin') return 'Administrator';
  if (role === 'manager') return 'Manager';
  if (role === 'cashier') return 'Cashier';
  if (role === 'marketer') return 'Marketer';
  return 'Employee';
}

export function roleValueFromLabel(role: string): string {
  if (role === 'Administrator') return 'admin';
  if (role === 'Manager') return 'manager';
  if (role === 'Cashier') return 'cashier';
  if (role === 'Marketer') return 'marketer';
  return 'employee';
}
