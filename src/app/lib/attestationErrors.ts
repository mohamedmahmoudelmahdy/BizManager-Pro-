/**
 * Attestation stable error-code → i18n key mapping.
 * Backend `error.code` is the contract; UI never shows raw codes as primary copy.
 */

import type { TFunction } from 'i18next';
import { ApiError, formatApiErrorMessage } from '@/app/lib/api';
import type { AttestationApiErrorBody } from '@/app/lib/attestationTypes';

export function extractAttestationErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as AttestationApiErrorBody | Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return null;
  const nested = (body as AttestationApiErrorBody).error;
  if (nested && typeof nested === 'object' && typeof nested.code === 'string') {
    return nested.code;
  }
  return null;
}

export function formatAttestationErrorMessage(
  err: unknown,
  t: TFunction,
  fallbackKey = 'attestation.errors.generic'
): string {
  const code = extractAttestationErrorCode(err);
  if (code) {
    const key = `attestation.errors.${code}`;
    const translated = t(key);
    if (translated !== key) {
      return translated;
    }
  }
  const generic = t(fallbackKey);
  if (generic !== fallbackKey) {
    return generic;
  }
  return formatApiErrorMessage(err, t('attestation.errors.generic'));
}
