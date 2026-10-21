import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Plus,
  Search,
  ArrowLeft,
  Users,
  FileText,
  DollarSign,
  Award,
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle,
  AlertCircle,
  Banknote,
  Trophy,
  Target,
  Percent,
  TrendingUp,
  Clock,
  BarChart3,
  Calendar,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/app/components/ui/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/app/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ApiError } from '@/app/lib/api';
import {
  fetchEmployeeDashboard,
  fetchTeamPerformanceReport,
  mapDashboardProcedure,
  mapDashboardPayment,
  dashboardMetricsToEmployeeMetrics,
  mapDashboardPeriodGroups,
  type PayrollSubmitPayload,
  type PerformancePeriodMode,
  type TeamPerformanceReport,
  type TeamPerformanceRow,
} from '@/app/lib/employeeApi';
import { PaySalaryModal } from '@/app/components/financial-control/modals/PaySalaryModal';
import { useData, type BankCard, type Employee, type Expense, type Payment, type Procedure } from '@/app/contexts/DataContext';
import {
  buildEmployeeMetrics,
  computeCommissionAmount,
  employeeAvatarColor,
  employeeInitials,
  filterEmployeePayments,
  filterEmployeeProcedures,
  getMetricsForEmployee,
  groupProceduresByPeriod,
  hasPayrollForPeriod,
  isClosedProcedure,
  isOpenProcedure,
  monthlyChartData,
  payrollPeriodKey,
  periodRangeForFilter,
  roleLabelFromApi,
  roleValueFromLabel,
  type EmployeeMetrics,
  type PeriodBucket,
  type PeriodGroup,
  type PerformanceLevel,
} from '@/app/lib/employeePerformance';
import {
  fmtCurrency,
  fmtCurrencyCompact,
  payrollColor,
  perfColor,
  perfDot,
  roleColor,
  type PayrollStatus,
} from '@/app/components/employees/employeeLogFormat';

type ViewMode = 'list' | 'profile' | 'comparison';

type AddEditFormData = {
  name: string;
  role: string;
  salary: number;
  email: string;
  username: string;
  password: string;
  commissionRate: number;
  target: number;
  debit: number;
  credit: number;
};

type EnrichedEmployee = Employee & {
  roleLabel: string;
  initials: string;
  avatarColor: string;
  metrics: EmployeeMetrics;
  performanceLevel: PerformanceLevel;
  salaryStatus: PayrollStatus;
  commissionStatus: PayrollStatus;
  commissionEarned: number;
};

const DONUT_COLORS = ['#10B981', '#F59E0B', '#6366F1'];

function procedureStatusLabel(status: Procedure['status'], t: TFunction) {
  if (status === 'done') return t('employees.profile.statusClosed');
  if (status === 'rejected') return t('employees.profile.statusRejected');
  if (status === 'in-process') return t('employees.profile.statusInProgress');
  return t('employees.profile.statusOpen');
}

function procedureStatusClass(status: Procedure['status']) {
  if (status === 'done') return 'bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'bg-rose-50 text-rose-700';
  if (status === 'in-process') return 'bg-indigo-50 text-indigo-700';
  return 'bg-amber-50 text-amber-700';
}

function StatCard({
  icon,
  label,
  value,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
      <div className={cn('p-2 rounded-lg flex-shrink-0', iconBg)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-slate-400 font-medium truncate">{label}</div>
        <div className="text-base font-bold text-slate-900 leading-tight mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

function PayrollIcon({ status }: { status: PayrollStatus }) {
  if (status === 'Paid') return <CheckCircle className="size-3.5 text-emerald-500" />;
  if (status === 'Overdue') return <AlertCircle className="size-3.5 text-rose-500" />;
  return <Clock className="size-3.5 text-amber-500" />;
}

type SalarySettlementStatus = 'pending' | 'partial' | 'paid';

function EmployeeSalaryStatus({
  status,
  remainingDue,
  t,
}: {
  status: SalarySettlementStatus;
  remainingDue?: number;
  t: TFunction;
}) {
  const label =
    status === 'paid'
      ? t('employees.payroll.paid')
      : status === 'partial'
        ? t('employees.payroll.partial')
        : t('employees.payroll.pending');
  const colorClass =
    status === 'paid'
      ? 'text-emerald-600'
      : status === 'partial'
        ? 'text-blue-600'
        : 'text-amber-600';
  return (
    <span className={cn('font-semibold flex flex-col items-end gap-0.5', colorClass)}>
      <span className="flex items-center gap-1">
        {status === 'paid' ? (
          <CheckCircle className="size-3.5 text-emerald-500" />
        ) : (
          <Clock className={cn('size-3.5', status === 'partial' ? 'text-blue-500' : 'text-amber-500')} />
        )}
        {label}
      </span>
      {status === 'partial' && remainingDue != null && remainingDue > 0 && (
        <span className="text-[10px] text-slate-500 font-mono font-normal">
          {fmtCurrency(remainingDue)} {t('employees.payroll.remainingDue')}
        </span>
      )}
    </span>
  );
}

export function EmployeeLog() {
  const { t } = useTranslation();
  const {
    employees,
    procedures,
    payments,
    expenses,
    bankCards,
    loading,
    addEmployee,
    updateEmployee,
    removeEmployee,
    payEmployeeCommission,
    refreshExpenses,
    ensureLoaded,
  } = useData();

  React.useEffect(() => {
    void ensureLoaded(['employees', 'procedures', 'payments', 'expenses', 'bankCards'], {
      forceFinancial: true,
    });
  }, [ensureLoaded]);

  const now = new Date();
  const [view, setView] = useState<ViewMode>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [perfFilter, setPerfFilter] = useState('All');
  const [periodMode, setPeriodMode] = useState<PerformancePeriodMode>('month');
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState<number>(now.getMonth() + 1);
  const [profileGroupBy, setProfileGroupBy] = useState<PeriodGroup>('month');
  const [payrollYear, setPayrollYear] = useState(now.getFullYear());
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1);
  const [performanceReport, setPerformanceReport] = useState<TeamPerformanceReport | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState(false);

  const loadPerformanceReport = useCallback(async () => {
    setPerformanceLoading(true);
    setPerformanceError(false);
    try {
      const roleApi =
        roleFilter === 'All'
          ? undefined
          : roleValueFromLabel(roleFilter);
      const data = await fetchTeamPerformanceReport({
        period_mode: periodMode,
        year: periodMode === 'all_time' ? undefined : filterYear,
        month: periodMode === 'month' ? filterMonth : undefined,
        role: roleApi,
        performance: perfFilter === 'All' ? undefined : perfFilter,
      });
      setPerformanceReport(data);
    } catch {
      setPerformanceReport(null);
      setPerformanceError(true);
    } finally {
      setPerformanceLoading(false);
    }
  }, [periodMode, filterYear, filterMonth, roleFilter, perfFilter]);

  useEffect(() => {
    void loadPerformanceReport();
  }, [loadPerformanceReport]);

  // Sync filters to URL for refresh restore
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('period_mode', periodMode);
    if (periodMode !== 'all_time') params.set('year', String(filterYear));
    else params.delete('year');
    if (periodMode === 'month') params.set('month', String(filterMonth));
    else params.delete('month');
    if (roleFilter !== 'All') params.set('role', roleFilter);
    else params.delete('role');
    if (perfFilter !== 'All') params.set('performance', perfFilter);
    else params.delete('performance');
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }, [periodMode, filterYear, filterMonth, roleFilter, perfFilter]);

  // Restore from URL once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('period_mode');
    if (mode === 'month' || mode === 'year' || mode === 'all_time') setPeriodMode(mode);
    const y = Number(params.get('year'));
    if (Number.isFinite(y) && y >= 2000) setFilterYear(y);
    const m = Number(params.get('month'));
    if (Number.isFinite(m) && m >= 1 && m <= 12) setFilterMonth(m);
    const role = params.get('role');
    if (role) setRoleFilter(role);
    const perf = params.get('performance');
    if (perf === 'High' || perf === 'Medium' || perf === 'Low') setPerfFilter(perf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metricsByEmployeeId = useMemo(() => {
    const map = new Map<string, TeamPerformanceRow>();
    for (const row of performanceReport?.employees ?? []) {
      map.set(String(row.employee_id), row);
    }
    return map;
  }, [performanceReport]);

  const enrichedEmployees = useMemo<EnrichedEmployee[]>(() => {
    return employees.map((employee, index) => {
      const row = metricsByEmployeeId.get(employee.id);
      const metrics: EmployeeMetrics = row
        ? {
            employeeId: employee.id,
            userId: employee.userId,
            totalProcedures: row.total_procedures,
            openProcedures: row.open_procedures ?? 0,
            closedProcedures: row.closed_procedures,
            closureRatio:
              row.total_procedures > 0 ? row.closed_procedures / row.total_procedures : 0,
            paymentsCollected: row.payments_collected,
            netProfit: row.net_profit,
            commissionAmount: row.commission_amount,
            performanceScore: row.performance_score,
            performanceLevel: row.performance_level,
            rank: row.rank,
          }
        : {
            employeeId: employee.id,
            userId: employee.userId,
            totalProcedures: 0,
            openProcedures: 0,
            closedProcedures: 0,
            closureRatio: 0,
            paymentsCollected: 0,
            netProfit: 0,
            commissionAmount: 0,
            performanceScore: 0,
            performanceLevel: 'Low' as PerformanceLevel,
            rank: 0,
          };
      const salaryStatus: PayrollStatus =
        row?.salary_status === 'paid' ? 'Paid' : 'Pending';
      const commissionStatus: PayrollStatus = row?.commission_paid ? 'Paid' : 'Pending';
      return {
        ...employee,
        roleLabel: roleLabelFromApi(employee.role),
        initials: employeeInitials(employee.name),
        avatarColor: employeeAvatarColor(index),
        metrics,
        performanceLevel: metrics.performanceLevel,
        salaryStatus,
        commissionStatus,
        commissionEarned: metrics.commissionAmount || employee.commissionMonth,
      };
    });
  }, [employees, metricsByEmployeeId]);

  const selected = useMemo(
    () => enrichedEmployees.find((e) => e.id === selectedId) || null,
    [enrichedEmployees, selectedId]
  );

  const filtered = useMemo(() => {
    // Role/performance already applied on backend when set; still filter search client-side.
    // When API filter applied, employees not in report still appear with zeros — hide those
    // if role/perf filters are active by requiring a matching report row.
    const reportIds = new Set((performanceReport?.employees ?? []).map((r) => String(r.employee_id)));
    const filtersActive = roleFilter !== 'All' || perfFilter !== 'All';
    return enrichedEmployees.filter((e) => {
      if (filtersActive && !reportIds.has(e.id)) return false;
      if (
        searchQuery &&
        !e.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !e.email.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [enrichedEmployees, searchQuery, roleFilter, perfFilter, performanceReport]);

  const stats = useMemo(() => {
    const s = performanceReport?.summary;
    if (s) {
      return {
        total: s.total_employees,
        activeProcedures: s.open_procedures,
        closedProcedures: s.closed_procedures,
        totalCollected: s.total_collected,
        salariesDue: s.salaries_due,
        commissionsDue: s.commissions_due,
      };
    }
    return {
      total: 0,
      activeProcedures: 0,
      closedProcedures: 0,
      totalCollected: 0,
      salariesDue: 0,
      commissionsDue: 0,
    };
  }, [performanceReport]);

  const periodLabel = performanceReport?.period?.label
    ?? (periodMode === 'all_time'
      ? t('employees.period.allTime')
      : periodMode === 'year'
        ? String(filterYear)
        : format(new Date(filterYear, filterMonth - 1, 1), 'MMMM yyyy'));

  const roleDisplay = (roleLabel: string) => {
    if (roleLabel === 'Administrator') return t('roles.administrator');
    if (roleLabel === 'Manager') return t('roles.manager');
    if (roleLabel === 'Cashier') return t('roles.cashier');
    if (roleLabel === 'Marketer') return t('roles.marketer');
    return t('roles.employee');
  };

  const handleSaveEmployee = async (form: AddEditFormData) => {
    const role = roleValueFromLabel(form.role);
    const commissionRate = Number.isFinite(form.commissionRate) ? form.commissionRate : 0;
    try {
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, {
          name: form.name,
          role,
          salary: form.salary,
          email: form.email,
          username: form.username,
          debit: form.debit,
          credit: form.credit,
          targetMonthly: form.target,
          commissionRate,
          password: form.password || undefined,
        });
        toast.success(t('employees.editTitle'));
      } else {
        addEmployee({
          name: form.name,
          role,
          salary: form.salary,
          email: form.email,
          username: form.username,
          debit: form.debit,
          credit: form.credit,
          targetMonthly: form.target,
          commissionRate,
          userId: '',
          commissionMonth: 0,
          commissionTotal: 0,
          password: form.password,
        });
        toast.success(t('employees.addTitle'));
      }
      setIsAddEditOpen(false);
      setEditingEmployee(null);
    } catch {
      toast.error(t('employees.saveFailed'));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
        <Loader2 className="size-8 animate-spin text-indigo-600" />
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    );
  }

  if (view === 'profile' && selected) {
    return (
      <EmployeeProfileView
        employee={selected}
        procedures={procedures}
        payments={payments}
        expenses={expenses}
        bankCards={bankCards}
        payrollYear={payrollYear}
        payrollMonth={payrollMonth}
        onPayrollPeriodChange={(y, m) => {
          setPayrollYear(y);
          setPayrollMonth(m);
        }}
        groupBy={profileGroupBy}
        onGroupByChange={setProfileGroupBy}
        onBack={() => {
          setView('list');
          setSelectedId(null);
        }}
        refreshExpenses={refreshExpenses}
        onPayCommission={async (payload) => {
          await payEmployeeCommission(selected.id, payload);
          await refreshExpenses();
          toast.success(t('employees.payroll.confirmCommission'));
        }}
        t={t}
        roleDisplay={roleDisplay(selected.roleLabel)}
      />
    );
  }

  if (view === 'comparison') {
    return (
      <PerformanceComparisonView
        employees={enrichedEmployees}
        onBack={() => setView('list')}
        t={t}
        roleDisplay={roleDisplay}
      />
    );
  }

  return (
    <div className="flex flex-col h-full gap-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('nav.employeeLog')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('employees.subtitleExtended')}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setView('comparison')}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            <BarChart3 className="size-4" />
            {t('employees.compare')}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingEmployee(null);
              setIsAddEditOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="size-4" />
            {t('employees.addEmployee')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<Users className="size-4 text-indigo-600" />}
          label={t('employees.stats.total')}
          value={String(stats.total)}
          iconBg="bg-indigo-50"
        />
        <StatCard
          icon={<Clock className="size-4 text-amber-600" />}
          label={t('employees.stats.openProcedures')}
          value={String(stats.activeProcedures)}
          iconBg="bg-amber-50"
        />
        <StatCard
          icon={<CheckCircle className="size-4 text-emerald-600" />}
          label={t('employees.stats.closedProcedures')}
          value={String(stats.closedProcedures)}
          iconBg="bg-emerald-50"
        />
        <StatCard
          icon={<DollarSign className="size-4 text-emerald-600" />}
          label={t('employees.stats.collected')}
          value={fmtCurrencyCompact(stats.totalCollected)}
          iconBg="bg-emerald-50"
        />
        <StatCard
          icon={<Banknote className="size-4 text-rose-600" />}
          label={t('employees.stats.salariesDue')}
          value={stats.salariesDue > 0 ? fmtCurrencyCompact(stats.salariesDue) : '—'}
          iconBg="bg-rose-50"
        />
        <StatCard
          icon={<Percent className="size-4 text-violet-600" />}
          label={t('employees.stats.commissionsDue')}
          value={stats.commissionsDue > 0 ? fmtCurrencyCompact(stats.commissionsDue) : '—'}
          iconBg="bg-violet-50"
        />
      </div>

      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('employees.searchPlaceholder')}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="emp-period-mode">
          {t('employees.period.label')}
        </label>
        <select
          id="emp-period-mode"
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-600"
          value={periodMode}
          onChange={(e) => setPeriodMode(e.target.value as PerformancePeriodMode)}
          aria-label={t('employees.period.label')}
        >
          <option value="month">{t('employees.period.specificMonth')}</option>
          <option value="year">{t('employees.period.allMonths')}</option>
          <option value="all_time">{t('employees.period.allTime')}</option>
        </select>
        <label className="sr-only" htmlFor="emp-period-year">
          {t('employees.period.selectedYear')}
        </label>
        <select
          id="emp-period-year"
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-600 disabled:opacity-50"
          value={filterYear}
          disabled={periodMode === 'all_time'}
          onChange={(e) => setFilterYear(Number(e.target.value))}
          aria-label={t('employees.period.selectedYear')}
        >
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="emp-period-month">
          {t('employees.period.selectedMonth')}
        </label>
        <select
          id="emp-period-month"
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-600 disabled:opacity-50"
          value={filterMonth}
          disabled={periodMode !== 'month'}
          onChange={(e) => setFilterMonth(Number(e.target.value))}
          aria-label={t('employees.period.selectedMonth')}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {format(new Date(2000, m - 1, 1), 'MMMM')}
            </option>
          ))}
        </select>
        <select
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-600"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="All">{t('employees.filterAllRoles')}</option>
          <option value="Administrator">{t('roles.administrator')}</option>
          <option value="Manager">{t('roles.manager')}</option>
          <option value="Employee">{t('roles.employee')}</option>
          <option value="Marketer">{t('roles.marketer')}</option>
        </select>
        <select
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm text-slate-600"
          value={perfFilter}
          onChange={(e) => setPerfFilter(e.target.value)}
        >
          <option value="All">{t('employees.filterAllPerformance')}</option>
          <option value="High">{t('employees.performance.high')}</option>
          <option value="Medium">{t('employees.performance.medium')}</option>
          <option value="Low">{t('employees.performance.low')}</option>
        </select>
        <span className="text-xs text-slate-500 px-1" aria-live="polite">
          {t('employees.period.scorePeriod')}: {periodLabel}
        </span>
      </div>

      {performanceError && (
        <p className="text-sm text-rose-600" role="alert">
          {t('employees.period.loadFailed')}
        </p>
      )}
      {performanceLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-16">
            <Users className="size-12 text-slate-200 mx-auto mb-3" />
            <p className="font-semibold text-slate-500">{t('employees.empty')}</p>
            <p className="text-sm text-slate-400 mt-1">{t('employees.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
            {filtered.map((emp) => (
              <EmployeeCard
                key={emp.id}
                emp={emp}
                roleDisplay={roleDisplay(emp.roleLabel)}
                t={t}
                onView={() => {
                  setSelectedId(emp.id);
                  setView('profile');
                }}
                onEdit={() => {
                  setEditingEmployee(emp);
                  setIsAddEditOpen(true);
                }}
                onDelete={() => {
                  removeEmployee(emp.id);
                  if (selectedId === emp.id) {
                    setView('list');
                    setSelectedId(null);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      <AddEditEmployeeModal
        isOpen={isAddEditOpen}
        onClose={() => {
          setIsAddEditOpen(false);
          setEditingEmployee(null);
        }}
        editingEmployee={editingEmployee}
        onSave={handleSaveEmployee}
        t={t}
      />
    </div>
  );
}

function EmployeeCard({
  emp,
  onView,
  onEdit,
  onDelete,
  t,
  roleDisplay,
}: {
  emp: EnrichedEmployee;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: TFunction;
  roleDisplay: string;
}) {
  const closedPct =
    emp.metrics.totalProcedures > 0
      ? Math.round((emp.metrics.closedProcedures / emp.metrics.totalProcedures) * 100)
      : 0;

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden group hover:shadow-md transition-all duration-200">
      <div className={cn('h-1 w-full', emp.avatarColor)} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'size-11 rounded-2xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0',
                emp.avatarColor
              )}
            >
              {emp.initials}
            </div>
            <div>
              <div className="font-semibold text-slate-900 text-sm leading-snug">{emp.name}</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', roleColor(emp.roleLabel))}>
                  {roleDisplay}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium text-emerald-700 bg-emerald-50">
                  {t('status.active')}
                </span>
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-slate-50"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 size-4" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={onDelete}>
                <Trash2 className="mr-2 size-4" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-1">{t('employees.card.procedures')}</div>
            <div className="font-bold text-slate-800 text-sm">{emp.metrics.totalProcedures}</div>
            <div className="text-xs text-slate-400">
              {emp.metrics.openProcedures} {t('employees.card.open')}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-1">{t('employees.card.collected')}</div>
            <div className="font-bold text-slate-800 text-sm">{fmtCurrencyCompact(emp.metrics.paymentsCollected)}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-1">{t('employees.card.netProfit')}</div>
            <div className="font-bold text-slate-800 text-sm">{fmtCurrencyCompact(emp.metrics.netProfit)}</div>
            <div className="text-xs text-emerald-500">
              {emp.commissionRate > 0 ? `${emp.commissionRate}%` : '—'}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>
              {t('employees.card.closed')}{' '}
              {emp.metrics.closedProcedures}/{emp.metrics.totalProcedures}
            </span>
            <span>{closedPct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${closedPct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-xs px-2 py-1 rounded-full border font-medium flex items-center gap-1.5',
              perfColor(emp.performanceLevel)
            )}
          >
            <span className={cn('size-1.5 rounded-full inline-block', perfDot(emp.performanceLevel))} />
            {t(`employees.performance.${emp.performanceLevel.toLowerCase()}`)}
          </span>
          <button
            type="button"
            onClick={onView}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {t('employees.viewProfile')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEditEmployeeModal({
  isOpen,
  onClose,
  editingEmployee,
  onSave,
  t,
}: {
  isOpen: boolean;
  onClose: () => void;
  editingEmployee: Employee | null;
  onSave: (form: AddEditFormData) => void;
  t: TFunction;
}) {
  const blank: AddEditFormData = {
    name: '',
    role: 'Employee',
    salary: 0,
    email: '',
    username: '',
    password: '',
    commissionRate: 0,
    target: 0,
    debit: 0,
    credit: 0,
  };
  const [form, setForm] = useState<AddEditFormData>(blank);

  useEffect(() => {
    if (!isOpen) return;
    if (editingEmployee) {
      setForm({
        name: editingEmployee.name,
        role: roleLabelFromApi(editingEmployee.role),
        salary: editingEmployee.salary,
        email: editingEmployee.email,
        username: editingEmployee.username,
        password: '',
        commissionRate: editingEmployee.commissionRate,
        target: editingEmployee.targetMonthly,
        debit: editingEmployee.debit,
        credit: editingEmployee.credit,
      });
    } else {
      setForm(blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingEmployee?.id]);

  const set = (k: keyof AddEditFormData, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const inputClass =
    'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white transition-colors';
  const labelClass = 'text-xs font-semibold text-slate-600 block mb-1.5';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-slate-100">
          <DialogTitle className="text-base font-bold">
            {editingEmployee ? t('employees.editTitle') : t('employees.addTitle')}
          </DialogTitle>
          <DialogDescription>
            {editingEmployee ? t('employees.editDesc') : t('employees.addDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
          <div>
            <label className={labelClass}>{t('employees.name')}</label>
            <input type="text" className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('employees.role')}</label>
            <select className={inputClass} value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="Employee">{t('roles.employee')}</option>
              <option value="Manager">{t('roles.manager')}</option>
              <option value="Administrator">{t('roles.administrator')}</option>
              <option value="Marketer">{t('roles.marketer')}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('employees.salary')}</label>
            <input type="number" className={inputClass} value={form.salary || ''} onChange={(e) => set('salary', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelClass}>{t('employees.commissionRate')}</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className={inputClass}
              value={form.commissionRate || ''}
              onChange={(e) => {
                const raw = e.target.value;
                set('commissionRate', raw === '' ? 0 : Number(raw));
              }}
            />
          </div>
          <div>
            <label className={labelClass}>{t('employees.email')}</label>
            <input type="email" className={inputClass} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('employees.username')}</label>
            <input type="text" className={inputClass} value={form.username} onChange={(e) => set('username', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>{t('employees.password')}</label>
            <input
              type="password"
              className={inputClass}
              placeholder={editingEmployee ? t('employees.passwordKeep') : ''}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>{t('employees.monthlyTarget')}</label>
            <input type="number" className={inputClass} value={form.target || ''} onChange={(e) => set('target', Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={() => form.name && form.username && onSave(form)}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
          >
            {editingEmployee ? t('employees.updateEmployee') : t('employees.createEmployee')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PayrollModalProps = {
  employee: EnrichedEmployee;
  periodKey: string;
  payrollYear: number;
  payrollMonth: number;
  bankCards: { id: string; bankName: string }[];
  expenses: Expense[];
  onClose: () => void;
  onSubmit: (payload: PayrollSubmitPayload) => Promise<void>;
  t: TFunction;
};

function GiveCommissionModal({
  employee,
  periodKey,
  payrollYear,
  payrollMonth,
  bankCards,
  expenses,
  procedures,
  commissionDue,
  commissionRate,
  onClose,
  onSubmit,
  t,
}: PayrollModalProps & {
  procedures: Procedure[];
  commissionDue?: number;
  commissionRate?: number;
}) {
  const range = periodRangeForFilter(payrollYear, payrollMonth);
  const empProcedures = filterEmployeeProcedures(procedures, employee, range);
  const effectiveRate = commissionRate ?? employee.commissionRate;
  const commission =
    commissionDue ?? computeCommissionAmount(empProcedures, effectiveRate);
  const alreadyPaid = hasPayrollForPeriod(expenses, employee, 'commission', periodKey);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paidBy, setPaidBy] = useState(bankCards[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = paidBy && commission > 0 && (!alreadyPaid || confirmed);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        period: periodKey,
        paid_by: paidBy,
        date,
        notes: notes || undefined,
        force: alreadyPaid && confirmed,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('employees.payroll.duplicateCommission'));
      } else {
        toast.error(t('employees.payroll.payError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-white p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-slate-100">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Percent className="size-5 text-violet-600" />
            {t('employees.payroll.giveCommission')}
          </DialogTitle>
          <DialogDescription>{t('employees.payroll.commissionDesc', { name: employee.name })}</DialogDescription>
        </DialogHeader>
        <div className="p-6 space-y-4">
          {alreadyPaid && !confirmed && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertCircle className="size-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700">{t('employees.payroll.duplicateCommission')}</p>
            </div>
          )}
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span>{t('employees.commissionRate')}</span>
              <span className="font-semibold">{effectiveRate}%</span>
            </div>
            <div className="flex justify-between">
              <span>{t('employees.profile.netProfit')}</span>
              <span className="font-semibold">{fmtCurrency(empProcedures.filter((p) => isClosedProcedure(p.status)).reduce((s, p) => s + Math.max(p.sellingPrice - p.cost, 0), 0))}</span>
            </div>
            <div className="border-t border-indigo-200 pt-2 flex justify-between font-bold text-indigo-700">
              <span>{t('employees.payroll.commissionDue')}</span>
              <span>{fmtCurrency(commission)}</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1.5">{t('expenses.paidBy')}</label>
            <select className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {bankCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.bankName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1.5">{t('expenses.date')}</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {alreadyPaid && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t('employees.payroll.confirmDuplicate')}
            </label>
          )}
        </div>
        <DialogFooter className="p-4 border-t bg-slate-50 flex justify-end gap-2">
          <DialogClose asChild>
            <button type="button" className="px-4 py-2 border bg-white rounded-lg text-sm">
              {t('common.cancel')}
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            className={cn('px-5 py-2 rounded-lg text-sm font-semibold text-white', canSubmit && !submitting ? 'bg-violet-600 hover:bg-violet-700' : 'bg-slate-300 cursor-not-allowed')}
          >
            {submitting ? t('common.loading') : t('employees.payroll.confirmCommission')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeProfileView({
  employee,
  procedures,
  payments,
  expenses,
  bankCards,
  payrollYear,
  payrollMonth,
  onPayrollPeriodChange,
  groupBy,
  onGroupByChange,
  onBack,
  refreshExpenses,
  onPayCommission,
  t,
  roleDisplay,
}: {
  employee: EnrichedEmployee;
  procedures: Procedure[];
  payments: Payment[];
  expenses: Expense[];
  bankCards: BankCard[];
  payrollYear: number;
  payrollMonth: number;
  onPayrollPeriodChange: (y: number, m: number) => void;
  groupBy: PeriodGroup;
  onGroupByChange: (g: PeriodGroup) => void;
  onBack: () => void;
  refreshExpenses: () => Promise<void>;
  onPayCommission: (payload: PayrollSubmitPayload) => Promise<void>;
  t: TFunction;
  roleDisplay: string;
}) {
  const periodKey = payrollPeriodKey(payrollYear, payrollMonth);
  const [activeTab, setActiveTab] = useState<'procedures' | 'payments' | 'payroll' | 'periods'>('procedures');
  const [giveSalary, setGiveSalary] = useState(false);
  const [giveCommission, setGiveCommission] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const [profileMetrics, setProfileMetrics] = useState<EmployeeMetrics>(employee.metrics);
  const [profilePerformanceLevel, setProfilePerformanceLevel] = useState<PerformanceLevel>(employee.performanceLevel);
  const [empProcedures, setEmpProcedures] = useState<Procedure[]>([]);
  const [empPayments, setEmpPayments] = useState<Payment[]>([]);
  const [periodBuckets, setPeriodBuckets] = useState<PeriodBucket[]>([]);
  const [salaryStatus, setSalaryStatus] = useState<SalarySettlementStatus>('pending');
  const [salaryRemainingDue, setSalaryRemainingDue] = useState(employee.salary);
  const [salaryPaidTotal, setSalaryPaidTotal] = useState(0);
  const [outstandingAdvances, setOutstandingAdvances] = useState(0);
  const [commissionPaid, setCommissionPaid] = useState(false);
  const [profileCommissionRate, setProfileCommissionRate] = useState(employee.commissionRate);

  useEffect(() => {
    setProfileCommissionRate(employee.commissionRate);
  }, [employee.commissionRate]);

  const applySalaryMetrics = useCallback(
    (metrics: {
      salary_paid?: boolean;
      salary_status?: SalarySettlementStatus;
      salary_remaining_due?: number;
      salary_paid_total?: number;
      outstanding_advances?: number;
    }) => {
      const status =
        metrics.salary_status ?? (metrics.salary_paid ? 'paid' : 'pending');
      setSalaryStatus(status);
      setSalaryRemainingDue(metrics.salary_remaining_due ?? employee.salary);
      setSalaryPaidTotal(metrics.salary_paid_total ?? 0);
      setOutstandingAdvances(metrics.outstanding_advances ?? 0);
    },
    [employee.salary]
  );

  const reloadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(false);
    try {
      const data = await fetchEmployeeDashboard(employee.id, periodKey, groupBy);
      setProfileMetrics(
        dashboardMetricsToEmployeeMetrics(
          employee.id,
          employee.userId,
          data.metrics,
          data.performance_score,
          data.performance_level,
          data.rank ?? employee.metrics.rank
        )
      );
      setProfilePerformanceLevel(data.performance_level);
      setEmpProcedures(data.procedures.map(mapDashboardProcedure));
      setEmpPayments(data.payments.map(mapDashboardPayment));
      setPeriodBuckets(mapDashboardPeriodGroups(data.period_groups));
      applySalaryMetrics(data.metrics);
      setCommissionPaid(data.metrics.commission_paid);
      setProfileCommissionRate(data.metrics.commission_rate ?? employee.commissionRate);
    } catch {
      setDashboardError(true);
      const range = periodRangeForFilter(payrollYear, payrollMonth);
      const built = buildEmployeeMetrics([employee], procedures, payments, range);
      const fallback = built[0] ?? employee.metrics;
      setProfileMetrics(fallback);
      setProfilePerformanceLevel(fallback.performanceLevel);
      const fallbackProcs = filterEmployeeProcedures(procedures, employee, range);
      setEmpProcedures(fallbackProcs);
      setEmpPayments(filterEmployeePayments(payments, employee, range, procedures));
      setPeriodBuckets(groupProceduresByPeriod(fallbackProcs, groupBy));
      const legacyPaid = hasPayrollForPeriod(expenses, employee, 'salary', periodKey);
      applySalaryMetrics({
        salary_paid: legacyPaid,
        salary_status: legacyPaid ? 'paid' : 'pending',
        salary_remaining_due: legacyPaid ? 0 : employee.salary,
        salary_paid_total: 0,
        outstanding_advances: 0,
      });
      setCommissionPaid(hasPayrollForPeriod(expenses, employee, 'commission', periodKey));
    } finally {
      setDashboardLoading(false);
    }
  }, [
    employee,
    periodKey,
    groupBy,
    procedures,
    payments,
    expenses,
    payrollYear,
    payrollMonth,
    applySalaryMetrics,
  ]);

  useEffect(() => {
    reloadDashboard();
  }, [reloadDashboard]);

  const salaryPayTarget = useMemo<TeamPerformanceRow>(
    () => ({
      employee_id: employee.id,
      user_id: Number(employee.userId) || 0,
      full_name: employee.name,
      role: employee.role,
      rank: profileMetrics.rank,
      performance_score: profileMetrics.performanceScore,
      performance_level: profilePerformanceLevel,
      salary: employee.salary,
      commission_rate: profileCommissionRate,
      commission_amount: profileMetrics.commissionAmount,
      salary_paid: salaryStatus === 'paid',
      salary_status: salaryStatus,
      salary_remaining_due: salaryRemainingDue,
      salary_paid_total: salaryPaidTotal,
      commission_paid: commissionPaid,
      net_profit: profileMetrics.netProfit,
      total_procedures: profileMetrics.totalProcedures,
      closed_procedures: profileMetrics.closedProcedures,
      payments_collected: profileMetrics.paymentsCollected,
      outstanding_advances: outstandingAdvances,
      period: periodKey,
    }),
    [
      employee,
      profileMetrics,
      profilePerformanceLevel,
      profileCommissionRate,
      salaryStatus,
      salaryRemainingDue,
      salaryPaidTotal,
      commissionPaid,
      outstandingAdvances,
      periodKey,
    ]
  );

  const periodLabel = format(new Date(payrollYear, payrollMonth - 1, 1), 'MMMM yyyy');

  const chartData = monthlyChartData(procedures, payments, employee);
  const commissionEarned = profileMetrics.commissionAmount;
  const hasCommissionRate = profileCommissionRate > 0;
  const hasCommissionDue = hasCommissionRate && commissionEarned > 0;

  const closedPct =
    profileMetrics.totalProcedures > 0
      ? Math.round((profileMetrics.closedProcedures / profileMetrics.totalProcedures) * 100)
      : 0;

  const donutData = [
    { name: t('employees.profile.statusClosed'), value: profileMetrics.closedProcedures },
    { name: t('employees.profile.statusOpen'), value: profileMetrics.openProcedures },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        {t('employees.backToList')}
      </button>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-5">
          <div className={cn('size-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl', employee.avatarColor)}>
            {employee.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-slate-900">{employee.name}</h2>
              <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', roleColor(employee.roleLabel))}>{roleDisplay}</span>
              <span className={cn('text-xs px-2.5 py-1 rounded-full border font-medium flex items-center gap-1', perfColor(profilePerformanceLevel))}>
                <span className={cn('size-1.5 rounded-full', perfDot(profilePerformanceLevel))} />
                {t(`employees.performance.${profilePerformanceLevel.toLowerCase()}`)}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-3">
              <span>{employee.email}</span>
              <span>@{employee.username}</span>
            </div>
            <div className="flex flex-wrap gap-5 text-sm items-center">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{t('employees.salary')}: </span>
                <span className="font-semibold">{fmtCurrency(employee.salary)}</span>
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                    salaryStatus === 'paid' && 'bg-emerald-50 text-emerald-700',
                    salaryStatus === 'partial' && 'bg-blue-50 text-blue-700',
                    salaryStatus === 'pending' && 'bg-amber-50 text-amber-700'
                  )}
                >
                  {salaryStatus === 'paid'
                    ? t('employees.payroll.paid')
                    : salaryStatus === 'partial'
                      ? t('employees.payroll.partial')
                      : t('employees.payroll.pending')}
                </span>
              </div>
              {hasCommissionRate && (
                <div>
                  <span className="text-slate-400">{t('employees.commissionRate')}: </span>
                  <span className="font-semibold">{profileCommissionRate}%</span>
                </div>
              )}
              <div>
                <span className="text-slate-400">{t('employees.profile.score')}: </span>
                <span className="font-semibold">{profileMetrics.performanceScore}/100 (#{profileMetrics.rank})</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
              value={payrollMonth}
              onChange={(e) => onPayrollPeriodChange(payrollYear, Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {format(new Date(2000, m - 1, 1), 'MMMM')}
                </option>
              ))}
            </select>
            <select
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
              value={payrollYear}
              onChange={(e) => onPayrollPeriodChange(Number(e.target.value), payrollMonth)}
            >
              {[new Date().getFullYear(), new Date().getFullYear() - 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {salaryStatus !== 'paid' && employee.salary > 0 && (
              <button
                type="button"
                onClick={() => setGiveSalary(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
              >
                <Banknote className="size-4" />
                {t('employees.payroll.giveSalary')}
              </button>
            )}
            {hasCommissionRate && (
              <button type="button" onClick={() => setGiveCommission(true)} className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-sm font-semibold rounded-lg hover:bg-slate-50">
                <Percent className="size-4" />
                {t('employees.payroll.giveCommission')}
              </button>
            )}
          </div>
        </div>
      </div>

      {dashboardError && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          {t('employees.profile.dashboardFallback')}
        </p>
      )}

      {dashboardLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
          <Loader2 className="size-6 animate-spin text-indigo-600" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      ) : (
        <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('employees.profile.totalProcedures'), value: String(profileMetrics.totalProcedures) },
          { label: t('employees.profile.open'), value: String(profileMetrics.openProcedures) },
          { label: t('employees.profile.closed'), value: String(profileMetrics.closedProcedures) },
          { label: t('employees.profile.completion'), value: `${closedPct}%` },
          { label: t('employees.profile.collected'), value: fmtCurrencyCompact(profileMetrics.paymentsCollected) },
          { label: t('employees.profile.netProfit'), value: fmtCurrencyCompact(profileMetrics.netProfit) },
          { label: t('employees.table.commissionMonth'), value: fmtCurrencyCompact(commissionEarned) },
          { label: t('employees.profile.rank'), value: `#${profileMetrics.rank}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="text-xs text-slate-400 mb-1">{label}</div>
            <div className="text-base font-bold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-4">{t('employees.profile.trend')}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v / 1000}K`} />
              <Tooltip formatter={(v: number) => [`AED ${Number(v).toLocaleString()}`, '']} />
              <Area type="monotone" dataKey="payments" stroke="#6366F1" fill="#6366F120" />
              <Area type="monotone" dataKey="profit" stroke="#10B981" fill="#10B98120" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-2">{t('employees.profile.procedureStatus')}</h3>
          {donutData.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value">
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 py-12 text-center">{t('employees.profile.noProcedures')}</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="border-b flex flex-wrap">
          {(['procedures', 'payments', 'periods', 'payroll'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn('px-5 py-3.5 text-sm font-semibold border-b-2', activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500')}
            >
              {t(`employees.profile.tab.${tab}`)}
            </button>
          ))}
        </div>

        {activeTab === 'procedures' && (
          <div className="overflow-x-auto">
            {empProcedures.length === 0 ? (
              <p className="p-8 text-center text-slate-400 text-sm">{t('employees.profile.noProcedures')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 text-xs uppercase">
                    <th className="px-4 py-3 text-left">{t('employees.profile.client')}</th>
                    <th className="px-4 py-3 text-left">{t('expenses.date')}</th>
                    <th className="px-4 py-3 text-left">{t('procedures.status')}</th>
                    <th className="px-4 py-3 text-right">{t('employees.profile.revenue')}</th>
                    <th className="px-4 py-3 text-right">{t('employees.profile.collected')}</th>
                    <th className="px-4 py-3 text-right">{t('employees.profile.netProfit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {empProcedures.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{p.customerName}</td>
                      <td className="px-4 py-3 text-slate-500">{p.date}</td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-1 rounded-full font-medium', procedureStatusClass(p.status))}>
                          {procedureStatusLabel(p.status, t)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{fmtCurrency(p.sellingPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{fmtCurrency(p.paid)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{fmtCurrency(Math.max(p.sellingPrice - p.cost, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="overflow-x-auto">
            {empPayments.length === 0 ? (
              <p className="p-8 text-center text-slate-400 text-sm">{t('employees.profile.noPayments')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                    <th className="px-4 py-3 text-left">{t('payments.customer')}</th>
                    <th className="px-4 py-3 text-left">{t('expenses.date')}</th>
                    <th className="px-4 py-3 text-right">{t('employees.payroll.amount')}</th>
                    <th className="px-4 py-3 text-left">{t('payments.table.type')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {empPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3">{p.customerName}</td>
                      <td className="px-4 py-3 text-slate-500">{p.date}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{fmtCurrency(p.amount)}</td>
                      <td className="px-4 py-3 capitalize">{p.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'periods' && (
          <div className="p-4 space-y-4">
            <div className="flex gap-2">
              {(['day', 'month', 'year'] as PeriodGroup[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onGroupByChange(g)}
                  className={cn('px-3 py-1.5 text-xs font-semibold rounded-lg', groupBy === g ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600')}
                >
                  {t(`employees.profile.group.${g}`)}
                </button>
              ))}
            </div>
            {periodBuckets.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8">{t('employees.profile.noProcedures')}</p>
            ) : (
              <div className="space-y-3">
                {periodBuckets.map((bucket) => (
                  <div key={bucket.key} className="border border-slate-100 rounded-lg p-4">
                    <div className="font-semibold text-slate-900 mb-2">{bucket.label}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
                      <span>{t('employees.profile.totalProcedures')}: {bucket.stats.total}</span>
                      <span>{t('employees.profile.open')}: {bucket.stats.open}</span>
                      <span>{t('employees.profile.closed')}: {bucket.stats.closed}</span>
                      <span>{t('employees.profile.completion')}: {Math.round(bucket.stats.closureRatio * 100)}%</span>
                      <span>{t('employees.profile.collected')}: {fmtCurrencyCompact(bucket.stats.paymentsCollected)}</span>
                      <span>{t('employees.profile.netProfit')}: {fmtCurrencyCompact(bucket.stats.netProfit)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'payroll' && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-100 rounded-xl p-4 space-y-3">
              <div className="font-semibold text-sm">{t('employees.payroll.monthlySalary')}</div>
              <div className="flex justify-between text-sm">
                <span>{t('financialControl.employeeFinancials.grossSalary')}</span>
                <span className="font-bold">{fmtCurrency(employee.salary)}</span>
              </div>
              {outstandingAdvances > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{t('employees.payroll.outstandingAdvances')}</span>
                  <span className="font-mono">{fmtCurrency(outstandingAdvances)}</span>
                </div>
              )}
              {salaryPaidTotal > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{t('employees.payroll.paidThisPeriod')}</span>
                  <span className="font-mono text-emerald-600">{fmtCurrency(salaryPaidTotal)}</span>
                </div>
              )}
              {salaryStatus === 'partial' && salaryRemainingDue > 0 && (
                <div className="flex justify-between text-sm text-amber-700">
                  <span>{t('employees.payroll.remainingDue')}</span>
                  <span className="font-mono font-semibold">{fmtCurrency(salaryRemainingDue)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>{t('procedures.status')}</span>
                <EmployeeSalaryStatus status={salaryStatus} remainingDue={salaryRemainingDue} t={t} />
              </div>
              {salaryStatus !== 'paid' && employee.salary > 0 && (
                <button
                  type="button"
                  onClick={() => setGiveSalary(true)}
                  className="w-full py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
                >
                  {t('employees.payroll.giveSalary')}
                </button>
              )}
            </div>
            <div className="border border-slate-100 rounded-xl p-4 space-y-3">
              <div className="font-semibold text-sm">{t('employees.payroll.commission')}</div>
              {hasCommissionRate ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span>{t('employees.commissionRate')}</span>
                    <span className="font-bold">{profileCommissionRate}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>{t('employees.table.commissionMonth')}</span>
                    <span className="font-bold text-violet-600">{fmtCurrency(commissionEarned)}</span>
                  </div>
                  {!hasCommissionDue && (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                      {t('employees.payroll.noEligibleProcedures')}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setGiveCommission(true)}
                    disabled={!hasCommissionDue}
                    className={cn(
                      'w-full py-2 text-white text-sm font-semibold rounded-lg',
                      hasCommissionDue ? 'bg-violet-600 hover:bg-violet-700' : 'bg-slate-300 cursor-not-allowed'
                    )}
                  >
                    {t('employees.payroll.giveCommission')}
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">{t('employees.payroll.noCommission')}</p>
              )}
            </div>
          </div>
        )}
      </div>
        </>
      )}

      <PaySalaryModal
        employee={salaryPayTarget}
        periodKey={periodKey}
        periodLabel={periodLabel}
        open={giveSalary}
        onClose={() => setGiveSalary(false)}
        onSuccess={async () => {
          await refreshExpenses();
          await reloadDashboard();
        }}
        salaryStatus={salaryStatus}
      />
      {giveCommission && (
        <GiveCommissionModal
          employee={employee}
          periodKey={periodKey}
          payrollYear={payrollYear}
          payrollMonth={payrollMonth}
          bankCards={bankCards}
          expenses={expenses}
          procedures={procedures}
          commissionDue={commissionEarned}
          commissionRate={profileCommissionRate}
          onClose={() => setGiveCommission(false)}
          onSubmit={onPayCommission}
          t={t}
        />
      )}
    </div>
  );
}

function PerformanceComparisonView({
  employees,
  onBack,
  t,
  roleDisplay,
}: {
  employees: EnrichedEmployee[];
  onBack: () => void;
  t: TFunction;
  roleDisplay: (role: string) => string;
}) {
  const sorted = useMemo(() => [...employees].sort((a, b) => b.metrics.performanceScore - a.metrics.performanceScore), [employees]);
  const topPayments = [...employees].sort((a, b) => b.metrics.paymentsCollected - a.metrics.paymentsCollected)[0];
  const topProfit = [...employees].sort((a, b) => b.metrics.netProfit - a.metrics.netProfit)[0];
  const topClosed = [...employees].sort((a, b) => b.metrics.closedProcedures - a.metrics.closedProcedures)[0];

  const chartData = employees.map((e) => ({
    name: e.name.split(' ')[0],
    payments: e.metrics.paymentsCollected,
    closed: e.metrics.closedProcedures,
    open: e.metrics.openProcedures,
  }));

  if (employees.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p>{t('employees.empty')}</p>
        <button type="button" onClick={onBack} className="mt-4 text-indigo-600 text-sm font-semibold">
          {t('employees.backToList')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        {t('employees.backToList')}
      </button>
      <div>
        <h2 className="text-xl font-bold">{t('employees.comparison.title')}</h2>
        <p className="text-sm text-slate-500">{t('employees.comparison.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('employees.comparison.bestPerformer'), emp: sorted[0], value: `${sorted[0]?.metrics.performanceScore ?? 0}/100`, Icon: Trophy, iconBg: 'bg-amber-50', iconColor: 'text-amber-500' },
          { label: t('employees.comparison.topPayments'), emp: topPayments, value: fmtCurrencyCompact(topPayments?.metrics.paymentsCollected ?? 0), Icon: DollarSign, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500' },
          { label: t('employees.comparison.topProfit'), emp: topProfit, value: fmtCurrencyCompact(topProfit?.metrics.netProfit ?? 0), Icon: TrendingUp, iconBg: 'bg-indigo-50', iconColor: 'text-indigo-500' },
          { label: t('employees.comparison.mostClosed'), emp: topClosed, value: String(topClosed?.metrics.closedProcedures ?? 0), Icon: Award, iconBg: 'bg-violet-50', iconColor: 'text-violet-500' },
        ].map(({ label, emp, value, Icon, iconBg, iconColor }) =>
          emp ? (
            <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn('p-1.5 rounded-lg', iconBg)}>
                  <Icon className={cn('size-4', iconColor)} />
                </div>
                <span className="text-xs font-semibold text-slate-400 uppercase">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={cn('size-8 rounded-full flex items-center justify-center text-white text-xs font-bold', emp.avatarColor)}>{emp.initials}</div>
                <div>
                  <div className="font-semibold text-sm truncate">{emp.name}</div>
                  <div className="text-xs font-bold text-slate-600">{value}</div>
                </div>
              </div>
            </div>
          ) : null
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-4">{t('employees.comparison.paymentsChart')}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `${v / 1000}K`} />
              <Tooltip formatter={(v: number) => [`AED ${Number(v).toLocaleString()}`, '']} />
              <Bar dataKey="payments" fill="#6366F1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-4">{t('employees.comparison.proceduresChart')}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="closed" stackId="a" fill="#10B981" />
              <Bar dataKey="open" stackId="a" fill="#FCD34D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b font-semibold text-sm">{t('employees.comparison.ranking')}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-400">
                <th className="px-4 py-3 text-left">{t('employees.comparison.rank')}</th>
                <th className="px-4 py-3 text-left">{t('employees.name')}</th>
                <th className="px-4 py-3 text-center">{t('employees.profile.totalProcedures')}</th>
                <th className="px-4 py-3 text-center">{t('employees.profile.completion')}</th>
                <th className="px-4 py-3 text-right">{t('employees.profile.collected')}</th>
                <th className="px-4 py-3 text-right">{t('employees.profile.netProfit')}</th>
                <th className="px-4 py-3 text-center">{t('employees.profile.score')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sorted.map((emp, i) => {
                const ratio =
                  emp.metrics.totalProcedures > 0
                    ? Math.round((emp.metrics.closedProcedures / emp.metrics.totalProcedures) * 100)
                    : 0;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={cn('size-7 rounded-full flex items-center justify-center text-white text-xs font-bold', emp.avatarColor)}>{emp.initials}</div>
                        <div>
                          <div className="font-medium text-xs">{emp.name}</div>
                          <div className="text-xs text-slate-400">{roleDisplay(emp.roleLabel)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{emp.metrics.totalProcedures}</td>
                    <td className="px-4 py-3 text-center">{ratio}%</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtCurrencyCompact(emp.metrics.paymentsCollected)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600">{fmtCurrencyCompact(emp.metrics.netProfit)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('text-xs px-2 py-1 rounded-full border font-semibold', perfColor(emp.performanceLevel))}>
                        {emp.metrics.performanceScore}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
