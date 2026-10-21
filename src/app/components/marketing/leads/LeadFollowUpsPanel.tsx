import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Pencil, Plus } from 'lucide-react';
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
import { marketingFollowUpsApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { LeadFollowUp } from '@/app/lib/marketingTypes';

type LeadFollowUpsPanelProps = {
  leadId: string;
  openCreateToken?: number;
};

type FormMode = 'create' | 'edit' | 'complete';

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatScheduledFor(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '—';
  return d.toLocaleString();
}

function followUpStatusTone(
  item: LeadFollowUp
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (item.status === 'completed') return 'success';
  if (item.status === 'cancelled') return 'danger';
  if (item.is_overdue || item.status === 'pending') {
    return item.is_overdue ? 'warning' : 'info';
  }
  return 'neutral';
}

export function LeadFollowUpsPanel({ leadId, openCreateToken = 0 }: LeadFollowUpsPanelProps) {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const { employees } = useData();
  const [items, setItems] = useState<LeadFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>('create');
  const [target, setTarget] = useState<LeadFollowUp | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [notes, setNotes] = useState('');

  const employeesWithUser = employees.filter((e) => e.userId);

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!perms.canViewFollowUps) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await marketingFollowUpsApi.list(
        { lead: leadId, ordering: 'scheduled_for' },
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
  }, [leadId, perms.canViewFollowUps]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const openCreate = () => {
    setMode('create');
    setTarget(null);
    setScheduledFor('');
    setAssignedToId('');
    setNotes('');
    setDialogOpen(true);
  };

  useEffect(() => {
    if (openCreateToken > 0 && perms.canAddFollowUp) {
      openCreate();
    }
  }, [openCreateToken, perms.canAddFollowUp]);

  const openEdit = (item: LeadFollowUp) => {
    setMode('edit');
    setTarget(item);
    setScheduledFor(toDatetimeLocal(item.scheduled_for));
    setAssignedToId(item.assigned_to?.id != null ? String(item.assigned_to.id) : '');
    setNotes(item.notes ?? '');
    setDialogOpen(true);
  };

  const openComplete = (item: LeadFollowUp) => {
    setMode('complete');
    setTarget(item);
    setScheduledFor('');
    setAssignedToId('');
    setNotes(item.notes ?? '');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          notes: notes.trim() || null,
        });
        toast.success(t('marketing.leadManagement.followUps.completed'));
      }
      setDialogOpen(false);
      await reload();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (!perms.canViewFollowUps) {
    return (
      <MarketingEmptyState message={t('marketing.permissionDenied.description')} />
    );
  }

  const dialogTitle =
    mode === 'create'
      ? t('marketing.leadManagement.followUps.create')
      : mode === 'edit'
        ? t('marketing.leadManagement.followUps.edit')
        : t('marketing.leadManagement.followUps.complete');

  return (
    <section className="space-y-3" aria-labelledby="lead-followups-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="lead-followups-heading" className="text-sm font-semibold text-slate-800">
          {t('marketing.leadManagement.followUps.title')}
        </h3>
        {perms.canAddFollowUp ? (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4 me-1.5" />
            {t('marketing.leadManagement.followUps.create')}
          </Button>
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
        <MarketingEmptyState message={t('marketing.leadManagement.followUps.empty')} />
      ) : (
        <ul role="list" className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => {
            const statusKey = item.is_overdue && item.status === 'pending'
              ? 'overdue'
              : item.status;
            const canEditPending = perms.canChangeFollowUp && item.status === 'pending';
            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <time className="text-sm font-medium text-slate-900" dateTime={item.scheduled_for}>
                        {formatScheduledFor(item.scheduled_for)}
                      </time>
                      <LeadStatusBadge
                        label={t(`marketing.leadManagement.followUps.status.${statusKey}`, {
                          defaultValue: String(statusKey),
                        })}
                        tone={followUpStatusTone(item)}
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      {t('marketing.leadManagement.followUps.fields.assignedTo')}:{' '}
                      {formatUserLabel(item.assigned_to)}
                    </p>
                    {item.notes ? (
                      <p className="text-sm text-slate-600 whitespace-pre-wrap">{item.notes}</p>
                    ) : null}
                  </div>
                  {canEditPending ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(item)}
                        aria-label={t('common.edit')}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openComplete(item)}
                        aria-label={t('marketing.leadManagement.followUps.complete')}
                      >
                        <Check className="size-4 text-emerald-600" />
                      </Button>
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
                {mode === 'complete'
                  ? t('marketing.leadManagement.followUps.completeHint')
                  : t('marketing.leadManagement.followUps.formHint')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {mode !== 'complete' ? (
                <>
                  <div>
                    <label htmlFor="lead-followup-scheduled" className={marketingLabelClass}>
                      {t('marketing.leadManagement.followUps.fields.scheduledFor')} *
                    </label>
                    <input
                      id="lead-followup-scheduled"
                      type="datetime-local"
                      className={marketingInputClass}
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="lead-followup-assignee" className={marketingLabelClass}>
                      {t('marketing.leadManagement.followUps.fields.assignedTo')}
                    </label>
                    <select
                      id="lead-followup-assignee"
                      className={marketingInputClass}
                      value={assignedToId}
                      onChange={(e) => setAssignedToId(e.target.value)}
                      disabled={submitting}
                    >
                      <option value="">{t('common.empty')}</option>
                      {employeesWithUser.map((emp) => (
                        <option key={emp.id} value={emp.userId}>
                          {emp.name || emp.username}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
              <div>
                <label htmlFor="lead-followup-notes" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.notes')}
                </label>
                <textarea
                  id="lead-followup-notes"
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
                {mode === 'complete'
                  ? t('marketing.leadManagement.followUps.complete')
                  : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
