import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Paperclip, Clock } from 'lucide-react';
import type { ExpenseApi } from '@/app/lib/operationalFinanceApi';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { num } from '@/app/components/financial-control/utils/format';

export function ExpenseDetailDrawer({
  expense,
  onClose,
}: {
  expense: ExpenseApi | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!expense) return null;

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('financialControl.expenses.category'), value: t(`financialControl.expenses.categories.${expense.category}`, { defaultValue: expense.category }) },
    { label: t('financialControl.expenses.paidBy'), value: expense.paid_by_name || '—' },
    { label: t('financialControl.expenses.employee'), value: expense.employee_name || '—' },
  ];

  if (expense.payroll_type) {
    rows.push({
      label: t('financialControl.expenses.payrollType'),
      value: t(`financialControl.expenses.payrollTypes.${expense.payroll_type}`, { defaultValue: expense.payroll_type }),
    });
  }
  if (expense.payroll_period) {
    rows.push({ label: t('financialControl.expenses.payrollPeriod'), value: <bdi>{expense.payroll_period}</bdi> });
  }
  if (expense.linked_source_type && expense.linked_source_type !== 'manual') {
    rows.push({
      label: t('financialControl.expenses.linkedSource'),
      value: (
        <span className="flex items-center gap-2">
          <FinancialStatusBadge status={expense.linked_source_type} />
          {expense.linked_source_label || '—'}
        </span>
      ),
    });
  }
  rows.push(
    { label: t('financialControl.expenses.date'), value: <bdi>{expense.date}</bdi> },
    { label: t('financialControl.expenses.createdAt'), value: <bdi>{new Date(expense.created_at).toLocaleString()}</bdi> },
    { label: t('financialControl.ledger.notes'), value: expense.notes || '—' }
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl h-full flex flex-col">
        <div className="p-5 border-b flex justify-between items-center">
          <div>
            <h3 className="font-bold">{t('financialControl.expenses.detailTitle')}</h3>
            <p className="text-xs text-slate-500">{expense.id.slice(0, 8)}…</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <CurrencyAmount value={num(expense.amount)} className="text-2xl font-bold" />
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-4 py-2 border-b border-slate-50 text-sm">
                <span className="text-slate-500">{r.label}</span>
                <span className="font-medium text-slate-900 text-end">{r.value}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-slate-500">
              <Paperclip className="size-3.5" />
              {t('financialControl.expenses.attachmentPlaceholder')}
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-3.5" />
              {t('financialControl.expenses.statusPlaceholder')}
            </div>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {t('financialControl.expenses.editDisabled')}
          </p>
        </div>
      </div>
    </div>
  );
}
