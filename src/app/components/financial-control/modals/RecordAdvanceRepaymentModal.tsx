import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { HandCoins, Loader2 } from 'lucide-react';
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
import { ApiError } from '@/app/lib/api';
import { recordAdvanceRepayment, fetchEmployeeAdvanceSummary } from '@/app/lib/employeeApi';
import type { TeamPerformanceRow } from '@/app/lib/employeeApi';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { useData, type BankCard } from '@/app/contexts/DataContext';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200';

export function RecordAdvanceRepaymentModal({
  employee,
  open,
  onClose,
  onSuccess,
}: {
  employee: TeamPerformanceRow;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards, refreshBankCards } = useData();
  const [paymentMethod, setPaymentMethod] = useState(bankCards[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outstanding, setOutstanding] = useState(0);
  const [activeAdvances, setActiveAdvances] = useState<
    Array<{ id: string; outstanding_balance: string; date: string }>
  >([]);

  useEffect(() => {
    if (!open) return;
    fetchEmployeeAdvanceSummary(employee.user_id)
      .then((data) => {
        setOutstanding(Number(data.outstanding_total));
        const active = data.advances.filter(
          (a) => a.status === 'active' && Number(a.outstanding_balance) > 0
        );
        setActiveAdvances(active);
        setAdvanceId('');
      })
      .catch(() => {
        setOutstanding(employee.outstanding_advances || 0);
        setActiveAdvances([]);
      });
  }, [open, employee]);

  const amountNum = Number(amount);
  const selectedCard = bankCards.find((c: BankCard) => c.id === paymentMethod);
  const selectedBalance = selectedCard?.balance ?? 0;
  const balanceAfter = selectedCard ? selectedBalance + (amountNum || 0) : null;
  const maxAmount = advanceId
    ? Number(activeAdvances.find((a) => a.id === advanceId)?.outstanding_balance || outstanding)
    : outstanding;
  const overMax = amountNum > maxAmount;
  const canSubmit = paymentMethod && amountNum > 0 && !overMax && outstanding > 0;

  const submit = async () => {
    setSubmitting(true);
    try {
      await recordAdvanceRepayment({
        employee: employee.user_id,
        amount: amountNum,
        payment_method: paymentMethod,
        date,
        notes: notes || undefined,
        advance: advanceId || undefined,
      });
      toast.success(t('financialControl.advances.repaymentRecorded'));
      await refreshBankCards();
      onSuccess();
      onClose();
    } catch (err) {
      const detail =
        err instanceof ApiError && typeof err.detail === 'string' ? err.detail : '';
      toast.error(detail || t('financialControl.advances.repaymentError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="size-5" />
            {t('financialControl.advances.recordRepayment')}
          </DialogTitle>
          <DialogDescription>{employee.full_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-800">
            {t('financialControl.advances.outstanding')}:{' '}
            <span className="font-mono font-semibold">{fmtAed(outstanding, i18n.language)}</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.ledger.amount')}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              max={maxAmount}
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            {overMax && (
              <p className="text-xs text-rose-600 mt-1">{t('financialControl.advances.repaymentOverMax')}</p>
            )}
          </div>
          {activeAdvances.length > 1 && (
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                {t('financialControl.advances.repayAdvance')}
              </label>
              <select
                className={inputClass}
                value={advanceId}
                onChange={(e) => setAdvanceId(e.target.value)}
              >
                <option value="">{t('financialControl.advances.repayFifo')}</option>
                {activeAdvances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.date} · {fmtAed(Number(a.outstanding_balance), i18n.language)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.advances.receivedInto')}
            </label>
            <select
              className={inputClass}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              {bankCards.map((c: BankCard) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} · {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.expenses.date')}
            </label>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.advances.notesReference')}
            </label>
            <textarea
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('financialControl.advances.repaymentNotesPlaceholder')}
            />
          </div>
          {selectedCard && amountNum > 0 && (
            <div className="rounded-lg p-3 text-xs space-y-1 border bg-emerald-50 border-emerald-100 text-emerald-800">
              <div className="flex justify-between">
                <span>{t('financialControl.advances.balanceBefore')}</span>
                <span className="font-mono">{fmtAed(selectedBalance, i18n.language)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{t('financialControl.advances.balanceAfter')}</span>
                <span className="font-mono">{fmtAed(balanceAfter ?? 0, i18n.language)}</span>
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400">{t('financialControl.advances.repaymentNote')}</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={submit}
            className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.advances.confirmRepayment')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
