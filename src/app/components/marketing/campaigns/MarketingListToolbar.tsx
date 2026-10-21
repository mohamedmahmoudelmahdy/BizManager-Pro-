import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { ActiveFilter } from '@/app/hooks/usePaginatedMarketingList';

type FilterOption = { value: string; label: string };

type MarketingListToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  activeFilter?: ActiveFilter;
  onActiveFilterChange?: (value: ActiveFilter) => void;
  showActiveFilter?: boolean;
  filters?: Array<{
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: FilterOption[];
  }>;
  ordering?: string;
  onOrderingChange?: (value: string) => void;
  orderingOptions?: FilterOption[];
  actions?: React.ReactNode;
};

export function MarketingListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  activeFilter = 'active',
  onActiveFilterChange,
  showActiveFilter = true,
  filters = [],
  ordering,
  onOrderingChange,
  orderingOptions,
  actions,
}: MarketingListToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute start-3 top-2.5 size-4 text-slate-400" aria-hidden />
          <input
            className="w-full ps-9 pe-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            placeholder={searchPlaceholder ?? t('marketing.campaignManagement.search')}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label={searchPlaceholder ?? t('marketing.campaignManagement.search')}
          />
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {showActiveFilter && onActiveFilterChange ? (
          <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[8rem]">
            <span>{t('marketing.campaignManagement.filters.activeState')}</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
              value={activeFilter}
              onChange={(e) => onActiveFilterChange(e.target.value as ActiveFilter)}
            >
              <option value="active">{t('marketing.campaignManagement.filters.activeOnly')}</option>
              <option value="inactive">{t('marketing.campaignManagement.filters.inactiveOnly')}</option>
              <option value="all">{t('marketing.campaignManagement.filters.all')}</option>
            </select>
          </label>
        ) : null}

        {filters.map((filter) => (
          <label key={filter.id} className="flex flex-col gap-1 text-xs text-slate-500 min-w-[8rem]">
            <span>{filter.label}</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
            >
              {filter.options.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {orderingOptions && onOrderingChange ? (
          <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[8rem]">
            <span>{t('marketing.campaignManagement.filters.sort')}</span>
            <select
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
              value={ordering ?? ''}
              onChange={(e) => onOrderingChange(e.target.value)}
            >
              {orderingOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
