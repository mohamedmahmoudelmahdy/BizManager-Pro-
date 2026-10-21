/**
 * Marketing Follow-ups operational workspace (Phase 3.4B).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Eye, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingListToolbar } from '@/app/components/marketing/campaigns/MarketingListToolbar';
import { MarketingPaginationBar } from '@/app/components/marketing/campaigns/MarketingPaginationBar';
import { MarketingCode } from '@/app/components/marketing/campaigns/MarketingBadges';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import {
  formatUserLabel,
  LeadStatusBadge,
} from '@/app/components/marketing/leads/LeadBadges';
import { LeadSearchSelect } from '@/app/components/marketing/leads/LeadSearchSelect';
import { useData } from '@/app/contexts/DataContext';
import {
  useDebouncedValue,
  usePaginatedMarketingList,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { marketingFollowUpsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { LeadFollowUp, MarketingListParams } from '@/app/lib/marketingTypes';
import { cn } from '@/app/components/ui/utils';

type QuickFilter = 'all' | 'overdue' | 'due_today' | 'next_7' | 'pending' | 'completed';
type FormMode = 'create' | 'edit' | 'complete';

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '—';
  return d.toLocaleString();
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function FollowUpsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const { employees } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(Number(searchParams.get('page') || '1') || 1);
  const [ordering, setOrdering] = useState(searchParams.get('ordering') || 'scheduled_for');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [quick, setQuick] = useState<QuickFilter>(
    (searchParams.get('quick') as QuickFilter) || 'all'
  );
  const [assignedTo, setAssignedTo] = useState(searchParams.get('assigned_to') || '');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [target, setTarget] = useState<LeadFollowUp | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [leadId, setLeadId] = useState('');
  const [leadLabel, setLeadLabel] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [notes, setNotes] = useState('');

  const employeesWithUser = employees.filter((e) => e.userId);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, ordering, status, quick, assignedTo]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (debouncedSearch) sp.set('search', debouncedSearch);
    if (ordering !== 'scheduled_for') sp.set('ordering', ordering);
    if (status) sp.set('status', status);
    if (quick !== 'all') sp.set('quick', quick);
    if (assignedTo) sp.set('assigned_to', assignedTo);
    if (page > 1) sp.set('page', String(page));
    setSearchParams(sp, { replace: true });
  }, [debouncedSearch, ordering, status, quick, assignedTo, page, setSearchParams]);

  const params = useMemo(() => {
    const today = new Date();
    const p: MarketingListParams = {
      page,
      search: debouncedSearch || undefined,
      ordering,
      assigned_to: assignedTo || undefined,
    };
    if (quick === 'overdue') {
      p.overdue = true;
    } else if (quick === 'due_today') {
      p.status = 'pending';
      p.scheduled_from = isoDate(today);
      p.scheduled_to = isoDate(today);
    } else if (quick === 'next_7') {
      p.status = 'pending';
      p.scheduled_from = isoDate(addDays(today, 1));
      p.scheduled_to = isoDate(addDays(today, 7));
    } else if (quick === 'pending') {
      p.status = 'pending';
    } else if (quick === 'completed') {
      p.status = 'completed';
    } else if (status) {
      p.status = status;
    }
    return p;
  }, [page, debouncedSearch, ordering, status, quick, assignedTo]);

  const fetcher = useCallback(
    (p: MarketingListParams, init: { signal: AbortSignal }) => marketingFollowUpsApi.list(p, init),
    []
  );
  const { data, count, loading, error, reload, pageSize, totalPages } =
    usePaginatedMarketingList<LeadFollowUp>(fetcher, params);

  const openCreate = () => {
    setMode('create');
    setTarget(null);
    setLeadId('');
    setLeadLabel('');
    setScheduledFor('');
    setAssignedToId('');
    setNotes('');
    setDialogOpen(true);
  };

  const openEdit = (item: LeadFollowUp) => {
    setMode('edit');
    setTarget(item);
    setLeadId(item.lead?.id ?? '');
    setLeadLabel(
      item.lead ? `${item.lead.lead_number} — ${item.lead.name}` : ''
    );
    setScheduledFor(toDatetimeLocal(item.scheduled_for));
    setAssignedToId(item.assigned_to?.id != null ? String(item.assigned_to.id) : '');
    setNotes(item.notes ?? '');
    setDialogOpen(true);
  };

  const openComplete = (item: LeadFollowUp) => {
    setMode('complete');
    setTarget(item);
    setNotes(item.notes ?? '');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create' && !leadId) {
      toast.error(t('marketing.followups.validation.leadRequired'));
      return;
    }
    if (mode !== 'complete' && !scheduledFor) {
      toast.error(t('marketing.leadManagement.followUps.validation.scheduledRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await marketingFollowUpsApi.create({
          lead_id: leadId,
          scheduled_for: new Date(scheduledFor).toISOString(),
          assigned_to_id: assignedToId ? Number(assignedToId) : null,
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.followUps.created'));
      } else if (mode === 'edit' && target) {
        await marketingFollowUpsApi.update(target.id, {
          scheduled_for: new Date(scheduledFor).toISOString(),
          assigned_to_id: assignedToId ? Number(assignedToId) : null,
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.followUps.updated'));
      } else if (mode === 'complete' && target) {
        await marketingFollowUpsApi.complete(target.id, {
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.followUps.completed'));
      }
      setDialogOpen(false);
      reload();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const quickFilters: { id: QuickFilter; label: string }[] = [
    { id: 'all', label: t('marketing.followups.quick.all') },
    { id: 'overdue', label: t('marketing.followups.quick.overdue') },
    { id: 'due_today', label: t('marketing.followups.quick.dueToday') },
    { id: 'next_7', label: t('marketing.followups.quick.next7') },
    { id: 'pending', label: t('marketing.followups.quick.pending') },
    { id: 'completed', label: t('marketing.followups.quick.completed') },
  ];

  return (
    <MarketingPermissionGuard
      anyOf={[MARKETING_PERMISSIONS.viewFollowUp, MARKETING_PERMISSIONS.manageLeadActivity]}
    >
      <MarketingPageShell
        title={t('marketing.followups.title')}
        description={t('marketing.followups.description')}
        actions={
          perms.canAddFollowUp ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4 me-2" />
              {t('marketing.followups.create')}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('marketing.followups.quick.label')}>
            {quickFilters.map((f) => (
              <button
                key={f.id}
                type="button"
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
                  quick === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                )}
                aria-pressed={quick === f.id}
                onClick={() => {
                  setQuick(f.id);
                  setStatus('');
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <MarketingListToolbar
            search={search}
            onSearchChange={setSearch}
            showActiveFilter={false}
            ordering={ordering}
            onOrderingChange={setOrdering}
            orderingOptions={[
              { value: 'scheduled_for', label: t('marketing.followups.sort.soonest') },
              { value: '-scheduled_for', label: t('marketing.followups.sort.latest') },
              { value: '-created_at', label: t('marketing.followups.sort.newest') },
            ]}
            filters={[
              {
                id: 'assigned',
                label: t('marketing.leadManagement.fields.assignedTo'),
                value: assignedTo,
                onChange: setAssignedTo,
                options: [
                  { value: '', label: t('marketing.followups.filters.allAssignees') },
                  ...employeesWithUser.map((e) => ({
                    value: String(e.userId),
                    label: e.name || e.username || e.email || String(e.userId),
                  })),
                ],
              },
            ]}
          />

          {loading && data.length === 0 ? (
            <MarketingLoadingState />
          ) : error ? (
            <MarketingErrorState message={formatMarketingErrorMessage(error, t)} onRetry={reload} />
          ) : data.length === 0 ? (
            <MarketingEmptyState message={t('marketing.followups.empty')} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.leadNumber')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.name')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.phone')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.scheduledFor')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.status')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.assignedTo')}</th>
                      <th className="px-4 py-3 text-end">{t('marketing.leadManagement.fields.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.map((row) => (
                      <tr
                        key={row.id}
                        className={cn('hover:bg-slate-50', row.is_overdue && 'bg-amber-50/60')}
                      >
                        <td className="px-4 py-3">
                          {row.lead ? (
                            <Link to={`/marketing/leads/${row.lead.id}`} className="hover:underline">
                              <MarketingCode>{row.lead.lead_number}</MarketingCode>
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium break-words max-w-[10rem]">
                          {row.lead ? (
                            <Link to={`/marketing/leads/${row.lead.id}`} className="hover:underline">
                              {row.lead.name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3" dir="ltr">
                          {row.lead?.raw_phone || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" dir="ltr">
                          {formatWhen(row.scheduled_for)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <LeadStatusBadge
                              label={t(`marketing.leadManagement.followUps.status.${row.status}`, {
                                defaultValue: row.status,
                              })}
                              tone={
                                row.status === 'completed'
                                  ? 'success'
                                  : row.status === 'cancelled'
                                    ? 'danger'
                                    : row.is_overdue
                                      ? 'warning'
                                      : 'info'
                              }
                            />
                            {row.is_overdue ? (
                              <span className="text-xs font-medium text-amber-800">
                                {t('marketing.followups.overdueLabel')}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">{formatUserLabel(row.assigned_to)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-1">
                            {row.lead ? (
                              <Button type="button" variant="outline" size="sm" asChild>
                                <Link to={`/marketing/leads/${row.lead.id}`}>
                                  <Eye className="size-4 me-1" />
                                  {t('marketing.leads.actions.open')}
                                </Link>
                              </Button>
                            ) : null}
                            {perms.canChangeFollowUp && row.status === 'pending' ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(row)}
                                  aria-label={t('common.edit')}
                                >
                                  <Pencil className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openComplete(row)}
                                  aria-label={t('marketing.leadManagement.followUps.complete')}
                                >
                                  <Check className="size-4" />
                                </Button>
                              </>
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

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {mode === 'create'
                  ? t('marketing.followups.create')
                  : mode === 'edit'
                    ? t('marketing.leadManagement.followUps.edit')
                    : t('marketing.leadManagement.followUps.complete')}
              </DialogTitle>
              <DialogDescription>
                {t('marketing.followups.dialogHint')}
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={handleSubmit}>
              {mode === 'create' ? (
                <LeadSearchSelect
                  id="fu-lead"
                  label={t('marketing.followups.fields.lead')}
                  value={leadId}
                  onChange={setLeadId}
                  selectedLabel={leadLabel}
                  required
                />
              ) : null}
              {mode !== 'complete' ? (
                <div>
                  <label htmlFor="fu-when" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.scheduledFor')}
                  </label>
                  <input
                    id="fu-when"
                    type="datetime-local"
                    className={marketingInputClass}
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                    required
                    dir="ltr"
                  />
                </div>
              ) : null}
              {mode !== 'complete' ? (
                <div>
                  <label htmlFor="fu-assignee" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.assignedTo')}
                  </label>
                  <select
                    id="fu-assignee"
                    className={marketingInputClass}
                    value={assignedToId}
                    onChange={(e) => setAssignedToId(e.target.value)}
                  >
                    <option value="">{t('marketing.followups.filters.unassigned')}</option>
                    {employeesWithUser.map((e) => (
                      <option key={e.id} value={String(e.userId)}>
                        {e.name || e.username || e.userId}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label htmlFor="fu-notes" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.notes')}
                </label>
                <textarea
                  id="fu-notes"
                  className={marketingInputClass}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </MarketingPageShell>
    </MarketingPermissionGuard>
  );
}
