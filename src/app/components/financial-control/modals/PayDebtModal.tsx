import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
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
import { payDebt } from '@/app/lib/financialControlApi';
import type { DebtApi } from '@/app/lib/financialControlApi';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function PayDebtModal({
  debt,
  open,
  onClose,
  onSuccess,
}: {
  debt: DebtApi | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards } = useData();
  const remaining = debt ? num(debt.remaining_balance) : 0;
  const defaultInstallment = debt ? num(debt.installment_amount) : 0;
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!debt) return;
    const pay = defaultInstallment > 0 ? defaultInstallment : remaining;
    setAmount(String(pay));
    setPaymentMethodId(debt.default_payment_method || '');
  }, [debt, defaultInstallment, remaining]);

  const payAmount = parseFloat(amount) || 0;
  const remainingAfter = Math.max(0, remaining - payAmount);
  const card = useMemo(() => bankCards.find((c) => c.id === paymentMethodId), [bankCards, paymentMethodId]);
  const isShort = card ? (card.balance ?? 0) < payAmount : false;

  const submit = async () => {
    if (!debt || !paymentMethodId || payAmount <= 0) {
      toast.error(t('financialControl.debts.payValidation'));
      return;
    }
    if (payAmount > remaining) {
      toast.error(t('financialControl.debts.exceedsRemaining'));
      return;
    }
    setSubmitting(true);
    try {
      await payDebt(debt.id, {
        amount: payAmount,
        payment_method_id: paymentMethodId,
        payment_date: paymentDate,
        reference_number: reference,
        notes,
        create_expense: true,
        create_ledger_entry: true,
      });
      toast.success(t('financialControl.debts.paid'));
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!debt) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('financialControl.debts.payDebt')} — {debt.name}
          </DialogTitle>
          <DialogDescription>{debt.creditor}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-4 border text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">{t('financialControl.debts.remaining')}</span>
              <CurrencyAmount value={remaining} className="font-bold text-red-600" />
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${debt.paid_percent}%` }} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.paymentAmount')}</label>
            <input type="number" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.payFrom')}</label>
            <select className={inputClass} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          {isShort && (
            <p className="text-xs text-red-600">{t('financialControl.checks.insufficient')}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('financialControl.debts.paymentDate')}</label>
              <input type="date" className={inputClass} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>{t('financialControl.debts.refNo')}</label>
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
            <div className="font-semibold mb-1">{t('financialControl.debts.whatWillHappen')}</div>
            <div>
              • {fmtAed(payAmount, i18n.language)} {t('financialControl.debts.deductFrom')}
            </div>
            <div>
              • {t('financialControl.debts.remainingAfter')}{' '}
              <bdi className="font-semibold">{fmtAed(remainingAfter, i18n.language)}</bdi>
            </div>
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
            disabled={submitting || !paymentMethodId || isShort}
            onClick={submit}
            className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.debts.confirmPayment')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
