export type { DebtApi, DebtPaymentApi } from '@/app/lib/financialControlApi';

export const DEBT_TYPES = ['bank_loan', 'vendor', 'office', 'vehicle', 'other'] as const;

export const DEBT_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly', 'one_time'] as const;
