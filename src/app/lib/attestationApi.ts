/**
 * Attestation API client — thin wrappers over shared fetch helpers.
 * Base path: /api/attestation/
 * No PUT/DELETE. No financial endpoints.
 */

import { getBlob, getJson, patchJson, postForm } from '@/app/lib/api';
import type {
  AttestationApplicationDetail,
  AttestationListParams,
  CompleteAttestationInput,
  PaginatedAttestationApplications,
  SetDataFlowInput,
  SetMOHESRInput,
  UpdateInternalNotesInput,
} from '@/app/lib/attestationTypes';

export const ATTESTATION_API_BASE = '/attestation';

function attestationPath(path = ''): string {
  if (!path) return `${ATTESTATION_API_BASE}/`;
  const cleaned = path.startsWith('/') ? path : `/${path}`;
  return `${ATTESTATION_API_BASE}${cleaned}`;
}

/** Build query string; omits undefined / null / empty values. */
export function buildAttestationQuery(
  params?: AttestationListParams | Record<string, unknown>
): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

function normalizeListResponse(
  data: PaginatedAttestationApplications | AttestationApplicationDetail[]
): PaginatedAttestationApplications {
  if (Array.isArray(data)) {
    return { count: data.length, next: null, previous: null, results: data as never };
  }
  return {
    count: data.count ?? data.results?.length ?? 0,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: data.results ?? [],
  };
}

function appendIfPresent(form: FormData, key: string, value: string | File | null | undefined) {
  if (value === undefined || value === null || value === '') return;
  form.append(key, value);
}

export const attestationApi = {
  listApplications: async (
    params?: AttestationListParams,
    init?: RequestInit
  ): Promise<PaginatedAttestationApplications> => {
    const data = await getJson<PaginatedAttestationApplications>(
      attestationPath(`/applications/${buildAttestationQuery(params)}`),
      init
    );
    return normalizeListResponse(data);
  },

  getApplication: (id: string, init?: RequestInit) =>
    getJson<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/`),
      init
    ),

  updateInternalNotes: (id: string, body: UpdateInternalNotesInput) =>
    patchJson<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/`),
      body
    ),

  saveDataFlow: (id: string, input: SetDataFlowInput) => {
    const form = new FormData();
    appendIfPresent(form, 'dataflow_reference', input.dataflow_reference);
    appendIfPresent(form, 'dataflow_submitted_at', input.dataflow_submitted_at);
    appendIfPresent(form, 'dataflow_payment_proof', input.dataflow_payment_proof);
    appendIfPresent(form, 'dataflow_result', input.dataflow_result);
    return postForm<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/save-dataflow/`),
      form
    );
  },

  setDataFlow: (id: string, input: SetDataFlowInput = {}) => {
    const form = new FormData();
    appendIfPresent(form, 'dataflow_reference', input.dataflow_reference);
    appendIfPresent(form, 'dataflow_submitted_at', input.dataflow_submitted_at);
    appendIfPresent(form, 'dataflow_payment_proof', input.dataflow_payment_proof);
    appendIfPresent(form, 'dataflow_result', input.dataflow_result);
    return postForm<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/set-dataflow/`),
      form
    );
  },

  saveMOHESR: (id: string, input: SetMOHESRInput) => {
    const form = new FormData();
    appendIfPresent(form, 'mohesr_reference', input.mohesr_reference);
    appendIfPresent(form, 'mohesr_submitted_at', input.mohesr_submitted_at);
    appendIfPresent(form, 'mohesr_payment_proof', input.mohesr_payment_proof);
    return postForm<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/save-mohesr/`),
      form
    );
  },

  setMOHESR: (id: string, input: SetMOHESRInput = {}) => {
    const form = new FormData();
    appendIfPresent(form, 'mohesr_reference', input.mohesr_reference);
    appendIfPresent(form, 'mohesr_submitted_at', input.mohesr_submitted_at);
    appendIfPresent(form, 'mohesr_payment_proof', input.mohesr_payment_proof);
    return postForm<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/set-mohesr/`),
      form
    );
  },

  complete: (id: string, input: CompleteAttestationInput = {}) => {
    const form = new FormData();
    appendIfPresent(form, 'final_equivalency', input.final_equivalency);
    return postForm<AttestationApplicationDetail>(
      attestationPath(`/applications/${id}/complete/`),
      form
    );
  },

  downloadDocument: (documentId: string) =>
    getBlob(attestationPath(`/documents/${documentId}/download/`)),
};
