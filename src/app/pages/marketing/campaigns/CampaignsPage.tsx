import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, Eye, Pencil, Plus } from 'lucide-react';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingListToolbar } from '@/app/components/marketing/campaigns/MarketingListToolbar';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { ArchiveEntityDialog } from '@/app/components/marketing/campaigns/ArchiveEntityDialog';
import { CampaignFormDialog } from '@/app/components/marketing/campaigns/CampaignFormDialog';
import { formatMarketingMoney } from '@/app/components/marketing/campaigns/marketingFormStyles';
import {
  MarketingActiveBadge,
  MarketingCode,
} from '@/app/components/marketing/campaigns/MarketingBadges';
import { Button } from '@/app/components/ui/button';
import { marketingCampaignsApi, marketingPlatformsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingCampaign, MarketingPlatform } from '@/app/lib/marketingTypes';
import {
  toActiveQueryParams,
  useDebouncedValue,
  usePaginatedMarketingList,
  type ActiveFilter,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

const STATUS_OPTIONS = ['', 'draft', 'active', 'paused', 'completed', 'cancelled'];

export function CampaignsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [ordering, setOrdering] = useState('-created_at');
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [platforms, setPlatforms] = useState<MarketingPlatform[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MarketingCampaign | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MarketingCampaign | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter, ordering, platformFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await marketingPlatformsApi.list({ ordering: 'name', page: 1 });
        if (!cancelled) setPlatforms(res.results);
      } catch {
        if (!cancelled) setPlatforms([]);
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
      platform: platformFilter || undefined,
      status: statusFilter || undefined,
      ...toActiveQueryParams(activeFilter),
    }),
    [page, debouncedSearch, ordering, platformFilter, statusFilter, activeFilter]
  );

  const fetcher = useCallback(
    (p: import('@/app/lib/marketingTypes').MarketingListParams, init: { signal: AbortSignal }) =>
      marketingCampaignsApi.list(p, init),
    []
  );

  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<MarketingCampaign>(fetcher, params);

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewCampaign}>
      <MarketingPageShell
        title={t('marketing.campaignManagement.campaign.title')}
        description={t('marketing.campaignManagement.campaign.description')}
        actions={
          perms.canAddCampaign ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 me-2" />
              {t('marketing.campaignManagement.campaign.create')}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <MarketingListToolbar
            search={search}
            onSearchChange={setSearch}
            activeFilter={activeFilter}
            onActiveFilterChange={setActiveFilter}
            ordering={ordering}
            onOrderingChange={setOrdering}
            orderingOptions={[
              { value: '-created_at', label: t('marketing.campaignManagement.sort.newest') },
              { value: 'name', label: t('marketing.campaignManagement.sort.nameAsc') },
              { value: '-name', label: t('marketing.campaignManagement.sort.nameDesc') },
              { value: 'code', label: t('marketing.campaignManagement.sort.codeAsc') },
            ]}
            filters={[
              {
                id: 'platform',
                label: t('marketing.campaignManagement.fields.platform'),
                value: platformFilter,
                onChange: setPlatformFilter,
                options: [
                  { value: '', label: t('marketing.campaignManagement.filters.allPlatforms') },
                  ...platforms.map((p) => ({ value: p.id, label: p.name })),
                ],
              },
              {
                id: 'status',
                label: t('marketing.campaignManagement.fields.status'),
                value: statusFilter,
                onChange: setStatusFilter,
                options: STATUS_OPTIONS.map((s) => ({
                  value: s,
                  label: s
                    ? t(`marketing.campaignManagement.status.${s}`)
                    : t('marketing.campaignManagement.filters.allStatuses'),
                })),
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
                debouncedSearch || platformFilter || statusFilter || activeFilter !== 'active'
                  ? t('marketing.campaignManagement.emptyFiltered')
                  : t('marketing.campaignManagement.campaign.empty')
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.name')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.code')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.platform')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.channel')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.status')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.budget')}
                      </th>
                      <th className="px-4 py-3 text-start font-semibold">
                        {t('marketing.campaignManagement.fields.active')}
                      </th>
                      <th className="px-4 py-3 text-end font-semibold">
                        {t('marketing.campaignManagement.fields.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900 break-words max-w-[12rem]">
                          {row.name}
                        </td>
                        <td className="px-4 py-3">
                          <MarketingCode>{row.code}</MarketingCode>
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words">
                          {row.platform?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words">
                          {row.channel?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {t(`marketing.campaignManagement.status.${row.status}`, {
                            defaultValue: row.status,
                          })}
                        </td>
                        <td className="px-4 py-3" dir="ltr">
                          {formatMarketingMoney(row.budget, row.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <MarketingActiveBadge
                            active={row.is_active}
                            activeLabel={t('marketing.campaignManagement.active')}
                            inactiveLabel={t('marketing.campaignManagement.inactive')}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="sm" asChild>
                              <Link
                                to={`/marketing/campaigns/${row.id}`}
                                aria-label={t('common.view')}
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            {perms.canChangeCampaign ? (
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
                            {perms.canChangeCampaign && row.is_active ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setArchiveTarget(row)}
                                aria-label={t('marketing.campaignManagement.archive.confirm')}
                              >
                                <Archive className="size-4 text-rose-600" />
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

        <CampaignFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={reload} />
        <CampaignFormDialog
          open={Boolean(editTarget)}
          campaign={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={reload}
        />
        {archiveTarget ? (
          <ArchiveEntityDialog
            open
            entityName={archiveTarget.name}
            onClose={() => setArchiveTarget(null)}
            onSuccess={reload}
            archive={() => marketingCampaignsApi.archive(archiveTarget.id)}
          />
        ) : null}
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
