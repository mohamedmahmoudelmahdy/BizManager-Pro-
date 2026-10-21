import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckSquare, Loader2 } from 'lucide-react';
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
import { useData } from '@/app/contexts/DataContext';
import { deductCheck } from '@/app/lib/financialControlApi';
import type { CheckApi } from '@/app/lib/financialControlApi';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function DeductCheckModal({
  check,
  open,
  onClose,
  onSuccess,
}: {
  check: CheckApi | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards } = useData();
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (check?.bank_account) setPaymentMethodId(check.bank_account);
    else setPaymentMethodId('');
  }, [check]);

  const amount = check ? num(check.amount) : 0;
  const card = useMemo(
    () => bankCards.find((c) => c.id === paymentMethodId),
    [bankCards, paymentMethodId]
  );
  const balanceAfter = card ? (card.balance ?? 0) - amount : null;
  const isShort = balanceAfter !== null && balanceAfter < 0;

  const submit = async () => {
    if (!check || !paymentMethodId) {
      toast.error(t('financialControl.checks.paymentRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await deductCheck(check.id, {
        payment_method_id: paymentMethodId,
        notes,
        create_expense: true,
        create_ledger_entry: true,
      });
      toast.success(t('financialControl.checks.deductedSuccess'));
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!check) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <CheckSquare className="size-5" />
            {t('financialControl.checks.deductTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('financialControl.checks.deductConfirm', {
              amount: fmtAed(amount, i18n.language),
              bank: card?.bankName || '—',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <CurrencyAmount value={amount} className="text-2xl font-bold font-mono" />
            <p className="text-sm text-slate-500 mt-1">
              {check.payee} · {check.check_number}
            </p>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.checks.deductFrom')}</label>
            <select
              className={inputClass}
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
            >
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          {card && balanceAfter !== null && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-slate-50 rounded-xl p-3 border">
                <div className="text-slate-400 mb-1">{t('financialControl.ledger.currentBalance')}</div>
                <CurrencyAmount value={card.balance ?? 0} className="font-bold font-mono text-sm" />
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border">
                <div className="text-slate-400 mb-1">{t('financialControl.ledger.amount')}</div>
                <CurrencyAmount value={amount} className="font-bold font-mono text-sm text-red-600" />
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border">
                <div className="text-slate-400 mb-1">{t('financialControl.checks.balanceAfter')}</div>
                <CurrencyAmount
                  value={Math.abs(balanceAfter)}
                  className={`font-bold font-mono text-sm ${isShort ? 'text-red-600' : 'text-emerald-700'}`}
                />
              </div>
            </div>
          )}
          {isShort && (
            <div className="flex gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
              <AlertTriangle className="size-4 flex-shrink-0" />
              {t('financialControl.checks.insufficient')}
            </div>
          )}
          <div>
            <label className={labelClass}>{t('financialControl.ledger.notes')}</label>
            <textarea
              rows={2}
              className={`${inputClass} resize-none`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting || !paymentMethodId}
            onClick={submit}
            className={`px-5 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2 ${
              isShort ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.checks.confirmDeduct')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
