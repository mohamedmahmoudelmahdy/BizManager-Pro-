/**
 * Transfer Procedure or Payment to another Customer account.
 * Admin/Manager only — target selected via searchable combobox (no raw UUID entry).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { SearchableCombobox } from '@/app/components/ui/searchable-combobox';
import { buildSearchableText } from '@/app/utils/searchText';
import { useData } from '@/app/contexts/DataContext';
import { formatApiErrorMessage } from '@/app/lib/api';

export type TransferProcedureTarget = {
  id: string;
  date: string | null;
  category: string;
  description?: string | null;
  selling_price: string;
  cost: string;
  paid: string;
  outstanding: string;
  linkedPaymentCount: number;
  /** Authoritative owner from financial-summary when present. */
  customerId?: string;
};

export type TransferPaymentTarget = {
  id: string;
  date: string | null;
  amount: string;
  bank_card_name: string;
  type: string;
  procedure_id: string | null;
  procedure_category: string;
  /** Authoritative owner from financial-summary when present. */
  customerId?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'procedure' | 'payment' | null;
  sourceCustomerId: string;
  sourceCustomerName: string;
  procedure?: TransferProcedureTarget | null;
  payment?: TransferPaymentTarget | null;
  onSubmit: (payload: {
    target_customer_id: string;
    reason: string;
    transfer_linked_payments?: boolean;
    target_procedure_id?: string | null;
  }) => Promise<{ target_customer_id: string }>;
};

function fmtAed(value: string | number) {
  const n = Number(value || 0);
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Normalize customer UUIDs for reliable compare (case / whitespace). */
function normCustomerId(id: string | null | undefined): string {
  return String(id || '')
    .trim()
    .toLowerCase();
}

/**
 * cmdk treats raw UUIDs poorly as option values (hyphen / scoring quirks).
 * Prefix keeps values unique and stable inside Dialog + Popover.
 */
const CUSTOMER_OPTION_PREFIX = 'customer:';

function toCustomerOptionValue(id: string): string {
  return `${CUSTOMER_OPTION_PREFIX}${id}`;
}

function fromCustomerOptionValue(value: string): string {
  return value.startsWith(CUSTOMER_OPTION_PREFIX)
    ? value.slice(CUSTOMER_OPTION_PREFIX.length)
    : value;
}

export function CustomerFinancialTransferModal({
  open,
  onOpenChange,
  mode,
  sourceCustomerId,
  sourceCustomerName,
  procedure,
  payment,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const { customers, procedures } = useData();
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [targetProcedureId, setTargetProcedureId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successTargetId, setSuccessTargetId] = useState<string | null>(null);

  const effectiveSourceId = normCustomerId(
    (mode === 'procedure' ? procedure?.customerId : payment?.customerId) ||
      sourceCustomerId
  );

  useEffect(() => {
    if (!open) return;
    setTargetId('');
    setReason('');
    setTargetProcedureId('');
    setSaving(false);
    setError('');
    setSuccessTargetId(null);
  }, [open, mode, procedure?.id, payment?.id]);

  const customerOptions = useMemo(
    () =>
      customers
        .filter(
          (c) =>
            normCustomerId(c.id) !== effectiveSourceId &&
            (c.accountStatus || 'active') !== 'closed'
        )
        .map((c) => {
          const label = c.companyName || c.name;
          return {
            value: toCustomerOptionValue(String(c.id)),
            label,
            searchText: buildSearchableText(
              c.name,
              c.companyName,
              c.phone,
              c.phoneSecondary,
              c.email
            ),
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [customers, effectiveSourceId]
  );

  const targetProcedureOptions = useMemo(() => {
    if (!targetId) return [];
    const targetNorm = normCustomerId(targetId);
    return procedures
      .filter((p) => normCustomerId(p.customerId) === targetNorm)
      .map((p) => ({
        value: p.id,
        label: `${p.category} — ${p.date}`,
        searchText: buildSearchableText(p.category, p.description, p.date),
      }));
  }, [procedures, targetId]);

  const validation = useMemo(() => {
    if (!targetId) return t('customers.transfer.targetRequired');
    if (normCustomerId(targetId) === effectiveSourceId) {
      return t('customers.transfer.sameCustomer');
    }
    if (!reason.trim()) return t('customers.transfer.reasonRequired');
    return '';
  }, [reason, effectiveSourceId, t, targetId]);

  const handleSubmit = async () => {
    if (validation || !mode) return;
    const normalizedTarget = normCustomerId(targetId);
    if (!normalizedTarget || normalizedTarget === effectiveSourceId) {
      setError(t('customers.transfer.sameCustomer'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await onSubmit({
        target_customer_id: String(targetId).trim(),
        reason: reason.trim(),
        transfer_linked_payments: mode === 'procedure' ? true : undefined,
        target_procedure_id:
          mode === 'payment' ? targetProcedureId || null : undefined,
      });
      setSuccessTargetId(result.target_customer_id);
    } catch (err) {
      setError(formatApiErrorMessage(err, t('customers.transfer.failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'payment'
              ? t('customers.transfer.paymentTitle')
              : t('customers.transfer.procedureTitle')}
          </DialogTitle>
          <DialogDescription>{t('customers.transfer.warning')}</DialogDescription>
        </DialogHeader>

        {successTargetId ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-emerald-700 font-medium">
              {t('customers.transfer.success')}
            </p>
            <Link
              to={`/customers/${successTargetId}`}
              className="inline-flex text-sm font-medium text-blue-700 underline"
              onClick={() => onOpenChange(false)}
            >
              {t('customers.transfer.openTarget')}
            </Link>
            <DialogFooter>
              <button
                type="button"
                className="px-4 py-2 rounded-md border text-sm"
                onClick={() => onOpenChange(false)}
              >
                {t('common.close')}
              </button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('customers.transfer.warning')}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">
                {t('customers.transfer.currentCustomer')}
              </p>
              <p className="text-sm font-medium text-slate-900 mt-0.5">{sourceCustomerName}</p>
            </div>

            {mode === 'procedure' && procedure ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-900">{procedure.category}</p>
                <p className="text-slate-600" dir="auto">
                  {procedure.description?.trim() || '—'}
                </p>
                <p className="text-slate-600">
                  {procedure.date || '—'} · {t('customers.profile.charge')}:{' '}
                  {fmtAed(procedure.selling_price)} · {t('customers.profile.paid')}:{' '}
                  {fmtAed(procedure.paid)} · {t('customers.profile.outstanding')}:{' '}
                  {fmtAed(procedure.outstanding)}
                </p>
                <p className="text-slate-700 font-medium">
                  {t('customers.transfer.linkedPayments', {
                    count: procedure.linkedPaymentCount,
                  })}
                </p>
                {procedure.linkedPaymentCount > 0 ? (
                  <p className="text-xs text-slate-600">
                    {t('customers.transfer.linkedPaymentsMove')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {mode === 'payment' && payment ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <p className="font-semibold text-slate-900" dir="ltr">
                  {fmtAed(payment.amount)}
                </p>
                <p className="text-slate-600">
                  {payment.date || '—'} · {payment.bank_card_name || payment.type}
                </p>
                <p className="text-slate-600">
                  {t('payments.linkedProcedure')}: {payment.procedure_category || '—'}
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                {t('customers.transfer.targetCustomer')}
              </label>
              <SearchableCombobox
                value={targetId ? toCustomerOptionValue(targetId) : ''}
                onValueChange={(v) => {
                  setTargetId(fromCustomerOptionValue(v));
                  setTargetProcedureId('');
                }}
                options={customerOptions}
                placeholder={t('customers.transfer.searchCustomer')}
                searchPlaceholder={t('customers.transfer.searchCustomer')}
                emptyText={t('customers.transfer.noCustomers')}
                popoverModal={false}
                textAlign="left"
                labelDir="auto"
                triggerClassName="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
              />
            </div>

            {mode === 'payment' ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  {t('customers.transfer.targetProcedureOptional')}
                </label>
                <SearchableCombobox
                  value={targetProcedureId}
                  onValueChange={setTargetProcedureId}
                  options={targetProcedureOptions}
                  placeholder={t('customers.transfer.unallocated')}
                  searchPlaceholder={t('customers.transfer.searchProcedure')}
                  emptyText={t('customers.transfer.noProcedures')}
                  disabled={!targetId}
                  popoverModal={false}
                  textAlign="left"
                  labelDir="auto"
                  triggerClassName="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white disabled:opacity-60"
                />
                <p className="text-xs text-slate-500">
                  {t('customers.transfer.targetProcedureHelp')}
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="xfer-reason" className="text-sm font-medium text-slate-700">
                {t('customers.transfer.reason')}
              </label>
              <textarea
                id="xfer-reason"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm min-h-[88px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>

            {validation ? (
              <p className="text-sm text-amber-700" role="status">
                {validation}
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md border text-sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
                disabled={!!validation || saving}
                onClick={() => void handleSubmit()}
              >
                {saving ? t('common.loading') : t('customers.transfer.confirm')}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
