import { getJson, postJson } from '@/app/lib/api';

export type ResolveAlertProcedurePayload = {
  category: string;
  description?: string;
  selling_price?: number | string;
  cost?: number | string;
  cash_out_type?: string | null;
  cash_in_type?: string | null;
  assigned_employee?: string | null;
  status?: string;
  date?: string;
  paid?: number | string;
  cash_in?: number | string;
  customer_card_mode?: boolean;
};

export type ResolveAlertPayload = {
  alert_type: string;
  customer_id: string;
  field: string;
  new_expiry_date: string;
  notes?: string;
  worker_id?: string;
  create_procedure?: boolean;
  procedure?: ResolveAlertProcedurePayload;
};

export type ResolveAlertResponse = {
  customer: Record<string, unknown> | null;
  worker: Record<string, unknown> | null;
  procedure: Record<string, unknown> | null;
  alert_may_remain: boolean;
  days_until_expiry: number | null;
  warning: string | null;
  field: string;
  target: 'customer' | 'worker';
};

export async function resolveDashboardAlert(payload: ResolveAlertPayload): Promise<ResolveAlertResponse> {
  return postJson<ResolveAlertResponse>('/dashboard/alerts/resolve/', payload);
}

export type DashboardMoney = string | null;

export type DashboardSummary = {
  period: {
    year: number;
    month: number;
    key: string;
    date_from: string;
    date_to: string;
  };
  executive: {
    collected_revenue: string;
    net_profit: string;
    outstanding_receivables: string;
    marketing_contribution: DashboardMoney;
    cash_available: string;
    customers_with_debt: number;
  };
  collection: {
    collected: string;
    amount_due: string;
    rate: DashboardMoney;
    rate_pct: DashboardMoney;
    overdue_receivables: string;
    top_debtors: Array<{ customer_id: string; name: string; balance: string }>;
  };
  debt_aging: Array<{ bucket: string; amount: string }>;
  operations: {
    submitted: number;
    in_process: number;
    need_info: number;
    done: number;
    rejected: number;
    active: number;
    overdue: number;
    open_over_14_days: number;
    unassigned: number;
    completion_rate: DashboardMoney;
    completion_rate_pct: DashboardMoney;
    rejection_rate: DashboardMoney;
    period_total: number;
    period_done: number;
    oldest_open: Array<Record<string, unknown>>;
  };
  profit_by_type: Array<{
    procedure_type: string;
    procedure_count: number;
    revenue: string;
    cost: string;
    net_profit: string;
    margin: DashboardMoney;
    margin_pct: DashboardMoney;
  }>;
  top_customers_by_profit: Array<{
    customer_id: string;
    name: string;
    net_profit: string;
    revenue: string;
  }>;
  employees: {
    top_by_net_profit: {
      employee_id?: string;
      full_name?: string;
      performance_score?: number;
      rank?: number;
      net_profit?: string;
      payments_collected?: string;
      open_procedures?: number;
    } | null;
    top_by_collections: {
      employee_id?: string;
      full_name?: string;
      performance_score?: number;
      rank?: number;
      net_profit?: string;
      payments_collected?: string;
      open_procedures?: number;
    } | null;
    average_score: number | null;
    commission_due_total: string;
    outstanding_advances_total: string;
    workload_imbalance: {
      highest: { name: string; open_procedures: number; employee_id?: string };
      lowest: { name: string; open_procedures: number; employee_id?: string };
    } | null;
    employees: Array<Record<string, unknown>>;
  };
  marketing: {
    leads: number;
    converted_customers: number;
    conversion_rate: DashboardMoney;
    conversion_rate_pct: DashboardMoney;
    collected_revenue: DashboardMoney;
    net_profit: DashboardMoney;
    campaign_spend: DashboardMoney;
    marketing_contribution: DashboardMoney;
    roas: DashboardMoney;
    marketing_roi: DashboardMoney;
  } | null;
  expenses: {
    total: string;
    payroll: string;
    operating: string;
    expense_ratio: DashboardMoney;
    expense_ratio_pct: DashboardMoney;
  };
  bank: {
    cash_available: string;
    unreconciled_accounts: number;
    unreconciled_entries: number;
  };
  alerts: Array<{
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | string;
    title_key: string;
    count?: number | null;
    detail_count?: number | null;
    amount?: string | null;
    meta?: Record<string, unknown>;
  }>;
  meta: {
    currency: string;
    overdue_days: number;
    marketing_roas: DashboardMoney;
  };
};

export async function fetchDashboardSummary(period?: string): Promise<DashboardSummary> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : '';
  return getJson<DashboardSummary>(`/dashboard/summary/${qs}`);
}
