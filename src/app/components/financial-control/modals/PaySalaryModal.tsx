import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Banknote, Loader2, AlertCircle } from 'lucide-react';
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
import { payEmployeeSalary } from '@/app/lib/employeeApi';
import type { TeamPerformanceRow } from '@/app/lib/employeeApi';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { useData, type BankCard } from '@/app/contexts/DataContext';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200';

type PaymentMode = 'full' | 'partial';

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function PaySalaryModal({
  employee,
  periodKey,
  periodLabel,
  open,
  onClose,
  onSuccess,
  salaryStatus,
}: {
  employee: TeamPerformanceRow;
  periodKey: string;
  periodLabel: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  salaryStatus: 'pending' | 'partial' | 'paid';
}) {
  const { t, i18n } = useTranslation();
  const { bankCards } = useData();
  const [paidBy, setPaidBy] = useState(bankCards[0]?.id || '');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [manualDeduction, setManualDeduction] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const breakdown = useMemo(() => {
    const gross = employee.salary;
    const priorCash = employee.salary_paid_total || 0;
    const outstanding = employee.outstanding_advances || 0;
    const remainingObligation =
      employee.salary_status === 'paid'
        ? 0
        : Math.max(0, num(employee.salary_remaining_due ?? gross));
    const manual = Math.max(0, num(manualDeduction));
    const afterManual = Math.max(0, remainingObligation - manual);
    const advanceDeduction =
      paymentMode === 'full'
        ? Math.min(outstanding, afterManual)
        : Math.min(outstanding, num(partialAmount));
    const paidAmount =
      paymentMode === 'full'
        ? Math.max(0, afterManual - advanceDeduction)
        : Math.max(0, num(partialAmount));
    const remainingDue = Math.max(0, remainingObligation - manual - paidAmount - advanceDeduction);
    return {
      gross,
      outstanding,
      priorCash,
      remainingObligation,
      manual,
      advanceDeduction,
      payable: afterManual,
      paidAmount,
      remainingDue,
    };
  }, [employee, manualDeduction, paymentMode, partialAmount]);

  const fullyPaid = salaryStatus === 'paid';
  const canSubmit =
    paidBy &&
    breakdown.paidAmount > 0 &&
    (!fullyPaid || confirmed) &&
    breakdown.manual <= breakdown.remainingObligation &&
    (paymentMode === 'full' || breakdown.paidAmount <= breakdown.payable);

  const submit = async () => {
    setSubmitting(true);
    try {
      await payEmployeeSalary(employee.employee_id, {
        period: periodKey,
        paid_by: paidBy,
        date,
        notes: notes || undefined,
        force: fullyPaid && confirmed,
        payment_mode: paymentMode,
        manual_deduction_amount: breakdown.manual || undefined,
        manual_deduction_reason: manualReason || undefined,
        paid_amount: paymentMode === 'partial' ? breakdown.paidAmount : undefined,
      });
      toast.success(t('financialControl.employeeFinancials.salaryPaid'));
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('employees.payroll.duplicateSalary'));
      } else if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'detail' in err.body) {
        toast.error(String((err.body as { detail: string }).detail));
      } else {
        toast.error(t('employees.payroll.payError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="size-5" />
            {t('financialControl.employeeFinancials.paySalary')}
          </DialogTitle>
          <DialogDescription>
            {employee.full_name} · {periodLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fullyPaid && !confirmed && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-700">
              <AlertCircle className="size-4 flex-shrink-0" />
              {t('employees.payroll.duplicateSalary')}
            </div>
          )}
          {salaryStatus === 'partial' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
              {t('financialControl.employeeFinancials.partialAlreadyPaid', {
                paid: fmtAed(employee.salary_paid_total || 0, i18n.language),
                remaining: fmtAed(employee.salary_remaining_due || 0, i18n.language),
              })}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">{t('financialControl.employeeFinancials.grossSalary')}</span>
              <span className="font-mono">{fmtAed(breakdown.gross, i18n.language)}</span>
            </div>
            {breakdown.priorCash > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>{t('financialControl.employeeFinancials.alreadyPaid')}</span>
                <span className="font-mono">- {fmtAed(breakdown.priorCash, i18n.language)}</span>
              </div>
            )}
            {breakdown.outstanding > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>{t('financialControl.advances.outstanding')}</span>
                <span className="font-mono">{fmtAed(breakdown.outstanding, i18n.language)}</span>
              </div>
            )}
            {breakdown.advanceDeduction > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>{t('financialControl.advances.salaryDeduction')}</span>
                <span className="font-mono">- {fmtAed(breakdown.advanceDeduction, i18n.language)}</span>
              </div>
            )}
            {breakdown.manual > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>{t('financialControl.employeeFinancials.manualDeduction')}</span>
                <span className="font-mono">- {fmtAed(breakdown.manual, i18n.language)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
              <span>{t('financialControl.employeeFinancials.payableSalary')}</span>
              <span className="font-mono">{fmtAed(breakdown.payable, i18n.language)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900">
              <span>{t('financialControl.employeeFinancials.paidAmount')}</span>
              <span className="font-mono text-lg">{fmtAed(breakdown.paidAmount, i18n.language)}</span>
            </div>
            {breakdown.remainingDue > 0 && (
              <div className="flex justify-between text-amber-700 text-xs">
                <span>{t('financialControl.employeeFinancials.remainingSalaryDue')}</span>
                <span className="font-mono font-semibold">{fmtAed(breakdown.remainingDue, i18n.language)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                {t('financialControl.employeeFinancials.manualDeduction')}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                value={manualDeduction}
                onChange={(e) => setManualDeduction(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                {t('financialControl.employeeFinancials.deductionReason')}
              </label>
              <input
                className={inputClass}
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder={t('financialControl.employeeFinancials.deductionReasonPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              {t('financialControl.employeeFinancials.paymentMode')}
            </label>
            <select
              className={inputClass}
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
            >
              <option value="full">{t('financialControl.employeeFinancials.paymentModeFull')}</option>
              <option value="partial">{t('financialControl.employeeFinancials.paymentModePartial')}</option>
            </select>
          </div>

          {paymentMode === 'partial' && (
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">
                {t('financialControl.employeeFinancials.partialAmount')}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
              />
            </div>
          )}

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
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.ledger.notes')}</label>
            <textarea
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {fullyPaid && (
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
            {t('employees.payroll.confirmPayment')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
