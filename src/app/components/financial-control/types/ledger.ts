export type LedgerAccountType =
  | 'internal'
  | 'customer'
  | 'vendor'
  | 'employee'
  | 'partner'
  | 'government_provider'
  | 'office_debt'
  | 'vehicle'
  | 'checks'
  | 'other';

export type LedgerEntryType = 'credit' | 'debit';
export type LedgerEntryStatus = 'draft' | 'posted' | 'reconciled' | 'reversed';

export interface LedgerAccountApi {
  id: string;
  name: string;
  account_code: string;
  account_type: LedgerAccountType;
  linked_customer: string | null;
  linked_customer_name: string;
  linked_employee: number | null;
  linked_employee_name: string;
  linked_payment_method: string | null;
  linked_payment_method_name: string;
  linked_vendor_name: string;
  status: 'active' | 'closed' | 'inactive';
  opening_balance_type: 'debit' | 'credit';
  opening_balance_amount: string | number;
  current_balance: string | number;
  total_credit: number;
  total_debit: number;
  unreconciled_count: number;
  import_created: boolean;
  import_only: boolean;
  can_delete_imported: boolean;
  delete_imported_reason: string;
  import_draft_entry_count: number;
  notes: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  last_reconciled_at: string | null;
  closed_at: string | null;
  closed_reason: string;
}

export interface LedgerEntryApi {
  id: string;
  ledger_account: string;
  ledger_account_name: string;
  date: string;
  description: string;
  entry_type: LedgerEntryType;
  amount: string | number;
  previous_balance: string | number;
  resulting_balance: string | number;
  running_balance: string | number;
  status: LedgerEntryStatus;
  source_type: string;
  source_id: string;
  reversal_of: string | null;
  is_reversal: boolean;
  reversed_by_name?: string;
  reversal_reason?: string;
  can_reverse_generically?: boolean;
  generic_reverse_block_reason?: string;
  notes: string;
  created_by_name: string;
  created_at: string;
  reconciled_at: string | null;
  reversed_at: string | null;
}
