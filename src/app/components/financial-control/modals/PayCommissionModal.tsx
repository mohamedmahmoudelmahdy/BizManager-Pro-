import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Coins, Loader2, AlertCircle } from 'lucide-react';
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
import { payEmployeeCommission } from '@/app/lib/employeeApi';
import type { TeamPerformanceRow } from '@/app/lib/employeeApi';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { useData, type BankCard } from '@/app/contexts/DataContext';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200';

export function PayCommissionModal({
  employee,
  periodKey,
  periodLabel,
  open,
  onClose,
  onSuccess,
  alreadyPaid,
}: {
  employee: TeamPerformanceRow;
  periodKey: string;
  periodLabel: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  alreadyPaid: boolean;
}) {
  const { t } = useTranslation();
  const { bankCards } = useData();
  const [paidBy, setPaidBy] = useState(bankCards[0]?.id || '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const due = employee.commission_amount;
  const canSubmit = paidBy && due > 0 && (!alreadyPaid || confirmed);

  const submit = async () => {
    setSubmitting(true);
    try {
      await payEmployeeCommission(employee.employee_id, {
        period: periodKey,
        paid_by: paidBy,
        date,
        notes: notes || undefined,
        force: alreadyPaid && confirmed,
      });
      toast.success(t('financialControl.employeeFinancials.commissionPaid'));
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('employees.payroll.duplicateCommission'));
      } else {
        toast.error(t('employees.payroll.payError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="size-5" />
            {t('financialControl.employeeFinancials.payCommission')}
          </DialogTitle>
          <DialogDescription>
            {employee.full_name} · {periodLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {alreadyPaid && !confirmed && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-700">
              <AlertCircle className="size-4 flex-shrink-0" />
              {t('employees.payroll.duplicateCommission')}
            </div>
          )}
          {due <= 0 && (
            <p className="text-sm text-slate-500">{t('financialControl.employeeFinancials.noCommissionDue')}</p>
          )}
          <div className="bg-slate-50 rounded-xl p-4 border">
            <div className="text-xs text-slate-500 mb-1">{t('financialControl.employeeFinancials.commissionDue')}</div>
            <CurrencyAmount value={due} className="text-2xl font-bold" />
            <div className="text-xs text-slate-500 mt-2">
              {t('financialControl.employeeFinancials.commissionRate')}: {employee.commission_rate}%
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.expenses.paidBy')}</label>
            <select className={inputClass} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {bankCards.map((c: BankCard) => (
                <option key={c.id} value={c.id}>
                  {c.bankName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.expenses.date')}</label>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {alreadyPaid && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t('employees.payroll.confirmDuplicate')}
            </label>
          )}
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
            {t('employees.payroll.confirmCommission')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
