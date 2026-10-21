import React, { useState } from 'react';
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
import { createExpense } from '@/app/lib/operationalFinanceApi';
import { EXPENSE_CATEGORIES } from '@/app/components/financial-control/types/expense';
import { fmtAed } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function AddFcExpenseModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards, employees, refreshBankCards } = useData();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: 'office',
    amount: '',
    paid_by: '',
    assigned_employee: '',
    notes: '',
  });

  const selectedCard = bankCards.find((c) => c.id === form.paid_by);
  const amountNum = parseFloat(form.amount) || 0;
  const insufficient = selectedCard && amountNum > (selectedCard.balance ?? 0);

  const submit = async () => {
    if (!form.amount || !form.paid_by || !form.category) {
      toast.error(t('financialControl.expenses.validation'));
      return;
    }
    setSubmitting(true);
    try {
      await createExpense({
        category: form.category,
        date: form.date,
        amount: amountNum,
        paid_by: form.paid_by,
        assigned_employee: form.assigned_employee || null,
        notes: form.notes,
      });
      await refreshBankCards();
      toast.success(t('financialControl.expenses.created'));
      onSuccess();
      onClose();
      setForm({
        date: new Date().toISOString().slice(0, 10),
        category: 'office',
        amount: '',
        paid_by: '',
        assigned_employee: '',
        notes: '',
      });
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('financialControl.expenses.addExpense')}</DialogTitle>
          <DialogDescription>{t('financialControl.expenses.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <label className={labelClass}>{t('financialControl.expenses.date')}</label>
            <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.expenses.category')}</label>
            <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`financialControl.expenses.categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.amount')}</label>
            <input type="number" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.expenses.paidBy')}</label>
            <select className={inputClass} value={form.paid_by} onChange={(e) => setForm({ ...form, paid_by: e.target.value })}>
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.expenses.employee')}</label>
            <select className={inputClass} value={form.assigned_employee} onChange={(e) => setForm({ ...form, assigned_employee: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.userId || e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.ledger.notes')}</label>
            <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {insufficient && (
          <p className="text-xs text-red-600">{t('financialControl.checks.insufficient')}</p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting || insufficient}
            onClick={submit}
            className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
