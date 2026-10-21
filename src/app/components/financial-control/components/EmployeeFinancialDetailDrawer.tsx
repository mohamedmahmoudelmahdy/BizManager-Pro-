import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { X, Loader2, Banknote, Coins, HandCoins, Undo2, Wallet } from 'lucide-react';
import type {
  TeamPerformanceRow,
  EmployeeDashboardResponse,
  EmployeeAdvanceApi,
} from '@/app/lib/employeeApi';
import {
  fetchEmployeeDashboard,
  fetchEmployeeAdvanceSummary,
  reverseEmployeeAdvance,
  reverseAdvanceDeduction,
} from '@/app/lib/employeeApi';
import type { ExpenseApi } from '@/app/lib/operationalFinanceApi';
import { ReverseSalaryModal } from '@/app/components/financial-control/modals/ReverseSalaryModal';
import { CurrencyAmount } from '@/app/components/financial-control/components/CurrencyAmount';
import { FinancialStatusBadge } from '@/app/components/financial-control/components/FinancialStatusBadge';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { cn } from '@/app/components/ui/utils';

type DeductionRow = EmployeeAdvanceApi['deductions'][number];

export function EmployeeFinancialDetailDrawer({
  employee,
  periodKey,
  periodLabel,
  canPay,
  canManageAdvances,
  isAdmin,
  salaryExpenses = [],
  onClose,
  onPaySalary,
  onPayCommission,
  onRecordRepayment,
}: {
  employee: TeamPerformanceRow | null;
  periodKey: string;
  periodLabel: string;
  canPay: boolean;
  canManageAdvances: boolean;
  isAdmin: boolean;
  salaryExpenses?: ExpenseApi[];
  onClose: () => void;
  onPaySalary: () => void;
  onPayCommission: () => void;
  onRecordRepayment: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [dash, setDash] = useState<EmployeeDashboardResponse | null>(null);
  const [advances, setAdvances] = useState<EmployeeAdvanceApi[]>([]);
  const [reverseDeductionTarget, setReverseDeductionTarget] = useState<DeductionRow | null>(null);
  const [reverseSalaryExpense, setReverseSalaryExpense] = useState<ExpenseApi | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  const outstandingTotal = advances
    .filter((a) => a.status === 'active')
    .reduce((s, a) => s + Number(a.outstanding_balance), 0);

  const loadAdvances = useCallback(() => {
    if (!employee) return;
    fetchEmployeeAdvanceSummary(employee.user_id)
      .then((data) => setAdvances(data.advances))
      .catch(() => setAdvances([]));
  }, [employee]);

  const reloadDashboard = useCallback(() => {
    if (!employee) return;
    fetchEmployeeDashboard(employee.employee_id, periodKey)
      .then((data) => setDash(data))
      .catch(() => setDash(null));
  }, [employee, periodKey]);

  useEffect(() => {
    if (!employee) return;
    let cancelled = false;
    setLoading(true);
    fetchEmployeeDashboard(employee.employee_id, periodKey)
      .then((data) => {
        if (!cancelled) setDash(data);
      })
      .catch(() => {
        if (!cancelled) setDash(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    loadAdvances();
    return () => {
      cancelled = true;
    };
  }, [employee, periodKey, loadAdvances]);

  const handleReverseAdvance = async (advanceId: string) => {
    try {
      await reverseEmployeeAdvance(advanceId, '');
      toast.success(t('financialControl.advances.reversed'));
      loadAdvances();
      reloadDashboard();
    } catch {
      toast.error(t('financialControl.advances.reverseError'));
    }
  };

  const handleConfirmReverseDeduction = async () => {
    if (!reverseDeductionTarget || !reverseReason.trim()) return;
    setReversing(true);
    try {
      await reverseAdvanceDeduction(reverseDeductionTarget.id, reverseReason.trim());
      toast.success(t('financialControl.advances.deductionReversed'));
      setReverseDeductionTarget(null);
      setReverseReason('');
      loadAdvances();
      reloadDashboard();
    } catch {
      toast.error(t('financialControl.advances.deductionReverseError'));
    } finally {
      setReversing(false);
    }
  };

  if (!employee) return null;
  const m = dash?.metrics;
  const salaryPaid = m?.salary_paid ?? employee.salary_paid;
  const commissionPaid = m?.commission_paid ?? employee.commission_paid;
  const commissionAmount = m?.commission_amount ?? employee.commission_amount;
  const salary = m?.salary ?? employee.salary;
  const netProfit = m?.net_profit ?? employee.net_profit;
  const totalProc = m?.total_procedures ?? employee.total_procedures;
  const closed = m?.closed_procedures ?? employee.closed_procedures;
  const rank = dash?.rank ?? employee.rank;
  const score = dash?.performance_score ?? employee.performance_score;
  const level = dash?.performance_level ?? employee.performance_level;

  const statRows = [
    { label: t('financialControl.employeeFinancials.salary'), value: fmtAed(salary, i18n.language) },
    { label: t('financialControl.employeeFinancials.commissionDue'), value: fmtAed(commissionAmount, i18n.language) },
    { label: t('financialControl.employeeFinancials.netProfit'), value: fmtAed(netProfit, i18n.language) },
    { label: t('financialControl.employeeFinancials.procedures'), value: String(totalProc) },
    { label: t('financialControl.employeeFinancials.closed'), value: String(closed) },
    { label: t('financialControl.employeeFinancials.rank'), value: `#${rank}` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl h-full flex flex-col">
        <div className="p-5 border-b flex justify-between items-start">
          <div>
            <h3 className="font-bold text-lg">{employee.full_name}</h3>
            <p className="text-xs text-slate-500 capitalize">{employee.role} · {periodLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <FinancialStatusBadge status={level} />
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {t('financialControl.employeeFinancials.score', { score })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={cn('rounded-xl p-3 border', salaryPaid ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100')}>
                  <div className="text-xs text-slate-500">{t('financialControl.employeeFinancials.salaryStatus')}</div>
                  <div className="font-semibold text-sm mt-1">
                    {salaryPaid ? t('financialControl.employeeFinancials.settled') : t('financialControl.employeeFinancials.pending')}
                  </div>
                </div>
                <div className={cn('rounded-xl p-3 border', commissionPaid ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100')}>
                  <div className="text-xs text-slate-500">{t('financialControl.employeeFinancials.commissionStatus')}</div>
                  <div className="font-semibold text-sm mt-1">
                    {commissionPaid ? t('financialControl.employeeFinancials.settled') : t('financialControl.employeeFinancials.pending')}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {statRows.map((r) => (
                  <div key={r.label} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
                    <span className="text-slate-500">{r.label}</span>
                    <span className="font-medium">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <div className="flex items-center gap-2 mb-2">
                  <HandCoins className="size-4 text-rose-500" />
                  <h4 className="font-semibold text-sm">{t('financialControl.advances.history')}</h4>
                </div>
                {advances.length === 0 ? (
                  <p className="text-xs text-slate-400">{t('financialControl.advances.noAdvances')}</p>
                ) : (
                  <div className="space-y-2">
                    {advances.map((a) => (
                      <div key={a.id} className="rounded-lg border border-slate-100 p-2.5 text-xs">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-semibold">{fmtAed(Number(a.amount), i18n.language)}</div>
                            <div className="text-slate-400"><bdi>{a.date}</bdi></div>
                          </div>
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full font-medium',
                              a.status === 'active'
                                ? 'bg-amber-50 text-amber-700'
                                : a.status === 'settled'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            {t(`financialControl.advances.status_${a.status}`, { defaultValue: a.status })}
                          </span>
                        </div>
                        {a.reason && <div className="text-slate-500 mt-1">{a.reason}</div>}
                        <div className="flex justify-between items-center mt-1.5">
                          <span className="text-slate-400">
                            {t('financialControl.advances.remaining')}:{' '}
                            <span className="font-mono text-slate-700">{fmtAed(Number(a.outstanding_balance), i18n.language)}</span>
                          </span>
                          {canPay && a.status === 'active' && a.deductions.length === 0 && (
                            <button
                              type="button"
                              onClick={() => handleReverseAdvance(a.id)}
                              className="flex items-center gap-1 text-rose-600 hover:underline"
                            >
                              <Undo2 className="size-3" />
                              {t('financialControl.advances.reverse')}
                            </button>
                          )}
                        </div>
                        {a.deductions.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-50 space-y-1.5">
                            <div className="text-[10px] uppercase text-slate-400 font-semibold">
                              {t('financialControl.advances.deductionHistory')}
                            </div>
                            {a.deductions.map((d) => (
                              <div key={d.id} className="flex justify-between items-center gap-2">
                                <div>
                                  <span className="font-mono text-slate-700">
                                    {fmtAed(Number(d.amount), i18n.language)}
                                  </span>
                                  <span className="text-slate-400 ms-1"><bdi>{d.date}</bdi></span>
                                  {d.status === 'reversed' && (
                                    <span className="ms-1 text-slate-400">
                                      ({t('financialControl.advances.deductionReversedLabel')})
                                    </span>
                                  )}
                                </div>
                                {canPay && d.status === 'active' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReverseDeductionTarget(d);
                                      setReverseReason('');
                                    }}
                                    className="flex items-center gap-1 text-rose-600 hover:underline shrink-0"
                                  >
                                    <Undo2 className="size-3" />
                                    {t('financialControl.advances.reverseDeduction')}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {a.repayments?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-50 space-y-1.5">
                            <div className="text-[10px] uppercase text-slate-400 font-semibold">
                              {t('financialControl.advances.repaymentHistory')}
                            </div>
                            {a.repayments.map((r) => (
                              <div key={r.id} className="flex justify-between items-center gap-2 text-emerald-700">
                                <div>
                                  <span className="font-mono">+{fmtAed(Number(r.amount), i18n.language)}</span>
                                  <span className="text-slate-400 ms-1"><bdi>{r.date}</bdi></span>
                                  {r.payment_method_name && (
                                    <span className="text-slate-400 ms-1">· {r.payment_method_name}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {salaryExpenses.length > 0 && (
                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Banknote className="size-4 text-slate-500" />
                    <h4 className="font-semibold text-sm">{t('financialControl.employeeFinancials.salaryPayments')}</h4>
                  </div>
                  <div className="space-y-1.5">
                    {salaryExpenses.map((e) => (
                      <div key={e.id} className="flex justify-between items-center text-xs rounded-lg border border-slate-100 px-2.5 py-2">
                        <div>
                          <span className="font-mono font-semibold">{fmtAed(Number(e.amount), i18n.language)}</span>
                          <span className="text-slate-400 ms-1"><bdi>{e.date}</bdi></span>
                        </div>
                        {isAdmin && e.payroll_status !== 'reversed' && employee && (
                          <button
                            type="button"
                            onClick={() => setReverseSalaryExpense(e)}
                            className="flex items-center gap-1 text-rose-600 hover:underline"
                          >
                            <Undo2 className="size-3" />
                            {t('financialControl.employeeFinancials.reverseSalary')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-400">{t('financialControl.employeeFinancials.aggregationNote')}</p>
            </>
          )}
        </div>
        {(canPay || canManageAdvances) && (
          <div className="p-4 border-t flex flex-col gap-2">
            {canPay && (
              <>
                <button
                  type="button"
                  onClick={onPaySalary}
                  disabled={salary <= 0}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Banknote className="size-4" />
                  {t('financialControl.employeeFinancials.paySalary')}
                </button>
                <button
                  type="button"
                  onClick={onPayCommission}
                  disabled={commissionAmount <= 0}
                  className="w-full py-2.5 border border-slate-200 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Coins className="size-4" />
                  {t('financialControl.employeeFinancials.payCommission')}
                </button>
              </>
            )}
            {canManageAdvances && outstandingTotal > 0 && (
              <button
                type="button"
                onClick={onRecordRepayment}
                className="w-full py-2.5 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Wallet className="size-4" />
                {t('financialControl.advances.recordRepayment')}
              </button>
            )}
            {canPay && (
              <p className="text-xs text-center text-slate-400">{t('financialControl.employeeFinancials.adminOnly')}</p>
            )}
          </div>
        )}
      </div>

      {reverseDeductionTarget && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !reversing && setReverseDeductionTarget(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl max-w-sm w-full p-5 space-y-4">
            <h4 className="font-semibold">{t('financialControl.advances.reverseDeductionTitle')}</h4>
            <p className="text-sm text-slate-600">{t('financialControl.advances.reverseDeductionConfirm')}</p>
            <label className="block text-sm">
              <span className="text-slate-600">{t('financialControl.advances.reason')}</span>
              <textarea
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[72px]"
                placeholder={t('financialControl.advances.reverseDeductionReasonPlaceholder')}
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={reversing}
                onClick={() => setReverseDeductionTarget(null)}
                className="px-4 py-2 text-sm border rounded-lg"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={reversing || !reverseReason.trim()}
                onClick={handleConfirmReverseDeduction}
                className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg disabled:opacity-50"
              >
                {reversing ? t('common.loading') : t('financialControl.advances.reverseDeduction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reverseSalaryExpense && employee && (
        <ReverseSalaryModal
          employeeProfileId={employee.employee_id}
          expense={reverseSalaryExpense}
          open={!!reverseSalaryExpense}
          onClose={() => setReverseSalaryExpense(null)}
          onSuccess={() => {
            loadAdvances();
            reloadDashboard();
          }}
        />
      )}
    </div>
  );
}
