import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marketingApi, buildMarketingQuery } from '@/app/lib/marketingApi';
import type { MarketingListParams, NamedRefSummary, PaginatedResponse } from '@/app/lib/marketingTypes';
import { useDebouncedValue } from '@/app/hooks/usePaginatedMarketingList';
import type { SearchableComboboxOption } from '@/app/components/ui/searchable-combobox';

type OptionRow = NamedRefSummary & {
  code?: string;
  is_active?: boolean;
  lead_number?: string;
  name?: string;
  id?: string;
};

function defaultToOption(row: OptionRow): SearchableComboboxOption {
  const code = row.code ? ` (${row.code})` : '';
  const inactive = row.is_active === false ? ' [inactive]' : '';
  const name = row.name ?? '';
  return {
    value: String(row.id),
    label: `${name}${code}${inactive}`,
    searchText: `${name} ${row.code ?? ''} ${row.lead_number ?? ''}`,
  };
}

export function useHierarchyOptions(opts: {
  listPath: string;
  enabled?: boolean;
  extraParams?: MarketingListParams;
  selectedId?: string;
  selectedLabel?: string;
  getPath?: (id: string) => string;
  ordering?: string;
  mapOption?: (row: Record<string, unknown>) => SearchableComboboxOption;
}) {
  const {
    listPath,
    enabled = true,
    extraParams,
    selectedId,
    selectedLabel,
    getPath,
    ordering = 'name',
    mapOption,
  } = opts;
  const mapOptionRef = useRef(mapOption);
  mapOptionRef.current = mapOption;
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [options, setOptions] = useState<SearchableComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);

  const extraKey = JSON.stringify(extraParams ?? {});

  const load = useCallback(async () => {
    if (!enabled) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const params: MarketingListParams = {
        ...(JSON.parse(extraKey) as MarketingListParams),
        search: debouncedSearch || undefined,
        ordering,
        page: 1,
      };
      const res = await marketingApi.get<PaginatedResponse<OptionRow>>(
        `${listPath}${buildMarketingQuery(params)}`
      );
      const mapper = mapOptionRef.current
        ? (row: OptionRow) => mapOptionRef.current!(row as unknown as Record<string, unknown>)
        : defaultToOption;
      let next = res.results.map(mapper);

      if (selectedId && !next.some((o) => o.value === selectedId)) {
        if (getPath) {
          try {
            const row = await marketingApi.get<OptionRow>(getPath(selectedId));
            next = [mapper(row), ...next];
          } catch {
            if (selectedLabel) {
              next = [{ value: selectedId, label: selectedLabel }, ...next];
            }
          }
        } else if (selectedLabel) {
          next = [{ value: selectedId, label: selectedLabel }, ...next];
        }
      }

      setOptions(next);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setOptions(
        selectedId && selectedLabel ? [{ value: selectedId, label: selectedLabel }] : []
      );
    } finally {
      setLoading(false);
    }
  }, [
    enabled,
    listPath,
    extraKey,
    debouncedSearch,
    selectedId,
    selectedLabel,
    getPath,
    ordering,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return useMemo(
    () => ({
      options,
      loading,
      search,
      setSearch,
      reload: load,
    }),
    [options, loading, search, load]
  );
}
