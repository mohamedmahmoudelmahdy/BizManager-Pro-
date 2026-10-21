import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, Eye, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingListToolbar } from '@/app/components/marketing/campaigns/MarketingListToolbar';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { MarketingCode } from '@/app/components/marketing/campaigns/MarketingBadges';
import { LeadFormDialog } from '@/app/components/marketing/leads/LeadFormDialog';
import { LeadArchiveDialog } from '@/app/components/marketing/leads/LeadArchiveDialog';
import {
  formatUserLabel,
  LeadStatusBadge,
  leadStatusTone,
} from '@/app/components/marketing/leads/LeadBadges';
import { Button } from '@/app/components/ui/button';
import { marketingCampaignsApi, marketingLeadsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type {
  LeadDetail,
  LeadOutcome,
  LeadSummary,
  MarketingCampaign,
  MarketingListParams,
} from '@/app/lib/marketingTypes';
import {
  useDebouncedValue,
  usePaginatedMarketingList,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

const STATUSES = [
  '',
  'new',
  'contacted',
  'qualified',
  'assigned',
  'in_progress',
  'converted',
  'lost',
  'archived',
];

const OUTCOMES: Array<'' | LeadOutcome | '__blank__'> = [
  '',
  'interested',
  'not_interested',
  'no_answer',
  'wrong_number',
  'duplicate',
  'future_opportunity',
  '__blank__',
];

type ArchiveFilter = 'active' | 'archived' | 'all';

function formatContactedAt(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function LeadsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState('-created_at');
  const [statusFilter, setStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('active');
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LeadDetail | null>(null);
  const [editDetailLoading, setEditDetailLoading] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<LeadSummary | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, ordering, statusFilter, outcomeFilter, campaignFilter, archiveFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await marketingCampaignsApi.list({ ordering: 'name', page: 1 });
        if (!cancelled) setCampaigns(res.results);
      } catch {
        if (!cancelled) setCampaigns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const params = useMemo(() => {
    const p: MarketingListParams = {
      page,
      search: debouncedSearch || undefined,
      ordering,
      campaign: campaignFilter || undefined,
      status: statusFilter || undefined,
      outcome: outcomeFilter || undefined,
    };
    if (archiveFilter === 'archived') p.archived = true;
    if (archiveFilter === 'all') p.include_archived = true;
    return p;
  }, [
    page,
    debouncedSearch,
    ordering,
    campaignFilter,
    statusFilter,
    outcomeFilter,
    archiveFilter,
  ]);

  const fetcher = useCallback(
    (p: MarketingListParams, init: { signal: AbortSignal }) => marketingLeadsApi.list(p, init),
    []
  );

  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<LeadSummary>(fetcher, params);

  const openEdit = async (row: LeadSummary) => {
    setEditDetailLoading(true);
    try {
      setEditTarget(await marketingLeadsApi.get(row.id));
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setEditDetailLoading(false);
    }
  };

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewLead}>
      <MarketingPageShell
        title={t('marketing.leadManagement.title')}
        description={t('marketing.leadManagement.description')}
        actions={
          perms.canAddLead ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 me-2" />
              {t('marketing.leadManagement.create')}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <MarketingListToolbar
            search={search}
            onSearchChange={setSearch}
            showActiveFilter={false}
            ordering={ordering}
            onOrderingChange={setOrdering}
            orderingOptions={[
              { value: '-created_at', label: t('marketing.leadManagement.sort.newest') },
              { value: 'created_at', label: t('marketing.leadManagement.sort.oldest') },
              { value: 'lead_number', label: t('marketing.leadManagement.sort.numberAsc') },
              { value: 'status', label: t('marketing.leadManagement.sort.status') },
            ]}
            filters={[
              {
                id: 'status',
                label: t('marketing.leadManagement.fields.status'),
                value: statusFilter,
                onChange: setStatusFilter,
                options: STATUSES.map((s) => ({
                  value: s,
                  label: s
                    ? t(`marketing.leadManagement.status.${s}`)
                    : t('marketing.leadManagement.filters.allStatuses'),
                })),
              },
              {
                id: 'outcome',
                label: t('marketing.leadManagement.filters.outcome'),
                value: outcomeFilter,
                onChange: setOutcomeFilter,
                options: OUTCOMES.map((o) => ({
                  value: o,
                  label:
                    o === ''
                      ? t('marketing.leadManagement.filters.allOutcomes')
                      : o === '__blank__'
                        ? t('marketing.leadManagement.filters.noOutcome')
                        : t(`marketing.leadManagement.outcome.${o}`),
                })),
              },
              {
                id: 'campaign',
                label: t('marketing.leadManagement.fields.campaign'),
                value: campaignFilter,
                onChange: setCampaignFilter,
                options: [
                  { value: '', label: t('marketing.leadManagement.filters.allCampaigns') },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ],
              },
              {
                id: 'archive',
                label: t('marketing.leadManagement.filters.archiveState'),
                value: archiveFilter,
                onChange: (v) => setArchiveFilter(v as ArchiveFilter),
                options: [
                  { value: 'active', label: t('marketing.leadManagement.filters.activeOnly') },
                  { value: 'archived', label: t('marketing.leadManagement.filters.archivedOnly') },
                  { value: 'all', label: t('marketing.leadManagement.filters.all') },
                ],
              },
            ]}
          />

          {loading && data.length === 0 ? (
            <MarketingLoadingState />
          ) : error ? (
            <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={reload} />
          ) : data.length === 0 ? (
            <MarketingEmptyState
              message={
                debouncedSearch ||
                statusFilter ||
                outcomeFilter ||
                campaignFilter ||
                archiveFilter !== 'active'
                  ? t('marketing.leadManagement.emptyFiltered')
                  : t('marketing.leadManagement.empty')
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.leadNumber')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.name')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.phone')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.status')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.campaign')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.fields.outcome')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.leadManagement.columns.contactedBy')}
                      </th>
                      <th className="px-4 py-3 text-end font-semibold">
                        {t('marketing.leadManagement.fields.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            to={`/marketing/leads/${row.id}`}
                            className="inline-flex text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
                          >
                            <MarketingCode>{row.lead_number}</MarketingCode>
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 break-words max-w-[10rem]">
                          <Link
                            to={`/marketing/leads/${row.id}`}
                            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3" dir="ltr">
                          {row.raw_phone}
                        </td>
                        <td className="px-4 py-3">
                          <LeadStatusBadge
                            label={t(`marketing.leadManagement.status.${row.status}`, {
                              defaultValue: row.status,
                            })}
                            tone={leadStatusTone(row.status)}
                          />
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words">
                          {row.campaign?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.outcome
                            ? t(`marketing.leadManagement.outcome.${row.outcome}`, {
                                defaultValue: row.outcome,
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[9rem]">
                          {row.last_contacted_by ? (
                            <div className="min-w-0">
                              <div className="break-words font-medium text-slate-800">
                                {formatUserLabel(row.last_contacted_by)}
                              </div>
                              {row.last_contacted_at ? (
                                <time
                                  className="hidden sm:block text-xs text-slate-500 mt-0.5"
                                  dateTime={row.last_contacted_at}
                                >
                                  {formatContactedAt(row.last_contacted_at)}
                                </time>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              {t('marketing.leadManagement.empty.notContacted')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button type="button" variant="outline" size="sm" asChild>
                              <Link to={`/marketing/leads/${row.id}`}>
                                <Eye className="size-4 me-1.5" aria-hidden />
                                <span className="hidden sm:inline">
                                  {t('marketing.leads.actions.open')}
                                </span>
                                <span className="sm:hidden">{t('marketing.leads.actions.openShort')}</span>
                              </Link>
                            </Button>
                            {perms.canChangeLead &&
                            row.status !== 'archived' &&
                            row.status !== 'converted' ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={editDetailLoading}
                                onClick={() => openEdit(row)}
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                              >
                                <Pencil className="size-4" />
                                <span className="sr-only sm:not-sr-only sm:ms-1.5 sm:inline">
                                  {t('common.edit')}
                                </span>
                              </Button>
                            ) : null}
                            {perms.canChangeLead && row.status !== 'archived' ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setArchiveTarget(row)}
                                title={t('marketing.leadManagement.archive.confirm')}
                                aria-label={t('marketing.leadManagement.archive.confirm')}
                              >
                                <Archive className="size-4 text-rose-600" />
                                <span className="sr-only sm:not-sr-only sm:ms-1.5 sm:inline text-rose-700">
                                  {t('marketing.leads.actions.archive')}
                                </span>
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-3">
                <MarketingPaginationBar
                  page={page}
                  totalPages={totalPages}
                  count={count}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  loading={loading}
                />
              </div>
            </div>
          )}
        </div>

        <LeadFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={reload} />
        <LeadFormDialog
          open={Boolean(editTarget)}
          lead={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={reload}
        />
        {archiveTarget ? (
          <LeadArchiveDialog
            open
            leadId={archiveTarget.id}
            leadName={archiveTarget.name}
            leadNumber={archiveTarget.lead_number}
            onClose={() => setArchiveTarget(null)}
            onSuccess={reload}
          />
        ) : null}
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
