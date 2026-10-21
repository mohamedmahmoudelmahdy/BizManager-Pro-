import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '@/app/contexts/DataContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Download, Loader2 } from 'lucide-react';
import {
  formatReportAed,
  getExpenseReportingMonthKey,
  monthKeyFromDateOnly,
} from '@/app/lib/reportExpensePeriod';
import {
  fetchCollectedProfitability,
  type CollectedProfitabilityReport,
} from '@/app/lib/reportsApi';
import { formatApiErrorMessage } from '@/app/lib/api';

function money(value?: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  salaries: 'Salaries',
  office: 'Office',
  'government-fees': 'Gov Fees',
  misc: 'Misc',
};

export function ReportsPage() {
  const { t } = useTranslation();
  const { procedures, payments, expenses, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['procedures', 'payments', 'expenses'], { forceFinancial: true });
  }, [ensureLoaded]);

  const [monthFilter, setMonthFilter] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [report, setReport] = useState<CollectedProfitabilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const monthOptions = useMemo(() => {
    const values = new Set<string>();
    procedures.forEach((item) => {
      const key = monthKeyFromDateOnly(item.date);
      if (key) values.add(key);
    });
    payments.forEach((item) => {
      const key = monthKeyFromDateOnly(item.date);
      if (key) values.add(key);
    });
    expenses.forEach((item) => {
      const key = getExpenseReportingMonthKey(item);
      if (key) values.add(key);
    });
    if (monthFilter && monthFilter !== 'all') values.add(monthFilter);
    return Array.from(values).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  }, [procedures, expenses, payments, monthFilter]);

  const load = useCallback(async () => {
    if (monthFilter === 'all') {
      setReport(null);
      setError(t('reportsAnalytics.selectMonth'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchCollectedProfitability(monthFilter);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(formatApiErrorMessage(err, t('reportsAnalytics.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [monthFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  const profit = report?.profitability;
  const collections = report?.collections;

  const revenueByCategory = useMemo(
    () =>
      (report?.procedure_revenue_by_category || []).map((row) => ({
        category: row.category,
        total: money(row.total),
      })),
    [report]
  );

  const costsByCategory = useMemo(
    () =>
      (report?.procedure_costs_by_category || []).map((row) => ({
        category: row.category,
        total: money(row.total),
      })),
    [report]
  );

  const expensesByCategory = useMemo(
    () =>
      (report?.expense_distribution || []).map((row) => ({
        name: EXPENSE_CATEGORY_LABELS[row.category] || row.category,
        value: money(row.total),
      })),
    [report]
  );

  const collectionsByLink = useMemo(
    () =>
      (report?.collections_by_category || []).map((row) => ({
        category: row.category,
        net_collected: money(row.net_collected),
      })),
    [report]
  );

  const marginDisplay =
    profit?.profit_margin != null ? `${Number(profit.profit_margin).toFixed(1)}%` : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t('reportsAnalytics.title')}</h1>
          <p className="text-slate-500 mt-1">{t('reportsAnalytics.subtitle')}</p>
        </div>
        <Button className="gap-2" type="button" disabled title={t('reportsAnalytics.exportStub')}>
          <Download className="h-4 w-4" />
          {t('reportsAnalytics.export')}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-slate-700" htmlFor="reports-month">
              {t('reportsAnalytics.filterMonth')}
            </label>
            <select
              id="reports-month"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white min-w-[180px]"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : report && profit && collections ? (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('reportsAnalytics.profitabilitySection')}</h2>
              <p className="text-sm text-slate-500">{t('reportsAnalytics.profitabilitySectionHint')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Kpi
                title={t('reportsAnalytics.procedureRevenue')}
                hint={t('reportsAnalytics.procedureRevenueHint')}
                value={formatReportAed(money(profit.procedure_revenue))}
                valueClass="text-green-700"
              />
              <Kpi
                title={t('reportsAnalytics.procedureCostsIncurred')}
                hint={t('reportsAnalytics.procedureCostsIncurredHint')}
                value={formatReportAed(money(profit.procedure_costs_incurred))}
                valueClass="text-amber-700"
              />
              <Kpi
                title={t('reportsAnalytics.operatingExpenses')}
                hint={t('reportsAnalytics.operatingExpensesHint')}
                value={formatReportAed(money(profit.operating_expenses))}
                valueClass="text-red-700"
              />
              <Kpi
                title={t('reportsAnalytics.operatingProfit')}
                hint={t('reportsAnalytics.operatingProfitHint')}
                value={formatReportAed(money(profit.operating_profit))}
                valueClass="text-blue-700"
              />
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('reportsAnalytics.profitMargin')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.profitMarginHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{marginDisplay}</div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('reportsAnalytics.collectionsSection')}</h2>
              <p className="text-sm text-slate-500">{t('reportsAnalytics.collectionsSectionHint')}</p>
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{t('reportsAnalytics.collectionDetail')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.collectionDetailHint')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row
                  label={t('reportsAnalytics.grossCollected')}
                  value={formatReportAed(money(collections.gross_customer_collections))}
                />
                <Row label={t('reportsAnalytics.refunds')} value={formatReportAed(money(collections.refunds))} />
                <Row
                  label={t('reportsAnalytics.netCustomerCollections')}
                  value={formatReportAed(money(collections.net_customer_collections))}
                  bold
                />
                <div className="border-t border-slate-100 pt-2 mt-2 space-y-1">
                  <Row
                    label={t('reportsAnalytics.procedureLinked')}
                    value={formatReportAed(money(collections.procedure_linked_collections))}
                  />
                  <Row
                    label={t('reportsAnalytics.customerLevel')}
                    value={formatReportAed(money(collections.customer_level_collections))}
                  />
                  <p className="text-xs text-slate-500 pt-1">{t('reportsAnalytics.customerLevelNote')}</p>
                </div>
              </CardContent>
            </Card>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('reportsAnalytics.revenueByCategory')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.revenueByCategoryHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueByCategory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatReportAed(Number(value))} />
                    <Legend />
                    <Bar dataKey="total" name={t('reportsAnalytics.procedureRevenue')} fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('reportsAnalytics.costsByCategory')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.costsByCategoryHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costsByCategory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatReportAed(Number(value))} />
                    <Legend />
                    <Bar dataKey="total" name={t('reportsAnalytics.procedureCostsIncurred')} fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('reportsAnalytics.expenseDistribution')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.expenseDistributionHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={expensesByCategory}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name}: ${formatReportAed(Number(entry.value))}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {expensesByCategory.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatReportAed(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('reportsAnalytics.collectionsByLink')}</CardTitle>
                <CardDescription>{t('reportsAnalytics.collectionsByLinkHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={collectionsByLink}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatReportAed(Number(value))} />
                    <Legend />
                    <Bar
                      dataKey="net_collected"
                      name={t('reportsAnalytics.netCustomerCollections')}
                      fill="#3b82f6"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  title,
  hint,
  value,
  valueClass,
}: {
  title: string;
  hint: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClass || ''}`} dir="ltr">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-600">{label}</span>
      <span className={bold ? 'font-semibold text-slate-900' : 'font-mono text-slate-800'} dir="ltr">
        {value}
      </span>
    </div>
  );
}
