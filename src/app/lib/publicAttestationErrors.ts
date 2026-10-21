/** Map public attestation API errors to localized messages + field hints. */

import type { TFunction } from 'i18next';
import { ApiError } from '@/app/lib/api';
import type { PublicAttestationApiErrorBody } from '@/app/lib/publicAttestationTypes';
import type { FieldErrors } from '@/app/lib/publicAttestationValidation';

export function extractPublicAttestationError(
  err: unknown
): { code: string | null; details: Record<string, unknown>; status: number | null } {
  if (!(err instanceof ApiError)) {
    return { code: null, details: {}, status: null };
  }
  const body = err.body as PublicAttestationApiErrorBody | null;
  const nested = body?.error;
  const code =
    nested && typeof nested.code === 'string'
      ? nested.code
      : err.status === 429
        ? 'attestation_rate_limited'
        : null;
  const details =
    nested && nested.details && typeof nested.details === 'object'
      ? (nested.details as Record<string, unknown>)
      : {};
  return { code, details, status: err.status };
}

export function formatPublicAttestationErrorMessage(err: unknown, t: TFunction): string {
  const { code, status } = extractPublicAttestationError(err);
  if (status === 429 || code === 'attestation_rate_limited') {
    return t('attestationPublic.errors.rateLimited');
  }
  if (code === 'attestation_batch_unavailable') {
    return t('attestationPublic.unavailable.description');
  }
  if (code) {
    const key = `attestationPublic.errors.${code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return t('attestationPublic.errors.generic');
}

/** Attach backend field/degree errors next to inputs when possible. */
export function mapPublicAttestationErrorToFields(
  err: unknown,
  t: TFunction
): FieldErrors {
  const { code, details } = extractPublicAttestationError(err);
  const errors: FieldErrors = {};

  if (code === 'attestation_passport_required') {
    errors.passport = t('attestationPublic.errors.passportRequired');
  }
  if (code === 'attestation_degree_required') {
    errors.degrees = t('attestationPublic.errors.degreeRequired');
  }
  if (code === 'attestation_certificate_required') {
    const idx = Number(details.degree_index ?? 0);
    errors[`degree_${idx}_certificate`] = t(
      'attestationPublic.errors.certificateRequired'
    );
  }
  if (code === 'attestation_transcript_required') {
    const idx = Number(details.degree_index ?? 0);
    errors[`degree_${idx}_transcript`] = t(
      'attestationPublic.errors.transcriptRequired'
    );
  }
  if (code === 'attestation_invalid_academic_period') {
    const idx = Number(details.index ?? 0);
    errors[`degree_${idx}_completion_year`] = t(
      'attestationPublic.errors.invalidAcademicPeriod'
    );
  }
  if (code === 'attestation_file_too_large') {
    errors._global = t('attestationPublic.errors.fileTooLarge');
  }
  if (code === 'attestation_invalid_file_type') {
    errors._global = t('attestationPublic.errors.unsupportedFileType');
  }
  if (code === 'attestation_submission_invalid') {
    if (details.field === 'full_name') {
      errors.full_name = t('attestationPublic.errors.required');
    } else {
      errors._global = t('attestationPublic.errors.generic');
    }
  }

  return errors;
}

export function isBatchUnavailableError(err: unknown): boolean {
  const { code } = extractPublicAttestationError(err);
  return code === 'attestation_batch_unavailable';
}
