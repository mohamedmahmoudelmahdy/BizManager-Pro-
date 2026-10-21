import React, { useEffect, useState } from 'react';
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
import { createDebt, fetchLedgerAccounts, updateDebt } from '@/app/lib/financialControlApi';
import type { DebtApi } from '@/app/lib/financialControlApi';
import { DEBT_FREQUENCIES, DEBT_TYPES } from '@/app/components/financial-control/types/debt';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

type FormState = {
  name: string;
  creditor: string;
  debt_type: string;
  original_amount: string;
  installment_amount: string;
  total_installments: string;
  due_date: string;
  next_payment_date: string;
  payment_frequency: string;
  linked_ledger_account: string;
  default_payment_method: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  name: '',
  creditor: '',
  debt_type: 'other',
  original_amount: '',
  installment_amount: '',
  total_installments: '0',
  due_date: '',
  next_payment_date: '',
  payment_frequency: 'monthly',
  linked_ledger_account: '',
  default_payment_method: '',
  notes: '',
});

export function AddDebtModal({
  open,
  onClose,
  onSuccess,
  editDebt,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editDebt?: DebtApi | null;
}) {
  const { t } = useTranslation();
  const { bankCards } = useData();
  const [ledgers, setLedgers] = useState<LedgerAccountApi[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  useEffect(() => {
    if (!open) return;
    fetchLedgerAccounts().then(setLedgers).catch(() => setLedgers([]));
    if (editDebt) {
      setForm({
        name: editDebt.name,
        creditor: editDebt.creditor,
        debt_type: editDebt.debt_type,
        original_amount: String(editDebt.original_amount),
        installment_amount: String(editDebt.installment_amount),
        total_installments: String(editDebt.total_installments),
        due_date: editDebt.due_date || '',
        next_payment_date: editDebt.next_payment_date || '',
        payment_frequency: editDebt.payment_frequency,
        linked_ledger_account: editDebt.linked_ledger_account || '',
        default_payment_method: editDebt.default_payment_method || '',
        notes: editDebt.notes || '',
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, editDebt]);

  const submit = async () => {
    if (!form.name || !form.creditor || !form.original_amount) {
      toast.error(t('financialControl.debts.validation'));
      return;
    }
    setSubmitting(true);
    const payload = {
      name: form.name,
      creditor: form.creditor,
      debt_type: form.debt_type,
      original_amount: form.original_amount,
      installment_amount: form.installment_amount || 0,
      total_installments: parseInt(form.total_installments, 10) || 0,
      due_date: form.due_date || null,
      next_payment_date: form.next_payment_date || null,
      payment_frequency: form.payment_frequency,
      linked_ledger_account: form.linked_ledger_account || null,
      default_payment_method: form.default_payment_method || null,
      notes: form.notes,
    };
    try {
      if (editDebt) {
        await updateDebt(editDebt.id, payload);
        toast.success(t('financialControl.debts.updated'));
      } else {
        await createDebt(payload);
        toast.success(t('financialControl.debts.created'));
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t('financialControl.shell.loadError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editDebt ? t('financialControl.debts.editDebt') : t('financialControl.debts.addLiability')}
          </DialogTitle>
          <DialogDescription>{t('financialControl.debts.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <label className={labelClass}>{t('financialControl.debts.debtName')}</label>
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.creditor')}</label>
            <input className={inputClass} value={form.creditor} onChange={(e) => setForm({ ...form, creditor: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.debtType')}</label>
            <select className={inputClass} value={form.debt_type} onChange={(e) => setForm({ ...form, debt_type: e.target.value })}>
              {DEBT_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`financialControl.debts.types.${tp}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.originalAmount')}</label>
            <input type="number" className={inputClass} value={form.original_amount} onChange={(e) => setForm({ ...form, original_amount: e.target.value })} disabled={!!editDebt} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.installment')}</label>
            <input type="number" className={inputClass} value={form.installment_amount} onChange={(e) => setForm({ ...form, installment_amount: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.totalInstallments')}</label>
            <input type="number" className={inputClass} value={form.total_installments} onChange={(e) => setForm({ ...form, total_installments: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.nextPayment')}</label>
            <input type="date" className={inputClass} value={form.next_payment_date} onChange={(e) => setForm({ ...form, next_payment_date: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.dueDate')}</label>
            <input type="date" className={inputClass} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.frequency')}</label>
            <select className={inputClass} value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value })}>
              {DEBT_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`financialControl.debts.frequencies.${f}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.debts.payFrom')}</label>
            <select className={inputClass} value={form.default_payment_method} onChange={(e) => setForm({ ...form, default_payment_method: e.target.value })}>
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.debts.linkedLedger')}</label>
            <select className={inputClass} value={form.linked_ledger_account} onChange={(e) => setForm({ ...form, linked_ledger_account: e.target.value })}>
              <option value="">—</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.ledger.notes')}</label>
            <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button type="button" disabled={submitting} onClick={submit} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-2">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('common.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
