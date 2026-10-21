import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ConvertCustomerMatchSummary,
  LeadConversionMode,
  LeadDetail,
} from '@/app/lib/marketingTypes';
import {
  marketingInputClass,
  marketingLabelClass,
} from '@/app/components/marketing/campaigns/marketingFormStyles';
import { useAuth } from '@/app/contexts/AuthContext';
import { cn } from '@/app/components/ui/utils';

type LeadConvertDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (lead: LeadDetail) => void;
  lead: LeadDetail;
};

type FieldErrors = Partial<Record<'name' | 'phone' | 'email' | 'type', string>>;

export function LeadConvertDialog({ open, onClose, onSuccess, lead }: LeadConvertDialogProps) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canOpenCustomer = hasPermission('customers.view_customer', { allowAdminManager: true });

  const [mode, setMode] = useState<LeadConversionMode>('create_customer');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [matches, setMatches] = useState<ConvertCustomerMatchSummary[]>([]);
  const [matchesLoaded, setMatchesLoaded] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerType, setCustomerType] = useState('individual');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const matchListRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetFormFromLead = useCallback(() => {
    setMode('create_customer');
    setFormError(null);
    setFieldErrors({});
    setMatches([]);
    setMatchesLoaded(false);
    setLoadingMatches(false);
    setMatchesError(null);
    setSelectedCustomerId('');
    setCustomerType('individual');
    setCustomerName(lead.name || '');
    setCustomerPhone(lead.raw_phone || '');
    setCustomerEmail(lead.email || '');
  }, [lead]);

  const loadMatches = useCallback(
    async (opts?: { focus?: boolean; clearSelection?: boolean }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadingMatches(true);
      setMatchesError(null);
      try {
        const res = await marketingLeadsApi.customerMatches(lead.id, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setMatches(Array.isArray(res.matches) ? res.matches : []);
        setMatchesLoaded(true);
        if (opts?.clearSelection !== false) {
          setSelectedCustomerId('');
        }
        if (opts?.focus) {
          requestAnimationFrame(() => matchListRef.current?.focus());
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setMatchesError(formatMarketingErrorMessage(err, t));
        setMatchesLoaded(false);
      } finally {
        if (!controller.signal.aborted) setLoadingMatches(false);
      }
    },
    [lead.id, t]
  );

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    resetFormFromLead();
    void loadMatches({ clearSelection: true });
    // Prefetch matches on open; reset when Lead changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-fetch loops from callback identity
  }, [open, lead.id]);

  const switchToLinkExisting = () => {
    setFormError(null);
    setFieldErrors({});
    setMode('link_existing_customer');
    if (!matchesLoaded && !loadingMatches) {
      void loadMatches({ focus: true });
    } else if (matchesLoaded) {
      requestAnimationFrame(() => matchListRef.current?.focus());
    }
  };

  const switchToCreateNew = () => {
    setFormError(null);
    setFieldErrors({});
    setSelectedCustomerId('');
    setMode('create_customer');
  };

  const applyFieldErrorsFromDetails = (details: Record<string, unknown>) => {
    const fields = details.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
    const next: FieldErrors = {};
    for (const key of ['name', 'phone', 'email', 'type'] as const) {
      if (key in fields) {
        next[key] = t('marketing.leadManagement.validation.fieldInvalid', {
          defaultValue: t('marketing.errors.customer_creation_failed'),
        });
      }
    }
    setFieldErrors(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create_customer') {
      if (!customerName.trim() || !customerPhone.trim()) {
        toast.error(t('marketing.leadManagement.validation.nameRequired'));
        return;
      }
    }
    if (mode === 'link_existing_customer') {
      if (!selectedCustomerId) {
        toast.error(t('marketing.leadManagement.validation.customerRequired'));
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const result =
        mode === 'create_customer'
          ? await marketingLeadsApi.convert(lead.id, {
              mode: 'create_customer',
              customer: {
                type: customerType,
                name: customerName.trim(),
                phone: customerPhone.trim(),
                ...(customerEmail.trim() ? { email: customerEmail.trim() } : {}),
              },
            })
          : await marketingLeadsApi.convert(lead.id, {
              mode: 'link_existing_customer',
              customer_id: selectedCustomerId,
            });
      toast.success(t('marketing.leadManagement.toasts.converted'));
      onSuccess(result);
      onClose();
    } catch (err) {
      const code = extractMarketingErrorCode(err);
      const details = extractMarketingErrorDetails(err);
      if (code === 'matching_customer_found') {
        const list = Array.isArray(details.matches)
          ? (details.matches as ConvertCustomerMatchSummary[])
          : [];
        setMatches(list);
        setMatchesLoaded(true);
        setFormError(t('marketing.leadManagement.conversion.matchesFound'));
      } else if (code === 'customer_match_not_found') {
        setMatches([]);
        setMatchesLoaded(true);
        setSelectedCustomerId('');
        setFormError(t('marketing.leadManagement.conversion.noMatches'));
      } else if (code === 'invalid_customer_link') {
        setSelectedCustomerId('');
        setFormError(formatMarketingErrorMessage(err, t));
        void loadMatches({ clearSelection: true });
      } else if (code === 'customer_creation_failed') {
        applyFieldErrorsFromDetails(details);
        setFormError(formatMarketingErrorMessage(err, t));
      } else {
        setFormError(formatMarketingErrorMessage(err, t));
        toast.error(formatMarketingErrorMessage(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canConvert = lead.status !== 'converted' && lead.status !== 'archived';
  const createReady = Boolean(customerName.trim() && customerPhone.trim());
  const linkReady = Boolean(selectedCustomerId);
  const submitDisabled =
    submitting ||
    (mode === 'link_existing_customer' && (loadingMatches || !linkReady)) ||
    (mode === 'create_customer' && !createReady);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('marketing.leadManagement.conversion.title')}</DialogTitle>
          <DialogDescription>
            {t('marketing.leadManagement.conversion.description')}
          </DialogDescription>
        </DialogHeader>

        {!canConvert ? (
          <p className="text-sm text-amber-700" role="alert">
            {lead.status === 'converted'
              ? t('marketing.leadManagement.conversion.alreadyConverted')
              : t('marketing.leadManagement.conversion.archivedCannotConvert')}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-600">
                {t('marketing.leadManagement.conversion.mode')}
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="convert-mode"
                  checked={mode === 'create_customer'}
                  disabled={submitting}
                  onChange={switchToCreateNew}
                />
                {t('marketing.leadManagement.conversion.createNew')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="convert-mode"
                  checked={mode === 'link_existing_customer'}
                  disabled={submitting}
                  onChange={switchToLinkExisting}
                />
                {t('marketing.leadManagement.conversion.linkExisting')}
              </label>
            </fieldset>

            {mode === 'create_customer' ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="conv-type" className={marketingLabelClass}>
                    {t('marketing.leadManagement.conversion.customerType')}
                  </label>
                  <select
                    id="conv-type"
                    className={marketingInputClass}
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                    disabled={submitting}
                    aria-invalid={Boolean(fieldErrors.type)}
                    aria-describedby={fieldErrors.type ? 'conv-type-err' : undefined}
                  >
                    <option value="individual">
                      {t('marketing.leadManagement.conversion.typeIndividual')}
                    </option>
                    <option value="company">
                      {t('marketing.leadManagement.conversion.typeCompany')}
                    </option>
                  </select>
                  {fieldErrors.type ? (
                    <p id="conv-type-err" className="mt-1 text-xs text-rose-700" role="alert">
                      {fieldErrors.type}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="conv-name" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.name')} *
                  </label>
                  <input
                    id="conv-name"
                    className={marketingInputClass}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    disabled={submitting}
                    required
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? 'conv-name-err' : undefined}
                  />
                  {fieldErrors.name ? (
                    <p id="conv-name-err" className="mt-1 text-xs text-rose-700" role="alert">
                      {fieldErrors.name}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="conv-phone" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.phone')} *
                  </label>
                  <input
                    id="conv-phone"
                    className={marketingInputClass}
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    dir="ltr"
                    disabled={submitting}
                    required
                    aria-invalid={Boolean(fieldErrors.phone)}
                    aria-describedby={fieldErrors.phone ? 'conv-phone-err' : undefined}
                  />
                  {fieldErrors.phone ? (
                    <p id="conv-phone-err" className="mt-1 text-xs text-rose-700" role="alert">
                      {fieldErrors.phone}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="conv-email" className={marketingLabelClass}>
                    {t('marketing.leadManagement.fields.email')}
                  </label>
                  <input
                    id="conv-email"
                    type="email"
                    className={marketingInputClass}
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    dir="ltr"
                    disabled={submitting}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'conv-email-err' : undefined}
                  />
                  {fieldErrors.email ? (
                    <p id="conv-email-err" className="mt-1 text-xs text-rose-700" role="alert">
                      {fieldErrors.email}
                    </p>
                  ) : null}
                </div>
                {matchesLoaded && matches.length > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p>{t('marketing.leadManagement.conversion.matchesFound')}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={switchToLinkExisting}
                      disabled={submitting}
                    >
                      {t('marketing.leadManagement.conversion.switchToLink')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  ref={matchListRef}
                  tabIndex={-1}
                  className="outline-none"
                  aria-live="polite"
                  aria-busy={loadingMatches}
                >
                  {loadingMatches ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600 py-4">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t('marketing.leadManagement.conversion.loadingMatches')}
                    </div>
                  ) : matchesError ? (
                    <div className="space-y-2" role="alert">
                      <p className="text-sm text-rose-700">{matchesError}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void loadMatches({ focus: true })}
                      >
                        {t('marketing.leadManagement.conversion.retry')}
                      </Button>
                    </div>
                  ) : matches.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600 space-y-2">
                      <p>{t('marketing.leadManagement.conversion.noMatches')}</p>
                      <p className="text-xs">
                        {t('marketing.leadManagement.conversion.useCreateNewHint')}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={switchToCreateNew}
                      >
                        {t('marketing.leadManagement.conversion.switchToCreate')}
                      </Button>
                    </div>
                  ) : (
                    <fieldset className="space-y-2 max-h-56 overflow-y-auto pe-1">
                      <legend className="text-xs font-semibold text-slate-600 mb-1">
                        {t('marketing.leadManagement.conversion.selectCustomer')}
                      </legend>
                      {matches.map((m) => (
                        <label
                          key={m.id}
                          className={cn(
                            'flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer',
                            selectedCustomerId === m.id
                              ? 'border-slate-900 bg-slate-50'
                              : 'border-slate-200'
                          )}
                        >
                          <input
                            type="radio"
                            name="convert-customer"
                            className="mt-1"
                            checked={selectedCustomerId === m.id}
                            onChange={() => setSelectedCustomerId(m.id)}
                            disabled={submitting}
                          />
                          <span className="min-w-0">
                            <span className="font-medium break-words block">{m.display_name}</span>
                            {m.customer_type ? (
                              <span className="block text-xs text-slate-500">
                                {m.customer_type === 'company'
                                  ? t('marketing.leadManagement.conversion.typeCompany')
                                  : t('marketing.leadManagement.conversion.typeIndividual')}
                              </span>
                            ) : null}
                            <span className="block text-xs text-slate-500" dir="ltr">
                              {(m.phone || m.matched_raw_phone) ?? '—'}
                              {m.matched_field ? ` · ${m.matched_field}` : ''}
                            </span>
                            {canOpenCustomer ? (
                              <Link
                                to={`/customers/${m.id}`}
                                className="text-xs text-blue-700 underline"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {t('marketing.leadManagement.conversion.viewCustomer')}
                              </Link>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </div>
              </div>
            )}

            {formError ? (
              <div
                className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2"
                role="alert"
              >
                <p>{formError}</p>
                {matchesLoaded && matches.length > 0 && mode === 'create_customer' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={switchToLinkExisting}
                    disabled={submitting}
                  >
                    {t('marketing.leadManagement.conversion.switchToLink')}
                  </Button>
                ) : null}
                {matchesLoaded && matches.length === 0 && mode === 'link_existing_customer' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={switchToCreateNew}
                    disabled={submitting}
                  >
                    {t('marketing.leadManagement.conversion.switchToCreate')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitDisabled} aria-disabled={submitDisabled}>
                {submitting ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                {t('marketing.leadManagement.conversion.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
