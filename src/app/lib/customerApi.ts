import { getJson, postForm, postJson } from '@/app/lib/api';

export type WorkerImportPreviewRow = {
  row_number: number;
  status: 'valid' | 'warning' | 'error';
  errors: string[];
  warnings: string[];
  mapped: {
    name: string;
    residency_expiry: string | null;
    insurance_expiry: string | null;
    no_health_insurance: boolean;
    identifier: string | null;
    notes: string | null;
  };
};

export type WorkerImportPreviewResponse = {
  preview: true;
  columns_detected: Record<string, number | null>;
  header_labels: string[];
  counts: {
    total: number;
    valid: number;
    warning: number;
    error: number;
  };
  rows: WorkerImportPreviewRow[];
  can_import: boolean;
  importable_count: number;
};

export type WorkerImportConfirmResponse = {
  preview: false;
  created: number;
  skipped: number;
  errors: number;
  counts: WorkerImportPreviewResponse['counts'];
};

function workersImportFormData(file: File, confirm: boolean) {
  const body = new FormData();
  body.append('file', file);
  body.append('confirm', confirm ? 'true' : 'false');
  return body;
}

export async function previewWorkersCsvImport(
  customerId: string,
  file: File
): Promise<WorkerImportPreviewResponse> {
  return postForm<WorkerImportPreviewResponse>(
    `/customers/${customerId}/workers/import-csv/`,
    workersImportFormData(file, false)
  );
}

export async function confirmWorkersCsvImport(
  customerId: string,
  file: File
): Promise<WorkerImportConfirmResponse> {
  return postForm<WorkerImportConfirmResponse>(
    `/customers/${customerId}/workers/import-csv/`,
    workersImportFormData(file, true)
  );
}

export type CustomerFinancialSummary = {
  customer: {
    id: string;
    type: 'individual' | 'company';
    name: string;
    company_name: string;
    display_name: string;
    phone: string;
    phone_secondary: string;
    email: string;
    balance: string;
    debt_status: string;
    debt_status_display: 'in_debt' | 'credit' | 'clear';
    last_activity: string | null;
    account_status: 'active' | 'closed';
    closed_at: string | null;
    closure_reason: string;
  };
  totals: {
    procedure_count: number;
    total_procedure_charges: string;
    total_payments: string;
    total_refunds?: string;
    net_collected?: string;
    total_adjustments: string;
    total_reversed_adjustments: string;
    computed_statement_balance: string;
    recorded_balance: string;
    balance_mismatch: boolean;
  };
  procedures: Array<{
    id: string;
    customer_id?: string;
    date: string | null;
    category: string;
    /** Existing Procedure.description; empty string when unset. */
    description?: string | null;
    status: string;
    selling_price: string;
    cost: string;
    paid: string;
    outstanding: string;
  }>;
  payments: Array<{
    id: string;
    customer_id?: string;
    date: string | null;
    amount: string;
    original_amount?: string;
    refunded_amount?: string;
    refundable_amount?: string;
    type: string;
    procedure_id: string | null;
    procedure_category: string;
    bank_card_name: string;
    notes: string;
    recorded_by_name: string;
  }>;
  refunds?: Array<{
    id: string;
    payment_id: string;
    customer_id?: string;
    date: string | null;
    amount: string;
    payment_method_name: string;
    reason: string;
    notes: string;
    created_by_name: string;
  }>;
  adjustments: Array<{
    id: string;
    date: string | null;
    adjustment_type: string;
    amount: string;
    reason: string;
    notes: string;
    status: string;
    reversed_at: string | null;
    reversal_reason: string;
  }>;
  statement: Array<{
    id: string;
    date: string | null;
    kind: 'procedure' | 'payment' | 'refund' | 'adjustment' | 'adjustment_reversal' | 'account_event';
    description: string;
    status: string;
    debit: string;
    credit: string;
    running_balance: string;
  }>;
};

export async function fetchCustomerFinancialSummary(customerId: string): Promise<CustomerFinancialSummary> {
  return getJson<CustomerFinancialSummary>(`/customers/${customerId}/financial-summary/`);
}

export type DirectDiscountPayload = {
  amount: string;
  date: string;
  reason: string;
  notes?: string;
};

export async function createCustomerFinancialAdjustment(customerId: string, payload: DirectDiscountPayload) {
  return postJson(`/customers/${customerId}/financial-adjustments/`, {
    adjustment_type: 'discount',
    ...payload,
  });
}

export async function closeCustomerAccount(customerId: string, reason: string) {
  return postJson(`/customers/${customerId}/close-account/`, { reason });
}

export async function reopenCustomerAccount(customerId: string, reason: string) {
  return postJson(`/customers/${customerId}/reopen-account/`, { reason });
}

export type TransferProcedurePayload = {
  target_customer_id: string;
  reason: string;
  transfer_linked_payments?: boolean;
};

export type TransferPaymentPayload = {
  target_customer_id: string;
  reason: string;
  target_procedure_id?: string | null;
};

export type FinancialTransferResult = {
  procedure?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  transfer: {
    transfer_id: string;
    transfer_type: string;
    source_customer_id: string;
    target_customer_id: string;
    reason: string;
    linked_payment_ids?: string[];
    source_balance?: string;
    target_balance?: string;
  };
};

export async function transferProcedureToCustomer(
  procedureId: string,
  payload: TransferProcedurePayload
): Promise<FinancialTransferResult> {
  return postJson<FinancialTransferResult>(
    `/procedures/${procedureId}/transfer-customer/`,
    payload
  );
}

export async function transferPaymentToCustomer(
  paymentId: string,
  payload: TransferPaymentPayload
): Promise<FinancialTransferResult> {
  return postJson<FinancialTransferResult>(
    `/payments/${paymentId}/transfer-customer/`,
    payload
  );
}

export type PaymentRefundPayload = {
  amount: string;
  payment_method: string;
  date: string;
  reason: string;
  notes?: string;
};

export type PaymentRefundResult = {
  refund: Record<string, unknown>;
  payment: Record<string, unknown>;
  original_amount: string;
  refunded_amount: string;
  refundable_amount: string;
  balance_before: {
    balance: string;
    absolute_amount: string;
    debt_status_display: 'in_debt' | 'credit' | 'clear';
    label: string;
  };
  balance_after: {
    balance: string;
    absolute_amount: string;
    debt_status_display: 'in_debt' | 'credit' | 'clear';
    label: string;
  };
  customer_financial_summary: CustomerFinancialSummary;
};

export async function refundPayment(
  paymentId: string,
  payload: PaymentRefundPayload
): Promise<PaymentRefundResult> {
  return postJson<PaymentRefundResult>(`/payments/${paymentId}/refund/`, payload);
}
