import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
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
import { marketingLeadsApi } from '@/app/lib/marketingApi';
import {
  extractMarketingErrorCode,
  extractMarketingErrorDetails,
  formatMarketingErrorMessage,
} from '@/app/lib/marketingErrors';
import type {
  CreateLeadInput,
  CustomerPhoneMatchSummary,
  DuplicateLeadPhoneDetails,
  LeadDetail,
  LeadOutcome,
  LeadStatus,
  UpdateLeadInput,
} from '@/app/lib/marketingTypes';
import {
  LeadAttributionFields,
  type LeadAttributionValues,
} from '@/app/components/marketing/leads/LeadAttributionFields';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import { MarketingCode } from '@/app/components/marketing/campaigns/MarketingBadges';

const CREATE_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'assigned',
  'in_progress',
  'lost',
];

const OUTCOMES: LeadOutcome[] = [
  '',
  'interested',
  'not_interested',
  'no_answer',
  'wrong_number',
  'duplicate',
  'future_opportunity',
];

type LeadFormDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (lead?: LeadDetail) => void;
  lead?: LeadDetail | null;
};

const emptyAttribution = (): LeadAttributionValues => ({
  channelId: '',
  platformId: '',
  campaignId: '',
  adSetId: '',
  advertisementId: '',
});

export function LeadFormDialog({ open, onClose, onSuccess, lead }: LeadFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(lead);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [rawPhone, setRawPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<LeadStatus>('new');
  const [outcome, setOutcome] = useState<LeadOutcome | string>('');
  const [attribution, setAttribution] = useState<LeadAttributionValues>(emptyAttribution());
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateLead, setDuplicateLead] = useState<DuplicateLeadPhoneDetails['lead'] | null>(
    null
  );
  const [customerMatches, setCustomerMatches] = useState<CustomerPhoneMatchSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(lead?.name ?? '');
    setRawPhone(lead?.raw_phone ?? '');
    setEmail(lead?.email ?? '');
    setNotes(lead?.notes ?? '');
    setStatus((lead?.status as LeadStatus) || 'new');
    setOutcome(lead?.outcome ?? '');
    setAttribution({
      channelId: lead?.channel?.id ?? '',
      platformId: lead?.platform?.id ?? '',
      campaignId: lead?.campaign?.id ?? '',
      adSetId: lead?.ad_set?.id ?? '',
      advertisementId: lead?.advertisement?.id ?? '',
    });
    setSelectedCustomerId('');
    setFormError(null);
    setDuplicateLead(null);
    setCustomerMatches([]);
  }, [open, lead]);

  const buildPayload = (): CreateLeadInput | UpdateLeadInput => {
    const base = {
      name: name.trim(),
      raw_phone: rawPhone.trim(),
      email: email.trim(),
      notes: notes.trim(),
      status,
      outcome: outcome || '',
      channel_id: attribution.channelId || null,
      platform_id: attribution.platformId || null,
      campaign_id: attribution.campaignId || null,
      ad_set_id: attribution.adSetId || null,
      advertisement_id: attribution.advertisementId || null,
      selected_customer_id: selectedCustomerId || null,
    };
    return base;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t('marketing.leadManagement.validation.nameRequired'));
      return;
    }
    if (!rawPhone.trim()) {
      toast.error(t('marketing.leadManagement.validation.phoneRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setDuplicateLead(null);
    try {
      const payload = buildPayload();
      let result: LeadDetail;
      if (isEdit && lead) {
        result = await marketingLeadsApi.update(lead.id, payload);
        toast.success(t('marketing.leadManagement.toasts.updated'));
      } else {
        result = await marketingLeadsApi.create(payload as CreateLeadInput);
        toast.success(t('marketing.leadManagement.toasts.created'));
      }
      onSuccess(result);
      onClose();
    } catch (err) {
      const code = extractMarketingErrorCode(err);
      const details = extractMarketingErrorDetails(err);
      if (code === 'duplicate_lead_phone') {
        const leadInfo = (details as DuplicateLeadPhoneDetails).lead;
        setDuplicateLead(leadInfo ?? null);
        setFormError(t('marketing.leadManagement.conflicts.duplicatePhone'));
        setCustomerMatches([]);
      } else if (code === 'matching_customer_found') {
        const matches = Array.isArray(details.matches)
          ? (details.matches as CustomerPhoneMatchSummary[])
          : [];
        setCustomerMatches(matches);
        setFormError(t('marketing.leadManagement.conflicts.matchingCustomers'));
        setDuplicateLead(null);
      } else {
        setFormError(formatMarketingErrorMessage(err, t));
        toast.error(formatMarketingErrorMessage(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const editable =
    !lead || (lead.status !== 'archived' && lead.status !== 'converted');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('marketing.leadManagement.form.editTitle')
              : t('marketing.leadManagement.form.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('marketing.leadManagement.form.description')}
          </DialogDescription>
        </DialogHeader>

        {!editable ? (
          <p className="text-sm text-amber-700" role="alert">
            {t('marketing.leadManagement.form.notEditable')}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {isEdit && lead ? (
              <div>
                <p className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.leadNumber')}
                </p>
                <MarketingCode>{lead.lead_number}</MarketingCode>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="lead-name" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.name')} *
                </label>
                <input
                  id="lead-name"
                  className={marketingInputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div>
                <label htmlFor="lead-phone" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.phone')} *
                </label>
                <input
                  id="lead-phone"
                  className={marketingInputClass}
                  value={rawPhone}
                  onChange={(e) => setRawPhone(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="lead-email" className={marketingLabelClass}>
                {t('marketing.leadManagement.fields.email')}
              </label>
              <input
                id="lead-email"
                type="email"
                className={marketingInputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="lead-status" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.status')}
                </label>
                <select
                  id="lead-status"
                  className={marketingInputClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as LeadStatus)}
                >
                  {CREATE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`marketing.leadManagement.status.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lead-outcome" className={marketingLabelClass}>
                  {t('marketing.leadManagement.fields.outcome')}
                </label>
                <select
                  id="lead-outcome"
                  className={marketingInputClass}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  {OUTCOMES.map((o) => (
                    <option key={o || 'none'} value={o}>
                      {o
                        ? t(`marketing.leadManagement.outcome.${o}`)
                        : t('marketing.leadManagement.outcome.none')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">
                {t('marketing.leadManagement.sections.attribution')}
              </p>
              <LeadAttributionFields value={attribution} onChange={setAttribution} />
            </div>

            <div>
              <label htmlFor="lead-notes" className={marketingLabelClass}>
                {t('marketing.leadManagement.fields.notes')}
              </label>
              <textarea
                id="lead-notes"
                className={`${marketingInputClass} min-h-[96px] resize-y`}
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('marketing.leadManagement.placeholders.notes')}
                aria-describedby="lead-notes-help"
              />
              <p id="lead-notes-help" className="mt-1 text-xs text-slate-500">
                {t('marketing.leadManagement.help.notes')}
              </p>
            </div>

            {formError ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
                <p>{formError}</p>
                {duplicateLead ? (
                  <p className="mt-2">
                    {t('marketing.leadManagement.conflicts.existingLead', {
                      number: duplicateLead.lead_number,
                      name: duplicateLead.name,
                    })}{' '}
                    <Link
                      className="underline font-medium"
                      to={`/marketing/leads/${duplicateLead.id}`}
                      onClick={onClose}
                    >
                      {t('marketing.leadManagement.conflicts.openLead')}
                    </Link>
                  </p>
                ) : null}
                {customerMatches.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs">
                      {t('marketing.leadManagement.conflicts.selectMatchHint')}
                    </p>
                    {customerMatches.map((m) => (
                      <label
                        key={m.customer_id}
                        className="flex items-start gap-2 rounded-md border border-amber-100 bg-white px-2 py-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="selected-customer"
                          className="mt-1"
                          checked={selectedCustomerId === m.customer_id}
                          onChange={() => setSelectedCustomerId(m.customer_id)}
                        />
                        <span className="min-w-0">
                          <span className="font-medium break-words">{m.display_name}</span>
                          <span className="block text-xs text-slate-500" dir="ltr">
                            {m.phone || m.matched_raw_value} · {m.matched_field}
                          </span>
                        </span>
                      </label>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      disabled={!selectedCustomerId || submitting}
                      onClick={(ev) => handleSubmit(ev as unknown as React.FormEvent)}
                    >
                      {t('marketing.leadManagement.conflicts.retryWithMatch')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
