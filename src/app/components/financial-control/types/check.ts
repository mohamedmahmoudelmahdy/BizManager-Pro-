export type { CheckApi } from '@/app/lib/financialControlApi';

export const CHECK_TYPES = ['rent', 'supplier', 'government', 'security', 'other'] as const;

export const CHECK_STATUSES = [
  'pending',
  'due_soon',
  'deducted',
  'bounced',
  'cancelled',
  'replaced',
] as const;
