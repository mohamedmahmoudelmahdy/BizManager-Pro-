/**
 * Marketing CRM stable error-code → i18n key mapping.
 * Backend `error.code` is the contract; UI never shows raw codes.
 */

import type { TFunction } from 'i18next';
import { ApiError, formatApiErrorMessage } from '@/app/lib/api';
import type { MarketingApiErrorBody } from '@/app/lib/marketingTypes';

/** Known Marketing business error codes from Phase 2C. */
export const MARKETING_ERROR_CODES = [
  'invalid_phone',
  'duplicate_lead_phone',
  'matching_customer_found',
  'invalid_customer_link',
  'invalid_campaign_hierarchy',
  'invalid_platform_channel',
  'invalid_campaign_platform',
  'invalid_adset_campaign',
  'invalid_advertisement_hierarchy',
  'campaign_dates_invalid',
  'campaign_budget_invalid',
  'campaign_has_children',
  'entity_has_children',
  'entity_already_archived',
  'lead_already_archived',
  'lead_not_found',
  'lead_archived',
  'archive_reason_required',
  'immutable_field',
  'invalid_status_for_create',
  'permission_denied',
  'operation_not_permitted',
  'duplicate_channel',
  'duplicate_platform',
  'duplicate_campaign',
  'duplicate_adset',
  'duplicate_advertisement',
  'assignment_not_found',
  'duplicate_active_assignment',
  'invalid_assignment_transition',
  'assignment_not_owned',
  'assignment_already_completed',
  'followup_completed',
  'followup_invalid_date',
  'activity_invalid',
  'invalid_conversion_mode',
  'lead_already_converted',
  'lead_not_convertible',
  'customer_match_not_found',
  'customer_creation_failed',
  'conversion_failed',
  'conflicting_customer_id_and_customer',
  'invalid_outcome',
  'invalid_report_date_range',
  'invalid_reporting_interval',
  'invalid_report_filter',
  'invalid_report_hierarchy',
  'report_date_range_too_large',
  'report_permission_denied',
  'reporting_unavailable',
] as const;

export type MarketingErrorCode = (typeof MARKETING_ERROR_CODES)[number] | string;

export function extractMarketingErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as MarketingApiErrorBody | Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return null;
  const nested = (body as MarketingApiErrorBody).error;
  if (nested && typeof nested === 'object' && typeof nested.code === 'string') {
    return nested.code;
  }
  return null;
}

export function extractMarketingErrorDetails(err: unknown): Record<string, unknown> {
  if (!(err instanceof ApiError)) return {};
  const body = err.body as MarketingApiErrorBody | null;
  if (body?.error?.details && typeof body.error.details === 'object') {
    return body.error.details;
  }
  return {};
}

/**
 * Resolve a user-facing message for a Marketing API error.
 * Prefers `marketing.errors.<code>` when present; otherwise falls back.
 */
export function formatMarketingErrorMessage(
  err: unknown,
  t: TFunction,
  fallbackKey = 'marketing.errors.generic'
): string {
  const code = extractMarketingErrorCode(err);
  if (code) {
    const key = `marketing.errors.${code}`;
    const translated = t(key);
    // i18next returns the key itself when missing
    if (translated !== key) {
      return translated;
    }
  }
  const generic = t(fallbackKey);
  if (generic !== fallbackKey) {
    return generic;
  }
  return formatApiErrorMessage(err, t('marketing.errors.generic'));
}
