import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/app/components/ui/dialog';
import { createLedgerEntry } from '@/app/lib/financialControlApi';
import { ApiError } from '@/app/lib/api';
import { useData } from '@/app/contexts/DataContext';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function AddLedgerEntryModal({
  account,
  open,
  onClose,
  onSuccess,
}: {
  account: LedgerAccountApi;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards, refreshBankCards } = useData();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    entry_type: 'debit' as 'debit' | 'credit',
    amount: '',
    notes: '',
    status: 'draft' as 'draft' | 'posted',
    post_now: true,
    affects_payment_method: false,
    related_payment_method: '',
  });

  const amount = parseFloat(form.amount) || 0;
  const balance = num(account.current_balance);
  const preview =
    form.entry_type === 'credit' ? balance + amount : balance - amount;

  const selectedCard = bankCards.find((c) => c.id === form.related_payment_method);
  const pmBefore = selectedCard ? num(selectedCard.balance) : 0;
  const pmAfter =
    form.entry_type === 'credit' ? pmBefore + amount : pmBefore - amount;

  const handleSubmit = async () => {
    if (!form.description.trim() || amount <= 0) {
      toast.error(t('financialControl.ledger.entryValidation'));
      return;
    }
    if (form.affects_payment_method && !form.related_payment_method) {
      toast.error(t('financialControl.ledger.paymentMethodRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await createLedgerEntry(account.id, {
        date: form.date,
        description: form.description.trim(),
        entry_type: form.entry_type,
        amount,
        notes: form.notes,
        status: 'draft',
        post_now: form.post_now,
        affects_payment_method: form.affects_payment_method,
        related_payment_method: form.affects_payment_method
          ? form.related_payment_method
          : null,
      });
      toast.success(t('financialControl.ledger.entrySaved'));
      // If the entry moved cash, payment method balances changed — refresh them
      // so the Payments page and overview reflect the new balance.
      if (form.affects_payment_method) {
        await refreshBankCards();
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const detail = e instanceof ApiError ? e.detail : '';
      toast.error(detail || t('financialControl.ledger.saveError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <BookOpen className="size-4 text-indigo-500" />
            {t('financialControl.ledger.addEntry')}
          </DialogTitle>
          <DialogDescription>{account.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('financialControl.ledger.entryDate')}</label>
              <input
                type="date"
                className={inputClass}
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>{t('financialControl.ledger.entryType')}</label>
              <select
                className={inputClass}
                value={form.entry_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entry_type: e.target.value as 'debit' | 'credit' }))
                }
              >
                <option value="debit">{t('financialControl.ledger.debit')}</option>
                <option value="credit">{t('financialControl.ledger.credit')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.description')}</label>
            <input
              className={inputClass}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.amount')}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.notes')}</label>
            <textarea
              rows={2}
              className={inputClass}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.post_now}
              onChange={(e) => setForm((f) => ({ ...f, post_now: e.target.checked }))}
            />
            {t('financialControl.ledger.postNow')}
          </label>

          <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.affects_payment_method}
                onChange={(e) =>
                  setForm((f) => ({ ...f, affects_payment_method: e.target.checked }))
                }
              />
              {t('financialControl.ledger.affectsPaymentMethod')}
            </label>
            <p className="text-xs text-slate-400">
              {form.affects_payment_method
                ? t('financialControl.ledger.affectsPaymentMethodOn')
                : t('financialControl.ledger.affectsPaymentMethodOff')}
            </p>
            {form.affects_payment_method && (
              <div>
                <label className={labelClass}>{t('financialControl.ledger.paymentMethod')}</label>
                <select
                  className={inputClass}
                  value={form.related_payment_method}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, related_payment_method: e.target.value }))
                  }
                >
                  <option value="">—</option>
                  {bankCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {amount > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 space-y-1">
              <div>{t('financialControl.ledger.balanceAfter')}: {fmtAed(preview)}</div>
              {form.affects_payment_method && selectedCard && (
                <>
                  <div>
                    {t('financialControl.ledger.pmBalanceBefore')}: {fmtAed(pmBefore, i18n.language)}
                  </div>
                  <div>
                    {t('financialControl.ledger.pmBalanceAfter')}: {fmtAed(pmAfter, i18n.language)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border border-slate-200 rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="px-5 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.ledger.saveEntry')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
