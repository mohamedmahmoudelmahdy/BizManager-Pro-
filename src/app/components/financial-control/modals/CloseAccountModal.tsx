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
import { ApiError } from '@/app/lib/api';
import { closeLedgerAccount } from '@/app/lib/financialControlApi';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { num } from '@/app/components/financial-control/utils/format';

export function CloseAccountModal({
  account,
  open,
  onClose,
  onSuccess,
}: {
  account: LedgerAccountApi;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await closeLedgerAccount(account.id, reason);
      toast.success(t('financialControl.ledger.accountClosed'));
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const detail =
        err instanceof ApiError &&
        err.body &&
        typeof err.body === 'object' &&
        'detail' in err.body
          ? String((err.body as { detail: string }).detail)
          : t('financialControl.ledger.closeFailed');
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('financialControl.ledger.closeAccount')}</DialogTitle>
          <DialogDescription>{account.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t('financialControl.ledger.closeRules')}</p>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('financialControl.ledger.currentBalance')}</span>
            <CurrencyAmount value={num(account.current_balance)} />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('financialControl.ledger.blockingUnreconciled')}</span>
            <span className="font-semibold">{account.unreconciled_count}</span>
          </div>
          <p className="text-xs text-slate-400">{t('financialControl.ledger.closeReversalHelper')}</p>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            rows={2}
            placeholder={t('financialControl.ledger.closeReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
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
            onClick={handleConfirm}
            className="px-5 py-2 text-sm bg-rose-600 text-white rounded-lg font-semibold flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t('financialControl.ledger.confirmClose')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
