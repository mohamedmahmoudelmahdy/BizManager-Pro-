import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Pencil, Plus } from 'lucide-react';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingListToolbar } from '@/app/components/marketing/campaigns/MarketingListToolbar';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { ArchiveEntityDialog } from '@/app/components/marketing/campaigns/ArchiveEntityDialog';
import { PlatformFormDialog } from '@/app/components/marketing/campaigns/PlatformFormDialog';
import {
  MarketingActiveBadge,
  MarketingCode,
} from '@/app/components/marketing/campaigns/MarketingBadges';
import { Button } from '@/app/components/ui/button';
import { marketingChannelsApi, marketingPlatformsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingChannel, MarketingPlatform } from '@/app/lib/marketingTypes';
import {
  toActiveQueryParams,
  useDebouncedValue,
  usePaginatedMarketingList,
  type ActiveFilter,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

export function PlatformsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [ordering, setOrdering] = useState('name');
  const [channelFilter, setChannelFilter] = useState('');
  const [channels, setChannels] = useState<MarketingChannel[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MarketingPlatform | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MarketingPlatform | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter, ordering, channelFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await marketingChannelsApi.list({ ordering: 'name', page: 1 });
        if (!cancelled) setChannels(res.results);
      } catch {
        if (!cancelled) setChannels([]);
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
      channel: channelFilter || undefined,
      ...toActiveQueryParams(activeFilter),
    }),
    [page, debouncedSearch, ordering, channelFilter, activeFilter]
  );

  const fetcher = useCallback(
    (p: import('@/app/lib/marketingTypes').MarketingListParams, init: { signal: AbortSignal }) =>
      marketingPlatformsApi.list(p, init),
    []
  );

  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<MarketingPlatform>(fetcher, params);

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewPlatform}>
      <MarketingPageShell
        title={t('marketing.campaignManagement.platform.title')}
        description={t('marketing.campaignManagement.platform.description')}
        actions={
          perms.canAddPlatform ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 me-2" />
              {t('marketing.campaignManagement.platform.create')}
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
              { value: 'name', label: t('marketing.campaignManagement.sort.nameAsc') },
              { value: '-name', label: t('marketing.campaignManagement.sort.nameDesc') },
              { value: '-created_at', label: t('marketing.campaignManagement.sort.newest') },
            ]}
            filters={[
              {
                id: 'channel',
                label: t('marketing.campaignManagement.fields.channel'),
                value: channelFilter,
                onChange: setChannelFilter,
                options: [
                  { value: '', label: t('marketing.campaignManagement.filters.allChannels') },
                  ...channels.map((c) => ({ value: c.id, label: c.name })),
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
                debouncedSearch || channelFilter || activeFilter !== 'active'
                  ? t('marketing.campaignManagement.emptyFiltered')
                  : t('marketing.campaignManagement.platform.empty')
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
                        {t('marketing.campaignManagement.fields.channel')}
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
                        <td className="px-4 py-3 font-medium text-slate-900 break-words">{row.name}</td>
                        <td className="px-4 py-3">
                          <MarketingCode>{row.code}</MarketingCode>
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words">
                          {row.channel?.name ?? '—'}
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
                            {perms.canChangePlatform ? (
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
                            {perms.canChangePlatform && row.is_active ? (
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

        <PlatformFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={reload} />
        <PlatformFormDialog
          open={Boolean(editTarget)}
          platform={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={reload}
        />
        {archiveTarget ? (
          <ArchiveEntityDialog
            open
            entityName={archiveTarget.name}
            onClose={() => setArchiveTarget(null)}
            onSuccess={reload}
            archive={() => marketingPlatformsApi.archive(archiveTarget.id)}
          />
        ) : null}
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
