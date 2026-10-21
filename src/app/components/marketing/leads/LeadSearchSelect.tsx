/**
 * Shared lead picker for Marketing operational dialogs (server search).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableCombobox } from '@/app/components/ui/searchable-combobox';
import { marketingLabelClass } from '@/app/components/marketing/campaigns/marketingFormStyles';
import { useHierarchyOptions } from '@/app/hooks/useHierarchyOptions';
import { marketingPaths } from '@/app/lib/marketingApi';

type LeadSearchSelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  selectedLabel?: string;
  disabled?: boolean;
  required?: boolean;
};

export function LeadSearchSelect({
  id,
  label,
  value,
  onChange,
  selectedLabel,
  disabled,
  required,
}: LeadSearchSelectProps) {
  const { t } = useTranslation();
  const { options, loading, setSearch } = useHierarchyOptions({
    listPath: marketingPaths.leads,
    getPath: marketingPaths.lead,
    selectedId: value || undefined,
    selectedLabel,
    enabled: !disabled,
    ordering: '-created_at',
    mapOption: (row) => ({
      value: String(row.id),
      label: `${row.lead_number ?? ''} — ${row.name ?? ''}`.trim(),
      searchText: `${row.lead_number ?? ''} ${row.name ?? ''} ${row.raw_phone ?? ''}`,
    }),
  });

  return (
    <div>
      <label htmlFor={id} className={marketingLabelClass}>
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
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
            : t('marketing.followups.selectLead')
        }
        searchPlaceholder={t('marketing.campaignManagement.select.search')}
        emptyText={t('marketing.campaignManagement.select.empty')}
        ariaLabel={label}
        textAlign="left"
        popoverModal
      />
    </div>
  );
}
