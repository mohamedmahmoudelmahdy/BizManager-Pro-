import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format } from 'date-fns';
import { Users, Loader2, Eye, Banknote, Coins, AlertCircle, HandCoins, Undo2, Wallet } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { fetchTeamPerformance, type TeamPerformanceRow } from '@/app/lib/employeeApi';
import { fetchExpenses, type ExpenseApi } from '@/app/lib/operationalFinanceApi';
import { payrollPeriodKey } from '@/app/lib/employeePerformance';
import { parsePayrollFromExpense } from '@/app/lib/employeePerformance';
import type { Expense } from '@/app/contexts/DataContext';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { EmptyFinancialState } from '@/app/components/financial-control/components/EmptyFinancialState';
import { EmployeeFinancialDetailDrawer } from '@/app/components/financial-control/components/EmployeeFinancialDetailDrawer';
import { PaySalaryModal } from '@/app/components/financial-control/modals/PaySalaryModal';
import { PayCommissionModal } from '@/app/components/financial-control/modals/PayCommissionModal';
import { GiveAdvanceModal } from '@/app/components/financial-control/modals/GiveAdvanceModal';
import { RecordAdvanceRepaymentModal } from '@/app/components/financial-control/modals/RecordAdvanceRepaymentModal';
import { ReverseSalaryModal } from '@/app/components/financial-control/modals/ReverseSalaryModal';
import { fmtAed, num } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

function expenseToLegacy(e: ExpenseApi): Expense {
  return {
    id: e.id,
    category: e.category as Expense['category'],
    date: e.date,
    amount: num(e.amount),
    paidBy: e.paid_by,
    assignedEmployee: e.employee_name,
    assignedEmployeeId: e.assigned_employee ? String(e.assigned_employee) : '',
    payrollType: (e.payroll_type || '') as Expense['payrollType'],
    payrollPeriod: e.payroll_period || '',
    payrollStatus: (e.payroll_status || 'active') as Expense['payrollStatus'],
    notes: e.notes,
  };
}

export function EmployeeFinancialsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [team, setTeam] = useState<TeamPerformanceRow[]>([]);
  const [payrollExpenses, setPayrollExpenses] = useState<ExpenseApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending_salary' | 'pending_commission' | 'complete'>('all');
  const [selected, setSelected] = useState<TeamPerformanceRow | null>(null);
  const [paySalaryTarget, setPaySalaryTarget] = useState<TeamPerformanceRow | null>(null);
  const [payCommissionTarget, setPayCommissionTarget] = useState<TeamPerformanceRow | null>(null);
  const [giveAdvanceTarget, setGiveAdvanceTarget] = useState<TeamPerformanceRow | null>(null);
  const [repaymentTarget, setRepaymentTarget] = useState<TeamPerformanceRow | null>(null);
  const [reverseSalaryTarget, setReverseSalaryTarget] = useState<{
    expense: ExpenseApi;
    profileId: string;
  } | null>(null);

  const periodKey = payrollPeriodKey(year, month);
  const periodLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const isAdmin = user?.role === 'admin';
  const canManageAdvances = user?.role === 'admin' || user?.role === 'manager';
  const canPay = isAdmin;

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Depends only on periodKey: re-fetches when the month/year changes (desired)
  // and after a payroll mutation (via onSuccess), but does NOT depend on
  // unstable context refresh functions, so it can't loop.
  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [perf, exps] = await Promise.all([
        fetchTeamPerformance(periodKey),
        fetchExpenses(),
      ]);
      if (!mountedRef.current) return;
      setTeam(perf);
      setPayrollExpenses(
        exps.filter((e) => {
          if (e.payroll_status === 'reversed') return false;
          if (!e.payroll_type && e.linked_source_type !== 'payroll') return false;
          const legacy = expenseToLegacy(e);
          const parsed = parsePayrollFromExpense(legacy);
          return parsed?.period === periodKey;
        })
      );
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return team.filter((row) => {
      if (q && !row.full_name.toLowerCase().includes(q)) return false;
      if (settlementFilter === 'pending_salary' && row.salary_status === 'paid') return false;
      if (settlementFilter === 'pending_commission' && (row.commission_paid || row.commission_amount <= 0)) return false;
      if (
        settlementFilter === 'complete' &&
        (row.salary_status !== 'paid' || (!row.commission_paid && row.commission_amount > 0))
      )
        return false;
      return true;
    });
  }, [team, search, settlementFilter]);

  const pendingSalary = team.filter((r) => r.salary_status !== 'paid' && r.salary > 0).length;
  const pendingCommission = team.filter((r) => !r.commission_paid && r.commission_amount > 0).length;
  const payrollPaidTotal = payrollExpenses.reduce((s, e) => s + num(e.amount), 0);
  const outstandingAdvancesTotal = team.reduce((s, r) => s + (r.outstanding_advances || 0), 0);

  // Full-page spinner only on the very first load; period changes and
  // post-payroll refreshes keep the current table visible to avoid flicker.
  if (loading && team.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={t('financialControl.nav.employeeFinancials')}
        subtitle={t('financialControl.employeeFinancials.subtitle')}
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {format(new Date(2000, m - 1, 1), 'MMMM')}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('financialControl.employeeFinancials.search')}
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]"
        />
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white"
          value={settlementFilter}
          onChange={(e) => setSettlementFilter(e.target.value as typeof settlementFilter)}
        >
          <option value="all">{t('financialControl.employeeFinancials.filterAll')}</option>
          <option value="pending_salary">{t('financialControl.employeeFinancials.filterPendingSalary')}</option>
          <option value="pending_commission">{t('financialControl.employeeFinancials.filterPendingCommission')}</option>
          <option value="complete">{t('financialControl.employeeFinancials.filterComplete')}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label={t('financialControl.employeeFinancials.teamSize')} value={String(team.length)} icon={<Users className="size-4 text-indigo-600" />} iconBg="bg-indigo-50" />
        <KpiCard label={t('financialControl.employeeFinancials.pendingSalary')} value={String(pendingSalary)} icon={<Banknote className="size-4 text-amber-600" />} iconBg="bg-amber-50" warn={pendingSalary > 0} />
        <KpiCard label={t('financialControl.employeeFinancials.pendingCommission')} value={String(pendingCommission)} icon={<Coins className="size-4 text-violet-600" />} iconBg="bg-violet-50" warn={pendingCommission > 0} />
        <KpiCard label={t('financialControl.advances.outstandingTotal')} value={fmtAed(outstandingAdvancesTotal, i18n.language)} icon={<HandCoins className="size-4 text-rose-600" />} iconBg="bg-rose-50" warn={outstandingAdvancesTotal > 0} />
        <KpiCard label={t('financialControl.employeeFinancials.payrollPosted')} value={fmtAed(payrollPaidTotal, i18n.language)} />
      </div>

      {(pendingSalary > 0 || pendingCommission > 0) && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
          {t('financialControl.employeeFinancials.pendingBanner', { salary: pendingSalary, commission: pendingCommission })}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyFinancialState message={t('financialControl.employeeFinancials.empty')} />
      ) : (
        <SectionCard title={t('financialControl.employeeFinancials.teamTable')}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">#</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.employeeFinancials.employee')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.employeeFinancials.netProfit')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.employeeFinancials.salary')}</th>
                  <th className="px-4 py-3 text-center">{t('financialControl.employeeFinancials.salaryStatus')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.employeeFinancials.commissionDue')}</th>
                  <th className="px-4 py-3 text-center">{t('financialControl.employeeFinancials.commissionStatus')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.advances.outstanding')}</th>
                  <th className="px-4 py-3 text-center">{t('financialControl.checks.risk')}</th>
                  <th className="px-4 py-3 text-end">{t('common.view')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((row) => (
                  <tr key={row.employee_id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{row.rank}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{row.full_name}</div>
                      <div className="text-xs text-slate-400 capitalize">{row.role}</div>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={row.net_profit} className="font-mono text-xs" />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={row.salary} className="font-mono text-xs" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SalaryStatusPill
                        status={row.salary_status || (row.salary_paid ? 'paid' : 'pending')}
                        remainingDue={row.salary_remaining_due}
                        t={t}
                        i18nLang={i18n.language}
                      />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={row.commission_amount} className="font-mono text-xs" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <SettlementPill paid={row.commission_amount <= 0 ? true : row.commission_paid} na={row.commission_amount <= 0} t={t} />
                    </td>
                    <td className="px-4 py-3 text-end">
                      {row.outstanding_advances > 0 ? (
                        <CurrencyAmount value={row.outstanding_advances} className="font-mono text-xs text-rose-600 font-semibold" />
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <FinancialStatusBadge status={row.performance_level} />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                        <button type="button" onClick={() => setSelected(row)} className="p-1.5 rounded hover:bg-slate-100">
                          <Eye className="size-4 text-slate-400" />
                        </button>
                        {canPay && row.salary_status !== 'paid' && row.salary > 0 && (
                          <button
                            type="button"
                            onClick={() => setPaySalaryTarget(row)}
                            className="p-1.5 rounded hover:bg-slate-100"
                            title={t('financialControl.employeeFinancials.paySalary')}
                          >
                            <Banknote className="size-4 text-slate-600" />
                          </button>
                        )}
                        {canPay && !row.commission_paid && row.commission_amount > 0 && (
                          <button
                            type="button"
                            onClick={() => setPayCommissionTarget(row)}
                            className="p-1.5 rounded hover:bg-slate-100"
                            title={t('financialControl.employeeFinancials.payCommission')}
                          >
                            <Coins className="size-4 text-violet-600" />
                          </button>
                        )}
                        {canManageAdvances && row.outstanding_advances > 0 && (
                          <button
                            type="button"
                            onClick={() => setRepaymentTarget(row)}
                            className="p-1.5 rounded hover:bg-slate-100"
                            title={t('financialControl.advances.recordRepayment')}
                          >
                            <Wallet className="size-4 text-emerald-600" />
                          </button>
                        )}
                        {canManageAdvances && (
                          <button
                            type="button"
                            onClick={() => setGiveAdvanceTarget(row)}
                            className="p-1.5 rounded hover:bg-slate-100"
                            title={t('financialControl.advances.giveAdvance')}
                          >
                            <HandCoins className="size-4 text-rose-600" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title={t('financialControl.employeeFinancials.settlementsTitle')}>
        {payrollExpenses.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">{t('financialControl.employeeFinancials.noSettlements')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.date')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.employee')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.payrollType')}</th>
                  <th className="px-4 py-3 text-end">{t('financialControl.ledger.amount')}</th>
                  <th className="px-4 py-3 text-start">{t('financialControl.expenses.paidBy')}</th>
                  {isAdmin && <th className="px-4 py-3 text-end">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {payrollExpenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 text-xs"><bdi>{e.date}</bdi></td>
                    <td className="px-4 py-3 text-xs">{e.employee_name || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {e.payroll_type
                        ? t(`financialControl.expenses.payrollTypes.${e.payroll_type}`, { defaultValue: e.payroll_type })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <CurrencyAmount value={e.amount} className="font-bold text-xs" />
                    </td>
                    <td className="px-4 py-3 text-xs">{e.paid_by_name}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-end">
                        {e.payroll_type === 'salary' && e.payroll_status !== 'reversed' && (
                          <button
                            type="button"
                            onClick={() =>
                              setReverseSalaryTarget({
                                expense: e,
                                profileId: team.find(
                                  (r) => String(r.user_id) === String(e.assigned_employee)
                                )?.employee_id || '',
                              })
                            }
                            disabled={!team.some((r) => String(r.user_id) === String(e.assigned_employee))}
                            className="text-xs text-rose-600 hover:underline inline-flex items-center gap-1 disabled:opacity-40"
                          >
                            <Undo2 className="size-3" />
                            {t('financialControl.employeeFinancials.reverseSalary')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <EmployeeFinancialDetailDrawer
        employee={selected}
        periodKey={periodKey}
        periodLabel={periodLabel}
        canPay={canPay}
        canManageAdvances={canManageAdvances}
        isAdmin={isAdmin}
        salaryExpenses={payrollExpenses.filter(
          (e) => e.payroll_type === 'salary' && String(e.assigned_employee) === String(selected?.user_id)
        )}
        onClose={() => setSelected(null)}
        onPaySalary={() => {
          if (selected) {
            setPaySalaryTarget(selected);
            setSelected(null);
          }
        }}
        onPayCommission={() => {
          if (selected) {
            setPayCommissionTarget(selected);
            setSelected(null);
          }
        }}
        onRecordRepayment={() => {
          if (selected) {
            setRepaymentTarget(selected);
          }
        }}
      />

      {paySalaryTarget && (
        <PaySalaryModal
          employee={paySalaryTarget}
          periodKey={periodKey}
          periodLabel={periodLabel}
          open={!!paySalaryTarget}
          salaryStatus={paySalaryTarget.salary_status || (paySalaryTarget.salary_paid ? 'paid' : 'pending')}
          onClose={() => setPaySalaryTarget(null)}
          onSuccess={load}
        />
      )}
      {payCommissionTarget && (
        <PayCommissionModal
          employee={payCommissionTarget}
          periodKey={periodKey}
          periodLabel={periodLabel}
          open={!!payCommissionTarget}
          alreadyPaid={payCommissionTarget.commission_paid}
          onClose={() => setPayCommissionTarget(null)}
          onSuccess={load}
        />
      )}
      {giveAdvanceTarget && (
        <GiveAdvanceModal
          employee={giveAdvanceTarget}
          open={!!giveAdvanceTarget}
          onClose={() => setGiveAdvanceTarget(null)}
          onSuccess={load}
        />
      )}
      {repaymentTarget && (
        <RecordAdvanceRepaymentModal
          employee={repaymentTarget}
          open={!!repaymentTarget}
          onClose={() => setRepaymentTarget(null)}
          onSuccess={load}
        />
      )}
      {reverseSalaryTarget?.profileId && (
        <ReverseSalaryModal
          employeeProfileId={reverseSalaryTarget.profileId}
          expense={reverseSalaryTarget.expense}
          open={!!reverseSalaryTarget}
          onClose={() => setReverseSalaryTarget(null)}
          onSuccess={load}
        />
      )}
    </div>
  );
}

function SalaryStatusPill({
  status,
  remainingDue,
  t,
  i18nLang,
}: {
  status: 'pending' | 'partial' | 'paid';
  remainingDue?: number;
  t: TFunction;
  i18nLang: string;
}) {
  const label =
    status === 'paid'
      ? t('financialControl.employeeFinancials.settled')
      : status === 'partial'
        ? t('financialControl.employeeFinancials.partial')
        : t('financialControl.employeeFinancials.pending');
  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-xs px-2 py-0.5 rounded-full font-medium',
          status === 'paid' && 'bg-emerald-50 text-emerald-700',
          status === 'partial' && 'bg-blue-50 text-blue-700',
          status === 'pending' && 'bg-amber-50 text-amber-700'
        )}
      >
        {label}
      </span>
      {status === 'partial' && remainingDue != null && remainingDue > 0 && (
        <span className="text-[10px] text-slate-500 font-mono">
          {fmtAed(remainingDue, i18nLang)} {t('financialControl.employeeFinancials.dueShort')}
        </span>
      )}
    </div>
  );
}

function SettlementPill({
  paid,
  na,
  t,
}: {
  paid: boolean;
  na?: boolean;
  t: TFunction;
}) {
  if (na) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  return (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded-full font-medium',
        paid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      )}
    >
      {paid ? t('financialControl.employeeFinancials.settled') : t('financialControl.employeeFinancials.pending')}
    </span>
  );
}
