import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, Loader2 } from 'lucide-react';
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
import { reverseSalaryPayment } from '@/app/lib/employeeApi';
import type { ExpenseApi } from '@/app/lib/operationalFinanceApi';
import { fmtAed } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200';

export function ReverseSalaryModal({
  employeeProfileId,
  expense,
  open,
  onClose,
  onSuccess,
}: {
  employeeProfileId: string;
  expense: ExpenseApi;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await reverseSalaryPayment(employeeProfileId, expense.id, reason.trim());
      toast.success(t('financialControl.employeeFinancials.salaryReversed'));
      onSuccess();
      onClose();
    } catch (err) {
      const detail =
        err instanceof ApiError && typeof err.detail === 'string' ? err.detail : '';
      toast.error(detail || t('financialControl.employeeFinancials.salaryReverseError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="size-5" />
            {t('financialControl.employeeFinancials.reverseSalaryTitle')}
          </DialogTitle>
          <DialogDescription>
            {expense.employee_name} · {fmtAed(Number(expense.amount), i18n.language)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-600">{t('financialControl.employeeFinancials.reverseSalaryConfirm')}</p>
        <label className="block text-sm">
          <span className="text-slate-600">{t('financialControl.advances.reason')}</span>
          <textarea
            className={`${inputClass} mt-1 min-h-[72px]`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('financialControl.employeeFinancials.reverseSalaryReasonPlaceholder')}
          />
        </label>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting || !reason.trim()}
            onClick={submit}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.employeeFinancials.reverseSalary')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
