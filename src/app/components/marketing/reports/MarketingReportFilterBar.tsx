import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AdSetSelect,
  AdvertisementSelect,
  CampaignSelect,
  ChannelSelect,
  PlatformSelect,
} from '@/app/components/marketing/campaigns/HierarchySelects';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import { Button } from '@/app/components/ui/button';
import { formatMarketingIsoDate } from '@/app/lib/marketingFormat';
import type { MarketingDashboardFilters } from '@/app/hooks/useMarketingReportFilters';
import { LEAD_STATUS_CODES, LEAD_OUTCOME_CODES } from '@/app/components/marketing/reports/reportEnums';

type Props = {
  filters: MarketingDashboardFilters;
  setFilters: (patch: Partial<MarketingDashboardFilters>) => void;
  setHierarchy: (
    level: 'channel' | 'platform' | 'campaign' | 'adset' | 'advertisement',
    id: string
  ) => void;
  resetFilters: () => void;
};

export function MarketingReportFilterBar({
  filters,
  setFilters,
  setHierarchy,
  resetFilters,
}: Props) {
  const { t } = useTranslation();

  const summaryParts = [
    `${formatMarketingIsoDate(filters.date_from)} – ${formatMarketingIsoDate(filters.date_to)}`,
    filters.include_archived ? t('marketing.dashboard.filters.includeArchived') : null,
    filters.status
      ? t(`marketing.leadManagement.status.${filters.status}`, { defaultValue: filters.status })
      : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {t('marketing.dashboard.filters.title')}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5" aria-live="polite">
            {t('marketing.dashboard.filters.summary')}: {summaryParts.join(' · ')}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
          {t('marketing.dashboard.filters.reset')}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor="rpt-date-from" className={marketingLabelClass}>
            {t('marketing.dashboard.filters.dateFrom')}
          </label>
          <input
            id="rpt-date-from"
            type="date"
            className={marketingInputClass}
            value={filters.date_from}
            onChange={(e) => setFilters({ date_from: e.target.value })}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="rpt-date-to" className={marketingLabelClass}>
            {t('marketing.dashboard.filters.dateTo')}
          </label>
          <input
            id="rpt-date-to"
            type="date"
            className={marketingInputClass}
            value={filters.date_to}
            onChange={(e) => setFilters({ date_to: e.target.value })}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="rpt-status" className={marketingLabelClass}>
            {t('marketing.leadManagement.fields.status')}
          </label>
          <select
            id="rpt-status"
            className={marketingInputClass}
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
          >
            <option value="">{t('marketing.leadManagement.filters.allStatuses')}</option>
            {LEAD_STATUS_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`marketing.leadManagement.status.${code}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rpt-outcome" className={marketingLabelClass}>
            {t('marketing.leadManagement.fields.outcome')}
          </label>
          <select
            id="rpt-outcome"
            className={marketingInputClass}
            value={filters.outcome}
            onChange={(e) => setFilters({ outcome: e.target.value })}
          >
            <option value="">{t('marketing.dashboard.filters.allOutcomes')}</option>
            <option value="__blank__">{t('marketing.dashboard.filters.noOutcome')}</option>
            {LEAD_OUTCOME_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`marketing.leadManagement.outcome.${code}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <ChannelSelect
          id="rpt-channel"
          label={t('marketing.leadManagement.fields.channel')}
          value={filters.channel_id}
          onChange={(v) => setHierarchy('channel', v)}
          allowClear
          extraParams={{ include_inactive: true }}
        />
        <PlatformSelect
          id="rpt-platform"
          label={t('marketing.leadManagement.fields.platform')}
          value={filters.platform_id}
          onChange={(v) => setHierarchy('platform', v)}
          allowClear
          disabled={!filters.channel_id}
          extraParams={{
            include_inactive: true,
            ...(filters.channel_id ? { channel: filters.channel_id } : {}),
          }}
        />
        <CampaignSelect
          id="rpt-campaign"
          label={t('marketing.leadManagement.fields.campaign')}
          value={filters.campaign_id}
          onChange={(v) => setHierarchy('campaign', v)}
          allowClear
          disabled={!filters.platform_id && !filters.channel_id}
          extraParams={{
            include_inactive: true,
            ...(filters.platform_id ? { platform: filters.platform_id } : {}),
            ...(filters.channel_id ? { channel: filters.channel_id } : {}),
          }}
        />
        <AdSetSelect
          id="rpt-adset"
          label={t('marketing.leadManagement.fields.adSet')}
          value={filters.adset_id}
          onChange={(v) => setHierarchy('adset', v)}
          allowClear
          disabled={!filters.campaign_id}
          extraParams={{
            include_inactive: true,
            ...(filters.campaign_id ? { campaign: filters.campaign_id } : {}),
          }}
        />
        <AdvertisementSelect
          id="rpt-ad"
          label={t('marketing.leadManagement.fields.advertisement')}
          value={filters.advertisement_id}
          onChange={(v) => setHierarchy('advertisement', v)}
          allowClear
          disabled={!filters.campaign_id}
          extraParams={{
            include_inactive: true,
            ...(filters.campaign_id ? { campaign: filters.campaign_id } : {}),
            ...(filters.adset_id ? { ad_set: filters.adset_id } : {}),
          }}
        />
        <div>
          <label htmlFor="rpt-assigned" className={marketingLabelClass}>
            {t('marketing.dashboard.filters.assignedTo')}
          </label>
          <input
            id="rpt-assigned"
            type="number"
            min={1}
            className={marketingInputClass}
            value={filters.assigned_to}
            onChange={(e) => setFilters({ assigned_to: e.target.value })}
            placeholder={t('marketing.dashboard.filters.assignedToHint')}
            dir="ltr"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={filters.include_archived}
          onChange={(e) => setFilters({ include_archived: e.target.checked })}
        />
        {t('marketing.dashboard.filters.includeArchived')}
      </label>
    </div>
  );
}
