/** Client-side validation for the public attestation form (UX only). */

import type { TFunction } from 'i18next';
import type {
  PublicAttestationDegreeInput,
  PublicAttestationFormState,
} from '@/app/lib/publicAttestationTypes';
import {
  PUBLIC_ATTESTATION_ALLOWED_EXTENSIONS,
  PUBLIC_ATTESTATION_MAX_FILE_BYTES,
  PUBLIC_ATTESTATION_MAX_TOTAL_BYTES,
  PUBLIC_ATTESTATION_NAME_MAX,
  PUBLIC_ATTESTATION_PHONE_MAX,
  PUBLIC_ATTESTATION_YEAR_MAX,
  PUBLIC_ATTESTATION_YEAR_MIN,
} from '@/app/lib/publicAttestationTypes';

export type FieldErrors = Record<string, string>;

export function isAllowedPublicAttestationFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  return PUBLIC_ATTESTATION_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function validatePublicAttestationFile(
  file: File | null,
  t: TFunction,
  requiredKey: string
): string | null {
  if (!file) return t(requiredKey);
  if (!isAllowedPublicAttestationFile(file)) {
    return t('attestationPublic.errors.unsupportedFileType');
  }
  if (file.size <= 0 || file.size > PUBLIC_ATTESTATION_MAX_FILE_BYTES) {
    return t('attestationPublic.errors.fileTooLarge');
  }
  return null;
}

export function totalSelectedFileBytes(state: PublicAttestationFormState): number {
  let total = 0;
  if (state.passport) total += state.passport.size;
  for (const d of state.degrees) {
    if (d.certificate) total += d.certificate.size;
    if (d.transcript) total += d.transcript.size;
  }
  return total;
}

function parseYear(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function validateDegreeYears(
  degree: PublicAttestationDegreeInput,
  t: TFunction
): { start?: string; completion?: string } {
  const out: { start?: string; completion?: string } = {};
  const start = parseYear(degree.start_year);
  const completion = parseYear(degree.completion_year);

  if (start === null) {
    out.start = t('attestationPublic.errors.invalidYear');
  } else if (start < PUBLIC_ATTESTATION_YEAR_MIN || start > PUBLIC_ATTESTATION_YEAR_MAX) {
    out.start = t('attestationPublic.errors.invalidYear');
  }

  if (completion === null) {
    out.completion = t('attestationPublic.errors.invalidYear');
  } else if (
    completion < PUBLIC_ATTESTATION_YEAR_MIN ||
    completion > PUBLIC_ATTESTATION_YEAR_MAX
  ) {
    out.completion = t('attestationPublic.errors.invalidYear');
  }

  if (start !== null && completion !== null && completion < start) {
    out.completion = t('attestationPublic.errors.yearOrder');
  }

  return out;
}

export function validatePublicAttestationForm(
  state: PublicAttestationFormState,
  t: TFunction
): FieldErrors {
  const errors: FieldErrors = {};

  const name = state.full_name.trim();
  if (!name) {
    errors.full_name = t('attestationPublic.errors.required');
  } else if (name.length > PUBLIC_ATTESTATION_NAME_MAX) {
    errors.full_name = t('attestationPublic.errors.nameTooLong');
  }

  const phone = state.phone.trim();
  if (!phone) {
    errors.phone = t('attestationPublic.errors.required');
  } else if (phone.length > PUBLIC_ATTESTATION_PHONE_MAX) {
    errors.phone = t('attestationPublic.errors.phoneTooLong');
  }

  if (!state.degrees.length) {
    errors.degrees = t('attestationPublic.errors.degreeRequired');
  }

  state.degrees.forEach((degree, index) => {
    const prefix = `degree_${index}`;
    if (!degree.study_location.trim()) {
      errors[`${prefix}_study_location`] = t('attestationPublic.errors.required');
    }
    if (!degree.university.trim()) {
      errors[`${prefix}_university`] = t('attestationPublic.errors.required');
    }
    if (!degree.degree_level.trim()) {
      errors[`${prefix}_degree_level`] = t('attestationPublic.errors.required');
    }
    if (!degree.major.trim()) {
      errors[`${prefix}_major`] = t('attestationPublic.errors.required');
    }
    if (!degree.final_grade.trim()) {
      errors[`${prefix}_final_grade`] = t('attestationPublic.errors.required');
    }

    const yearErrs = validateDegreeYears(degree, t);
    if (yearErrs.start) errors[`${prefix}_start_year`] = yearErrs.start;
    if (yearErrs.completion) errors[`${prefix}_completion_year`] = yearErrs.completion;

    const certErr = validatePublicAttestationFile(
      degree.certificate,
      t,
      'attestationPublic.errors.certificateRequired'
    );
    if (certErr) errors[`${prefix}_certificate`] = certErr;

    const trErr = validatePublicAttestationFile(
      degree.transcript,
      t,
      'attestationPublic.errors.transcriptRequired'
    );
    if (trErr) errors[`${prefix}_transcript`] = trErr;
  });

  const passportErr = validatePublicAttestationFile(
    state.passport,
    t,
    'attestationPublic.errors.passportRequired'
  );
  if (passportErr) errors.passport = passportErr;

  if (totalSelectedFileBytes(state) > PUBLIC_ATTESTATION_MAX_TOTAL_BYTES) {
    errors._total = t('attestationPublic.errors.totalTooLarge');
  }

  return errors;
}

export function firstFieldErrorKey(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  return keys.length ? keys[0] : null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
