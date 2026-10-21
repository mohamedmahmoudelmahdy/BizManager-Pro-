/**
 * Isolated Marketing report fetch hook (useState/useEffect + AbortSignal).
 * No React Query. One failing widget does not affect others.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/app/lib/api';

type State<T> = {
  data: T | null;
  loading: boolean;
  error: unknown;
};

export function useMarketingReportQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  enabled = true
) {
  const [state, setState] = useState<State<T>>({ data: null, loading: enabled, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const retryKey = useRef(0);
  const [, bump] = useState(0);

  const retry = useCallback(() => {
    retryKey.current += 1;
    bump((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 0) return;
        setState({ data: null, loading: false, error: err });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps provided by caller
  }, [enabled, retryKey.current, ...deps]);

  return { ...state, retry };
}
