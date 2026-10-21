import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Plus,
  Loader2,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchLedgerAccount,
  fetchLedgerEntries,
  reconcileLedgerAccount,
  reopenLedgerAccount,
  reverseLedgerEntry,
  reconcileLedgerEntry,
  postLedgerEntry,
} from '@/app/lib/financialControlApi';
import type { LedgerAccountApi, LedgerEntryApi } from '@/app/components/financial-control/types/ledger';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { AddLedgerEntryModal } from '@/app/components/financial-control/modals/AddLedgerEntryModal';
import { ACCOUNT_TYPE_LABELS, fmtAed, num } from '@/app/components/financial-control/utils/format';
import { format } from 'date-fns';

export function LedgerProfilePage() {
  const { t } = useTranslation();
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<LedgerAccountApi | null>(null);
  const [entries, setEntries] = useState<LedgerEntryApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    // Avoid overlapping fetches; keep existing data visible while revalidating.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [acc, ents] = await Promise.all([
        fetchLedgerAccount(accountId),
        fetchLedgerEntries(accountId),
      ]);
      if (!mountedRef.current) return;
      setAccount(acc);
      setEntries(ents);
    } catch {
      if (mountedRef.current) toast.error(t('financialControl.ledger.loadAccountError'));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await load();
      toast.success(t('financialControl.ledger.actionDone'));
    } catch {
      toast.error(t('financialControl.ledger.actionError'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading || !account) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate('/financial-control/ledger-accounts')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" />
        {t('financialControl.ledger.backToAccounts')}
      </button>

      <SectionHeader title={account.name} subtitle={account.account_code || ACCOUNT_TYPE_LABELS[account.account_type]}>
        {account.status === 'active' && (
          <>
            <button
              type="button"
              onClick={() => runAction('recon', () => reconcileLedgerAccount(account.id))}
              className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium"
            >
              <RefreshCw className="size-4" />
              {t('financialControl.ledger.reconcileAll')}
            </button>
            <button
              type="button"
              onClick={() => setShowAddEntry(true)}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
            >
              <Plus className="size-4" />
              {t('financialControl.ledger.addEntry')}
            </button>
          </>
        )}
        {account.status === 'closed' && (
          <button
            type="button"
            onClick={() => runAction('reopen', () => reopenLedgerAccount(account.id))}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm"
          >
            <RotateCcw className="size-4" />
            {t('financialControl.ledger.reopen')}
          </button>
        )}
      </SectionHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-slate-400">{t('financialControl.ledger.currentBalance')}</div>
          <div className="mt-1">
            <CurrencyAmount value={num(account.current_balance)} />
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-slate-400">{t('financialControl.ledger.unreconciled')}</div>
          <div className="text-lg font-bold mt-1">{account.unreconciled_count}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-slate-400">{t('financialControl.ledger.totalCredit')}</div>
          <div className="text-lg font-bold text-emerald-600 mt-1">{fmtAed(account.total_credit)}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-slate-400">{t('financialControl.ledger.totalDebit')}</div>
          <div className="text-lg font-bold text-rose-600 mt-1">{fmtAed(account.total_debit)}</div>
        </div>
      </div>

      <SectionCard title={t('financialControl.ledger.transactions')}>
        <p className="px-4 pt-3 text-xs text-slate-400">
          {t('financialControl.ledger.reconcileHelper')}
        </p>
        {entries.length === 0 ? (
          <EmptyFinancialState message={t('financialControl.ledger.noEntries')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.ledger.entryDate')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.ledger.description')}</th>
                  <th className="px-4 py-3 text-center">{t('financialControl.ledger.entryType')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.resultingBalance')}</th>
                  <th className="px-4 py-3 text-start">{t('common.status')}</th>
                  <th className="px-4 py-3 text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs">{format(new Date(e.date), 'yyyy-MM-dd')}</td>
                    <td className="px-4 py-3">{e.description}</td>
                    <td className="px-4 py-3 text-center uppercase text-xs font-semibold">{e.entry_type}</td>
                    <td className="px-4 py-3 text-end font-mono">{fmtAed(num(e.amount))}</td>
                    <td className="px-4 py-3 text-end font-mono">{fmtAed(num(e.resulting_balance))}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <FinancialStatusBadge status={e.status} />
                        {e.is_reversal && (
                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {t('financialControl.ledger.reversalEntry')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end space-x-1">
                      {account.status === 'active' && e.status === 'draft' && (
                        <button
                          type="button"
                          disabled={busyId === e.id}
                          className="text-xs text-indigo-600 hover:underline"
                          onClick={() => runAction(e.id, () => postLedgerEntry(e.id))}
                        >
                          {t('financialControl.ledger.post')}
                        </button>
                      )}
                      {account.status === 'active' && e.status === 'posted' && !e.is_reversal && (
                        <button
                          type="button"
                          disabled={busyId === e.id}
                          className="text-xs text-emerald-600 hover:underline"
                          onClick={() => runAction(e.id, () => reconcileLedgerEntry(e.id))}
                        >
                          {t('financialControl.ledger.reconcile')}
                        </button>
                      )}
                      {account.status === 'active' &&
                        (e.status === 'posted' || e.status === 'reconciled') &&
                        !e.is_reversal &&
                        (e.can_reverse_generically !== false ? (
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            className="text-xs text-rose-600 hover:underline"
                            onClick={() => runAction(e.id, () => reverseLedgerEntry(e.id))}
                          >
                            {t('financialControl.ledger.reverse')}
                          </button>
                        ) : (
                          <span
                            className="text-xs text-slate-400 cursor-help"
                            title={
                              e.generic_reverse_block_reason ||
                              t('financialControl.ledger.reverseBlockedTooltip')
                            }
                          >
                            {t('financialControl.ledger.reverseBlocked')}
                          </span>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <AddLedgerEntryModal
        account={account}
        open={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        onSuccess={load}
      />
    </div>
  );
}
