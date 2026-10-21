import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
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
import { createDeposit } from '@/app/lib/operationalFinanceApi';
import { fmtAed } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

export function AddTransferModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { bankCards, refreshBankCards } = useData();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    from_method: '',
    to_method: '',
    notes: '',
  });

  const fromCard = useMemo(() => bankCards.find((c) => c.id === form.from_method), [bankCards, form.from_method]);
  const amountNum = parseFloat(form.amount) || 0;
  const sameAccount = form.from_method && form.from_method === form.to_method;
  const insufficient = fromCard && amountNum > (fromCard.balance ?? 0);

  const submit = async () => {
    if (!form.amount || !form.from_method || !form.to_method) {
      toast.error(t('financialControl.transfers.validation'));
      return;
    }
    if (sameAccount) {
      toast.error(t('financialControl.transfers.sameAccount'));
      return;
    }
    setSubmitting(true);
    try {
      await createDeposit({
        date: form.date,
        amount: amountNum,
        from_method: form.from_method,
        to_method: form.to_method,
        notes: form.notes,
      });
      await refreshBankCards();
      toast.success(t('financialControl.transfers.created'));
      onSuccess();
      onClose();
      setForm({
        date: new Date().toISOString().slice(0, 10),
        amount: '',
        from_method: '',
        to_method: '',
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
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-5" />
            {t('financialControl.transfers.addTransfer')}
          </DialogTitle>
          <DialogDescription>{t('financialControl.transfers.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <label className={labelClass}>{t('financialControl.expenses.date')}</label>
            <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.amount')}</label>
            <input type="number" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.transfers.from')}</label>
            <select className={inputClass} value={form.from_method} onChange={(e) => setForm({ ...form, from_method: e.target.value })}>
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.transfers.to')}</label>
            <select className={inputClass} value={form.to_method} onChange={(e) => setForm({ ...form, to_method: e.target.value })}>
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName} — {fmtAed(c.balance ?? 0, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>{t('financialControl.ledger.notes')}</label>
            <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        {(insufficient || sameAccount) && (
          <p className="text-xs text-red-600">
            {sameAccount ? t('financialControl.transfers.sameAccount') : t('financialControl.checks.insufficient')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting || insufficient || !!sameAccount}
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
