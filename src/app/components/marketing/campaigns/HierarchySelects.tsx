import React from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableCombobox } from '@/app/components/ui/searchable-combobox';
import { useHierarchyOptions } from '@/app/hooks/useHierarchyOptions';
import { marketingPaths } from '@/app/lib/marketingApi';
import { marketingLabelClass } from '@/app/components/marketing/campaigns/marketingFormStyles';
import type { MarketingListParams } from '@/app/lib/marketingTypes';

type BaseSelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  extraParams?: MarketingListParams;
};

function HierarchySelect({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  allowClear,
  selectedLabel,
  listPath,
  getPath,
  extraParams,
}: BaseSelectProps & { listPath: string; getPath: (id: string) => string }) {
  const { t } = useTranslation();
  const { options, loading, setSearch } = useHierarchyOptions({
    listPath,
    getPath,
    selectedId: value || undefined,
    selectedLabel,
    extraParams,
    enabled: !disabled,
  });

  return (
    <div>
      <label htmlFor={id} className={marketingLabelClass}>
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <SearchableCombobox
            id={id}
            value={value}
            onValueChange={onChange}
            options={options}
            disabled={disabled || loading}
            filterMode="server"
            onSearchChange={setSearch}
            placeholder={
              loading
                ? t('marketing.campaignManagement.select.loading')
                : t('marketing.campaignManagement.select.placeholder')
            }
            searchPlaceholder={t('marketing.campaignManagement.select.search')}
            emptyText={t('marketing.campaignManagement.select.empty')}
            ariaLabel={label}
            textAlign="left"
            popoverModal
          />
        </div>
        {allowClear && value ? (
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline px-2 shrink-0"
            onClick={() => onChange('')}
          >
            {t('marketing.campaignManagement.select.clear')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ChannelSelect(props: BaseSelectProps) {
  return (
    <HierarchySelect
      {...props}
      listPath={marketingPaths.channels}
      getPath={marketingPaths.channel}
    />
  );
}

export function PlatformSelect(props: BaseSelectProps) {
  return (
    <HierarchySelect
      {...props}
      listPath={marketingPaths.platforms}
      getPath={marketingPaths.platform}
    />
  );
}

export function CampaignSelect(props: BaseSelectProps) {
  return (
    <HierarchySelect
      {...props}
      listPath={marketingPaths.campaigns}
      getPath={marketingPaths.campaign}
    />
  );
}

export function AdSetSelect(props: BaseSelectProps) {
  return (
    <HierarchySelect
      {...props}
      listPath={marketingPaths.adsets}
      getPath={marketingPaths.adset}
    />
  );
}

export function AdvertisementSelect(props: BaseSelectProps) {
  return (
    <HierarchySelect
      {...props}
      listPath={marketingPaths.advertisements}
      getPath={marketingPaths.advertisement}
    />
  );
}
