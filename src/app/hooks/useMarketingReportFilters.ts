/**
 * URL-synced Marketing report filters with debounce for API fetches.
 * Presentation layer only — no client aggregation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MarketingReportFilterParams, ReportingInterval } from '@/app/lib/marketingTypes';
import { defaultReportDateFrom, defaultReportDateTo } from '@/app/lib/marketingFormat';

export type MarketingDashboardFilters = {
  date_from: string;
  date_to: string;
  channel_id: string;
  platform_id: string;
  campaign_id: string;
  adset_id: string;
  advertisement_id: string;
  status: string;
  outcome: string;
  assigned_to: string;
  include_archived: boolean;
  interval: ReportingInterval;
  search: string;
  ordering: string;
  page: number;
  page_size: number;
};

const FILTER_KEYS = [
  'date_from',
  'date_to',
  'channel_id',
  'platform_id',
  'campaign_id',
  'adset_id',
  'advertisement_id',
  'status',
  'outcome',
  'assigned_to',
  'include_archived',
  'interval',
  'search',
  'ordering',
  'page',
  'page_size',
] as const;

function readFilters(sp: URLSearchParams): MarketingDashboardFilters {
  const intervalRaw = sp.get('interval');
  const interval: ReportingInterval =
    intervalRaw === 'week' || intervalRaw === 'month' ? intervalRaw : 'day';
  const page = Number(sp.get('page') || '1');
  const page_size = Number(sp.get('page_size') || '20');
  return {
    date_from: sp.get('date_from') || defaultReportDateFrom(),
    date_to: sp.get('date_to') || defaultReportDateTo(),
    channel_id: sp.get('channel_id') || '',
    platform_id: sp.get('platform_id') || '',
    campaign_id: sp.get('campaign_id') || '',
    adset_id: sp.get('adset_id') || '',
    advertisement_id: sp.get('advertisement_id') || '',
    status: sp.get('status') || '',
    outcome: sp.get('outcome') ?? '',
    assigned_to: sp.get('assigned_to') || '',
    include_archived: sp.get('include_archived') === 'true',
    interval,
    search: sp.get('search') || '',
    ordering: sp.get('ordering') || 'campaign_name',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: Number.isFinite(page_size) && page_size > 0 ? Math.min(page_size, 100) : 20,
  };
}

function writeFilters(filters: MarketingDashboardFilters): URLSearchParams {
  const sp = new URLSearchParams();
  const defaults: MarketingDashboardFilters = {
    date_from: defaultReportDateFrom(),
    date_to: defaultReportDateTo(),
    channel_id: '',
    platform_id: '',
    campaign_id: '',
    adset_id: '',
    advertisement_id: '',
    status: '',
    outcome: '',
    assigned_to: '',
    include_archived: false,
    interval: 'day',
    search: '',
    ordering: 'campaign_name',
    page: 1,
    page_size: 20,
  };

  for (const key of FILTER_KEYS) {
    const value = filters[key];
    const def = defaults[key];
    if (key === 'include_archived') {
      if (filters.include_archived) sp.set(key, 'true');
      continue;
    }
    if (value === def || value === '' || value === null || value === undefined) continue;
    sp.set(key, String(value));
  }
  return sp;
}

export function filtersToApiParams(
  filters: MarketingDashboardFilters,
  opts?: { includeInterval?: boolean; includePagination?: boolean }
): MarketingReportFilterParams {
  const params: MarketingReportFilterParams = {
    date_from: filters.date_from,
    date_to: filters.date_to,
  };
  if (filters.channel_id) params.channel_id = filters.channel_id;
  if (filters.platform_id) params.platform_id = filters.platform_id;
  if (filters.campaign_id) params.campaign_id = filters.campaign_id;
  if (filters.adset_id) params.adset_id = filters.adset_id;
  if (filters.advertisement_id) params.advertisement_id = filters.advertisement_id;
  if (filters.status) params.status = filters.status;
  if (filters.outcome === '__blank__') params.outcome = '';
  else if (filters.outcome) params.outcome = filters.outcome;
  if (filters.assigned_to) params.assigned_to = filters.assigned_to;
  if (filters.include_archived) params.include_archived = true;
  if (opts?.includeInterval) params.interval = filters.interval;
  if (opts?.includePagination) {
    params.search = filters.search || undefined;
    params.ordering = filters.ordering || undefined;
    params.page = filters.page;
    params.page_size = filters.page_size;
  }
  return params;
}

const DEBOUNCE_MS = 350;

export function useMarketingReportFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [debounced, setDebounced] = useState(filters);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(filters), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filters]);

  const setFilters = useCallback(
    (patch: Partial<MarketingDashboardFilters>, options?: { replace?: boolean }) => {
      const next = { ...readFilters(searchParams), ...patch };
      // Reset page when core filters change (unless page itself is patched alone)
      if (
        !('page' in patch) &&
        Object.keys(patch).some((k) => k !== 'page' && k !== 'page_size')
      ) {
        next.page = 1;
      }
      setSearchParams(writeFilters(next), { replace: options?.replace ?? true });
    },
    [searchParams, setSearchParams]
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const setHierarchy = useCallback(
    (level: 'channel' | 'platform' | 'campaign' | 'adset' | 'advertisement', id: string) => {
      const patch: Partial<MarketingDashboardFilters> = {};
      if (level === 'channel') {
        patch.channel_id = id;
        patch.platform_id = '';
        patch.campaign_id = '';
        patch.adset_id = '';
        patch.advertisement_id = '';
      } else if (level === 'platform') {
        patch.platform_id = id;
        patch.campaign_id = '';
        patch.adset_id = '';
        patch.advertisement_id = '';
      } else if (level === 'campaign') {
        patch.campaign_id = id;
        patch.adset_id = '';
        patch.advertisement_id = '';
      } else if (level === 'adset') {
        patch.adset_id = id;
        patch.advertisement_id = '';
      } else {
        patch.advertisement_id = id;
      }
      setFilters(patch);
    },
    [setFilters]
  );

  return {
    filters,
    debouncedFilters: debounced,
    setFilters,
    resetFilters,
    setHierarchy,
    apiParams: filtersToApiParams(debounced),
    trendsParams: filtersToApiParams(debounced, { includeInterval: true }),
    campaignParams: filtersToApiParams(debounced, { includePagination: true }),
  };
}
