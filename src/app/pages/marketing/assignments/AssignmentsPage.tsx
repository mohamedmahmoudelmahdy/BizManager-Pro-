/**
 * Marketing Assignments operational workspace (Phase 3.4C).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, Loader2, Plus, RefreshCw } from 'lucide-react';
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
  leadStatusTone,
} from '@/app/components/marketing/leads/LeadBadges';
import { LeadSearchSelect } from '@/app/components/marketing/leads/LeadSearchSelect';
import { useData } from '@/app/contexts/DataContext';
import {
  useDebouncedValue,
  usePaginatedMarketingList,
} from '@/app/hooks/usePaginatedMarketingList';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { marketingAssignmentsApi, marketingLeadsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type {
  LeadAssignment,
  LeadSummary,
  MarketingListParams,
} from '@/app/lib/marketingTypes';
import { cn } from '@/app/components/ui/utils';

type WorkspaceTab =
  | 'active'
  | 'pending'
  | 'accepted'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'reassigned'
  | 'unassigned';

type DialogMode = 'assign' | 'reassign' | 'reject' | 'complete' | 'cancel';

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function assignmentTone(
  status: string
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'accepted':
    case 'completed':
      return 'success';
    case 'pending':
      return 'info';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    case 'reassigned':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function AssignmentsPage() {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const { employees } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(Number(searchParams.get('page') || '1') || 1);
  const [ordering, setOrdering] = useState(searchParams.get('ordering') || '-assigned_at');
  const [tab, setTab] = useState<WorkspaceTab>(
    (searchParams.get('tab') as WorkspaceTab) || 'active'
  );
  const [assignedUser, setAssignedUser] = useState(
    searchParams.get('assigned_to') || searchParams.get('assigned_user') || ''
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>('assign');
  const [actionTarget, setActionTarget] = useState<LeadAssignment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [leadId, setLeadId] = useState('');
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [notes, setNotes] = useState('');

  const employeesWithUser = employees.filter((e) => e.userId);
  const isUnassignedTab = tab === 'unassigned';

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, ordering, tab, assignedUser]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (debouncedSearch) sp.set('search', debouncedSearch);
    if (ordering !== '-assigned_at') sp.set('ordering', ordering);
    if (tab !== 'active') sp.set('tab', tab);
    if (assignedUser) sp.set('assigned_to', assignedUser);
    if (page > 1) sp.set('page', String(page));
    setSearchParams(sp, { replace: true });
  }, [debouncedSearch, ordering, tab, assignedUser, page, setSearchParams]);

  const assignmentParams = useMemo(() => {
    const p: MarketingListParams = {
      page,
      search: debouncedSearch || undefined,
      ordering,
      assigned_to: assignedUser || undefined,
    };
    if (tab === 'active') p.active = true;
    else if (tab !== 'unassigned') p.status = tab;
    return p;
  }, [page, debouncedSearch, ordering, tab, assignedUser]);

  const unassignedParams = useMemo(() => {
    const p: MarketingListParams = {
      page,
      search: debouncedSearch || undefined,
      ordering: '-created_at',
      assignment_state: 'unassigned',
    };
    return p;
  }, [page, debouncedSearch]);

  const assignmentFetcher = useCallback(
    (p: MarketingListParams, init: { signal: AbortSignal }) =>
      marketingAssignmentsApi.list(p, init),
    []
  );
  const leadFetcher = useCallback(
    (p: MarketingListParams, init: { signal: AbortSignal }) => marketingLeadsApi.list(p, init),
    []
  );

  const assignments = usePaginatedMarketingList<LeadAssignment>(
    assignmentFetcher,
    assignmentParams,
    !isUnassignedTab
  );
  const unassignedLeads = usePaginatedMarketingList<LeadSummary>(
    leadFetcher,
    unassignedParams,
    isUnassignedTab
  );

  const openAssignDialog = (
    nextMode: 'assign' | 'reassign',
    row?: LeadAssignment | LeadSummary
  ) => {
    setMode(nextMode);
    if (row && 'is_active' in row) {
      setActionTarget(row);
      setLeadId(row.lead?.id ?? '');
    } else if (row) {
      setActionTarget(null);
      setLeadId(row.id);
    } else {
      setActionTarget(null);
      setLeadId('');
    }
    setEmployeeUserId('');
    setNotes('');
    setDialogOpen(true);
  };

  const openNotesAction = (nextMode: 'reject' | 'complete' | 'cancel', row: LeadAssignment) => {
    setMode(nextMode);
    setActionTarget(row);
    setEmployeeUserId('');
    setNotes('');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'assign') {
        if (!leadId || !employeeUserId) {
          toast.error(t('marketing.assignments.validation.required'));
          setSubmitting(false);
          return;
        }
        await marketingAssignmentsApi.assign({
          lead_id: leadId,
          operations_employee_id: Number(employeeUserId),
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.assignments.assigned'));
      } else if (mode === 'reassign' && actionTarget) {
        if (!employeeUserId) {
          toast.error(t('marketing.assignments.validation.employeeRequired'));
          setSubmitting(false);
          return;
        }
        await marketingAssignmentsApi.reassign({
          lead_id: actionTarget.lead?.id ?? leadId,
          operations_employee_id: Number(employeeUserId),
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.assignments.reassigned'));
      } else if (mode === 'reject' && actionTarget) {
        await marketingAssignmentsApi.reject(actionTarget.id, {
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.assignments.rejected'));
      } else if (mode === 'complete' && actionTarget) {
        await marketingAssignmentsApi.complete(actionTarget.id, {
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.assignments.completed'));
      } else if (mode === 'cancel' && actionTarget) {
        await marketingAssignmentsApi.cancel(actionTarget.id, {
          notes: notes.trim() || undefined,
        });
        toast.success(t('marketing.leadManagement.assignments.cancelled'));
      }
      setDialogOpen(false);
      if (isUnassignedTab) unassignedLeads.reload();
      else assignments.reload();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async (row: LeadAssignment) => {
    try {
      await marketingAssignmentsApi.accept(row.id);
      toast.success(t('marketing.leadManagement.assignments.accepted'));
      assignments.reload();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    }
  };

  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: 'active', label: t('marketing.assignments.tabs.active') },
    { id: 'pending', label: t('marketing.assignments.tabs.pending') },
    { id: 'accepted', label: t('marketing.assignments.tabs.accepted') },
    { id: 'completed', label: t('marketing.assignments.tabs.completed') },
    { id: 'rejected', label: t('marketing.assignments.tabs.rejected') },
    { id: 'cancelled', label: t('marketing.assignments.tabs.cancelled') },
    { id: 'reassigned', label: t('marketing.assignments.tabs.reassigned') },
    { id: 'unassigned', label: t('marketing.assignments.tabs.unassigned') },
  ];

  const listLoading = isUnassignedTab ? unassignedLeads.loading : assignments.loading;
  const listError = isUnassignedTab ? unassignedLeads.error : assignments.error;
  const listReload = isUnassignedTab ? unassignedLeads.reload : assignments.reload;

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewAssignment}>
      <MarketingPageShell
        title={t('marketing.assignments.title')}
        description={t('marketing.assignments.description')}
        actions={
          perms.canAssignLead ? (
            <Button type="button" onClick={() => openAssignDialog('assign')}>
              <Plus className="size-4 me-2" />
              {t('marketing.assignments.assign')}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-100 p-1.5" role="tablist">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  tab === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                )}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <MarketingListToolbar
            search={search}
            onSearchChange={setSearch}
            showActiveFilter={false}
            ordering={isUnassignedTab ? '-created_at' : ordering}
            onOrderingChange={setOrdering}
            orderingOptions={
              isUnassignedTab
                ? [{ value: '-created_at', label: t('marketing.leadManagement.sort.newest') }]
                : [
                    { value: '-assigned_at', label: t('marketing.assignments.sort.newest') },
                    { value: 'assigned_at', label: t('marketing.assignments.sort.oldest') },
                    { value: 'status', label: t('marketing.assignments.sort.status') },
                  ]
            }
            filters={
              isUnassignedTab
                ? []
                : [
                    {
                      id: 'assigned_user',
                      label: t('marketing.leadManagement.fields.operationsEmployee'),
                      value: assignedUser,
                      onChange: setAssignedUser,
                      options: [
                        { value: '', label: t('marketing.assignments.filters.allAssignees') },
                        ...employeesWithUser.map((e) => ({
                          value: String(e.userId),
                          label: e.name || e.username || String(e.userId),
                        })),
                      ],
                    },
                  ]
            }
          />

          {listLoading &&
          (isUnassignedTab ? unassignedLeads.data : assignments.data).length === 0 ? (
            <MarketingLoadingState />
          ) : listError ? (
            <MarketingErrorState
              message={formatMarketingErrorMessage(listError, t)}
              onRetry={listReload}
            />
          ) : isUnassignedTab ? (
            unassignedLeads.data.length === 0 ? (
              <MarketingEmptyState message={t('marketing.assignments.emptyUnassigned')} />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                        <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.leadNumber')}</th>
                        <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.name')}</th>
                        <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.phone')}</th>
                        <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.status')}</th>
                        <th className="px-4 py-3 text-end">{t('marketing.leadManagement.fields.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {unassignedLeads.data.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <Link to={`/marketing/leads/${row.id}`} className="hover:underline">
                              <MarketingCode>{row.lead_number}</MarketingCode>
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/marketing/leads/${row.id}`} className="hover:underline">
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
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              <Button type="button" variant="outline" size="sm" asChild>
                                <Link to={`/marketing/leads/${row.id}`}>
                                  <Eye className="size-4 me-1" />
                                  {t('marketing.leads.actions.open')}
                                </Link>
                              </Button>
                              {perms.canAssignLead ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openAssignDialog('assign', row)}
                                >
                                  {t('marketing.assignments.assign')}
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
                    totalPages={unassignedLeads.totalPages}
                    count={unassignedLeads.count}
                    pageSize={unassignedLeads.pageSize}
                    onPageChange={setPage}
                    loading={unassignedLeads.loading}
                  />
                </div>
              </div>
            )
          ) : assignments.data.length === 0 ? (
            <MarketingEmptyState message={t('marketing.assignments.empty')} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.leadNumber')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.name')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.operationsEmployee')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.assignments.cols.assignedBy')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.leadManagement.fields.status')}</th>
                      <th className="px-4 py-3 text-start">{t('marketing.assignments.cols.assignedAt')}</th>
                      <th className="px-4 py-3 text-end">{t('marketing.leadManagement.fields.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {assignments.data.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          {row.lead ? (
                            <Link to={`/marketing/leads/${row.lead.id}`} className="hover:underline">
                              <MarketingCode>{row.lead.lead_number}</MarketingCode>
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium break-words">
                          {row.lead ? (
                            <Link to={`/marketing/leads/${row.lead.id}`} className="hover:underline">
                              {row.lead.name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">{formatUserLabel(row.operations_employee)}</td>
                        <td className="px-4 py-3">{formatUserLabel(row.assigned_by)}</td>
                        <td className="px-4 py-3">
                          <LeadStatusBadge
                            label={t(`marketing.leadManagement.assignments.status.${row.status}`, {
                              defaultValue: row.status,
                            })}
                            tone={assignmentTone(row.status)}
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" dir="ltr">
                          {formatWhen(row.assigned_at)}
                        </td>
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
                            {row.is_active &&
                            row.status === 'pending' &&
                            perms.canChangeAssignment ? (
                              <>
                                <Button type="button" size="sm" onClick={() => handleAccept(row)}>
                                  {t('marketing.leadManagement.assignments.accept')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openNotesAction('reject', row)}
                                >
                                  {t('marketing.leadManagement.assignments.reject')}
                                </Button>
                              </>
                            ) : null}
                            {row.is_active &&
                            row.status === 'accepted' &&
                            perms.canChangeAssignment ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => openNotesAction('complete', row)}
                              >
                                {t('marketing.leadManagement.assignments.complete')}
                              </Button>
                            ) : null}
                            {row.is_active && perms.canAssignLead ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openAssignDialog('reassign', row)}
                                  aria-label={t('marketing.leadManagement.assignments.reassign')}
                                >
                                  <RefreshCw className="size-4" />
                                </Button>
                                {(row.status === 'pending' || row.status === 'accepted') && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openNotesAction('cancel', row)}
                                  >
                                    {t('common.cancel')}
                                  </Button>
                                )}
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
                  totalPages={assignments.totalPages}
                  count={assignments.count}
                  pageSize={assignments.pageSize}
                  onPageChange={setPage}
                  loading={assignments.loading}
                />
              </div>
            </div>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {mode === 'assign'
                  ? t('marketing.assignments.assign')
                  : mode === 'reassign'
                    ? t('marketing.leadManagement.assignments.reassign')
                    : mode === 'reject'
                      ? t('marketing.leadManagement.assignments.reject')
                      : mode === 'complete'
                        ? t('marketing.leadManagement.assignments.complete')
                        : t('common.cancel')}
              </DialogTitle>
              <DialogDescription>{t('marketing.assignments.dialogHint')}</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={handleSubmit}>
              {(mode === 'assign' || mode === 'reassign') && !actionTarget?.lead ? (
                <LeadSearchSelect
                  id="asg-lead"
                  label={t('marketing.followups.fields.lead')}
                  value={leadId}
                  onChange={setLeadId}
                  required={mode === 'assign'}
                  disabled={mode === 'reassign' && Boolean(actionTarget)}
                />
              ) : null}
              {(mode === 'assign' || mode === 'reassign') && (
                <div>
                  <label htmlFor="asg-emp" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.operationsEmployee')}
                  </label>
                  <select
                    id="asg-emp"
                    className={marketingInputClass}
                    value={employeeUserId}
                    onChange={(e) => setEmployeeUserId(e.target.value)}
                    required
                  >
                    <option value="">{t('marketing.assignments.selectEmployee')}</option>
                    {employeesWithUser.map((e) => (
                      <option key={e.id} value={String(e.userId)}>
                        {e.name || e.username}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="asg-notes" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.notes')}
                </label>
                <textarea
                  id="asg-notes"
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
