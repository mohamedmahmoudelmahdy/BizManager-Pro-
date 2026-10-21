import { useMemo } from 'react';
import { marketingApi, marketingPaths, MARKETING_API_BASE } from '@/app/lib/marketingApi';
import {
  extractMarketingErrorCode,
  extractMarketingErrorDetails,
  formatMarketingErrorMessage,
} from '@/app/lib/marketingErrors';

/**
 * Shared Marketing API accessors for feature pages.
 *
 * Note: this project does not use React Query. Data fetching remains
 * useState/useEffect (or DataContext) as elsewhere. These helpers centralize
 * the Marketing base path and error mapping until a query library is adopted.
 */
export function useMarketingApi() {
  return useMemo(
    () => ({
      api: marketingApi,
      paths: marketingPaths,
      base: MARKETING_API_BASE,
      extractErrorCode: extractMarketingErrorCode,
      extractErrorDetails: extractMarketingErrorDetails,
      formatError: formatMarketingErrorMessage,
    }),
    []
  );
}

/** Stable query-key prefixes for future React Query adoption. */
export const marketingQueryKeys = {
  all: ['marketing'] as const,
  leads: () => [...marketingQueryKeys.all, 'leads'] as const,
  lead: (id: string) => [...marketingQueryKeys.leads(), id] as const,
  campaigns: () => [...marketingQueryKeys.all, 'campaigns'] as const,
  campaign: (id: string) => [...marketingQueryKeys.campaigns(), id] as const,
  followups: () => [...marketingQueryKeys.all, 'followups'] as const,
  assignments: () => [...marketingQueryKeys.all, 'assignments'] as const,
  spend: () => [...marketingQueryKeys.all, 'spend'] as const,
};

/**
 * Invalidation helper stub — no-op until React Query (or similar) is adopted.
 * Feature pages can call this after mutations without changing call sites later.
 */
export function useMarketingInvalidate() {
  return useMemo(
    () => ({
      invalidateAll: () => {
        /* reserved for future query client */
      },
      invalidateLeads: () => {
        /* reserved */
      },
      invalidateCampaigns: () => {
        /* reserved */
      },
      keys: marketingQueryKeys,
    }),
    []
  );
}

/**
 * Shared base key helper for Marketing list/detail fetches when a query library is added.
 */
export function useMarketingBaseQuery() {
  return useMemo(
    () => ({
      keys: marketingQueryKeys,
      base: MARKETING_API_BASE,
    }),
    []
  );
}
