/**
 * HR Attestation portal API — GET only (read-only).
 * No POST/PATCH/PUT/DELETE for application data.
 */

import { getBlob, getJson } from '@/app/lib/api';
import type {
  HRApplicationDetail,
  HRApplicationListParams,
  HROverviewResponse,
  PaginatedHRApplications,
} from '@/app/lib/hrAttestationTypes';

const BASE = '/hr/attestation';

function buildQuery(params?: HRApplicationListParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const hrAttestationApi = {
  getOverview: (init?: RequestInit) =>
    getJson<HROverviewResponse>(`${BASE}/overview/`, init),

  listApplications: (params?: HRApplicationListParams, init?: RequestInit) =>
    getJson<PaginatedHRApplications>(
      `${BASE}/applications/${buildQuery(params)}`,
      init
    ),

  getApplication: (id: string, init?: RequestInit) =>
    getJson<HRApplicationDetail>(`${BASE}/applications/${id}/`, init),

  downloadDocument: (documentId: string) =>
    getBlob(`${BASE}/documents/${documentId}/download/`),
};
