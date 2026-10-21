import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingListToolbar } from '@/app/components/marketing/campaigns/MarketingListToolbar';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { CampaignSpendFormDialog } from '@/app/components/marketing/campaigns/CampaignSpendFormDialog';
import { formatMarketingMoney } from '@/app/components/marketing/campaigns/marketingFormStyles';
import { Button } from '@/app/components/ui/button';
import { marketingCampaignSpendApi, marketingCampaignsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { CampaignSpend, MarketingCampaign } from '@/app/lib/marketingTypes';
import {
  useDebouncedValue,
  usePaginatedMarketingList,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

export function CampaignSpendPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState('-spend_date');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [dateAfter, setDateAfter] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CampaignSpend | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, ordering, campaignFilter, dateAfter, dateBefore]);

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

  const params = useMemo(
    () => ({
      page,
      search: debouncedSearch || undefined,
      ordering,
      campaign: campaignFilter || undefined,
      spend_date_after: dateAfter || undefined,
      spend_date_before: dateBefore || undefined,
    }),
    [page, debouncedSearch, ordering, campaignFilter, dateAfter, dateBefore]
  );

  const fetcher = useCallback(
    (p: import('@/app/lib/marketingTypes').MarketingListParams, init: { signal: AbortSignal }) =>
      marketingCampaignSpendApi.list(p, init),
    []
  );

  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<CampaignSpend>(fetcher, params);

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewCampaignSpend}>
      <MarketingPageShell
        title={t('marketing.campaignManagement.spend.title')}
        description={t('marketing.campaignManagement.spend.description')}
        actions={
          perms.canAddSpend ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 me-2" />
              {t('marketing.campaignManagement.spend.create')}
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
              { value: '-spend_date', label: t('marketing.campaignManagement.sort.spendNewest') },
              { value: 'spend_date', label: t('marketing.campaignManagement.sort.spendOldest') },
              { value: '-amount', label: t('marketing.campaignManagement.sort.amountDesc') },
              { value: 'amount', label: t('marketing.campaignManagement.sort.amountAsc') },
            ]}
            filters={[
              {
                id: 'campaign',
                label: t('marketing.campaignManagement.fields.campaign'),
                value: campaignFilter,
                onChange: setCampaignFilter,
                options: [
                  { value: '', label: t('marketing.campaignManagement.filters.allCampaigns') },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ],
              },
            ]}
            actions={
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  <span>{t('marketing.campaignManagement.filters.dateFrom')}</span>
                  <input
                    type="date"
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                    value={dateAfter}
                    onChange={(e) => setDateAfter(e.target.value)}
                    dir="ltr"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  <span>{t('marketing.campaignManagement.filters.dateTo')}</span>
                  <input
                    type="date"
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                    value={dateBefore}
                    onChange={(e) => setDateBefore(e.target.value)}
                    dir="ltr"
                  />
                </label>
              </div>
            }
          />

          {loading && data.length === 0 ? (
            <MarketingLoadingState />
          ) : error ? (
            <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={reload} />
          ) : data.length === 0 ? (
            <MarketingEmptyState
              message={
                debouncedSearch || campaignFilter || dateAfter || dateBefore
                  ? t('marketing.campaignManagement.emptyFiltered')
                  : t('marketing.campaignManagement.spend.empty')
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.spendDate')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.campaign')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.amount')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.description')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.expenseId')}
                      </th>
                      <th className="px-4 py-3 text-end font-semibold">
                        {t('marketing.campaignManagement.fields.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3" dir="ltr">
                          {row.spend_date}
                        </td>
                        <td className="px-4 py-3 text-slate-900 break-words">
                          {row.campaign?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-medium" dir="ltr">
                          {formatMarketingMoney(row.amount, row.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words max-w-xs">
                          {row.description || '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                          {row.expense_id || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {perms.canChangeSpend ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditTarget(row)}
                                aria-label={t('common.edit')}
                              >
                                <Pencil className="size-4" />
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

        <CampaignSpendFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={reload}
        />
        <CampaignSpendFormDialog
          open={Boolean(editTarget)}
          spend={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={reload}
        />
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
