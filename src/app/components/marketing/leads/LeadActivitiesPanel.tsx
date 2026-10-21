import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus } from 'lucide-react';
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
import { formatUserLabel } from '@/app/components/marketing/leads/LeadBadges';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { marketingActivitiesApi } from '@/app/lib/marketingApi';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { LeadActivity, LeadActivityType } from '@/app/lib/marketingTypes';

const ACTIVITY_TYPES: LeadActivityType[] = [
  'call',
  'whatsapp',
  'email',
  'meeting',
  'note',
  'follow_up',
  'status_change',
  'assignment',
  'conversion',
];

type LeadActivitiesPanelProps = {
  leadId: string;
  /** Increment to open the create dialog from a parent quick action. */
  openCreateToken?: number;
  /** Called after a successful activity create so parent can refresh Contacted By. */
  onChanged?: () => void;
};

function formatOccurredAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '—';
  return d.toLocaleString();
}

export function LeadActivitiesPanel({
  leadId,
  openCreateToken = 0,
  onChanged,
}: LeadActivitiesPanelProps) {
  const { t } = useTranslation();
  const perms = useMarketingPermissions();
  const [items, setItems] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activityType, setActivityType] = useState<LeadActivityType>('call');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!perms.canViewActivities) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await marketingActivitiesApi.list(
        { lead: leadId, ordering: '-occurred_at' },
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
  }, [leadId, perms.canViewActivities]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!createOpen) return;
    setActivityType('call');
    setSubject('');
    setNotes('');
  }, [createOpen]);

  useEffect(() => {
    if (openCreateToken > 0 && perms.canAddActivity) {
      setCreateOpen(true);
    }
  }, [openCreateToken, perms.canAddActivity]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await marketingActivitiesApi.create({
        lead_id: leadId,
        activity_type: activityType,
        subject: subject.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(t('marketing.leadManagement.activities.created'));
      setCreateOpen(false);
      await reload();
      onChanged?.();
    } catch (err) {
      toast.error(formatMarketingErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (!perms.canViewActivities) {
    return (
      <MarketingEmptyState message={t('marketing.permissionDenied.description')} />
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="lead-activities-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="lead-activities-heading" className="text-sm font-semibold text-slate-800">
          {t('marketing.leadManagement.activities.title')}
        </h3>
        {perms.canAddActivity ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 me-1.5" />
            {t('marketing.leadManagement.activities.create')}
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
        <MarketingEmptyState message={t('marketing.leadManagement.activities.empty')} />
      ) : (
        <ul role="list" className="relative space-y-0 border-s border-slate-200 ms-2 ps-4">
          {items.map((item) => (
            <li key={item.id} className="relative pb-4 last:pb-0">
              <span
                className="absolute -start-[1.3rem] top-1.5 size-2 rounded-full bg-slate-400 ring-4 ring-white"
                aria-hidden
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-slate-900">
                  {t(`marketing.leadManagement.activities.types.${item.activity_type}`, {
                    defaultValue: item.activity_type,
                  })}
                  {item.subject ? (
                    <span className="font-normal text-slate-600"> — {item.subject}</span>
                  ) : null}
                </p>
                <time
                  className="text-xs text-slate-400"
                  dateTime={item.occurred_at}
                >
                  {formatOccurredAt(item.occurred_at)}
                </time>
              </div>
              {item.notes ? (
                <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{item.notes}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-400">
                {formatUserLabel(item.created_by)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={(v) => !v && !submitting && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>{t('marketing.leadManagement.activities.create')}</DialogTitle>
              <DialogDescription>
                {t('marketing.leadManagement.activities.formHint')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label htmlFor="lead-activity-type" className={marketingLabelClass}>
                  {t('marketing.leadManagement.activities.fields.activityType')}
                </label>
                <select
                  id="lead-activity-type"
                  className={marketingInputClass}
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value as LeadActivityType)}
                  disabled={submitting}
                >
                  {ACTIVITY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`marketing.leadManagement.activities.types.${type}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lead-activity-subject" className={marketingLabelClass}>
                  {t('marketing.leadManagement.activities.fields.subject')}
                </label>
                <input
                  id="lead-activity-subject"
                  className={marketingInputClass}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="lead-activity-notes" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.notes')}
                </label>
                <textarea
                  id="lead-activity-notes"
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
                onClick={() => setCreateOpen(false)}
                disabled={submitting}
              >
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
    </section>
  );
}
