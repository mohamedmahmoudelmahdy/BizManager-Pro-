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
import { createCheck, fetchLedgerAccounts } from '@/app/lib/financialControlApi';
import { CHECK_TYPES } from '@/app/components/financial-control/types/check';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function AddCheckModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const { bankCards } = useData();
  const [ledgers, setLedgers] = useState<LedgerAccountApi[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    check_number: '',
    payee: '',
    amount: '',
    due_date: '',
    bank_account: '',
    linked_ledger_account: '',
    check_type: 'other',
    notes: '',
  });

  React.useEffect(() => {
    if (!open) return;
    fetchLedgerAccounts().then(setLedgers).catch(() => setLedgers([]));
  }, [open]);

  const submit = async () => {
    if (!form.check_number || !form.payee || !form.amount || !form.due_date) {
      toast.error(t('financialControl.checks.validation'));
      return;
    }
    setSubmitting(true);
    try {
      await createCheck({
        check_number: form.check_number,
        payee: form.payee,
        amount: form.amount,
        due_date: form.due_date,
        bank_account: form.bank_account || null,
        linked_ledger_account: form.linked_ledger_account || null,
        check_type: form.check_type,
        notes: form.notes,
      });
      toast.success(t('financialControl.checks.created'));
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('financialControl.checks.addCheck')}</DialogTitle>
          <DialogDescription>{t('financialControl.checks.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <label className={labelClass}>{t('financialControl.checks.checkNo')}</label>
            <input
              className={inputClass}
              value={form.check_number}
              onChange={(e) => setForm({ ...form, check_number: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.checks.payee')}</label>
            <input
              className={inputClass}
              value={form.payee}
              onChange={(e) => setForm({ ...form, payee: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.amount')}</label>
            <input
              type="number"
              className={inputClass}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.checks.dueDate')}</label>
            <input
              type="date"
              className={inputClass}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.checks.checkType')}</label>
            <select
              className={inputClass}
              value={form.check_type}
              onChange={(e) => setForm({ ...form, check_type: e.target.value })}
            >
              {CHECK_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`financialControl.checks.types.${tp}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.checks.bankAccount')}</label>
            <select
              className={inputClass}
              value={form.bank_account}
              onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
            >
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.checks.linkedLedger')}</label>
            <select
              className={inputClass}
              value={form.linked_ledger_account}
              onChange={(e) => setForm({ ...form, linked_ledger_account: e.target.value })}
            >
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
            <textarea
              rows={2}
              className={`${inputClass} resize-none`}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border border-slate-200 rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting}
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
