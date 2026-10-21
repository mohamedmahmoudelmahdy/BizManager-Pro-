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
import { createLedgerAccount } from '@/app/lib/financialControlApi';
import { accountTypeToApi, fmtAed } from '@/app/components/financial-control/utils/format';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white';
const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

const TYPE_OPTIONS = [
  'Internal',
  'Customer',
  'Vendor',
  'Employee',
  'Partner',
  'Government Provider',
  'Office Debt',
  'Vehicle',
  'Checks',
  'Other',
];

export function AddLedgerAccountModal({
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
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    account_code: '',
    account_type: 'Internal',
    opening_balance_type: 'credit' as 'credit' | 'debit',
    opening_balance_amount: '',
    linked_payment_method: '',
    linked_vendor_name: '',
    notes: '',
  });

  const opening = parseFloat(form.opening_balance_amount) || 0;
  const preview =
    form.opening_balance_type === 'credit' ? opening : -opening;

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('financialControl.ledger.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await createLedgerAccount({
        name: form.name.trim(),
        account_code: form.account_code.trim(),
        account_type: accountTypeToApi(form.account_type),
        opening_balance_type: form.opening_balance_type,
        opening_balance_amount: opening,
        linked_payment_method: form.linked_payment_method || null,
        linked_vendor_name: form.linked_vendor_name,
        notes: form.notes,
        status: 'active',
      });
      toast.success(t('financialControl.ledger.accountCreated'));
      onSuccess();
      onClose();
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('financialControl.ledger.addAccount')}</DialogTitle>
          <DialogDescription>{t('financialControl.ledger.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('financialControl.ledger.accountName')}</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelClass}>{t('financialControl.ledger.accountCode')}</label>
              <input
                className={inputClass}
                value={form.account_code}
                onChange={(e) => setForm((f) => ({ ...f, account_code: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.accountType')}</label>
            <select
              className={inputClass}
              value={form.account_type}
              onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('financialControl.ledger.openingType')}</label>
              <select
                className={inputClass}
                value={form.opening_balance_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    opening_balance_type: e.target.value as 'credit' | 'debit',
                  }))
                }
              >
                <option value="credit">{t('financialControl.ledger.credit')}</option>
                <option value="debit">{t('financialControl.ledger.debit')}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('financialControl.ledger.openingAmount')}</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={form.opening_balance_amount}
                onChange={(e) => setForm((f) => ({ ...f, opening_balance_amount: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('financialControl.ledger.paymentMethod')}</label>
            <select
              className={inputClass}
              value={form.linked_payment_method}
              onChange={(e) => setForm((f) => ({ ...f, linked_payment_method: e.target.value }))}
            >
              <option value="">—</option>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName}
                </option>
              ))}
            </select>
          </div>
          {opening > 0 && (
            <p className="text-xs text-slate-500">
              {t('financialControl.ledger.openingPreview')}: {fmtAed(preview)}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 text-sm border rounded-lg">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="px-5 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.ledger.createAccount')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
