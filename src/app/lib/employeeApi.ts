import { getJson, postJson } from '@/app/lib/api';
import type { Payment, Procedure } from '@/app/contexts/DataContext';
import type { EmployeeMetrics, PeriodBucket, PerformanceLevel } from '@/app/lib/employeePerformance';

export type EmployeeDashboardResponse = {
  metrics: {
    period: string | null;
    total_procedures: number;
    open_procedures: number;
    in_progress_procedures: number;
    closed_procedures: number;
    rejected_procedures: number;
    closure_ratio: number;
    revenue: number;
    collected_on_procedures: number;
    payments_collected: number;
    net_profit: number;
    commission_rate: number;
    commission_amount: number;
    salary: number;
    salary_paid: boolean;
    salary_status?: 'pending' | 'partial' | 'paid';
    salary_remaining_due?: number;
    salary_paid_total?: number;
    commission_paid: boolean;
    outstanding_advances: number;
  };
  rank: number | null;
  performance_score: number;
  performance_level: PerformanceLevel;
  procedures: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  period_groups: Array<{
    key: string;
    total_procedures: number;
    open_procedures: number;
    closed_procedures: number;
    closure_ratio: number;
    revenue: number;
    payments_collected: number;
    net_profit: number;
  }>;
};

export type TeamPerformanceRow = {
  employee_id: string;
  user_id: number;
  full_name: string;
  role: string;
  rank: number;
  rank_total?: number;
  performance_score: number;
  performance_level: PerformanceLevel;
  maximum_score?: number;
  salary: number;
  commission_rate: number;
  commission_amount: number;
  salary_paid: boolean;
  salary_status: 'pending' | 'partial' | 'paid';
  salary_remaining_due: number;
  salary_paid_total: number;
  commission_paid: boolean;
  net_profit: number;
  total_procedures: number;
  open_procedures?: number;
  closed_procedures: number;
  payments_collected: number;
  outstanding_advances: number;
  period: string | null;
};

export type EmployeeAdvanceApi = {
  id: string;
  employee: number;
  employee_name: string;
  amount: string;
  outstanding_balance: string;
  date: string;
  reason: string;
  status: 'active' | 'settled' | 'cancelled' | 'reversed';
  source_account: string | null;
  source_account_name: string;
  linked_expense: string | null;
  linked_ledger_account: string | null;
  linked_ledger_entry: string | null;
  created_by_name: string;
  created_at: string;
  reversed_at: string | null;
  reversal_reason: string;
  deductions: Array<{
    id: string;
    advance: string;
    amount: string;
    date: string;
    period: string;
    linked_salary_expense: string | null;
    linked_ledger_entry: string | null;
    created_at: string;
    notes: string;
    status: 'active' | 'reversed';
    reversed_at: string | null;
    reversal_reason: string;
  }>;
  repayments: Array<{
    id: string;
    advance: string;
    amount: string;
    date: string;
    payment_method: string | null;
    payment_method_name: string;
    created_at: string;
    notes: string;
    status: 'active' | 'reversed';
  }>;
};

export type EmployeeAdvanceSummary = {
  employee: string;
  outstanding_total: string;
  active_count: number;
  advances: EmployeeAdvanceApi[];
};

export type GiveAdvancePayload = {
  employee: number;
  amount: number;
  paid_by: string;
  date?: string;
  reason?: string;
};

export async function fetchEmployeeAdvanceSummary(employeeUserId: number): Promise<EmployeeAdvanceSummary> {
  const params = new URLSearchParams({ employee: String(employeeUserId) });
  return getJson<EmployeeAdvanceSummary>(`/employee-advances/summary/?${params.toString()}`);
}

export async function giveEmployeeAdvance(payload: GiveAdvancePayload): Promise<EmployeeAdvanceApi> {
  return postJson<EmployeeAdvanceApi>(`/employee-advances/`, payload);
}

export async function reverseEmployeeAdvance(advanceId: string, reason: string): Promise<EmployeeAdvanceApi> {
  return postJson<EmployeeAdvanceApi>(`/employee-advances/${advanceId}/reverse/`, { reason });
}

export async function reverseAdvanceDeduction(
  deductionId: string,
  reason: string
): Promise<{
  deduction: EmployeeAdvanceApi['deductions'][number];
  advance: EmployeeAdvanceApi;
  reversal_ledger_entry: unknown;
  salary_settlement: { salary_status: string; salary_remaining_due: number } | null;
}> {
  return postJson(`/employee-advances/deductions/${deductionId}/reverse/`, { reason });
}

export async function reverseSalaryPayment(
  employeeProfileId: string,
  expenseId: string,
  reason: string
): Promise<Record<string, unknown>> {
  return postJson(`/employees/${employeeProfileId}/salary-payments/${expenseId}/reverse/`, { reason });
}

export type RecordAdvanceRepaymentPayload = {
  employee: number;
  amount: number;
  payment_method: string;
  date?: string;
  notes?: string;
  advance?: string;
};

export async function recordAdvanceRepayment(payload: RecordAdvanceRepaymentPayload) {
  return postJson('/employee-advances/repayments/', payload);
}

export type PayrollSubmitPayload = {
  period: string;
  paid_by: string;
  date: string;
  notes?: string;
  force?: boolean;
  payment_mode?: 'full' | 'partial';
  manual_deduction_amount?: number;
  manual_deduction_reason?: string;
  paid_amount?: number;
};

export async function fetchTeamPerformance(period: string): Promise<TeamPerformanceRow[]> {
  const params = new URLSearchParams({ period });
  return getJson<TeamPerformanceRow[]>(`/employees/performance/?${params.toString()}`);
}

export type PerformancePeriodMode = 'month' | 'year' | 'all_time';

export type TeamPerformancePeriodMeta = {
  mode: PerformancePeriodMode | string;
  year: number | null;
  month: number | null;
  date_from: string | null;
  date_to: string;
  label: string;
  period_key: string | null;
};

export type TeamPerformanceSummary = {
  total_employees: number;
  open_procedures: number;
  closed_procedures: number;
  total_collected: number;
  salaries_due: number;
  commissions_due: number;
  rank_total: number;
};

export type TeamPerformanceReport = {
  period: TeamPerformancePeriodMeta;
  summary: TeamPerformanceSummary;
  employees: TeamPerformanceRow[];
};

export type FetchTeamPerformanceReportParams = {
  period_mode: PerformancePeriodMode;
  year?: number;
  month?: number;
  role?: string;
  performance?: string;
};

/** Authoritative Employee Log report — score/rank/KPIs share one backend period. */
export async function fetchTeamPerformanceReport(
  params: FetchTeamPerformanceReportParams
): Promise<TeamPerformanceReport> {
  const qs = new URLSearchParams({ period_mode: params.period_mode });
  if (params.period_mode !== 'all_time' && params.year != null) {
    qs.set('year', String(params.year));
  }
  if (params.period_mode === 'month' && params.month != null) {
    qs.set('month', String(params.month));
  }
  if (params.role && params.role !== 'All') qs.set('role', params.role);
  if (params.performance && params.performance !== 'All') {
    qs.set('performance', params.performance);
  }
  return getJson<TeamPerformanceReport>(`/employees/performance/?${qs.toString()}`);
}

export async function payEmployeeSalary(profileId: string, payload: PayrollSubmitPayload) {
  return postJson<Record<string, unknown>>(`/employees/${profileId}/pay-salary/`, payload);
}

export async function payEmployeeCommission(profileId: string, payload: PayrollSubmitPayload) {
  return postJson<Record<string, unknown>>(`/employees/${profileId}/pay-commission/`, payload);
}

export async function fetchEmployeeDashboard(
  employeeProfileId: string,
  period: string,
  groupBy: 'day' | 'month' | 'year' = 'month'
): Promise<EmployeeDashboardResponse> {
  const params = new URLSearchParams({ period, group_by: groupBy });
  return getJson<EmployeeDashboardResponse>(
    `/employees/${employeeProfileId}/dashboard/?${params.toString()}`
  );
}

/** Authoritative My Score for the logged-in employee (identity from auth only). */
export type EmployeeMyScorePeriod = {
  type: 'month' | 'lifetime' | string;
  month: number | null;
  year: number | null;
  key: string | null;
};

export type EmployeeMyScore = {
  value: number | null;
  maximum: number;
  rank: number | null;
  rank_total: number | null;
  performance_level: PerformanceLevel | null;
  period: EmployeeMyScorePeriod | null;
};

export type EmployeeMyScoreResponse = {
  score: EmployeeMyScore;
};

export async function fetchMyEmployeeScore(period?: string): Promise<EmployeeMyScoreResponse> {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  const qs = params.toString();
  return getJson<EmployeeMyScoreResponse>(`/employees/my-score/${qs ? `?${qs}` : ''}`);
}

export function mapDashboardProcedure(p: Record<string, unknown>): Procedure {
  return {
    id: String(p.id),
    customerId: String(p.customer),
    customerName: String(p.customer_name || ''),
    category: String(p.category || ''),
    description: String(p.description ?? ''),
    notes: String(p.notes ?? ''),
    cost: Number(p.cost),
    sellingPrice: Number(p.selling_price),
    cashIn: Number(p.cash_in || 0),
    cashOutType: p.cash_out_type ? String(p.cash_out_type) : undefined,
    cashInType: p.cash_in_type ? String(p.cash_in_type) : undefined,
    status: p.status as Procedure['status'],
    assignedEmployee: String(p.assigned_employee_name || ''),
    assignedEmployeeId: p.assigned_employee ? String(p.assigned_employee) : '',
    date: String(p.date),
    paid: Number(p.paid || 0),
  };
}

export function mapDashboardPayment(p: Record<string, unknown>): Payment {
  return {
    id: String(p.id),
    amount: Number(p.amount),
    date: String(p.date),
    type: p.type as Payment['type'],
    customerId: String(p.customer),
    customerName: String(p.customer_name || ''),
    procedureId: p.procedure ? String(p.procedure) : '',
    procedureCategory: String(p.procedure_category || ''),
    bankCard: p.bank_card ? String(p.bank_card) : '',
    recordedBy: String(p.recorded_by_name || ''),
    recordedById: p.recorded_by ? String(p.recorded_by) : '',
    notes: String(p.notes ?? ''),
  };
}

export function dashboardMetricsToEmployeeMetrics(
  employeeId: string,
  userId: string,
  m: EmployeeDashboardResponse['metrics'],
  score: number,
  level: PerformanceLevel,
  rank: number
): EmployeeMetrics {
  return {
    employeeId,
    userId,
    totalProcedures: m.total_procedures,
    openProcedures: m.open_procedures,
    inProgressProcedures: m.in_progress_procedures,
    closedProcedures: m.closed_procedures,
    closureRatio: m.closure_ratio,
    paymentsCollected: m.payments_collected,
    netProfit: m.net_profit,
    commissionAmount: m.commission_amount,
    performanceScore: score,
    performanceLevel: level,
    rank,
  };
}

export function mapDashboardPeriodGroups(
  groups: EmployeeDashboardResponse['period_groups']
): PeriodBucket[] {
  return groups.map((g) => ({
    key: g.key,
    label: g.key,
    stats: {
      total: g.total_procedures,
      open: g.open_procedures,
      inProgress: 0,
      closed: g.closed_procedures,
      closureRatio: g.closure_ratio,
      revenue: g.revenue,
      paymentsCollected: g.payments_collected,
      netProfit: g.net_profit,
    },
  }));
}
