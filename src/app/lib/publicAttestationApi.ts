/**
 * Unauthenticated public attestation submit client.
 * Uses raw fetch — never attaches Authorization / never redirects to login.
 */

import { ApiError, API_BASE } from '@/app/lib/api';
import type {
  PublicAttestationDegreeInput,
  PublicAttestationFormState,
  PublicAttestationSubmissionResponse,
} from '@/app/lib/publicAttestationTypes';

/** Prefer route slug; env is local/dev fallback only. */
export function getPublicAttestationSlug(routeSlug?: string | null): string {
  const fromRoute = (routeSlug || '').trim();
  if (fromRoute) return fromRoute;
  const fromEnv = (import.meta.env.VITE_ATTESTATION_PUBLIC_SLUG as string | undefined)?.trim();
  return fromEnv || '';
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `deg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyDegree(): PublicAttestationDegreeInput {
  return {
    clientId: newClientId(),
    study_location: '',
    university: '',
    degree_level: '',
    major: '',
    start_year: '',
    completion_year: '',
    final_grade: '',
    certificate: null,
    transcript: null,
  };
}

export function createEmptyPublicFormState(): PublicAttestationFormState {
  return {
    full_name: '',
    phone: '',
    degrees: [createEmptyDegree()],
    passport: null,
    website: '',
    captcha_token: undefined,
  };
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildPublicAttestationFormData(
  state: PublicAttestationFormState
): FormData {
  const fd = new FormData();
  fd.append('full_name', state.full_name.trim());
  fd.append('phone', state.phone.trim());

  const degreesPayload = state.degrees.map((d) => ({
    study_location: d.study_location.trim(),
    university: d.university.trim(),
    degree_level: d.degree_level.trim(),
    major: d.major.trim(),
    start_year: Number.parseInt(d.start_year, 10),
    completion_year: Number.parseInt(d.completion_year, 10),
    final_grade: d.final_grade.trim(),
  }));
  fd.append('degrees', JSON.stringify(degreesPayload));

  if (state.passport) {
    fd.append('passport', state.passport, state.passport.name);
  }

  state.degrees.forEach((degree, index) => {
    if (degree.certificate) {
      fd.append(
        `degree_${index}_certificate`,
        degree.certificate,
        degree.certificate.name
      );
    }
    if (degree.transcript) {
      fd.append(
        `degree_${index}_transcript`,
        degree.transcript,
        degree.transcript.name
      );
    }
  });

  // Honeypot — empty for humans; bots that fill it are rejected server-side.
  fd.append('website', state.website || '');

  if (state.captcha_token) {
    fd.append('captcha_token', state.captcha_token);
  }

  return fd;
}

export const publicAttestationApi = {
  async submitApplication(
    state: PublicAttestationFormState,
    options: {
      idempotencyKey: string;
      signal?: AbortSignal;
      slug?: string;
    }
  ): Promise<PublicAttestationSubmissionResponse> {
    const slug = (options.slug || getPublicAttestationSlug()).trim();
    if (!slug) {
      throw new ApiError(404, {
        error: {
          code: 'attestation_batch_unavailable',
          message: 'attestation_batch_unavailable',
          details: { reason: 'missing_slug' },
        },
      });
    }

    const url = `${API_BASE.replace(/\/$/, '')}/public/attestation/${encodeURIComponent(slug)}/applications/`;
    const body = buildPublicAttestationFormData(state);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        // Match Django/DRF header casing used by the public submit view.
        'Idempotency-Key': options.idempotencyKey,
      },
      body,
      signal: options.signal,
    });

    let parsed: unknown = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, parsed, url);
    }

    const bodyJson = parsed as PublicAttestationSubmissionResponse & {
      reference_number?: string;
    };
    // Normalize in case an older payload shape is returned.
    if (bodyJson && !bodyJson.reference_number && typeof bodyJson === 'object') {
      const alt = (bodyJson as { reference?: string }).reference;
      if (alt) bodyJson.reference_number = alt;
    }
    return bodyJson as PublicAttestationSubmissionResponse;
  },
};
