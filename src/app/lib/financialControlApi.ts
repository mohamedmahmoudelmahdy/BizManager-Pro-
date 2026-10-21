import { getJson, postJson, patchJson } from '@/app/lib/api';
import type { LedgerAccountApi, LedgerEntryApi } from '@/app/components/financial-control/types/ledger';

export type FinancialOverview = {
  total_cash_bank: number;
  pending_checks_total: number;
  pending_checks_count: number;
  month_expenses_total: number;
  month_start: string;
  month_end: string;
  open_debts_total: number;
  open_debts_count: number;
  employee_advances_total: number;
  employee_advances_count: number;
  pending_settlements_count: number;
  net_business_position: number;
  alerts_count: number;
  ledger_accounts: Array<{
    id: string;
    name: string;
    account_type: string;
    current_balance: number;
    status: string;
    unreconciled_count: number;
  }>;
  cashflow: Array<{ month: string; key: string; expenses: number; income: number }>;
  risk_items: Array<{
    severity: string;
    title_key: string;
    entity: string;
    description: string;
  }>;
};

export type FinancialAlert = {
  id: string;
  type: string;
  entity: string;
  due_date: string;
  amount: number;
  severity: string;
  status: string;
  suggested_action: string;
};

function toList<T>(data: T[] | { results: T[] }): T[] {
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function fetchFinancialOverview(): Promise<FinancialOverview> {
  return getJson<FinancialOverview>('/financial-control/overview/');
}

export async function fetchFinancialAlerts(): Promise<FinancialAlert[]> {
  return getJson<FinancialAlert[]>('/financial-control/alerts/');
}

export async function fetchLedgerAccounts(): Promise<LedgerAccountApi[]> {
  return toList(await getJson<LedgerAccountApi[] | { results: LedgerAccountApi[] }>('/ledger-accounts/'));
}

export async function fetchLedgerAccount(id: string): Promise<LedgerAccountApi> {
  return getJson<LedgerAccountApi>(`/ledger-accounts/${id}/`);
}

export async function fetchLedgerEntries(accountId: string): Promise<LedgerEntryApi[]> {
  return getJson<LedgerEntryApi[]>(`/ledger-accounts/${accountId}/entries/`);
}

export async function createLedgerAccount(payload: Record<string, unknown>): Promise<LedgerAccountApi> {
  return postJson<LedgerAccountApi>('/ledger-accounts/', payload);
}

export async function closeLedgerAccount(id: string, reason?: string): Promise<LedgerAccountApi> {
  return postJson<LedgerAccountApi>(`/ledger-accounts/${id}/close/`, { reason: reason || '' });
}

export type DeleteImportedLedgerResult = {
  import_created: boolean;
  total_entry_count: number;
  import_draft_entry_count: number;
  current_balance: number;
  deleted_account_name: string;
  deleted_entry_count: number;
  deleted_account_count: number;
};

export async function deleteImportedLedgerAccount(id: string): Promise<DeleteImportedLedgerResult> {
  return postJson<DeleteImportedLedgerResult>(`/ledger-accounts/${id}/delete-imported/`, {});
}

export async function reopenLedgerAccount(id: string): Promise<LedgerAccountApi> {
  return postJson<LedgerAccountApi>(`/ledger-accounts/${id}/reopen/`, {});
}

export async function reconcileLedgerAccount(id: string): Promise<LedgerAccountApi> {
  return postJson<LedgerAccountApi>(`/ledger-accounts/${id}/reconcile/`, {});
}

export async function createLedgerEntry(
  accountId: string,
  payload: Record<string, unknown>
): Promise<LedgerEntryApi> {
  return postJson<LedgerEntryApi>(`/ledger-accounts/${accountId}/entries/`, payload);
}

export async function postLedgerEntry(entryId: string): Promise<LedgerEntryApi> {
  return postJson<LedgerEntryApi>(`/ledger-entries/${entryId}/post/`, {});
}

export async function reconcileLedgerEntry(entryId: string): Promise<LedgerEntryApi> {
  return postJson<LedgerEntryApi>(`/ledger-entries/${entryId}/reconcile/`, {});
}

export async function reverseLedgerEntry(entryId: string): Promise<{
  original: LedgerEntryApi;
  reversal: LedgerEntryApi;
}> {
  return postJson(`/ledger-entries/${entryId}/reverse/`, {});
}

export type CheckApi = {
  id: string;
  check_number: string;
  payee: string;
  amount: number | string;
  due_date: string;
  bank_account: string | null;
  bank_account_name: string;
  linked_ledger_account: string | null;
  linked_ledger_account_name: string;
  check_type: string;
  status: string;
  risk_level: string;
  notes: string;
  days_until_due: number;
  deducted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type DebtApi = {
  id: string;
  name: string;
  creditor: string;
  debt_type: string;
  original_amount: number | string;
  paid_amount: number | string;
  remaining_balance: number | string;
  installment_amount: number | string;
  total_installments: number;
  due_date: string | null;
  next_payment_date: string | null;
  payment_frequency: string;
  linked_ledger_account: string | null;
  linked_ledger_account_name: string;
  default_payment_method: string | null;
  default_payment_method_name: string;
  status: string;
  display_status: string;
  paid_percent: number;
  risk_level: string;
  notes: string;
};

export type DebtPaymentApi = {
  id: string;
  debt: string;
  debt_name: string;
  amount: number | string;
  payment_date: string;
  payment_method_name: string;
  reference_number: string;
  notes: string;
  created_at: string;
};

export async function fetchChecks(): Promise<CheckApi[]> {
  return toList(await getJson<CheckApi[] | { results: CheckApi[] }>('/checks/'));
}

export async function createCheck(payload: Record<string, unknown>): Promise<CheckApi> {
  return postJson<CheckApi>('/checks/', payload);
}

export async function deductCheck(
  id: string,
  payload: Record<string, unknown>
): Promise<{ check: CheckApi; expense_id?: string; ledger_entry_id?: string }> {
  return postJson(`/checks/${id}/deduct/`, payload);
}

export async function cancelCheck(id: string, reason?: string): Promise<CheckApi> {
  return postJson<CheckApi>(`/checks/${id}/cancel/`, { reason: reason || '' });
}

export async function replaceCheck(
  id: string,
  payload: Record<string, unknown>
): Promise<{ original: CheckApi; replacement: CheckApi }> {
  return postJson(`/checks/${id}/replace/`, payload);
}

export async function fetchDebts(): Promise<DebtApi[]> {
  return toList(await getJson<DebtApi[] | { results: DebtApi[] }>('/debts/'));
}

export async function createDebt(payload: Record<string, unknown>): Promise<DebtApi> {
  return postJson<DebtApi>('/debts/', payload);
}

export async function updateDebt(id: string, payload: Record<string, unknown>): Promise<DebtApi> {
  return patchJson<DebtApi>(`/debts/${id}/`, payload);
}

export async function payDebt(
  id: string,
  payload: Record<string, unknown>
): Promise<{ debt: DebtApi; payment: DebtPaymentApi }> {
  return postJson(`/debts/${id}/pay/`, payload);
}

export async function fetchDebtPayments(): Promise<DebtPaymentApi[]> {
  return toList(
    await getJson<DebtPaymentApi[] | { results: DebtPaymentApi[] }>('/debt-payments/')
  );
}

export type FinancialReports = {
  period_start: string;
  period_end: string;
  summary: {
    total_cash_bank: number;
    period_expenses_total: number;
    payroll_expenses_total: number;
    payroll_expenses_count: number;
    transfer_volume: number;
    transfer_count: number;
    pending_checks_total: number;
    pending_checks_count: number;
    open_debts_total: number;
    open_debts_count: number;
    ledger_balance_total: number;
    ledger_unreconciled_entries: number;
    net_position: number;
  };
  expenses_by_category: Array<{ category: string; total: number; count: number }>;
  expense_trend: Array<{ key: string; label: string; total: number }>;
  checks_by_status: Array<{ status: string; count: number; total: number }>;
  debts_top: Array<{
    id: string;
    name: string;
    creditor: string;
    remaining_balance: number;
    next_payment_date: string;
  }>;
  bank_cards: Array<{ id: string; name: string; balance: number }>;
};

export async function fetchFinancialReports(
  periodStart?: string,
  periodEnd?: string
): Promise<FinancialReports> {
  const params = new URLSearchParams();
  if (periodStart) params.set('period_start', periodStart);
  if (periodEnd) params.set('period_end', periodEnd);
  const qs = params.toString();
  const path = qs ? `/financial-control/reports/?${qs}` : '/financial-control/reports/';
  return getJson<FinancialReports>(path);
}

export type ImportRowApi = {
  id: string;
  sheet_name: string;
  row_number: number;
  detected_type: string;
  raw_data_json: Record<string, string>;
  normalized_data_json: Record<string, unknown>;
  status: string;
  warning_message: string;
  error_message: string;
};

export type ImportJobApi = {
  id: string;
  original_filename: string;
  status: string;
  total_sheets: number;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  duplicate_hash: string;
  created_by_name: string;
  created_at: string;
  completed_at: string | null;
  confirmed_at?: string | null;
  confirmed_by_name?: string;
  archived?: boolean;
  profile?: string;
  summary_json: {
    duplicate_file?: boolean;
    duplicate_job_id?: string | null;
    sheets?: string[];
    confirm_disabled?: boolean;
    message?: string;
    error?: string;
    preview_summary?: {
      by_type: Record<
        string,
        { count: number; valid: number; warning: number; error: number; total: number }
      >;
      top_sheets: { name: string; count: number }[];
      unknown_rows: number;
      unknown_ratio: number;
    };
    import_result?: {
      imported_rows: number;
      skipped_rows: number;
      failed_rows: number;
      created: Record<string, number>;
      totals: Record<string, number>;
      confirmed_by?: string;
      confirmed_at?: string;
    };
  };
  rows?: ImportRowApi[];
};

export type ImportRowsPage = {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: ImportRowApi[];
};

export async function fetchImportJobs(): Promise<ImportJobApi[]> {
  return toList(await getJson<ImportJobApi[] | { results: ImportJobApi[] }>('/financial-import/jobs/'));
}

export async function fetchImportJob(id: string): Promise<ImportJobApi> {
  return getJson<ImportJobApi>(`/financial-import/jobs/${id}/`);
}

export async function uploadImportJob(file: File, profile = 'generic'): Promise<ImportJobApi> {
  const { postForm } = await import('@/app/lib/api');
  const form = new FormData();
  form.append('file', file);
  form.append('profile', profile);
  return postForm<ImportJobApi>('/financial-import/jobs/', form);
}

export type ImportSheetSummary = {
  sheet: string;
  row_count: number;
  header_row: number;
  columns: Record<string, number>;
  header_labels: { index: number; label: string }[];
  account_name: string;
  detected_type: string;
  confidence: number;
  user_type: string;
  user_columns: Record<string, number>;
  user_account_name: string;
};

export type ImportSheetsResponse = {
  profile: string;
  fields: string[];
  sheet_types: string[];
  sheets: ImportSheetSummary[];
  error?: string;
};

export type SheetMappingInput = {
  type: string;
  columns: Record<string, number>;
  account_name?: string;
  header_row?: number;
};

export async function fetchImportSheets(id: string): Promise<ImportSheetsResponse> {
  return getJson<ImportSheetsResponse>(`/financial-import/jobs/${id}/sheets/`);
}

export async function saveImportMapping(
  id: string,
  payload: { profile: string; sheets: Record<string, SheetMappingInput> }
): Promise<unknown> {
  return postJson(`/financial-import/jobs/${id}/mapping/`, payload);
}

export async function validateImportJob(id: string): Promise<ImportJobApi> {
  return postJson<ImportJobApi>(`/financial-import/jobs/${id}/validate/`, {});
}

export async function confirmImportJob(id: string): Promise<unknown> {
  return postJson(`/financial-import/jobs/${id}/confirm/`, {});
}

export async function fetchImportRows(
  id: string,
  params: { status?: string; detected_type?: string; page?: number; page_size?: number } = {}
): Promise<ImportRowsPage> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.detected_type && params.detected_type !== 'all')
    qs.set('detected_type', params.detected_type);
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  return getJson<ImportRowsPage>(`/financial-import/jobs/${id}/rows/?${qs.toString()}`);
}

export async function deleteImportJob(id: string): Promise<void> {
  const { deleteJson } = await import('@/app/lib/api');
  return deleteJson(`/financial-import/jobs/${id}/`);
}

export async function archiveImportJob(id: string): Promise<unknown> {
  return postJson(`/financial-import/jobs/${id}/archive/`, {});
}

export async function clearUnconfirmedImports(): Promise<{ deleted: number }> {
  return postJson<{ deleted: number }>('/financial-import/jobs/clear-unconfirmed/', {});
}

export async function downloadImportReport(id: string, filename: string): Promise<void> {
  const { getBlob } = await import('@/app/lib/api');
  const blob = await getBlob(`/financial-import/jobs/${id}/report/`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
