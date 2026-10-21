/** Lead status / outcome codes for report filters (backend enums). */

export const LEAD_STATUS_CODES = [
  'new',
  'contacted',
  'qualified',
  'assigned',
  'in_progress',
  'converted',
  'lost',
  'archived',
] as const;

export const LEAD_OUTCOME_CODES = [
  'interested',
  'not_interested',
  'no_answer',
  'wrong_number',
  'duplicate',
  'future_opportunity',
] as const;
