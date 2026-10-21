/**
 * Marketing CRM Dashboard / Reports workspace (Phase 3.3B).
 * Presentation layer only — metrics from Phase 3.3A reporting APIs.
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { MarketingReportFilterBar } from '@/app/components/marketing/reports/MarketingReportFilterBar';
import {
  MarketingBarChart,
  MarketingLineChart,
  MarketingPieChart,
} from '@/app/components/marketing/reports/MarketingCharts';
import {
  MarketingKpiCard,
  MarketingWidgetFrame,
} from '@/app/components/marketing/reports/MarketingReportWidgets';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { useMarketingReportFilters } from '@/app/hooks/useMarketingReportFilters';
import { useMarketingReportQuery } from '@/app/hooks/useMarketingReportQuery';
import { marketingReportsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import {
  formatMarketingCount,
  formatMarketingHours,
  formatMarketingMoney,
  formatMarketingRatioPercent,
} from '@/app/lib/marketingFormat';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import type { ReportingInterval } from '@/app/lib/marketingTypes';

function localizeStatus(code: string | null, t: ReturnType<typeof useTranslation>['t']) {
  if (!code) return t('marketing.dashboard.filters.noOutcome');
  return t(`marketing.leadManagement.status.${code}`, { defaultValue: code });
}

function localizeOutcome(code: string | null, t: ReturnType<typeof useTranslation>['t']) {
  if (!code) return t('marketing.dashboard.filters.noOutcome');
  return t(`marketing.leadManagement.outcome.${code}`, { defaultValue: code });
}

type DashboardMode = 'dashboard' | 'reports';

export function MarketingDashboardPage({ mode = 'dashboard' }: { mode?: DashboardMode }) {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const {
    filters,
    debouncedFilters,
    setFilters,
    resetFilters,
    setHierarchy,
    apiParams,
    trendsParams,
    campaignParams,
  } = useMarketingReportFilters();

  const canOverview = perms.canViewDashboard || perms.canViewReports;
  const canDetailed = perms.canViewReports;

  const overviewQuery = useMarketingReportQuery(
    (signal) => marketingReportsApi.overview(apiParams, { signal }),
    [JSON.stringify(apiParams)],
    canOverview
  );

  const trendsQuery = useMarketingReportQuery(
    (signal) => marketingReportsApi.leadTrends(trendsParams, { signal }),
    [JSON.stringify(trendsParams)],
    canDetailed
  );

  const campaignQuery = useMarketingReportQuery(
    (signal) => marketingReportsApi.campaignPerformance(campaignParams, { signal }),
    [JSON.stringify(campaignParams)],
    canDetailed
  );

  const followupQuery = useMarketingReportQuery(
    (signal) => marketingReportsApi.followupWorkload(apiParams, { signal }),
    [JSON.stringify(apiParams)],
    canDetailed
  );

  const assignmentQuery = useMarketingReportQuery(
    (signal) => marketingReportsApi.assignmentWorkload(apiParams, { signal }),
    [JSON.stringify(apiParams)],
    canDetailed
  );

  const overview = overviewQuery.data;
  const title =
    mode === 'reports'
      ? t('marketing.pages.reports.title')
      : t('marketing.pages.dashboard.title');
  const description =
    mode === 'reports'
      ? t('marketing.pages.reports.description')
      : t('marketing.pages.dashboard.description');

  const statusChartData = useMemo(() => {
    if (!overview) return [];
    return overview.breakdowns.status.map((row) => ({
      label: localizeStatus(row.code, t),
      count: row.count,
      code: row.code ?? 'null',
    }));
  }, [overview, t]);

  const outcomeChartData = useMemo(() => {
    if (!overview) return [];
    return overview.breakdowns.outcome.map((row) => ({
      label: localizeOutcome(row.code, t),
      count: row.count,
      code: row.code ?? 'null',
    }));
  }, [overview, t]);

  const trendSeries = useMemo(() => {
    if (!trendsQuery.data) return [];
    return trendsQuery.data.series.map((p) => ({
      period: p.period,
      created: p.created,
      converted: p.converted,
      lost: p.lost,
    }));
  }, [trendsQuery.data]);

  const guardAnyOf =
    mode === 'reports'
      ? [MARKETING_PERMISSIONS.viewReport]
      : [MARKETING_PERMISSIONS.viewDashboard, MARKETING_PERMISSIONS.viewReport];

  return (
    <MarketingPermissionGuard anyOf={guardAnyOf}>
      <MarketingPageShell title={title} description={description}>
        <div className="space-y-6">
          <MarketingReportFilterBar
            filters={filters}
            setFilters={setFilters}
            setHierarchy={setHierarchy}
            resetFilters={resetFilters}
          />

          {/* KPI cards from overview */}
          <section aria-labelledby="mkt-kpi-heading">
            <h2 id="mkt-kpi-heading" className="sr-only">
              {t('marketing.dashboard.kpis.title')}
            </h2>
            {overviewQuery.error ? (
              <MarketingErrorState
                message={formatMarketingErrorMessage(overviewQuery.error, t)}
                onRetry={overviewQuery.retry}
              />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.totalLeads')}
                  value={formatMarketingCount(overview?.leads.total)}
                  loading={overviewQuery.loading}
                  hint={t('marketing.dashboard.kpis.totalLeadsHint')}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.activeLeads')}
                  value={formatMarketingCount(overview?.leads.active)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.convertedCohort')}
                  value={formatMarketingCount(overview?.leads.converted_cohort)}
                  loading={overviewQuery.loading}
                  hint={t('marketing.dashboard.kpis.convertedCohortHint')}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.conversionEvents')}
                  value={formatMarketingCount(overview?.leads.conversion_events)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.lost')}
                  value={formatMarketingCount(overview?.leads.lost)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.conversionRate')}
                  value={formatMarketingRatioPercent(overview?.leads.conversion_rate)}
                  loading={overviewQuery.loading}
                  hint={t('marketing.dashboard.kpis.conversionRateHint')}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.avgTimeToConversion')}
                  value={
                    overview?.leads.average_time_to_conversion_hours != null
                      ? t('marketing.dashboard.kpis.hoursValue', {
                          value: formatMarketingHours(
                            overview.leads.average_time_to_conversion_hours
                          ),
                        })
                      : '—'
                  }
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.totalSpend')}
                  value={formatMarketingMoney(overview?.spend.total)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.costPerLead')}
                  value={formatMarketingMoney(overview?.spend.cost_per_lead)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.costPerConversion')}
                  value={formatMarketingMoney(overview?.spend.cost_per_conversion)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.pendingFollowups')}
                  value={formatMarketingCount(overview?.followups.pending)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.overdueFollowups')}
                  value={formatMarketingCount(overview?.followups.overdue)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.activeAssignments')}
                  value={formatMarketingCount(overview?.assignments.active_total)}
                  loading={overviewQuery.loading}
                />
                <MarketingKpiCard
                  label={t('marketing.dashboard.kpis.unassignedLeads')}
                  value={formatMarketingCount(overview?.assignments.unassigned_leads)}
                  loading={overviewQuery.loading}
                />
              </div>
            )}
          </section>

          {/* Status + Outcome */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MarketingWidgetFrame
              title={t('marketing.dashboard.statusBreakdown.title')}
              description={t('marketing.dashboard.statusBreakdown.description')}
            >
              {overviewQuery.loading ? (
                <MarketingLoadingState />
              ) : overviewQuery.error ? (
                <MarketingErrorState
                  message={formatMarketingErrorMessage(overviewQuery.error, t)}
                  onRetry={overviewQuery.retry}
                />
              ) : statusChartData.every((r) => r.count === 0) ? (
                <MarketingEmptyState message={t('marketing.dashboard.empty.breakdown')} />
              ) : (
                <MarketingPieChart
                  data={statusChartData}
                  ariaLabel={t('marketing.dashboard.statusBreakdown.title')}
                  description={t('marketing.dashboard.statusBreakdown.a11y')}
                />
              )}
            </MarketingWidgetFrame>

            <MarketingWidgetFrame
              title={t('marketing.dashboard.outcomeBreakdown.title')}
              description={t('marketing.dashboard.outcomeBreakdown.description')}
            >
              {overviewQuery.loading ? (
                <MarketingLoadingState />
              ) : overviewQuery.error ? (
                <MarketingErrorState
                  message={formatMarketingErrorMessage(overviewQuery.error, t)}
                  onRetry={overviewQuery.retry}
                />
              ) : outcomeChartData.every((r) => r.count === 0) ? (
                <MarketingEmptyState message={t('marketing.dashboard.empty.breakdown')} />
              ) : (
                <MarketingBarChart
                  data={outcomeChartData}
                  series={[
                    {
                      dataKey: 'count',
                      name: t('marketing.dashboard.charts.count'),
                      color: '#0369a1',
                    },
                  ]}
                  ariaLabel={t('marketing.dashboard.outcomeBreakdown.title')}
                  description={t('marketing.dashboard.outcomeBreakdown.a11y')}
                />
              )}
            </MarketingWidgetFrame>
          </div>

          {/* Detailed report widgets — require view_marketing_report */}
          {canDetailed ? (
            <>
              <MarketingWidgetFrame
                title={t('marketing.dashboard.leadTrends.title')}
                description={t('marketing.dashboard.leadTrends.description')}
                actions={
                  <div>
                    <label htmlFor="rpt-interval" className="sr-only">
                      {t('marketing.dashboard.leadTrends.interval')}
                    </label>
                    <select
                      id="rpt-interval"
                      className={`${marketingInputClass} w-auto min-w-[8rem]`}
                      value={filters.interval}
                      onChange={(e) =>
                        setFilters({ interval: e.target.value as ReportingInterval })
                      }
                    >
                      <option value="day">{t('marketing.dashboard.intervals.day')}</option>
                      <option value="week">{t('marketing.dashboard.intervals.week')}</option>
                      <option value="month">{t('marketing.dashboard.intervals.month')}</option>
                    </select>
                  </div>
                }
              >
                {trendsQuery.loading ? (
                  <MarketingLoadingState />
                ) : trendsQuery.error ? (
                  <MarketingErrorState
                    message={formatMarketingErrorMessage(trendsQuery.error, t)}
                    onRetry={trendsQuery.retry}
                  />
                ) : trendSeries.length === 0 ? (
                  <MarketingEmptyState message={t('marketing.dashboard.empty.trends')} />
                ) : (
                  <MarketingLineChart
                    data={trendSeries}
                    series={[
                      {
                        dataKey: 'created',
                        name: t('marketing.dashboard.leadTrends.created'),
                        color: '#0f766e',
                      },
                      {
                        dataKey: 'converted',
                        name: t('marketing.dashboard.leadTrends.converted'),
                        color: '#0369a1',
                      },
                      {
                        dataKey: 'lost',
                        name: t('marketing.dashboard.leadTrends.lost'),
                        color: '#be123c',
                      },
                    ]}
                    ariaLabel={t('marketing.dashboard.leadTrends.title')}
                    description={t('marketing.dashboard.leadTrends.a11y')}
                  />
                )}
              </MarketingWidgetFrame>

              <CampaignPerformanceSection
                loading={campaignQuery.loading}
                error={campaignQuery.error}
                onRetry={campaignQuery.retry}
                data={campaignQuery.data}
                filters={filters}
                setFilters={setFilters}
              />

              <FollowupWorkloadSection
                loading={followupQuery.loading}
                error={followupQuery.error}
                onRetry={followupQuery.retry}
                data={followupQuery.data}
                canViewFollowUps={perms.canViewFollowUps}
              />

              <AssignmentWorkloadSection
                loading={assignmentQuery.loading}
                error={assignmentQuery.error}
                onRetry={assignmentQuery.retry}
                data={assignmentQuery.data}
              />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm text-slate-600">
                {t('marketing.dashboard.reportsGated')}
              </p>
            </div>
          )}

          {/* Debounce indicator for screen readers */}
          <p className="sr-only" aria-live="polite">
            {JSON.stringify(debouncedFilters.date_from)}
          </p>
        </div>
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}

function CampaignPerformanceSection({
  loading,
  error,
  onRetry,
  data,
  filters,
  setFilters,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  data: Awaited<ReturnType<typeof marketingReportsApi.campaignPerformance>> | null;
  filters: ReturnType<typeof useMarketingReportFilters>['filters'];
  setFilters: ReturnType<typeof useMarketingReportFilters>['setFilters'];
}) {
  const { t } = useTranslation();
  const pageCount = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;

  return (
    <MarketingWidgetFrame
      title={t('marketing.dashboard.campaignPerformance.title')}
      description={t('marketing.dashboard.campaignPerformance.description')}
      actions={
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label htmlFor="rpt-camp-search" className={marketingLabelClass}>
              {t('marketing.dashboard.campaignPerformance.search')}
            </label>
            <input
              id="rpt-camp-search"
              className={`${marketingInputClass} min-w-[10rem]`}
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              placeholder={t('marketing.dashboard.campaignPerformance.searchPlaceholder')}
            />
          </div>
          <div>
            <label htmlFor="rpt-camp-order" className={marketingLabelClass}>
              {t('marketing.dashboard.campaignPerformance.ordering')}
            </label>
            <select
              id="rpt-camp-order"
              className={marketingInputClass}
              value={filters.ordering}
              onChange={(e) => setFilters({ ordering: e.target.value })}
            >
              <option value="campaign_name">{t('marketing.dashboard.campaignPerformance.sort.nameAsc')}</option>
              <option value="-campaign_name">{t('marketing.dashboard.campaignPerformance.sort.nameDesc')}</option>
              <option value="-leads_created">{t('marketing.dashboard.campaignPerformance.sort.leadsDesc')}</option>
              <option value="-converted_leads">{t('marketing.dashboard.campaignPerformance.sort.convertedDesc')}</option>
              <option value="-spend">{t('marketing.dashboard.campaignPerformance.sort.spendDesc')}</option>
              <option value="-conversion_rate">{t('marketing.dashboard.campaignPerformance.sort.rateDesc')}</option>
            </select>
          </div>
        </div>
      }
    >
      {loading ? (
        <MarketingLoadingState />
      ) : error ? (
        <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={onRetry} />
      ) : !data || data.results.length === 0 ? (
        <MarketingEmptyState message={t('marketing.dashboard.empty.campaigns')} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs font-semibold text-slate-500">
                  <th className="py-2 pe-3 text-start">{t('marketing.dashboard.campaignPerformance.cols.campaign')}</th>
                  <th className="py-2 pe-3 text-start">{t('marketing.dashboard.campaignPerformance.cols.platform')}</th>
                  <th className="py-2 pe-3 text-start">{t('marketing.dashboard.campaignPerformance.cols.channel')}</th>
                  <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.leads')}</th>
                  <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.converted')}</th>
                  <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.rate')}</th>
                  <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.spend')}</th>
                  <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.cpl')}</th>
                  <th className="py-2 text-end" dir="ltr">{t('marketing.dashboard.campaignPerformance.cols.cpc')}</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.campaign_id} className="border-b border-slate-100">
                    <td className="py-2.5 pe-3">
                      <div className="font-medium text-slate-900 break-words">{row.campaign_name}</div>
                      <div className="text-xs text-slate-500" dir="ltr">{row.campaign_code}</div>
                    </td>
                    <td className="py-2.5 pe-3 text-slate-700">{row.platform.name}</td>
                    <td className="py-2.5 pe-3 text-slate-700">{row.channel.name}</td>
                    <td className="py-2.5 pe-3 text-end tabular-nums" dir="ltr">
                      {formatMarketingCount(row.leads_created)}
                    </td>
                    <td className="py-2.5 pe-3 text-end tabular-nums" dir="ltr">
                      {formatMarketingCount(row.converted_leads)}
                    </td>
                    <td className="py-2.5 pe-3 text-end tabular-nums" dir="ltr">
                      {formatMarketingRatioPercent(row.conversion_rate)}
                    </td>
                    <td className="py-2.5 pe-3 text-end tabular-nums" dir="ltr">
                      {formatMarketingMoney(row.spend)}
                    </td>
                    <td className="py-2.5 pe-3 text-end tabular-nums" dir="ltr">
                      {formatMarketingMoney(row.cost_per_lead)}
                    </td>
                    <td className="py-2.5 text-end tabular-nums" dir="ltr">
                      {formatMarketingMoney(row.cost_per_conversion)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MarketingPaginationBar
            page={data.page}
            totalPages={pageCount}
            count={data.count}
            pageSize={data.page_size}
            onPageChange={(page) => setFilters({ page })}
          />
        </>
      )}
    </MarketingWidgetFrame>
  );
}

function FollowupWorkloadSection({
  loading,
  error,
  onRetry,
  data,
  canViewFollowUps,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  data: Awaited<ReturnType<typeof marketingReportsApi.followupWorkload>> | null;
  canViewFollowUps: boolean;
}) {
  const { t } = useTranslation();
  return (
    <MarketingWidgetFrame
      title={t('marketing.dashboard.followupWorkload.title')}
      description={t('marketing.dashboard.followupWorkload.description')}
      actions={
        canViewFollowUps ? (
          <Link to="/marketing/followups" className="text-xs font-medium text-slate-700 underline">
            {t('marketing.dashboard.followupWorkload.openList')}
          </Link>
        ) : null
      }
    >
      {loading ? (
        <MarketingLoadingState />
      ) : error ? (
        <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={onRetry} />
      ) : !data ? (
        <MarketingEmptyState message={t('marketing.dashboard.empty.followups')} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.pending')} value={formatMarketingCount(data.summary.pending)} />
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.completed')} value={formatMarketingCount(data.summary.completed)} />
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.cancelled')} value={formatMarketingCount(data.summary.cancelled)} />
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.overdue')} value={formatMarketingCount(data.summary.overdue)} />
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.dueToday')} value={formatMarketingCount(data.summary.due_today)} />
            <MarketingKpiCard label={t('marketing.dashboard.followupWorkload.next7')} value={formatMarketingCount(data.summary.due_next_7_days)} />
          </div>
          {data.by_assignee.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2 pe-3 text-start">{t('marketing.dashboard.followupWorkload.cols.user')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.followupWorkload.cols.pending')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.followupWorkload.cols.overdue')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.followupWorkload.cols.completed')}</th>
                    <th className="py-2 text-end" dir="ltr">{t('marketing.dashboard.followupWorkload.cols.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_assignee.map((row) => (
                    <tr key={row.user_id} className="border-b border-slate-100">
                      <td className="py-2 pe-3">{row.display_name}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.pending}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.overdue}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.completed}</td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </MarketingWidgetFrame>
  );
}

function AssignmentWorkloadSection({
  loading,
  error,
  onRetry,
  data,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  data: Awaited<ReturnType<typeof marketingReportsApi.assignmentWorkload>> | null;
}) {
  const { t } = useTranslation();
  return (
    <MarketingWidgetFrame
      title={t('marketing.dashboard.assignmentWorkload.title')}
      description={t('marketing.dashboard.assignmentWorkload.description')}
    >
      {loading ? (
        <MarketingLoadingState />
      ) : error ? (
        <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={onRetry} />
      ) : !data ? (
        <MarketingEmptyState message={t('marketing.dashboard.empty.assignments')} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <MarketingKpiCard label={t('marketing.dashboard.assignmentWorkload.unassigned')} value={formatMarketingCount(data.summary.unassigned_leads)} />
            <MarketingKpiCard label={t('marketing.dashboard.assignmentWorkload.pending')} value={formatMarketingCount(data.summary.pending)} />
            <MarketingKpiCard label={t('marketing.dashboard.assignmentWorkload.accepted')} value={formatMarketingCount(data.summary.accepted)} />
            <MarketingKpiCard label={t('marketing.dashboard.assignmentWorkload.active')} value={formatMarketingCount(data.summary.active_total)} />
            <MarketingKpiCard label={t('marketing.dashboard.assignmentWorkload.completedInRange')} value={formatMarketingCount(data.summary.completed_in_range)} />
          </div>
          {data.by_assignee.length === 0 ? (
            <MarketingEmptyState message={t('marketing.dashboard.empty.assignees')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2 pe-3 text-start">{t('marketing.dashboard.assignmentWorkload.cols.user')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.assignmentWorkload.cols.pending')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.assignmentWorkload.cols.accepted')}</th>
                    <th className="py-2 pe-3 text-end" dir="ltr">{t('marketing.dashboard.assignmentWorkload.cols.active')}</th>
                    <th className="py-2 text-end" dir="ltr">{t('marketing.dashboard.assignmentWorkload.cols.completed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_assignee.map((row) => (
                    <tr key={row.user_id} className="border-b border-slate-100">
                      <td className="py-2 pe-3">{row.display_name}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.pending}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.accepted}</td>
                      <td className="py-2 pe-3 text-end tabular-nums" dir="ltr">{row.active_total}</td>
                      <td className="py-2 text-end tabular-nums" dir="ltr">{row.completed_in_range}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </MarketingWidgetFrame>
  );
}
