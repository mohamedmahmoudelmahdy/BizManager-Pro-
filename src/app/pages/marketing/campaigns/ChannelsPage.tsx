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
import { ChannelFormDialog } from '@/app/components/marketing/campaigns/ChannelFormDialog';
import {
  MarketingActiveBadge,
  MarketingCode,
} from '@/app/components/marketing/campaigns/MarketingBadges';
import { Button } from '@/app/components/ui/button';
import { marketingChannelsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { MarketingChannel } from '@/app/lib/marketingTypes';
import {
  toActiveQueryParams,
  useDebouncedValue,
  usePaginatedMarketingList,
  type ActiveFilter,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';

export function ChannelsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [ordering, setOrdering] = useState('name');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MarketingChannel | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MarketingChannel | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter, ordering]);

  const params = useMemo(
    () => ({
      page,
      search: debouncedSearch || undefined,
      ordering,
      ...toActiveQueryParams(activeFilter),
    }),
    [page, debouncedSearch, ordering, activeFilter]
  );

  const fetcher = useCallback(
    (p: import('@/app/lib/marketingTypes').MarketingListParams, init: { signal: AbortSignal }) =>
      marketingChannelsApi.list(p, init),
    []
  );

  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<MarketingChannel>(fetcher, params);

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewChannel}>
      <MarketingPageShell
        title={t('marketing.campaignManagement.channel.title')}
        description={t('marketing.campaignManagement.channel.description')}
        actions={
          perms.canAddChannel ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 me-2" />
              {t('marketing.campaignManagement.channel.create')}
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
              { value: 'code', label: t('marketing.campaignManagement.sort.codeAsc') },
              { value: '-created_at', label: t('marketing.campaignManagement.sort.newest') },
            ]}
          />

          {loading && data.length === 0 ? (
            <MarketingLoadingState />
          ) : error ? (
            <MarketingErrorState
              message={formatMarketingErrorMessage(error, t)}
              onRetry={reload}
            />
          ) : data.length === 0 ? (
            <MarketingEmptyState
              message={
                debouncedSearch || activeFilter !== 'active'
                  ? t('marketing.campaignManagement.emptyFiltered')
                  : t('marketing.campaignManagement.channel.empty')
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
                        <td className="px-4 py-3 font-medium text-slate-900 break-words max-w-xs">
                          {row.name}
                        </td>
                        <td className="px-4 py-3">
                          <MarketingCode>{row.code}</MarketingCode>
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
                            {perms.canChangeChannel ? (
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
                            {perms.canChangeChannel && row.is_active ? (
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

        <ChannelFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={reload}
        />
        <ChannelFormDialog
          open={Boolean(editTarget)}
          channel={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={reload}
        />
        {archiveTarget ? (
          <ArchiveEntityDialog
            open={Boolean(archiveTarget)}
            entityName={archiveTarget.name}
            onClose={() => setArchiveTarget(null)}
            onSuccess={reload}
            archive={() => marketingChannelsApi.archive(archiveTarget.id)}
          />
        ) : null}
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
