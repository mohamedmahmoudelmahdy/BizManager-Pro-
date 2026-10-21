import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { useData } from '@/app/contexts/DataContext';
import { cn } from '@/app/components/ui/utils';

export type RefundPaymentTarget = {
  id: string;
  amount: string;
  refunded_amount?: string;
  refundable_amount?: string;
  bank_card_name?: string;
  date: string | null;
};

export type RefundPaymentPayload = {
  amount: string;
  payment_method: string;
  date: string;
  reason: string;
  notes: string;
};

function fmtAed(value: number) {
  return `AED ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function balanceLabel(balance: number, t: (k: string) => string) {
  if (balance > 0) return `${fmtAed(Math.abs(balance))} ${t('customers.refund.debt')}`;
  if (balance < 0) return `${fmtAed(Math.abs(balance))} ${t('customers.refund.credit')}`;
  return t('customers.refund.settled');
}

export function CustomerPaymentRefundModal({
  open,
  onOpenChange,
  payment,
  customerBalance,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: RefundPaymentTarget | null;
  customerBalance: number;
  onSubmit: (payload: RefundPaymentPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { paymentMethods } = useData();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const original = Number(payment?.amount || 0);
  const alreadyRefunded = Number(payment?.refunded_amount || 0);
  const refundable = Number(
    payment?.refundable_amount != null
      ? payment.refundable_amount
      : Math.max(original - alreadyRefunded, 0)
  );

  useEffect(() => {
    if (!open || !payment) return;
    setAmount(refundable > 0 ? refundable.toFixed(2) : '');
    setPaymentMethod(paymentMethods[0]?.id || '');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setReason('');
    setNotes('');
    setSaving(false);
  }, [open, payment?.id, paymentMethods, refundable]);

  const refundAmount = Number(amount || 0);
  const balanceAfter = customerBalance + (Number.isFinite(refundAmount) ? refundAmount : 0);

  const validationMessage = useMemo(() => {
    if (!payment) return '';
    if (refundable <= 0) return t('customers.refund.alreadyFullyRefunded');
    if (!amount || !Number.isFinite(refundAmount) || refundAmount <= 0) {
      return t('customers.refund.amountGreaterThanZero');
    }
    if (refundAmount > refundable + 1e-9) return t('customers.refund.exceedsRefundable');
    if (!paymentMethod) return t('customers.refund.methodRequired');
    if (!reason.trim()) return t('customers.refund.reasonRequired');
    return '';
  }, [amount, payment, paymentMethod, reason, refundAmount, refundable, t]);

  const handleSubmit = async () => {
    if (!payment || validationMessage) return;
    setSaving(true);
    try {
      await onSubmit({
        amount: Number(refundAmount).toFixed(2),
        payment_method: paymentMethod,
        date,
        reason: reason.trim(),
        notes: notes.trim(),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('customers.refund.title')}</DialogTitle>
          <DialogDescription>{t('customers.refund.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ReadonlyField label={t('customers.refund.originalPayment')} value={fmtAed(original)} />
            <ReadonlyField label={t('customers.refund.alreadyRefunded')} value={fmtAed(alreadyRefunded)} />
            <ReadonlyField label={t('customers.refund.refundable')} value={fmtAed(refundable)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{t('customers.refund.amount')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{t('customers.refund.date')}</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.refund.method')}</label>
            <select
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:ring-1 focus:ring-black focus:border-black outline-none"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="">{t('customers.refund.selectMethod')}</option>
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.bankName} ({m.methodType}) — {fmtAed(m.balance ?? 0)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.refund.reason')}</label>
            <input
              dir="auto"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('customers.refund.reasonPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.refund.notes')}</label>
            <textarea
              dir="auto"
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
            <ReadonlyField
              label={t('customers.refund.balanceBefore')}
              value={balanceLabel(customerBalance, t)}
            />
            <ReadonlyField
              label={t('customers.refund.balanceAfter')}
              value={balanceLabel(balanceAfter, t)}
              emphasize
            />
          </div>

          {validationMessage ? (
            <p className="text-sm text-red-600">{validationMessage}</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <button
              type="button"
              className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={!!validationMessage || saving}
            onClick={handleSubmit}
            className={cn(
              'px-4 py-2 text-sm rounded-md text-white',
              validationMessage || saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800'
            )}
          >
            {saving
              ? t('customers.refund.confirm', { amount: fmtAed(Number.isFinite(refundAmount) ? refundAmount : 0) }) + '…'
              : t('customers.refund.confirm', { amount: fmtAed(Number.isFinite(refundAmount) ? refundAmount : 0) })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadonlyField({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase font-semibold text-gray-500">{label}</p>
      <p className={cn('text-sm font-semibold', emphasize ? 'text-slate-900' : 'text-gray-800')}>{value}</p>
    </div>
  );
}
