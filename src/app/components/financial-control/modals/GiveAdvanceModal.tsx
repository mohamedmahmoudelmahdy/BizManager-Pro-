import React, { useState } from 'react';
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
import { giveEmployeeAdvance } from '@/app/lib/employeeApi';
import type { TeamPerformanceRow } from '@/app/lib/employeeApi';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { useData, type BankCard } from '@/app/contexts/DataContext';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200';

export function GiveAdvanceModal({
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
  const [paidBy, setPaidBy] = useState(bankCards[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountNum = Number(amount);
  const selectedCard = bankCards.find((c: BankCard) => c.id === paidBy);
  const selectedBalance = selectedCard?.balance ?? 0;
  const balanceAfter = selectedCard ? selectedBalance - (amountNum || 0) : null;
  const insufficient = balanceAfter !== null && balanceAfter < 0;
  const canSubmit = paidBy && amountNum > 0 && !insufficient;

  const submit = async () => {
    setSubmitting(true);
    try {
      await giveEmployeeAdvance({
        employee: employee.user_id,
        amount: amountNum,
        paid_by: paidBy,
        date,
        reason: reason || undefined,
      });
      toast.success(t('financialControl.advances.given'));
      await refreshBankCards();
      onSuccess();
      onClose();
    } catch (err) {
      const detail =
        err instanceof ApiError && typeof err.detail === 'string' ? err.detail : '';
      toast.error(detail || t('financialControl.advances.giveError'));
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
            {t('financialControl.advances.giveAdvance')}
          </DialogTitle>
          <DialogDescription>{employee.full_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.ledger.amount')}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.expenses.paidBy')}
            </label>
            <select className={inputClass} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
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
              {t('financialControl.advances.reason')}
            </label>
            <textarea
              className={inputClass}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('financialControl.advances.reasonPlaceholder')}
            />
          </div>
          {selectedCard && amountNum > 0 && (
            <div
              className={
                'rounded-lg p-3 text-xs space-y-1 border ' +
                (insufficient ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-600')
              }
            >
              <div className="flex justify-between">
                <span>{t('financialControl.advances.balanceBefore')}</span>
                <span className="font-mono">{fmtAed(selectedBalance, i18n.language)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{t('financialControl.advances.balanceAfter')}</span>
                <span className="font-mono">{fmtAed(balanceAfter ?? 0, i18n.language)}</span>
              </div>
              {insufficient && <div>{t('financialControl.advances.insufficient')}</div>}
            </div>
          )}
          <p className="text-xs text-slate-400">{t('financialControl.advances.giveNote')}</p>
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
            {t('financialControl.advances.confirmGive')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
