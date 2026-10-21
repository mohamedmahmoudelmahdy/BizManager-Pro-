import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import { useData } from '@/app/contexts/DataContext';
import { getJson } from '@/app/lib/api';
import { fetchDashboardSummary, type DashboardSummary } from '@/app/lib/dashboardApi';
import { fetchMyEmployeeScore, type EmployeeMyScore } from '@/app/lib/employeeApi';
import { useTranslation } from 'react-i18next';
import { ResolveAlertModal } from '@/app/components/dashboard/ResolveAlertModal';
import {
  buildDashboardExpiryAlerts,
  filterDashboardAlerts,
  type AlertFilterGroup,
  type AlertFilterSeverity,
  type CompanyEmployeeAlert,
  type DashboardExpiryAlert,
} from '@/app/utils/dashboardAlerts';
import { filterProceduresForEmployee } from '@/app/utils/employeeProcedures';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/app/components/ui/dialog';
import { 
  DollarSign, 
  AlertTriangle, 
  FileText, 
  TrendingUp,
  Eye,
  EyeOff,
  Trophy
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    customers,
    procedures,
    payments,
    expenses,
    bankCards,
    employees,
    procedureCategories,
    refreshCustomers,
    refreshBankCards,
    refreshProcedures,
    ensureLoaded,
  } = useData();

  useEffect(() => {
    void ensureLoaded([
      'customers',
      'procedures',
      'payments',
      'expenses',
      'bankCards',
      'employees',
      'procedureCategories',
    ]);
  }, [ensureLoaded]);

  const [selectedProcedureId, setSelectedProcedureId] = useState<string | null>(null);
  const [resolveAlert, setResolveAlert] = useState<DashboardExpiryAlert | null>(null);
  const [alertSearch, setAlertSearch] = useState('');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<AlertFilterSeverity>('all');
  const [alertGroupFilter, setAlertGroupFilter] = useState<AlertFilterGroup>('all');
  const [numbersVisible, setNumbersVisible] = useState(() => {
    try {
      return localStorage.getItem('dashboardNumbersVisible') !== 'false';
    } catch {
      return true;
    }
  });
  const [companyEmployees, setCompanyEmployees] = useState<CompanyEmployeeAlert[]>([]);
  const [myScore, setMyScore] = useState<EmployeeMyScore | null>(null);
  const [myScoreLoading, setMyScoreLoading] = useState(false);
  const [myScoreError, setMyScoreError] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const loadCompanyEmployees = useCallback(async () => {
    try {
      const data = await getJson<any>('/company-employees/');
      if (Array.isArray(data)) {
        setCompanyEmployees(data);
      } else if (Array.isArray(data?.results)) {
        setCompanyEmployees(data.results);
      } else {
        setCompanyEmployees([]);
      }
    } catch {
      setCompanyEmployees([]);
    }
  }, []);

  const parseDate = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const inRange = (value: string | undefined, start: Date, end: Date) => {
    const parsed = parseDate(value);
    return !!parsed && parsed >= start && parsed < end;
  };

  const addMonths = (base: Date, diff: number) => {
    const next = new Date(base);
    next.setMonth(next.getMonth() + diff);
    return next;
  };

  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const now = new Date();
  const currentPeriodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthStart = startOfMonth(now);
  const nextMonthStart = addMonths(currentMonthStart, 1);

  const loadMyScore = useCallback(async () => {
    if (user?.role !== 'employee') return;
    setMyScoreLoading(true);
    setMyScoreError(false);
    try {
      // Same default period as Employee Log (current YYYY-MM); identity is auth-only on the server.
      const data = await fetchMyEmployeeScore(currentPeriodKey);
      setMyScore(data.score ?? null);
    } catch {
      setMyScore(null);
      setMyScoreError(true);
    } finally {
      setMyScoreLoading(false);
    }
  }, [user?.role, currentPeriodKey]);

  const loadSummary = useCallback(async () => {
    if (user?.role !== 'admin' && user?.role !== 'manager') return;
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const data = await fetchDashboardSummary(currentPeriodKey);
      setSummary(data);
    } catch {
      setSummary(null);
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  }, [user?.role, currentPeriodKey]);

  const monthPayments = (start: Date, end: Date) => payments.filter((p) => inRange(p.date, start, end));
  const monthProcedures = (start: Date, end: Date) => procedures.filter((p) => inRange(p.date, start, end));
  const monthExpenses = (start: Date, end: Date) => expenses.filter((e) => inRange(e.date, start, end));

  const sumAmounts = <T,>(rows: T[], selector: (row: T) => number) =>
    rows.reduce((sum, row) => sum + selector(row), 0);

  const formatMoney = (value?: string | null) => {
    if (value == null || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? `AED ${n.toLocaleString()}` : `AED ${value}`;
  };

  const formatRatePct = (value?: string | null) => {
    if (value == null || value === '') return '—';
    return `${value}%`;
  };

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todaysPayments = monthPayments(todayStart, tomorrowStart);
  const todaysRevenue = sumAmounts(todaysPayments, (p) => Number(p.amount || 0));
  const todaysCashRevenue = sumAmounts(todaysPayments.filter((p) => p.type === 'cash'), (p) => Number(p.amount || 0));

  // Calculate KPIs (cashier / shared fallbacks; admin/manager prefer summary API)
  const outstandingDebt = summary
    ? Number(summary.executive.outstanding_receivables || 0)
    : customers.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
  const customersWithDebt = summary
    ? summary.executive.customers_with_debt
    : customers.filter((c) => c.balance > 0).length;
  const proceduresInProgress = summary
    ? summary.operations.active
    : procedures.filter(
        (p) => p.status === 'in-process' || p.status === 'submitted' || p.status === 'need-info'
      ).length;

  const employeeProceduresThisMonth = useMemo(
    () =>
      filterProceduresForEmployee(procedures, user?.id, {
        dateInRange: (date) => inRange(date, currentMonthStart, nextMonthStart),
      }),
    [procedures, user?.id, currentMonthStart, nextMonthStart]
  );

  const visibleProcedures = user?.role === 'employee'
    ? filterProceduresForEmployee(procedures, user?.id)
    : procedures;

  useEffect(() => {
    if (user?.role === 'employee') {
      // #region agent log
      if (import.meta.env.VITE_AGENT_DEBUG === '1') {
        fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3d910e'},body:JSON.stringify({sessionId:'3d910e',runId:'post-fix',hypothesisId:'C',location:'DashboardPage.tsx',message:'dashboard_extra_employee',data:{role:user?.role,actions:['loadMyScore']},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      // Procedures already hydrated by DataContext; avoid a duplicate full /procedures/ fetch.
      void loadMyScore();
    }
  }, [user?.role, loadMyScore]);

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'manager') {
      // #region agent log
      if (import.meta.env.VITE_AGENT_DEBUG === '1') {
        fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3d910e'},body:JSON.stringify({sessionId:'3d910e',runId:'post-fix',hypothesisId:'C',location:'DashboardPage.tsx',message:'dashboard_extra_admin',data:{role:user?.role,actions:['loadSummary']},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      void loadSummary();
    }
  }, [user?.role, loadSummary]);

  useEffect(() => {
    // #region agent log
    if (import.meta.env.VITE_AGENT_DEBUG === '1') {
      fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3d910e'},body:JSON.stringify({sessionId:'3d910e',runId:'post-fix',hypothesisId:'C',location:'DashboardPage.tsx',message:'dashboard_company_employees',data:{role:user?.role},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    void loadCompanyEmployees();
  }, [loadCompanyEmployees]);

  const expiryAlerts = useMemo(
    () =>
      buildDashboardExpiryAlerts(customers, companyEmployees, {
        licenseExpiry: t('dashboard.licenseExpiry'),
        establishmentCardExpiry: t('dashboard.establishmentCardExpiry'),
        workersExpiry: t('dashboard.workersExpiry'),
        healthInsuranceExpiry: t('dashboard.healthInsuranceExpiry'),
        echannelExpiry: t('dashboard.echannelExpiry'),
        visaExpiry: t('dashboard.visaExpiry'),
        insuranceExpiry: t('dashboard.insuranceExpiry'),
        tradeLicense: t('dashboard.tradeLicenseExpiry'),
        workerResidency: t('dashboard.workerResidencyExpiring'),
        workerInsurance: t('dashboard.workerInsuranceExpiring'),
      }),
    [customers, companyEmployees, t]
  );

  const filteredExpiryAlerts = useMemo(
    () =>
      filterDashboardAlerts(expiryAlerts, {
        search: alertSearch,
        severity: alertSeverityFilter,
        group: alertGroupFilter,
      }),
    [expiryAlerts, alertSearch, alertSeverityFilter, alertGroupFilter]
  );

  const canCreateProcedure = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee';

  const handleAlertResolved = useCallback(
    async ({ procedureCreated }: { procedureCreated: boolean }) => {
      await Promise.all([refreshCustomers(), loadCompanyEmployees()]);
      if (procedureCreated) {
        await Promise.all([refreshBankCards(), refreshProcedures()]);
      }
      if (user?.role === 'admin' || user?.role === 'manager') {
        void loadSummary();
      }
    },
    [loadCompanyEmployees, loadSummary, refreshBankCards, refreshCustomers, refreshProcedures, user?.role]
  );

  const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const revenueData = useMemo(() => {
    return Array.from({ length: 5 }).map((_, idx) => {
      const monthDate = addMonths(currentMonthStart, idx - 4);
      const monthStart = startOfMonth(monthDate);
      const monthEnd = addMonths(monthStart, 1);
      const revenue = sumAmounts(monthProcedures(monthStart, monthEnd), (p) => Number(p.sellingPrice || 0));
      const procedureCost = sumAmounts(monthProcedures(monthStart, monthEnd), (p) => Number(p.cost || 0));
      const operatingExpenses = sumAmounts(monthExpenses(monthStart, monthEnd), (e) => Number(e.amount || 0));
      return {
        month: t(`months.${monthKeys[monthDate.getMonth()]}`, { defaultValue: monthDate.toLocaleString('en', { month: 'short' }) }),
        revenue,
        expenses: procedureCost + operatingExpenses,
      };
    });
  }, [currentMonthStart, payments, procedures, expenses, t]);

  const paymentMethodData = [
    { name: t('paymentMethods.cash'), value: sumAmounts(payments.filter(p => p.type === 'cash'), (p) => Number(p.amount || 0)) },
    { name: t('paymentMethods.pos'), value: sumAmounts(payments.filter(p => p.type === 'pos'), (p) => Number(p.amount || 0)) },
    { name: t('paymentMethods.transfer'), value: sumAmounts(payments.filter(p => p.type === 'transfer'), (p) => Number(p.amount || 0)) },
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b'];
  const selectedProcedure = procedures.find((procedure) => procedure.id === selectedProcedureId);
  const getBankCardLabel = (cardId?: string) => {
    if (!cardId) return t('common.empty');
    const card = bankCards.find((entry) => entry.id === cardId);
    return card ? `${card.bankName} • ${card.cardType} • ****${card.last4}` : cardId;
  };

  // Role-specific content
  const renderRoleSpecificContent = () => {
    switch (user?.role) {
      case 'admin':
      case 'manager': {
        const exec = summary?.executive;
        const collection = summary?.collection;
        const ops = summary?.operations;
        const employeesSec = summary?.employees;
        const marketing = summary?.marketing;
        const expensesSec = summary?.expenses;
        const bank = summary?.bank;
        const debtAging = summary?.debt_aging ?? [];
        const profitByType = summary?.profit_by_type ?? [];
        const topCustomers = summary?.top_customers_by_profit ?? [];
        const mgmtAlerts = summary?.alerts ?? [];

        const moneyOrDots = (value?: string | null) =>
          numbersVisible ? formatMoney(value) : 'AED •••';
        const numOrDots = (value?: number | null) =>
          numbersVisible ? (value ?? '—') : '•••';

        return (
          <>
            {summaryError && (
              <p className="text-sm text-red-600 mb-2">{t('dashboard.summaryLoadError')}</p>
            )}
            {summaryLoading && !summary && (
              <p className="text-sm text-slate-500 mb-2">{t('dashboard.summaryLoading')}</p>
            )}

            {/* Executive row */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.collectedRevenue')}</CardTitle>
                  <DollarSign className="h-4 w-4 text-slate-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{moneyOrDots(exec?.collected_revenue)}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.thisMonth')}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.netProfit')}</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{moneyOrDots(exec?.net_profit)}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.doneProceduresOnly')}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.outstandingDebts')}</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{moneyOrDots(exec?.outstanding_receivables)}</div>
                  <p className="text-xs text-slate-500 mt-1">
                    {numbersVisible && <span className="text-red-500">{customersWithDebt}</span>}{' '}
                    {t('dashboard.customersWithDebt')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.marketingContribution')}</CardTitle>
                  <TrendingUp className="h-4 w-4 text-slate-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {marketing ? moneyOrDots(exec?.marketing_contribution) : '—'}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.profitMinusSpend')}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.cashAvailable')}</CardTitle>
                  <DollarSign className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{moneyOrDots(exec?.cash_available)}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.paymentMethodBalances')}</p>
                </CardContent>
              </Card>
            </div>

            {/* Collection + debt aging */}
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.collectionRate')}</CardTitle>
                  <CardDescription>
                    {numbersVisible
                      ? t('dashboard.collectionRateDetail', {
                          collected: formatMoney(collection?.collected),
                          due: formatMoney(collection?.amount_due),
                        })
                      : t('dashboard.thisMonth')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {numbersVisible ? formatRatePct(collection?.rate_pct) : '•••'}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {t('dashboard.overdueReceivables')}: {moneyOrDots(collection?.overdue_receivables)}
                  </p>
                  {(collection?.top_debtors?.length ?? 0) > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-slate-700">{t('dashboard.topDebtors')}</p>
                      {collection!.top_debtors.slice(0, 5).map((d) => (
                        <div key={d.customer_id} className="flex justify-between text-xs text-slate-600">
                          <span>{d.name}</span>
                          <span dir="ltr">{moneyOrDots(d.balance)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.debtAging')}</CardTitle>
                  <CardDescription>{t('dashboard.debtAgingDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={debtAging.map((row) => ({
                        bucket: t(`dashboard.aging.${row.bucket}`, { defaultValue: row.bucket }),
                        amount: Number(row.amount || 0),
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="amount" fill="#f59e0b" name={t('dashboard.outstandingDebts')} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1">
                    {debtAging.map((row) => (
                      <div key={row.bucket} className="flex justify-between text-xs text-slate-600">
                        <span>{t(`dashboard.aging.${row.bucket}`, { defaultValue: row.bucket })}</span>
                        <span dir="ltr">{moneyOrDots(row.amount)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Operations row */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.activeProcedures')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{numOrDots(ops?.active)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.overdueProcedures')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{numOrDots(ops?.overdue)}</div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('dashboard.openOverDays', { count: ops?.open_over_14_days ?? 0, days: 14 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.completionRate')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {numbersVisible ? formatRatePct(ops?.completion_rate_pct) : '•••'}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.unassignedProcedures')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{numOrDots(ops?.unassigned)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.expenseRatio')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {numbersVisible ? formatRatePct(expensesSec?.expense_ratio_pct) : '•••'}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('dashboard.expensesThisMonth')}: {moneyOrDots(expensesSec?.total)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Profit by type + top customers */}
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.profitByType')}</CardTitle>
                  <CardDescription>{t('dashboard.profitByTypeDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {profitByType.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('dashboard.noData')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500 border-b">
                            <th className="py-2 pr-2 font-medium">{t('dashboard.procedure')}</th>
                            <th className="py-2 pr-2 font-medium text-right">{t('dashboard.sellingPrice')}</th>
                            <th className="py-2 pr-2 font-medium text-right">{t('dashboard.cost')}</th>
                            <th className="py-2 pr-2 font-medium text-right">{t('dashboard.netProfit')}</th>
                            <th className="py-2 font-medium text-right">{t('dashboard.margin')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profitByType.slice(0, 8).map((row) => (
                            <tr key={row.procedure_type} className="border-b border-slate-100">
                              <td className="py-2 pr-2">{row.procedure_type || '—'}</td>
                              <td className="py-2 pr-2 text-right" dir="ltr">
                                {numbersVisible ? formatMoney(row.revenue) : '•••'}
                              </td>
                              <td className="py-2 pr-2 text-right" dir="ltr">
                                {numbersVisible ? formatMoney(row.cost) : '•••'}
                              </td>
                              <td className="py-2 pr-2 text-right" dir="ltr">
                                {numbersVisible ? formatMoney(row.net_profit) : '•••'}
                              </td>
                              <td className="py-2 text-right" dir="ltr">
                                {numbersVisible ? formatRatePct(row.margin_pct) : '•••'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.topCustomersByProfit')}</CardTitle>
                  <CardDescription>{t('dashboard.thisMonth')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {topCustomers.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('dashboard.noData')}</p>
                  ) : (
                    <div className="space-y-2">
                      {topCustomers.map((c) => (
                        <div key={c.customer_id} className="flex justify-between text-sm">
                          <span className="text-slate-800">{c.name}</span>
                          <span className="font-medium" dir="ltr">
                            {moneyOrDots(c.net_profit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Employee + marketing + bank */}
            <div className="grid gap-4 md:grid-cols-3 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.employeePerformance')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.topPerformer')}</span>
                    <span>{employeesSec?.top_by_net_profit?.full_name || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.averageScore')}</span>
                    <span dir="ltr">
                      {numbersVisible
                        ? employeesSec?.average_score != null
                          ? employeesSec.average_score
                          : '—'
                        : '•••'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.commissionDue')}</span>
                    <span dir="ltr">{moneyOrDots(employeesSec?.commission_due_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.outstandingAdvances')}</span>
                    <span dir="ltr">{moneyOrDots(employeesSec?.outstanding_advances_total)}</span>
                  </div>
                  {employeesSec?.workload_imbalance && (
                    <p className="text-xs text-amber-700 mt-2">
                      {t('dashboard.workloadImbalance', {
                        high: employeesSec.workload_imbalance.highest.name,
                        highCount: employeesSec.workload_imbalance.highest.open_procedures,
                        low: employeesSec.workload_imbalance.lowest.name,
                        lowCount: employeesSec.workload_imbalance.lowest.open_procedures,
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.marketingPerformance')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {!marketing ? (
                    <p className="text-slate-500">{t('dashboard.marketingUnavailable')}</p>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('dashboard.leads')}</span>
                        <span>{numOrDots(marketing.leads)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('dashboard.convertedCustomers')}</span>
                        <span>{numOrDots(marketing.converted_customers)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('dashboard.conversionRate')}</span>
                        <span dir="ltr">
                          {numbersVisible ? formatRatePct(marketing.conversion_rate_pct) : '•••'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('dashboard.attributedNetProfit')}</span>
                        <span dir="ltr">{moneyOrDots(marketing.net_profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('dashboard.roas')}</span>
                        <span dir="ltr">{numbersVisible ? marketing.roas ?? '—' : '•••'}</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.bankExceptions')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.unreconciledAccounts')}</span>
                    <span>{numOrDots(bank?.unreconciled_accounts)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.unreconciledEntries')}</span>
                    <span>{numOrDots(bank?.unreconciled_entries)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('dashboard.payrollVsOperating')}</span>
                    <span dir="ltr" className="text-right">
                      {numbersVisible
                        ? `${formatMoney(expensesSec?.payroll)} / ${formatMoney(expensesSec?.operating)}`
                        : '•••'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Critical alerts from summary */}
            {mgmtAlerts.length > 0 && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{t('dashboard.criticalAlerts')}</CardTitle>
                  <CardDescription>{t('dashboard.criticalAlertsDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {mgmtAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                        alert.severity === 'critical'
                          ? 'bg-red-50 border-red-200'
                          : alert.severity === 'high'
                            ? 'bg-orange-50 border-orange-200'
                            : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <Badge variant="secondary" className="shrink-0 capitalize">
                        {t(`dashboard.severity.${alert.severity}`, { defaultValue: alert.severity })}
                      </Badge>
                      <div>
                        <p className="font-medium text-slate-900">
                          {t(`dashboard.alertKeys.${alert.title_key}`, {
                            defaultValue: alert.title_key,
                          })}
                        </p>
                        <p className="text-slate-600">
                          {alert.count != null &&
                            t('dashboard.alertCount', { count: alert.count })}
                          {alert.detail_count != null &&
                            ` · ${t('dashboard.alertDetailCount', { count: alert.detail_count })}`}
                          {alert.amount != null && numbersVisible && ` · ${formatMoney(alert.amount)}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Charts */}
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.revenueVsExpenses')}</CardTitle>
                  <CardDescription>{t('dashboard.monthlyComparison')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} />
                      <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.paymentMethods')}</CardTitle>
                  <CardDescription>{t('dashboard.distributionByType')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={paymentMethodData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry) => entry.name}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {paymentMethodData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </>
        );
      }

      case 'employee': {
        const scoreValue = myScore?.value;
        const scoreMax = myScore?.maximum;
        const scoreRank = myScore?.rank;
        const rankTotal = myScore?.rank_total;
        const periodKey = myScore?.period?.key ?? null;
        const isCurrentMonthPeriod =
          myScore?.period?.type === 'month' && periodKey === currentPeriodKey;
        const scoreAvailable =
          typeof scoreValue === 'number' &&
          Number.isFinite(scoreValue) &&
          typeof scoreMax === 'number' &&
          Number.isFinite(scoreMax) &&
          scoreMax > 0;
        const rankAvailable = typeof scoreRank === 'number' && Number.isFinite(scoreRank);
        const rankTotalAvailable =
          typeof rankTotal === 'number' && Number.isFinite(rankTotal) && rankTotal > 0;

        let scorePrimary: React.ReactNode;
        if (myScoreLoading) {
          scorePrimary = <span className="text-slate-400">…</span>;
        } else if (myScoreError || !scoreAvailable) {
          scorePrimary = (
            <span className="text-base font-medium text-slate-500">
              {t('dashboard.employeeScore.unavailable')}
            </span>
          );
        } else if (!numbersVisible) {
          scorePrimary = '•••';
        } else {
          scorePrimary = (
            <span dir="ltr" className="inline-block tabular-nums">
              {scoreValue} / {scoreMax}
            </span>
          );
        }

        let rankSecondary: React.ReactNode = null;
        if (!myScoreLoading && !myScoreError) {
          if (!rankAvailable) {
            rankSecondary = t('dashboard.employeeScore.notRanked');
          } else if (!numbersVisible) {
            rankSecondary = `${t('dashboard.employeeScore.rank')} #•••`;
          } else if (rankTotalAvailable) {
            rankSecondary = t('dashboard.employeeScore.rankOf', {
              rank: scoreRank,
              total: rankTotal,
            });
          } else {
            rankSecondary = (
              <>
                {t('dashboard.employeeScore.rank')}{' '}
                <span dir="ltr" className="inline-block tabular-nums">
                  #{scoreRank}
                </span>
              </>
            );
          }
        }

        const a11yLabel =
          scoreAvailable && rankAvailable
            ? t('dashboard.employeeScore.a11y', {
                score: scoreValue,
                maximum: scoreMax,
                rank: scoreRank,
              })
            : t('dashboard.employeeScore.title');

        return (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.myProcedures')}</CardTitle>
                  <FileText className="h-4 w-4 text-slate-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {numbersVisible ? employeeProceduresThisMonth.length : '•••'}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.thisMonth')}</p>
                </CardContent>
              </Card>

              <Card aria-busy={myScoreLoading} aria-label={a11yLabel}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t('dashboard.employeeScore.title')}
                  </CardTitle>
                  <Trophy className="h-4 w-4 text-slate-500" aria-hidden />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{scorePrimary}</div>
                  {rankSecondary != null && (
                    <p className="text-xs text-slate-500 mt-1">{rankSecondary}</p>
                  )}
                  {!myScoreLoading && !myScoreError && isCurrentMonthPeriod && (
                    <p className="text-xs text-slate-500 mt-1">{t('dashboard.thisMonth')}</p>
                  )}
                  {!myScoreLoading &&
                    !myScoreError &&
                    myScore?.period?.type === 'month' &&
                    periodKey &&
                    !isCurrentMonthPeriod && (
                      <p className="text-xs text-slate-500 mt-1" dir="ltr">
                        {periodKey}
                      </p>
                    )}
                </CardContent>
              </Card>
            </div>
          </>
        );
      }

      case 'cashier':
        return (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.todaysPayments')}</CardTitle>
                  <DollarSign className="h-4 w-4 text-slate-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{numbersVisible ? `AED ${todaysRevenue.toLocaleString()}` : 'AED •••'}</div>
                  <p className="text-xs text-slate-500 mt-1">
                    {numbersVisible ? t('dashboard.transactions', { count: todaysPayments.length }) : t('dashboard.transactions', { count: 0 })}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.cashCollected')}</CardTitle>
                  <DollarSign className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {numbersVisible ? `AED ${todaysCashRevenue.toLocaleString()}` : 'AED •••'}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.cashPayments')}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('dashboard.unpaidBalances')}</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{numbersVisible ? `AED ${outstandingDebt.toLocaleString()}` : 'AED •••'}</div>
                  <p className="text-xs text-slate-500 mt-1">{t('dashboard.requiresAttention')}</p>
                </CardContent>
              </Card>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  const toggleNumbersVisible = () => {
    setNumbersVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('dashboardNumbersVisible', String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('nav.dashboard')}</h1>
          <p className="text-slate-500 mt-1">{t('dashboard.welcomeBack', { name: user?.name || '' })}</p>
        </div>
        <button
          type="button"
          onClick={toggleNumbersVisible}
          className="p-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title={numbersVisible ? (t('dashboard.hideNumbers') || 'Hide numbers') : (t('dashboard.showNumbers') || 'Show numbers')}
        >
          {numbersVisible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>

      {renderRoleSpecificContent()}

      {/* Alerts Panel */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.alertsTitle')}</CardTitle>
          <CardDescription>{t('dashboard.alertsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <input
              type="search"
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
              placeholder={t('dashboard.alerts.searchPlaceholder')}
              className="border border-slate-200 rounded-md px-3 py-1.5 text-sm min-w-[200px] flex-1"
            />
            <select
              value={alertSeverityFilter}
              onChange={(e) => setAlertSeverityFilter(e.target.value as AlertFilterSeverity)}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="all">{t('dashboard.alerts.filterAllSeverities')}</option>
              <option value="expired">{t('dashboard.alerts.filterExpired')}</option>
              <option value="expiring_soon">{t('dashboard.alerts.filterExpiringSoon')}</option>
            </select>
            <select
              value={alertGroupFilter}
              onChange={(e) => setAlertGroupFilter(e.target.value as AlertFilterGroup)}
              className="border border-slate-200 rounded-md px-2 py-1.5 text-sm min-w-[180px]"
            >
              <option value="all">{t('dashboard.alerts.filterAllTypes')}</option>
              <option value="company_documents">{t('dashboard.alerts.filterCompanyDocuments')}</option>
              <option value="worker_documents">{t('dashboard.alerts.filterWorkerDocuments')}</option>
              <option value="license">{t('dashboard.alerts.filterLicense')}</option>
              <option value="trade_license">{t('dashboard.alerts.filterTradeLicense')}</option>
              <option value="insurance">{t('dashboard.alerts.filterInsurance')}</option>
              <option value="workers">{t('dashboard.alerts.filterWorkers')}</option>
              <option value="residency">{t('dashboard.alerts.filterResidency')}</option>
              <option value="establishment">{t('dashboard.alerts.filterEstablishment')}</option>
              <option value="echannel">{t('dashboard.alerts.filterEchannel')}</option>
            </select>
          </div>

          <div className="space-y-3">
            {filteredExpiryAlerts.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">{t('dashboard.alerts.noAlerts')}</p>
            ) : (
              filteredExpiryAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    alert.severity === 'expired'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-orange-50 border-orange-200'
                  }`}
                >
                  <Button variant="outline" size="sm" onClick={() => setResolveAlert(alert)}>
                    {t('dashboard.alerts.resolve')}
                  </Button>
                  <AlertTriangle
                    className={`h-5 w-5 shrink-0 ${
                      alert.severity === 'expired' ? 'text-red-600' : 'text-orange-600'
                    }`}
                  />
                  <div>
                    <p className="font-medium text-slate-900">{alert.label}</p>
                    <p className="text-sm text-slate-600">
                      {alert.workerName
                        ? t('dashboard.workerExpiresOn', {
                            name: alert.workerName,
                            company: alert.customerName,
                            date: alert.currentExpiryDate || t('common.na'),
                            days: alert.daysRemaining,
                          })
                        : t('dashboard.companyDocumentExpiresOn', {
                            company: alert.customerName,
                            document: alert.label,
                            date: alert.currentExpiryDate || t('common.na'),
                            days: alert.daysRemaining,
                          })}
                    </p>
                  </div>
                </div>
              ))
            )}

            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedProcedureId(procedures[0]?.id || null)}
              >
                {t('common.review')}
              </Button>
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-slate-900">{t('dashboard.pendingProcedures')}</p>
                  <p className="text-sm text-slate-600">{t('dashboard.proceduresAwaiting', { count: proceduresInProgress })}</p>
                </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ResolveAlertModal
        alert={resolveAlert}
        open={Boolean(resolveAlert)}
        onClose={() => setResolveAlert(null)}
        onResolved={handleAlertResolved}
        bankCards={bankCards}
        employees={employees}
        procedureCategories={procedureCategories}
        canCreateProcedure={canCreateProcedure}
      />

      <Dialog open={!!selectedProcedureId} onOpenChange={(open) => !open && setSelectedProcedureId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('dashboard.procedureDetails')}</DialogTitle>
            <DialogDescription>{t('dashboard.reviewProcedure')}</DialogDescription>
          </DialogHeader>
          {selectedProcedure ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.customer')}</p>
                <p className="font-medium text-slate-900">{selectedProcedure.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.procedure')}</p>
                <p className="font-medium text-slate-900">{selectedProcedure.category}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.cost')}</p>
                <p className="text-sm text-slate-900">AED {selectedProcedure.cost.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.sellingPrice')}</p>
                <p className="text-sm text-slate-900">AED {selectedProcedure.sellingPrice.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.cashIn')}</p>
                <p className="text-sm text-slate-900">AED {selectedProcedure.cashIn.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.cashInType')}</p>
                <p className="text-sm text-slate-900">{getBankCardLabel(selectedProcedure.cashInType)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.status')}</p>
                <Badge variant="secondary">
                  {t(`status.${selectedProcedure.status}`, { defaultValue: selectedProcedure.status })}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.assignedTo')}</p>
                <p className="text-sm text-slate-900">{selectedProcedure.assignedEmployee}</p>
              </div>
              <div className="md:col-span-2">
                <p className="text-sm text-slate-500">{t('dashboard.date')}</p>
                <p className="text-sm text-slate-900">{selectedProcedure.date}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('dashboard.noProcedureSelected')}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
          <CardDescription>{t('dashboard.latestUpdates')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {visibleProcedures.slice(0, 5).map((proc) => (
              <div key={proc.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{proc.customerName}</p>
                  <p className="text-sm text-slate-500">{proc.category} - {proc.status}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-slate-900">AED {proc.cost.toLocaleString()}</p>
                  <p className="text-sm text-slate-500">{proc.date}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
