import { deleteJson, getJson, postForm } from '@/app/lib/api';

export type PaymentMethodStatement = {
  payment_method: {
    id: string;
    name: string;
    method_type: string;
    card_type: string;
    masked_number: string;
    iban: string;
    account_number: string;
    notes: string;
    current_balance: string;
  };
  opening_balance: string;
  opening_balance_estimated: boolean;
  current_balance: string;
  totals: {
    money_in: string;
    money_out: string;
    net_change: string;
  };
  rows: Array<{
    id: string;
    date: string | null;
    description: string;
    source_type: string;
    money_in: string;
    money_out: string;
    running_balance: string;
    customer_name: string;
    procedure_name: string;
    reference: string;
    created_by: string;
    status: string;
  }>;
};

export type PaymentMethodStatementParams = {
  date_from?: string;
  date_to?: string;
  source_type?: string;
};

export async function fetchPaymentMethodStatement(
  cardId: string,
  params: PaymentMethodStatementParams = {}
): Promise<PaymentMethodStatement> {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.source_type) qs.set('source_type', params.source_type);
  const query = qs.toString();
  const path = query ? `/bank-cards/${cardId}/statement/?${query}` : `/bank-cards/${cardId}/statement/`;
  return getJson<PaymentMethodStatement>(path);
}

export type StatementComparisonRow = {
  id: number;
  source: 'bank' | 'system';
  date: string | null;
  description: string;
  money_in: string;
  money_out: string;
  balance: string | null;
  reference: string;
  match_status: string;
  system_row_id: string | null;
};

export type StatementComparisonMatch = {
  id: number;
  match_type: 'exact' | 'possible';
  confidence: string;
  reason: string;
  bank_row: StatementComparisonRow;
  system_row: StatementComparisonRow;
};

export type StatementComparisonJob = {
  id: string;
  payment_method_id: string;
  file_name: string;
  status: string;
  error_message: string;
  summary: {
    bank_total_debit: string;
    bank_total_credit: string;
    system_total_money_out: string;
    system_total_money_in: string;
    matched_count: number;
    possible_match_count: number;
    bank_only_count: number;
    system_only_count: number;
    amount_difference_total: string;
    date_from: string | null;
    date_to: string | null;
    bank_row_count: number;
    system_row_count: number;
  };
  detected_columns: {
    columns: Record<string, string>;
    format: string;
    header_row_index: number;
  };
  created_at: string;
  exact_matches: StatementComparisonMatch[];
  possible_matches: StatementComparisonMatch[];
  bank_only: StatementComparisonRow[];
  system_only: StatementComparisonRow[];
};

function comparisonFormData(file: File) {
  const body = new FormData();
  body.append('file', file);
  return body;
}

export async function uploadStatementComparison(
  cardId: string,
  file: File
): Promise<StatementComparisonJob> {
  return postForm<StatementComparisonJob>(
    `/bank-cards/${cardId}/statement-comparison/jobs/`,
    comparisonFormData(file)
  );
}

export async function fetchStatementComparison(
  cardId: string,
  jobId: string
): Promise<StatementComparisonJob> {
  return getJson<StatementComparisonJob>(
    `/bank-cards/${cardId}/statement-comparison/jobs/${jobId}/`
  );
}

export async function deleteStatementComparison(cardId: string, jobId: string): Promise<void> {
  await deleteJson(`/bank-cards/${cardId}/statement-comparison/jobs/${jobId}/`);
}
