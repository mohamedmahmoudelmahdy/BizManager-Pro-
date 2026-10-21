import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, BookOpen, Eye, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { fetchLedgerAccounts } from '@/app/lib/financialControlApi';
import type { LedgerAccountApi } from '@/app/components/financial-control/types/ledger';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { ReconciliationBanner } from '@/app/components/financial-control/components/ReconciliationBanner';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { AddLedgerAccountModal } from '@/app/components/financial-control/modals/AddLedgerAccountModal';
import { CloseAccountModal } from '@/app/components/financial-control/modals/CloseAccountModal';
import { DeleteImportedLedgerModal } from '@/app/components/financial-control/modals/DeleteImportedLedgerModal';
import { ACCOUNT_TYPE_LABELS, num } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

export function LedgerAccountsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [accounts, setAccounts] = useState<LedgerAccountApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [closeTarget, setCloseTarget] = useState<LedgerAccountApi | null>(null);
  const [deleteImportedTarget, setDeleteImportedTarget] = useState<LedgerAccountApi | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await fetchLedgerAccounts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.account_code.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const totalUnreconciled = filtered.reduce((s, a) => s + a.unreconciled_count, 0);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t('financialControl.nav.ledgerAccounts')} subtitle={t('financialControl.ledger.subtitle')}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          <Plus className="size-4" />
          {t('financialControl.ledger.addAccount')}
        </button>
      </SectionHeader>

      {totalUnreconciled > 0 && (
        <ReconciliationBanner
          message={t('financialControl.ledger.unreconciledBanner', { count: totalUnreconciled })}
        />
      )}

      <div className="relative max-w-md">
        <Search className="absolute start-3 top-2.5 size-4 text-slate-400" />
        <input
          className="w-full ps-9 pe-3 py-2 border border-slate-200 rounded-lg text-sm"
          placeholder={t('financialControl.ledger.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <SectionCard>
        {filtered.length === 0 ? (
          <EmptyFinancialState message={t('financialControl.ledger.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start font-semibold">{t('financialControl.ledger.accountName')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('financialControl.ledger.accountCode')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('financialControl.ledger.accountType')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('financialControl.ledger.balance')}</th>
                  <th className="px-4 py-3 text-center font-semibold">{t('financialControl.ledger.unreconciled')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('common.status')}</th>
                  <th className="px-4 py-3 text-center font-semibold">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    className={cn(
                      'hover:bg-slate-50 cursor-pointer',
                      a.status === 'closed' && 'opacity-60'
                    )}
                    onClick={() => navigate(`/financial-control/ledger-accounts/${a.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <BookOpen className="size-3.5 text-slate-400" />
                        <span className="font-medium text-slate-900">{a.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.account_code || '—'}</td>
                    <td className="px-4 py-3 text-xs">{ACCOUNT_TYPE_LABELS[a.account_type] || a.account_type}</td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={num(a.current_balance)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {a.unreconciled_count > 0 ? (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          {a.unreconciled_count}
                        </span>
                      ) : (
                        <span className="text-emerald-600 text-xs">✓</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <FinancialStatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="p-1.5 rounded-lg hover:bg-slate-100"
                        onClick={() => navigate(`/financial-control/ledger-accounts/${a.id}`)}
                      >
                        <Eye className="size-4 text-slate-500" />
                      </button>
                      {a.status === 'active' && (
                        <button
                          type="button"
                          className="ms-1 text-xs text-rose-600 hover:underline"
                          onClick={() => setCloseTarget(a)}
                        >
                          {t('financialControl.ledger.close')}
                        </button>
                      )}
                      {isAdmin && a.import_only && (
                        <button
                          type="button"
                          className={cn(
                            'ms-1 inline-flex items-center gap-1 text-xs hover:underline',
                            a.can_delete_imported ? 'text-rose-800' : 'text-slate-400 cursor-not-allowed'
                          )}
                          title={!a.can_delete_imported ? a.delete_imported_reason || undefined : undefined}
                          onClick={() => setDeleteImportedTarget(a)}
                        >
                          <Trash2 className="size-3" />
                          {t('financialControl.ledger.deleteImported')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <AddLedgerAccountModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      {closeTarget && (
        <CloseAccountModal
          account={closeTarget}
          open={!!closeTarget}
          onClose={() => setCloseTarget(null)}
          onSuccess={load}
        />
      )}
      {deleteImportedTarget && (
        <DeleteImportedLedgerModal
          account={deleteImportedTarget}
          open={!!deleteImportedTarget}
          onClose={() => setDeleteImportedTarget(null)}
          onSuccess={load}
        />
      )}
    </div>
  );
}
