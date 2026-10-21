/**
 * Marketing Revenue Attribution (Phase 4.1).
 * Display-only formatting — all metrics come from the backend API.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingKpiCard, MarketingWidgetFrame } from '@/app/components/marketing/reports/MarketingReportWidgets';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { marketingRevenueApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import {
  formatMarketingCount,
  formatMarketingIsoDate,
  formatMarketingMoney,
  formatMarketingRatioPercent,
  formatMarketingRoas,
} from '@/app/lib/marketingFormat';
import type {
  RevenueAttributionFilterParams,
  RevenueCampaignRow,
  RevenueChannelRow,
  RevenueCustomerRow,
  RevenueLeadRow,
  RevenueOverviewReport,
  RevenuePaginated,
  RevenuePlatformRow,
  RevenueProcedureTypeRow,
} from '@/app/lib/marketingTypes';
import { marketingInputClass, marketingLabelClass } from '@/app/components/marketing/campaigns/marketingFormStyles';

function paramsFromSearch(sp: URLSearchParams): RevenueAttributionFilterParams {
  const get = (k: string) => sp.get(k) || undefined;
  return {
    date_from: get('date_from'),
    date_to: get('date_to'),
    conversion_date_from: get('conversion_date_from'),
    conversion_date_to: get('conversion_date_to'),
    channel_id: get('channel_id'),
    campaign_id: get('campaign_id'),
    search: get('search'),
    page: Number(sp.get('page') || 1) || 1,
    page_size: 20,
  };
}

export function RevenueAttributionPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => paramsFromSearch(searchParams), [searchParams]);

  const [overview, setOverview] = useState<RevenueOverviewReport | null>(null);
  const [channels, setChannels] = useState<RevenuePaginated<RevenueChannelRow> | null>(null);
  const [platforms, setPlatforms] = useState<RevenuePaginated<RevenuePlatformRow> | null>(null);
  const [campaigns, setCampaigns] = useState<RevenuePaginated<RevenueCampaignRow> | null>(null);
  const [leads, setLeads] = useState<RevenuePaginated<RevenueLeadRow> | null>(null);
  const [customers, setCustomers] = useState<RevenuePaginated<RevenueCustomerRow> | null>(null);
  const [procedureTypes, setProcedureTypes] = useState<RevenuePaginated<RevenueProcedureTypeRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [ov, ch, pl, cp, ld, cu, pt] = await Promise.all([
        marketingRevenueApi.overview(filters, { signal }),
        marketingRevenueApi.channels(filters, { signal }),
        marketingRevenueApi.platforms(filters, { signal }),
        marketingRevenueApi.campaigns(filters, { signal }),
        marketingRevenueApi.leads(filters, { signal }),
        marketingRevenueApi.customers(filters, { signal }),
        marketingRevenueApi.procedureTypes(filters, { signal }),
      ]);
      setOverview(ov);
      setChannels(ch);
      setPlatforms(pl);
      setCampaigns(cp);
      setLeads(ld);
      setCustomers(cu);
      setProcedureTypes(pt);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => setSearchParams({}, { replace: true });

  const s = overview?.summary;
  const unavailable = t('marketing.revenueAttribution.unavailable');

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewReport}>
      <MarketingPageShell
        title={t('marketing.revenueAttribution.title')}
        description={t('marketing.revenueAttribution.description')}
      >
        <section className="space-y-3 mb-6" aria-label={t('marketing.revenueAttribution.filters.title')}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-slate-600">{t('marketing.revenueAttribution.filters.hint')}</p>
            <button
              type="button"
              className="text-sm text-slate-700 underline"
              onClick={resetFilters}
            >
              {t('marketing.revenueAttribution.filters.reset')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block">
              <span className={marketingLabelClass}>{t('marketing.revenueAttribution.filters.dateFrom')}</span>
              <input
                type="date"
                className={marketingInputClass}
                value={filters.date_from || ''}
                onChange={(e) => setFilter('date_from', e.target.value)}
              />
            </label>
            <label className="block">
              <span className={marketingLabelClass}>{t('marketing.revenueAttribution.filters.dateTo')}</span>
              <input
                type="date"
                className={marketingInputClass}
                value={filters.date_to || ''}
                onChange={(e) => setFilter('date_to', e.target.value)}
              />
            </label>
            <label className="block">
              <span className={marketingLabelClass}>{t('marketing.revenueAttribution.filters.conversionFrom')}</span>
              <input
                type="date"
                className={marketingInputClass}
                value={filters.conversion_date_from || ''}
                onChange={(e) => setFilter('conversion_date_from', e.target.value)}
              />
            </label>
            <label className="block">
              <span className={marketingLabelClass}>{t('marketing.revenueAttribution.filters.conversionTo')}</span>
              <input
                type="date"
                className={marketingInputClass}
                value={filters.conversion_date_to || ''}
                onChange={(e) => setFilter('conversion_date_to', e.target.value)}
              />
            </label>
          </div>
        </section>

        {error ? (
          <MarketingErrorState
            message={formatMarketingErrorMessage(error, t)}
            onRetry={() => void load()}
          />
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-8" aria-label={t('marketing.revenueAttribution.kpis.title')}>
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.convertedCustomers')} value={formatMarketingCount(s?.converted_customers)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.procedures')} value={formatMarketingCount(s?.procedures)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.collectedRevenue')} value={formatMarketingMoney(s?.collected_revenue)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.netProfit')} value={formatMarketingMoney(s?.net_profit)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.campaignSpend')} value={formatMarketingMoney(s?.campaign_spend)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.marketingContribution')} value={formatMarketingMoney(s?.marketing_contribution)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.roas')} value={formatMarketingRoas(s?.roas)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.marketingRoi')} value={formatMarketingRatioPercent(s?.marketing_roi)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.cac')} value={formatMarketingMoney(s?.customer_acquisition_cost)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.avgCustomerRevenue')} value={formatMarketingMoney(s?.average_customer_revenue)} />
              <MarketingKpiCard loading={loading} label={t('marketing.revenueAttribution.kpis.avgCustomerNetProfit')} value={formatMarketingMoney(s?.average_customer_net_profit)} />
            </section>

            <div className="space-y-8">
              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.channels')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.channel'),
                    t('marketing.revenueAttribution.cols.customers'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.spend'),
                    t('marketing.revenueAttribution.cols.contribution'),
                  ]}
                  rows={(channels?.results || []).map((r) => [
                    r.channel?.name || '—',
                    formatMarketingCount(r.converted_customers),
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingMoney(r.campaign_spend),
                    formatMarketingMoney(r.marketing_contribution),
                  ])}
                />
              </MarketingWidgetFrame>

              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.platforms')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.platform'),
                    t('marketing.revenueAttribution.cols.channel'),
                    t('marketing.revenueAttribution.cols.customers'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.spend'),
                    t('marketing.revenueAttribution.cols.contribution'),
                  ]}
                  rows={(platforms?.results || []).map((r) => [
                    r.platform?.name || '—',
                    r.channel?.name || '—',
                    formatMarketingCount(r.converted_customers),
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingMoney(r.campaign_spend),
                    formatMarketingMoney(r.marketing_contribution),
                  ])}
                />
              </MarketingWidgetFrame>

              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.campaigns')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.campaign'),
                    t('marketing.revenueAttribution.cols.customers'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.spend'),
                    t('marketing.revenueAttribution.cols.roas'),
                  ]}
                  rows={(campaigns?.results || []).map((r) => [
                    r.campaign?.name || '—',
                    formatMarketingCount(r.converted_customers),
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingMoney(r.campaign_spend),
                    formatMarketingRoas(r.roas),
                  ])}
                />
              </MarketingWidgetFrame>

              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.leads')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.lead'),
                    t('marketing.revenueAttribution.cols.customer'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.procedures'),
                  ]}
                  rows={(leads?.results || []).map((r) => [
                    <Link key={r.lead.id} to={`/marketing/leads/${r.lead.id}`} className="text-blue-700 underline">
                      {r.lead.lead_number}
                    </Link>,
                    r.customer?.display_name || '—',
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingCount(r.procedures),
                  ])}
                />
              </MarketingWidgetFrame>

              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.customers')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.customer'),
                    t('marketing.revenueAttribution.cols.lead'),
                    t('marketing.revenueAttribution.cols.campaign'),
                    t('marketing.revenueAttribution.cols.convertedAt'),
                    t('marketing.revenueAttribution.cols.procedures'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.firstPayment'),
                    t('marketing.revenueAttribution.cols.latestPayment'),
                  ]}
                  rows={(customers?.results || []).map((r) => [
                    r.customer?.display_name || '—',
                    r.lead_id ? (
                      <Link key={r.lead_id} to={`/marketing/leads/${r.lead_id}`} className="text-blue-700 underline">
                        {r.lead_number}
                      </Link>
                    ) : (
                      r.lead_number || '—'
                    ),
                    r.campaign?.name || '—',
                    formatMarketingIsoDate(r.converted_at) || unavailable,
                    formatMarketingCount(r.procedures),
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingIsoDate(r.first_payment_at) || unavailable,
                    formatMarketingIsoDate(r.latest_payment_at) || unavailable,
                  ])}
                />
              </MarketingWidgetFrame>

              <MarketingWidgetFrame title={t('marketing.revenueAttribution.tables.procedureTypes')}>
                <RevenueSimpleTable
                  loading={loading}
                  empty={t('marketing.revenueAttribution.empty')}
                  columns={[
                    t('marketing.revenueAttribution.cols.procedureType'),
                    t('marketing.revenueAttribution.cols.procedures'),
                    t('marketing.revenueAttribution.cols.customers'),
                    t('marketing.revenueAttribution.cols.collectedRevenue'),
                    t('marketing.revenueAttribution.cols.netProfit'),
                    t('marketing.revenueAttribution.cols.avgNetProfit'),
                  ]}
                  rows={(procedureTypes?.results || []).map((r) => [
                    r.procedure_type || '—',
                    formatMarketingCount(r.procedure_count),
                    formatMarketingCount(r.customer_count),
                    formatMarketingMoney(r.collected_revenue),
                    formatMarketingMoney(r.net_profit),
                    formatMarketingMoney(r.average_net_profit),
                  ])}
                />
                {!loading && (procedureTypes?.results?.length ?? 0) > 0 ? (
                  <p className="text-xs text-slate-500 mt-2">
                    {t('marketing.revenueAttribution.procedureTypeRevenueNote')}
                  </p>
                ) : null}
              </MarketingWidgetFrame>
            </div>
          </>
        )}
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}

function RevenueSimpleTable({
  columns,
  rows,
  loading,
  empty,
}: {
  columns: string[];
  rows: React.ReactNode[][];
  loading?: boolean;
  empty: string;
}) {
  if (loading) {
    return <div className="h-24 rounded bg-slate-100 animate-pulse" aria-hidden />;
  }
  if (!rows.length) {
    return <p className="text-sm text-slate-500 py-4">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-start">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            {columns.map((c) => (
              <th key={c} className="py-2 pe-3 font-semibold text-start">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pe-3 align-top" dir={j > 0 ? 'ltr' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
