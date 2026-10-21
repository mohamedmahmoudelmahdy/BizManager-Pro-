/**
 * Customer-profile attestation portal management API.
 */

import { getJson, postJson } from '@/app/lib/api';

export type CustomerAttestationHrUser = {
  profile_id: string;
  user_id: string;
  username: string;
  email: string;
  is_active: boolean;
};

export type CustomerAttestationBatchSummary = {
  id: string;
  title: string;
  public_slug: string;
  expected_applicant_count: number | null;
  is_active: boolean;
  application_count?: number;
  completed_count?: number;
};

export type CustomerAttestationStatus = {
  enabled: boolean;
  attestation_apply_slug: string | null;
  apply_path: string | null;
  active_batch: CustomerAttestationBatchSummary | null;
  latest_batch: CustomerAttestationBatchSummary | null;
  hr_users: CustomerAttestationHrUser[];
  customer: {
    id: string;
    display_name: string;
    type: string;
  };
};

function base(customerId: string) {
  return `/customers/${customerId}/attestation`;
}

export const customerAttestationApi = {
  status(customerId: string) {
    return getJson<CustomerAttestationStatus>(`${base(customerId)}/`);
  },
  enable(
    customerId: string,
    body?: { expected_applicant_count?: number; title?: string; slug?: string }
  ) {
    return postJson<CustomerAttestationStatus>(`${base(customerId)}/enable/`, body || {});
  },
  setActive(customerId: string, is_active: boolean) {
    return postJson<CustomerAttestationStatus>(`${base(customerId)}/set-active/`, {
      is_active,
    });
  },
  createHrUser(
    customerId: string,
    body: { username: string; password: string; email?: string }
  ) {
    return postJson<CustomerAttestationStatus>(`${base(customerId)}/hr-users/`, body);
  },
  setHrUserActive(customerId: string, userId: string, is_active: boolean) {
    return postJson<CustomerAttestationStatus>(
      `${base(customerId)}/hr-users/${userId}/set-active/`,
      { is_active }
    );
  },
};

export function buildPublicApplyAbsoluteUrl(applyPath: string | null | undefined): string {
  if (!applyPath) return '';
  if (typeof window === 'undefined') return applyPath;
  return `${window.location.origin}${applyPath.startsWith('/') ? '' : '/'}${applyPath}`;
}
