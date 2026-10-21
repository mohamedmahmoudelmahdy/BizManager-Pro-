import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
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
import { MarketingEmptyState } from '@/app/components/marketing/MarketingEmptyState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import {
  formatUserLabel,
  LeadStatusBadge,
} from '@/app/components/marketing/leads/LeadBadges';
import { useData } from '@/app/contexts/DataContext';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { marketingAssignmentsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { LeadAssignment, LeadAssignmentStatus } from '@/app/lib/marketingTypes';

type LeadAssignmentsPanelProps = {
  leadId: string;
  onChanged?: () => void;
  openAssignToken?: number;
};

type DialogMode = 'assign' | 'reassign' | 'reject' | 'complete' | 'cancel';

function formatAssignedAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '—';
  return d.toLocaleString();
}

function assignmentStatusTone(
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

export function LeadAssignmentsPanel({
  leadId,
  onChanged,
  openAssignToken = 0,
}: LeadAssignmentsPanelProps) {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const { employees } = useData();
  const [items, setItems] = useState<LeadAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>('assign');
  const [actionTarget, setActionTarget] = useState<LeadAssignment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [notes, setNotes] = useState('');

  const employeesWithUser = employees.filter((e) => e.userId);

  const canView =
    perms.canViewAssignments || perms.canAssignLead || perms.canChangeAssignment;

  const activeAssignment = useMemo(
    () => items.find((row) => row.is_active) ?? null,
    [items]
  );

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!canView) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await marketingAssignmentsApi.list(
        { lead: leadId, ordering: '-assigned_at' },
        { signal }
      );
      setItems(res.results);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err);
      setItems([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [canView, leadId]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const openAssign = (nextMode: 'assign' | 'reassign') => {
    setMode(nextMode);
    setActionTarget(null);
    setEmployeeUserId('');
    setNotes('');
    setDialogOpen(true);
  };

  useEffect(() => {
    if (openAssignToken <= 0 || !perms.canAssignLead) return;
    openAssign(activeAssignment ? 'reassign' : 'assign');
  }, [openAssignToken, perms.canAssignLead, activeAssignment]);

  const openNotesAction = (nextMode: 'reject' | 'complete' | 'cancel', row: LeadAssignment) => {
    setMode(nextMode);
    setActionTarget(row);
    setEmployeeUserId('');
    setNotes('');
    setDialogOpen(true);
  };

  const notifyChanged = () => {
    onChanged?.();
  };

  const handleAccept = async (row: LeadAssignment) => {
    setSubmitting(true);
    try {
      await marketingAssignmentsApi.accept(row.id);
      toast.success(t('marketing.leadManagement.assignments.accepted'));
      await reload();
      notifyChanged();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((mode === 'assign' || mode === 'reassign') && !employeeUserId) {
      toast.error(t('marketing.leadManagement.assignments.validation.employeeRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const notesPayload = notes.trim() || undefined;
      if (mode === 'assign') {
        await marketingAssignmentsApi.assign({
          lead_id: leadId,
          operations_employee_id: Number(employeeUserId),
          notes: notesPayload,
        });
        toast.success(t('marketing.leadManagement.assignments.assigned'));
      } else if (mode === 'reassign') {
        await marketingAssignmentsApi.reassign({
          lead_id: leadId,
          operations_employee_id: Number(employeeUserId),
          notes: notesPayload,
        });
        toast.success(t('marketing.leadManagement.assignments.reassigned'));
      } else if (mode === 'reject' && actionTarget) {
        await marketingAssignmentsApi.reject(actionTarget.id, { notes: notesPayload });
        toast.success(t('marketing.leadManagement.assignments.rejected'));
      } else if (mode === 'complete' && actionTarget) {
        await marketingAssignmentsApi.complete(actionTarget.id, { notes: notesPayload });
        toast.success(t('marketing.leadManagement.assignments.completedToast'));
      } else if (mode === 'cancel' && actionTarget) {
        await marketingAssignmentsApi.cancel(actionTarget.id, { notes: notesPayload });
        toast.success(t('marketing.leadManagement.assignments.cancelledToast'));
      }
      setDialogOpen(false);
      await reload();
      notifyChanged();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <MarketingEmptyState message={t('marketing.permissionDenied.description')} />
    );
  }

  const dialogTitle =
    mode === 'assign'
      ? t('marketing.leadManagement.assignments.assign')
      : mode === 'reassign'
        ? t('marketing.leadManagement.assignments.reassign')
        : mode === 'reject'
          ? t('marketing.leadManagement.assignments.reject')
          : mode === 'complete'
            ? t('marketing.leadManagement.assignments.complete')
            : t('marketing.leadManagement.assignments.cancel');

  const needsEmployee = mode === 'assign' || mode === 'reassign';

  return (
    <section className="space-y-3" aria-labelledby="lead-assignments-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="lead-assignments-heading" className="text-sm font-semibold text-slate-800">
          {t('marketing.leadManagement.assignments.title')}
        </h3>
        {perms.canAssignLead ? (
          activeAssignment ? (
            <Button type="button" size="sm" variant="outline" onClick={() => openAssign('reassign')}>
              <RefreshCw className="size-4 me-1.5" />
              {t('marketing.leadManagement.assignments.reassign')}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => openAssign('assign')}>
              <Plus className="size-4 me-1.5" />
              {t('marketing.leadManagement.assignments.assign')}
            </Button>
          )
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <MarketingLoadingState />
      ) : error ? (
        <MarketingErrorState
          message={formatMarketingErrorMessage(error, t)}
          onRetry={() => void reload()}
        />
      ) : items.length === 0 ? (
        <MarketingEmptyState message={t('marketing.leadManagement.assignments.empty')} />
      ) : (
        <ul role="list" className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((row) => {
            const status = row.status as LeadAssignmentStatus | string;
            const isActive = row.is_active;
            const showAcceptReject =
              isActive && status === 'pending' && perms.canChangeAssignment;
            const showComplete =
              isActive && status === 'accepted' && perms.canChangeAssignment;
            const showCancel =
              isActive &&
              (status === 'pending' || status === 'accepted') &&
              perms.canAssignLead;

            return (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {formatUserLabel(row.operations_employee)}
                      </p>
                      <LeadStatusBadge
                        label={t(`marketing.leadManagement.assignments.status.${status}`, {
                          defaultValue: String(status),
                        })}
                        tone={assignmentStatusTone(status)}
                      />
                      {isActive ? (
                        <LeadStatusBadge
                          label={t('marketing.leadManagement.assignments.active')}
                          tone="info"
                        />
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">
                      {t('marketing.leadManagement.assignments.fields.assignedBy')}:{' '}
                      {formatUserLabel(row.assigned_by)}
                      {' · '}
                      <time dateTime={row.assigned_at}>{formatAssignedAt(row.assigned_at)}</time>
                    </p>
                    {row.notes ? (
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{row.notes}</p>
                    ) : null}
                  </div>
                  {isActive && (showAcceptReject || showComplete || showCancel) ? (
                    <div className="flex flex-wrap shrink-0 gap-1">
                      {showAcceptReject ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => void handleAccept(row)}
                          >
                            {t('marketing.leadManagement.assignments.accept')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => openNotesAction('reject', row)}
                          >
                            {t('marketing.leadManagement.assignments.reject')}
                          </Button>
                        </>
                      ) : null}
                      {showComplete ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={submitting}
                          onClick={() => openNotesAction('complete', row)}
                        >
                          {t('marketing.leadManagement.assignments.complete')}
                        </Button>
                      ) : null}
                      {showCancel ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={submitting}
                          onClick={() => openNotesAction('cancel', row)}
                        >
                          {t('marketing.leadManagement.assignments.cancel')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => !v && !submitting && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>
                {needsEmployee
                  ? t('marketing.leadManagement.assignments.assignHint')
                  : t('marketing.leadManagement.assignments.actionNotesHint')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {needsEmployee ? (
                <div>
                  <label htmlFor="lead-assignment-employee" className={marketingLabelClass}>
                    {t('marketing.leadManagement.assignments.fields.employee')} *
                  </label>
                  <select
                    id="lead-assignment-employee"
                    className={marketingInputClass}
                    value={employeeUserId}
                    onChange={(e) => setEmployeeUserId(e.target.value)}
                    disabled={submitting}
                    required
                  >
                    <option value="">
                      {t('marketing.leadManagement.assignments.selectEmployee')}
                    </option>
                    {employeesWithUser.map((emp) => (
                      <option key={emp.id} value={emp.userId}>
                        {emp.name || emp.username}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label htmlFor="lead-assignment-notes" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.notes')}
                  {needsEmployee ? '' : ` (${t('marketing.leadManagement.assignments.notesOptional')})`}
                </label>
                <textarea
                  id="lead-assignment-notes"
                  className={marketingInputClass}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                {dialogTitle}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
