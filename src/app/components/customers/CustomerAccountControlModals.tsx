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
import { cn } from '@/app/components/ui/utils';

export type CustomerAccountTarget = {
  id: string;
  name: string;
  balance: number;
  accountStatus?: 'active' | 'closed';
};

type DirectDiscountPayload = {
  amount: string;
  date: string;
  reason: string;
  notes: string;
};

function fmtAed(value: number) {
  return `AED ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DirectDiscountModal({
  open,
  onOpenChange,
  customer,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerAccountTarget | null;
  onSubmit: (payload: DirectDiscountPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setReason('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
    setSaving(false);
  }, [open, customer?.id]);

  const outstanding = Math.max(Number(customer?.balance || 0), 0);
  const discount = Number(amount || 0);
  const balanceAfter = Math.max(outstanding - (Number.isFinite(discount) ? discount : 0), 0);

  const validationMessage = useMemo(() => {
    if (!customer) return '';
    if (customer.accountStatus === 'closed') return t('customers.account.closedCreateBlocked');
    if (outstanding <= 0) return t('customers.account.noDebitForDiscount');
    if (!amount || discount <= 0) return t('customers.account.amountGreaterThanZero');
    if (discount > outstanding) return t('customers.account.discountExceedsOutstanding');
    if (!reason.trim()) return t('customers.account.reasonRequired');
    return '';
  }, [amount, customer, discount, outstanding, reason, t]);

  const handleSubmit = async () => {
    if (!customer || validationMessage) return;
    setSaving(true);
    try {
      await onSubmit({
        amount: Number(discount).toFixed(2),
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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('customers.account.directDiscount')}</DialogTitle>
          <DialogDescription>{t('customers.account.directDiscountDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadonlyField label={t('payments.customer')} value={customer?.name || '—'} />
            <ReadonlyField label={t('customers.account.currentOutstanding')} value={fmtAed(outstanding)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{t('customers.account.discountAmount')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{t('payments.date')}</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.account.reason')}</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              dir="auto"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.account.notesReference')}</label>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[80px] focus:ring-1 focus:ring-black focus:border-black outline-none"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              dir="auto"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="font-semibold text-gray-800 mb-2">{t('customers.account.preview')}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <PreviewValue label={t('customers.account.balanceBefore')} value={fmtAed(outstanding)} />
              <PreviewValue label={t('customers.account.discount')} value={fmtAed(discount || 0)} />
              <PreviewValue label={t('customers.account.balanceAfter')} value={fmtAed(balanceAfter)} />
            </div>
          </div>

          {validationMessage && <p className="text-sm text-amber-700">{validationMessage}</p>}
        </div>

        <DialogFooter>
          <DialogClose className="rounded-md px-4 py-2 text-sm border border-gray-300 hover:bg-gray-50">
            {t('common.cancel')}
          </DialogClose>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !!validationMessage}
            className="rounded-md px-4 py-2 text-sm bg-black text-white hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t('common.loading') : t('customers.account.applyDiscount')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerAccountStatusModal({
  open,
  onOpenChange,
  customer,
  mode,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerAccountTarget | null;
  mode: 'close' | 'reopen';
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setSaving(false);
  }, [open, customer?.id]);

  const title = mode === 'close' ? t('customers.account.closeAccount') : t('customers.account.reopenAccount');
  const description =
    mode === 'close' ? t('customers.account.closeAccountDesc') : t('customers.account.reopenAccountDesc');

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onSubmit(reason.trim());
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <ReadonlyField label={t('payments.customer')} value={customer?.name || '—'} />
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">{t('customers.account.reason')}</label>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[90px] focus:ring-1 focus:ring-black focus:border-black outline-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              dir="auto"
            />
            {!reason.trim() && <p className="text-xs text-gray-500">{t('customers.account.reasonRequired')}</p>}
          </div>
        </div>
        <DialogFooter>
          <DialogClose className="rounded-md px-4 py-2 text-sm border border-gray-300 hover:bg-gray-50">
            {t('common.cancel')}
          </DialogClose>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !reason.trim()}
            className={cn(
              'rounded-md px-4 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed',
              mode === 'close' ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-gray-900'
            )}
          >
            {saving ? t('common.loading') : title}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900 break-words" dir="auto">
        {value}
      </p>
    </div>
  );
}

function PreviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}
