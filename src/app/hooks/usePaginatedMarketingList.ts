import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketingListParams, PaginatedResponse } from '@/app/lib/marketingTypes';

export type ActiveFilter = 'active' | 'inactive' | 'all';

export function toActiveQueryParams(filter: ActiveFilter): Partial<MarketingListParams> {
  if (filter === 'inactive') return { inactive: true };
  if (filter === 'all') return { include_inactive: true };
  return {};
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

type Fetcher<T> = (
  params: MarketingListParams,
  init: { signal: AbortSignal }
) => Promise<PaginatedResponse<T>>;

/**
 * Server-paginated Marketing list loader (useState/useEffect — no React Query).
 */
export function usePaginatedMarketingList<T>(
  fetcher: Fetcher<T>,
  params: MarketingListParams,
  enabled = true
) {
  const [data, setData] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const paramsKey = JSON.stringify(params);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const parsed = JSON.parse(paramsKey) as MarketingListParams;
        const res = await fetcherRef.current(parsed, { signal: controller.signal });
        if (cancelled) return;
        setData(res.results);
        setCount(res.count);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (cancelled) return;
        setError(err);
        setData([]);
        setCount(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [paramsKey, enabled, reloadToken]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return {
    data,
    count,
    loading,
    error,
    reload,
    pageSize,
    totalPages,
  };
}
