import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { format } from 'date-fns';
import { deleteJson, getJson, postJson, putJson, patchJson } from '@/app/lib/api';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  cachedFetch,
  clearResourceCache,
  invalidateResourceCache,
  setResourceSessionUser,
} from '@/app/lib/resourceCache';

type ApiList<T> = T[] | { results?: T[] };

/** List resources hydrated via DataContext (on demand + memory cache). */
export type DataResourceKey =
  | 'customers'
  | 'procedures'
  | 'procedureCategories'
  | 'payments'
  | 'deposits'
  | 'bankCards'
  | 'employees'
  | 'expenses';

const RESOURCE_PATH: Record<DataResourceKey, string> = {
  customers: '/customers/',
  procedures: '/procedures/',
  procedureCategories: '/procedure-categories/',
  payments: '/payments/',
  deposits: '/deposits/',
  bankCards: '/bank-cards/',
  employees: '/employees/',
  expenses: '/expenses/',
};

/** Financial list keys — never treat cache as authoritative; pages may force refresh. */
const FINANCIAL_RESOURCES: DataResourceKey[] = ['payments', 'deposits', 'expenses', 'bankCards'];

const LIST_TTL_MS = 60_000;

function toApiList<T>(value: ApiList<T>): T[] {
  return Array.isArray(value) ? value : value?.results ?? [];
}

export interface Customer {
  id: string;
  type: 'individual' | 'company';
  name: string;
  companyName?: string;
  phone: string;
  phoneSecondary?: string;
  email?: string;
  emiratesId?: string;
  tradeLicense?: string;
  licenseExpiry?: string;
  establishmentCardExpiry?: string;
  workersExpiry?: string;
  echannelExpiry?: string;
  echannelEmail?: string;
  echannelPassword?: string;
  noHealthInsurance?: boolean;
  healthInsuranceExpiry?: string;
  visaExpiry?: string;
  insuranceExpiry?: string;
  attachments?: string[];
  balance: number;
  debtStatus: 'clear' | 'warning' | 'exceeded';
  lastActivity: string;
  accountStatus?: 'active' | 'closed';
  closedAt?: string;
  closureReason?: string;
}

export interface ProcedureCategory {
  id: number;
  name: string;
  order: number;
}

export interface Procedure {
  id: string;
  customerId: string;
  customerName: string;
  category: string;
  description?: string;
  notes?: string;
  cost: number;
  sellingPrice: number;
  cashIn: number;
  cashOutType?: string;
  cashInType?: string;
  customerCardMode?: boolean;
  status: 'submitted' | 'in-process' | 'need-info' | 'done' | 'rejected';
  assignedEmployee: string;
  assignedEmployeeId?: string;
  date: string;
  paid: number;
}

export interface Payment {
  id: string;
  amount: number;
  date: string;
  type: 'cash' | 'transfer' | 'pos';
  customerId: string;
  customerName: string;
  procedureId?: string;
  procedureCategory?: string;
  bankCard?: string;
  recordedBy?: string;
  recordedById?: string;
  notes?: string;
}

export interface Deposit {
  id: string;
  date: string;
  amount: number;
  fromMethod: string;
  toMethod: string;
  notes?: string;
}

export interface BankCard {
  id: string;
  bankName: string;
  cardholderName: string;
  cardType: string;
  cardNumber: string;
  last4: string;
  expiryMonth: string;
  expiryYear: string;
  iban?: string;
  swift?: string;
  accountNumber?: string;
  notes?: string;
  methodType?: 'cash' | 'bank';
  balance?: number;
}

export interface Employee {
  id: string;
  userId: string;
  name: string;
  role: string;
  username: string;
  email: string;
  salary: number;
  debit: number;
  credit: number;
  targetMonthly: number;
  commissionRate: number;
  commissionMonth: number;
  commissionTotal: number;
}

export interface Expense {
  id: string;
  category: 'salaries' | 'office' | 'government-fees' | 'misc';
  date: string;
  amount: number;
  paidBy: string;
  assignedEmployee?: string;
  assignedEmployeeId?: string;
  payrollType?: '' | 'salary' | 'commission';
  /** First day of salary/commission month (YYYY-MM-DD). P&L attribution for payroll. */
  payrollPeriod?: string;
  /** active | reversed — reversed payroll must not affect Reports P&L. */
  payrollStatus?: 'active' | 'reversed' | '';
  notes?: string;
}

interface DataContextType {
  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;
  customers: Customer[];
  procedures: Procedure[];
  procedureCategories: ProcedureCategory[];
  payments: Payment[];
  deposits: Deposit[];
  paymentMethods: BankCard[];
  bankCards: BankCard[];
  employees: Employee[];
  expenses: Expense[];
  loading: boolean;
  /** Load list resources for the active page (deduped + TTL cache). */
  ensureLoaded: (
    keys: DataResourceKey[],
    opts?: { force?: boolean; forceFinancial?: boolean }
  ) => Promise<void>;
  addCustomer: (customer: Omit<Customer, 'id'>) => Promise<Customer>;
  updateCustomer: (id: string, updates: Partial<Customer>) => Promise<Customer>;
  removeCustomer: (id: string) => void;
  addEmployee: (employee: Omit<Employee, 'id'> & { password: string }) => void;
  updateEmployee: (
    id: string,
    updates: Partial<Employee> & { password?: string }
  ) => Promise<Employee>;
  removeEmployee: (id: string) => void;
  addProcedure: (procedure: Omit<Procedure, 'id'>) => Promise<Procedure>;
  addProcedureCategory: (name: string) => Promise<ProcedureCategory>;
  fetchProceduresByStatus: (status: string) => Promise<Procedure[]>;
  fetchProceduresFiltered: (params: {
    assigned_employee?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    months?: number;
  }) => Promise<Procedure[]>;
  removeProcedure: (id: string) => void;
  addPayment: (payment: Omit<Payment, 'id'>) => Promise<void>;
  updatePayment: (id: string, payment: Partial<Omit<Payment, 'id'>>) => Promise<void>;
  removePayment: (id: string) => Promise<void>;
  addBankCard: (card: Omit<BankCard, 'id'>) => void;
  updateBankCard: (id: string, updates: Partial<BankCard>) => void;
  removeBankCard: (id: string) => void;
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<Expense>;
  payEmployeeSalary: (
    employeeProfileId: string,
    payload: { period: string; paid_by: string; date: string; notes?: string; force?: boolean }
  ) => Promise<Expense>;
  payEmployeeCommission: (
    employeeProfileId: string,
    payload: { period: string; paid_by: string; date: string; notes?: string; force?: boolean }
  ) => Promise<Expense>;
  refreshExpenses: () => Promise<void>;
  refreshEmployees: () => Promise<void>;
  refreshBankCards: () => Promise<void>;
  refreshCustomers: () => Promise<void>;
  refreshProcedures: () => Promise<void>;
  addDeposit: (deposit: {
    amount: number;
    date: string;
    fromMethod: string;
    toMethod: string;
    notes?: string;
  }) => void;
  updateProcedureStatus: (id: string, status: Procedure['status'], notes?: string) => void;
  updateProcedure: (id: string, updates: Partial<Procedure>) => Promise<Procedure>;
}

// ---------------------------------------------------------------------------
// Pure mappers — declared at module scope so they keep a stable identity and
// never need to appear in hook dependency arrays.
// ---------------------------------------------------------------------------

const mapCustomer = (c: any): Customer => ({
  id: String(c.id),
  type: c.type,
  name: c.name,
  companyName: c.company_name || c.companyName,
  phone: c.phone || '',
  phoneSecondary: c.phone_secondary || '',
  email: c.email || '',
  emiratesId: c.emirates_id || '',
  tradeLicense: c.trade_license || '',
  licenseExpiry: c.license_expiry || '',
  establishmentCardExpiry: c.establishment_card_expiry || '',
  workersExpiry: c.workers_expiry || '',
  echannelExpiry: c.echannel_expiry || '',
  echannelEmail: c.echannel_email || '',
  echannelPassword: c.echannel_password || '',
  noHealthInsurance: !!c.no_health_insurance,
  healthInsuranceExpiry: c.health_insurance_expiry || '',
  visaExpiry: c.visa_expiry || '',
  insuranceExpiry: c.insurance_expiry || '',
  balance: Number(c.balance || 0),
  debtStatus: (c.debt_status as any) || 'clear',
  lastActivity: c.last_activity || '',
  accountStatus: c.account_status || 'active',
  closedAt: c.closed_at || '',
  closureReason: c.closure_reason || '',
  attachments: [],
});

const mapBankCard = (card: any): BankCard => ({
  id: card.id,
  bankName: card.bank_name,
  cardholderName: card.cardholder_name,
  cardType: card.card_type,
  cardNumber: card.card_number,
  last4: card.last4,
  expiryMonth: card.expiry_month,
  expiryYear: card.expiry_year,
  iban: card.iban,
  swift: card.swift,
  accountNumber: card.account_number,
  notes: card.notes,
  methodType: card.method_type,
  balance: Number(card.balance || 0),
});

const mapProcedure = (p: any): Procedure => ({
  id: String(p.id),
  customerId: String(p.customer ?? p.customer_id ?? ''),
  customerName: p.customer_name,
  category: p.category,
  description: p.description ?? '',
  notes: p.notes ?? '',
  cost: Number(p.cost),
  sellingPrice: Number(p.selling_price),
  cashIn: Number(p.cash_in || 0),
  cashOutType: p.cash_out_type,
  cashInType: p.cash_in_type,
  status: p.status,
  assignedEmployee: p.assigned_employee_name || '',
  assignedEmployeeId: p.assigned_employee ? String(p.assigned_employee) : '',
  date: p.date,
  paid: Number(p.paid || 0),
});

const mapPayment = (p: any): Payment => ({
  id: p.id,
  amount: Number(p.amount),
  date: p.date,
  type: p.type,
  customerId: p.customer,
  customerName: p.customer_name,
  procedureId: p.procedure ? String(p.procedure) : '',
  procedureCategory: p.procedure_category || '',
  bankCard: p.bank_card || '',
  recordedBy: p.recorded_by_name || '',
  recordedById: p.recorded_by ? String(p.recorded_by) : '',
  notes: p.notes,
});

const mapExpense = (expense: any): Expense => ({
  id: expense.id,
  category: expense.category,
  date: expense.date,
  amount: Number(expense.amount),
  paidBy: expense.paid_by,
  assignedEmployee: expense.employee_name || '',
  assignedEmployeeId: expense.assigned_employee ? String(expense.assigned_employee) : '',
  payrollType: expense.payroll_type || '',
  payrollPeriod: expense.payroll_period || '',
  payrollStatus: expense.payroll_status || 'active',
  notes: expense.notes || '',
});

const mapDeposit = (d: any): Deposit => ({
  id: d.id,
  date: d.date,
  amount: Number(d.amount || 0),
  fromMethod: d.from_method || '',
  toMethod: d.to_method || '',
  notes: d.notes,
});

const parseCommissionRate = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const mapEmployee = (e: any): Employee => ({
  id: e.id,
  userId: e.user_id != null ? String(e.user_id) : '',
  name: e.full_name,
  role: e.role,
  username: e.username,
  email: e.email,
  salary: Number(e.salary || 0),
  debit: Number(e.debit || 0),
  credit: Number(e.credit || 0),
  targetMonthly: Number(e.target_monthly || 0),
  commissionRate: parseCommissionRate(e.commission_rate),
  commissionMonth: Number(e.commission_month || 0),
  commissionTotal: Number(e.commission_total || 0),
});

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [procedureCategories, setProcedureCategories] = useState<ProcedureCategory[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [bankCards, setBankCards] = useState<BankCard[]>([]);
  const paymentMethods = bankCards;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const readyRef = React.useRef<Set<DataResourceKey>>(new Set());
  const loadGenRef = React.useRef(0);

  const applyResource = useCallback((key: DataResourceKey, raw: ApiList<unknown>) => {
    const list = toApiList(raw);
    switch (key) {
      case 'customers':
        setCustomers(list.map(mapCustomer));
        break;
      case 'procedures':
        setProcedures(list.map(mapProcedure));
        break;
      case 'procedureCategories':
        setProcedureCategories(
          list.map((c: any) => ({ id: c.id, name: c.name, order: c.order ?? 0 }))
        );
        break;
      case 'payments':
        setPayments(list.map(mapPayment));
        break;
      case 'deposits':
        setDeposits(list.map(mapDeposit));
        break;
      case 'bankCards':
        setBankCards(list.map(mapBankCard));
        break;
      case 'employees':
        setEmployees(list.map(mapEmployee));
        break;
      case 'expenses':
        setExpenses(list.map(mapExpense));
        break;
    }
    readyRef.current.add(key);
  }, []);

  const fetchResource = useCallback(
    async (key: DataResourceKey, opts?: { force?: boolean }) => {
      if (opts?.force) {
        invalidateResourceCache(key);
        readyRef.current.delete(key);
      }
      const path = RESOURCE_PATH[key];
      const raw = await cachedFetch<ApiList<unknown>>(
        key,
        async () => {
          try {
            return await getJson<ApiList<unknown>>(path);
          } catch {
            return [];
          }
        },
        opts?.force ? 0 : LIST_TTL_MS
      );
      applyResource(key, raw);
    },
    [applyResource]
  );

  const ensureLoaded = useCallback(
    async (
      keys: DataResourceKey[],
      opts?: { force?: boolean; forceFinancial?: boolean }
    ) => {
      if (!user) return;
      const unique = [...new Set(keys)];
      const toLoad = unique.filter((key) => {
        if (opts?.force) return true;
        if (opts?.forceFinancial && FINANCIAL_RESOURCES.includes(key)) return true;
        return !readyRef.current.has(key);
      });
      // #region agent log
      const _t0 = performance.now();
      fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '3d910e',
        },
        body: JSON.stringify({
          sessionId: '3d910e',
          runId: 'post-fix',
          hypothesisId: 'H1',
          location: 'DataContext.tsx:ensureLoaded',
          message: 'ensure_loaded_start',
          data: {
            requested: unique,
            fetching: toLoad,
            force: !!opts?.force,
            forceFinancial: !!opts?.forceFinancial,
            ready: [...readyRef.current],
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (toLoad.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '3d910e',
          },
          body: JSON.stringify({
            sessionId: '3d910e',
            runId: 'post-fix',
            hypothesisId: 'H3',
            location: 'DataContext.tsx:ensureLoaded',
            message: 'ensure_loaded_cache_hit',
            data: {
              requested: unique,
              elapsed_ms: Math.round(performance.now() - _t0),
              ready: [...readyRef.current],
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        return;
      }
      const gen = loadGenRef.current;
      setLoading(true);
      try {
        await Promise.all(
          toLoad.map((key) =>
            fetchResource(key, {
              force:
                !!opts?.force ||
                (!!opts?.forceFinancial && FINANCIAL_RESOURCES.includes(key)),
            })
          )
        );
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
      // #region agent log
      fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '3d910e',
        },
        body: JSON.stringify({
          sessionId: '3d910e',
          runId: 'post-fix',
          hypothesisId: 'H1',
          location: 'DataContext.tsx:ensureLoaded',
          message: 'ensure_loaded_done',
          data: {
            fetched: toLoad,
            elapsed_ms: Math.round(performance.now() - _t0),
            ready: [...readyRef.current],
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    },
    [user, fetchResource]
  );

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      loadGenRef.current += 1;
      setResourceSessionUser(null);
      clearResourceCache();
      readyRef.current.clear();
      setCustomers([]);
      setProcedures([]);
      setProcedureCategories([]);
      setPayments([]);
      setDeposits([]);
      setBankCards([]);
      setEmployees([]);
      setExpenses([]);
      setLoading(false);
      // #region agent log
      fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '3d910e',
        },
        body: JSON.stringify({
          sessionId: '3d910e',
          runId: 'post-fix',
          hypothesisId: 'H2',
          location: 'DataContext.tsx:boot',
          message: 'session_cleared_unauthenticated',
          data: { authLoading: false, hasUser: false },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return;
    }

    setResourceSessionUser(String(user.id));
    // #region agent log
    fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '3d910e',
      },
      body: JSON.stringify({
        sessionId: '3d910e',
        runId: 'post-fix',
        hypothesisId: 'H1',
        location: 'DataContext.tsx:boot',
        message: 'smart_boot_no_global_prefetch',
        data: { hasUser: true, userId: user.id, role: user.role },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [authLoading, user?.id, user?.role]);

  const refreshCustomers = useCallback(async () => {
    try {
      await fetchResource('customers', { force: true });
    } catch {
      // ignore for now
    }
  }, [fetchResource]);

  const refreshProcedures = useCallback(async () => {
    try {
      await fetchResource('procedures', { force: true });
    } catch {
      // ignore for now
    }
  }, [fetchResource]);

  const refreshBankCards = useCallback(async () => {
    try {
      await fetchResource('bankCards', { force: true });
    } catch {
      // ignore for now
    }
  }, [fetchResource]);

  const addCustomer = useCallback(async (customer: Omit<Customer, 'id'>) => {
    const noHealthInsurance = customer.noHealthInsurance ?? false;
    const payload = {
      type: customer.type,
      name: customer.name,
      company_name: customer.companyName || customer.name,
      phone: customer.phone,
      phone_secondary: customer.phoneSecondary || '',
      email: customer.email || '',
      emirates_id: customer.emiratesId || '',
      trade_license: customer.tradeLicense || '',
      license_expiry: customer.licenseExpiry || null,
      establishment_card_expiry: customer.establishmentCardExpiry || null,
      workers_expiry: customer.workersExpiry || null,
      echannel_expiry: customer.echannelExpiry || null,
      echannel_email: customer.echannelEmail || '',
      echannel_password: customer.echannelPassword || '',
      no_health_insurance: noHealthInsurance,
      health_insurance_expiry: noHealthInsurance ? null : (customer.healthInsuranceExpiry || null),
      visa_expiry: customer.visaExpiry || null,
      insurance_expiry: customer.insuranceExpiry || null,
      last_activity: customer.lastActivity || format(new Date(), 'yyyy-MM-dd'),
    };
    const res = await postJson<any>('/customers/', payload);
    const mapped = mapCustomer(res);
    setCustomers((prev) => [...prev, mapped]);
    return mapped;
  }, []);

  const addProcedure = useCallback(
    async (procedure: Omit<Procedure, 'id'>) => {
      const isCustomerCardMode =
        procedure.cashOutType === 'CUSTOMER_CARD' || !!procedure.customerCardMode;
      const payload = {
        customer: procedure.customerId,
        category: procedure.category,
        description: procedure.description ?? '',
        notes: procedure.notes ?? '',
        cost: procedure.cost,
        selling_price: procedure.sellingPrice,
        cash_in: procedure.cashIn,
        cash_out_type: isCustomerCardMode ? null : (procedure.cashOutType || null),
        cash_in_type: procedure.cashInType || null,
        customer_card_mode: isCustomerCardMode,
        status: procedure.status,
        assigned_employee: procedure.assignedEmployeeId || null,
        date: procedure.date,
        paid: procedure.paid,
      };
      const res = await postJson<any>('/procedures/', payload);
      const mapped = mapProcedure(res);
      setProcedures((prev) => [...prev, mapped]);
      refreshBankCards();
      refreshCustomers();
      return mapped;
    },
    [refreshBankCards, refreshCustomers]
  );

  const addProcedureCategory = useCallback(async (name: string): Promise<ProcedureCategory> => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Category name is required');
    const res = await postJson<any>('/procedure-categories/', { name: trimmed, order: 0 });
    const category: ProcedureCategory = { id: res.id, name: res.name, order: res.order ?? 0 };
    setProcedureCategories((prev) =>
      [...prev, category].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    );
    return category;
  }, []);

  const fetchProceduresByStatus = useCallback(async (status: string): Promise<Procedure[]> => {
    const data = await getJson<ApiList<unknown>>(`/procedures/?status=${encodeURIComponent(status)}`);
    const list = toApiList(data);
    return list.map(mapProcedure);
  }, []);

  const fetchProceduresFiltered = useCallback(
    async (params: {
      assigned_employee?: string;
      status?: string;
      date_from?: string;
      date_to?: string;
      months?: number;
    }): Promise<Procedure[]> => {
      const qs = new URLSearchParams();
      if (params.assigned_employee) qs.set('assigned_employee', params.assigned_employee);
      if (params.status) qs.set('status', params.status);
      if (params.date_from) qs.set('date_from', params.date_from);
      if (params.date_to) qs.set('date_to', params.date_to);
      if (params.months && params.months > 0) qs.set('months', String(params.months));
      const query = qs.toString();
      const path = query ? `/procedures/?${query}` : '/procedures/';
      const data = await getJson<ApiList<unknown>>(path);
      return toApiList(data).map(mapProcedure);
    },
    []
  );

  const removeProcedure = useCallback(
    (id: string) => {
      deleteJson(`/procedures/${id}/`)
        .then(() => {
          setProcedures((prev) => prev.filter((proc) => proc.id !== id));
          refreshBankCards();
          refreshCustomers();
        })
        .catch(() => {});
    },
    [refreshBankCards, refreshCustomers]
  );

  const updateCustomer = useCallback(async (id: string, updates: Partial<Customer>) => {
    const noHealthInsurance = updates.noHealthInsurance ?? false;
    const payload = {
      type: updates.type,
      name: updates.name,
      company_name: updates.companyName,
      phone: updates.phone,
      phone_secondary: updates.phoneSecondary,
      email: updates.email,
      emirates_id: updates.emiratesId,
      trade_license: updates.tradeLicense,
      license_expiry: updates.licenseExpiry,
      establishment_card_expiry: updates.establishmentCardExpiry,
      workers_expiry: updates.workersExpiry,
      echannel_expiry: updates.echannelExpiry,
      echannel_email: updates.echannelEmail,
      echannel_password: updates.echannelPassword,
      no_health_insurance: noHealthInsurance,
      health_insurance_expiry: noHealthInsurance ? null : (updates.healthInsuranceExpiry ?? null),
      visa_expiry: updates.visaExpiry,
      insurance_expiry: updates.insuranceExpiry,
      last_activity: updates.lastActivity,
    };
    const res = await putJson<any>(`/customers/${id}/`, payload);
    const mapped = mapCustomer(res);
    setCustomers((prev) => prev.map((customer) => (customer.id === id ? mapped : customer)));
    return mapped;
  }, []);

  const removeCustomer = useCallback((id: string) => {
    deleteJson(`/customers/${id}/`).then(() => {
      setCustomers((prev) => prev.filter((c) => c.id !== id));
    });
  }, []);

  const addEmployee = useCallback((employee: Omit<Employee, 'id'> & { password: string }) => {
    const payload = {
      full_name: employee.name,
      salary: employee.salary,
      debit: employee.debit,
      credit: employee.credit,
      target_monthly: employee.targetMonthly,
      commission_rate: employee.commissionRate,
      username: employee.username,
      email: employee.email,
      role: employee.role,
      password: employee.password,
    };
    postJson<any>('/employees/', payload).then((res) => {
      const mapped = mapEmployee(res);
      setEmployees((prev) => [...prev, mapped]);
    });
  }, []);

  const updateEmployee = useCallback(
    async (id: string, updates: Partial<Employee> & { password?: string }) => {
      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.full_name = updates.name;
      if (updates.salary !== undefined) payload.salary = updates.salary;
      if (updates.debit !== undefined) payload.debit = updates.debit;
      if (updates.credit !== undefined) payload.credit = updates.credit;
      if (updates.targetMonthly !== undefined) payload.target_monthly = updates.targetMonthly;
      if (updates.commissionRate !== undefined) {
        const rate = Number(updates.commissionRate);
        payload.commission_rate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
      }
      if (updates.username !== undefined) payload.username = updates.username;
      if (updates.email !== undefined) payload.email = updates.email;
      if (updates.role !== undefined) payload.role = updates.role;
      if (updates.password) payload.password = updates.password;

      const res = await patchJson<any>(`/employees/${id}/`, payload);
      const mapped = mapEmployee(res);
      setEmployees((prev) => prev.map((employee) => (employee.id === id ? mapped : employee)));
      return mapped;
    },
    []
  );

  const removeEmployee = useCallback((id: string) => {
    deleteJson(`/employees/${id}/`).catch(() => {});
    setEmployees((prev) => prev.filter((employee) => employee.id !== id));
  }, []);

  const addPayment = useCallback(
    async (payment: Omit<Payment, 'id'>) => {
      const payload: Record<string, unknown> = {
        amount: payment.amount,
        date: payment.date,
        type: payment.type,
        customer: payment.customerId,
        bank_card: payment.bankCard || null,
        notes: payment.notes || '',
      };
      if (payment.procedureId) payload.procedure = payment.procedureId;
      const res = await postJson<any>('/payments/', payload);
      const mapped = mapPayment(res);
      setPayments((prev) => [...prev, mapped]);
      await Promise.all([refreshBankCards(), refreshCustomers()]);
    },
    [refreshBankCards, refreshCustomers]
  );

  const updatePayment = useCallback(
    async (id: string, payment: Partial<Omit<Payment, 'id'>>) => {
      const payload: Record<string, unknown> = {};
      if (payment.amount !== undefined) payload.amount = payment.amount;
      if (payment.date !== undefined) payload.date = payment.date;
      if (payment.type !== undefined) payload.type = payment.type;
      if (payment.customerId !== undefined) payload.customer = payment.customerId;
      if (payment.bankCard !== undefined) payload.bank_card = payment.bankCard;
      if (payment.notes !== undefined) payload.notes = payment.notes;
      if (payment.procedureId !== undefined) payload.procedure = payment.procedureId || null;
      const res = await patchJson<any>(`/payments/${id}/`, payload);
      const mapped = mapPayment(res);
      setPayments((prev) => prev.map((p) => (p.id === id ? mapped : p)));
      await Promise.all([refreshBankCards(), refreshCustomers()]);
    },
    [refreshBankCards, refreshCustomers]
  );

  const removePayment = useCallback(
    async (id: string) => {
      await deleteJson(`/payments/${id}/`);
      setPayments((prev) => prev.filter((p) => p.id !== id));
      await Promise.all([refreshBankCards(), refreshCustomers()]);
    },
    [refreshBankCards, refreshCustomers]
  );

  const addBankCard = useCallback((card: Omit<BankCard, 'id'>) => {
    const payload = {
      bank_name: card.bankName,
      cardholder_name: card.cardholderName,
      card_type: card.cardType,
      card_number: card.cardNumber || '',
      expiry_month: card.expiryMonth,
      expiry_year: card.expiryYear,
      iban: card.iban || '',
      swift: card.swift || '',
      account_number: card.accountNumber || '',
      notes: card.notes || '',
      method_type: card.methodType || 'bank',
      balance: card.balance ?? 0,
    };
    postJson<any>('/bank-cards/', payload).then((res) => {
      const mapped = mapBankCard(res);
      setBankCards((prev) => [...prev, mapped]);
    });
  }, []);

  const updateBankCard = useCallback((id: string, updates: Partial<BankCard>) => {
    const payload = {
      bank_name: updates.bankName,
      cardholder_name: updates.cardholderName,
      card_type: updates.cardType,
      card_number: updates.cardNumber,
      expiry_month: updates.expiryMonth,
      expiry_year: updates.expiryYear,
      iban: updates.iban,
      swift: updates.swift,
      account_number: updates.accountNumber,
      notes: updates.notes,
      method_type: updates.methodType,
      balance: updates.balance,
    };
    putJson<any>(`/bank-cards/${id}/`, payload).then((res) => {
      const mapped = mapBankCard(res);
      setBankCards((prev) => prev.map((card) => (card.id === id ? mapped : card)));
    });
  }, []);

  const removeBankCard = useCallback((id: string) => {
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';
    const token = localStorage.getItem('accessToken');
    fetch(`${API_BASE.replace(/\/$/, '')}/bank-cards/${id}/`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    setBankCards((prev) => prev.filter((card) => card.id !== id));
  }, []);

  const refreshExpenses = useCallback(async () => {
    try {
      await fetchResource('expenses', { force: true });
    } catch {
      /* keep existing */
    }
  }, [fetchResource]);

  const refreshEmployees = useCallback(async () => {
    try {
      await fetchResource('employees', { force: true });
    } catch {
      /* keep existing */
    }
  }, [fetchResource]);

  const addExpense = useCallback(
    async (expense: Omit<Expense, 'id'>): Promise<Expense> => {
      const payload: Record<string, unknown> = {
        category: expense.category,
        date: expense.date,
        amount: expense.amount,
        paid_by: expense.paidBy,
        assigned_employee: expense.assignedEmployeeId || expense.assignedEmployee || null,
        notes: expense.notes || '',
      };
      if (expense.payrollType) payload.payroll_type = expense.payrollType;
      if (expense.payrollPeriod) payload.payroll_period = expense.payrollPeriod;
      const res = await postJson<any>('/expenses/', payload);
      const mapped = mapExpense(res);
      setExpenses((prev) => [...prev, mapped]);
      await refreshBankCards();
      return mapped;
    },
    [refreshBankCards]
  );

  const payEmployeeSalary = useCallback(
    async (
      employeeProfileId: string,
      payload: { period: string; paid_by: string; date: string; notes?: string; force?: boolean }
    ): Promise<Expense> => {
      const res = await postJson<any>(`/employees/${employeeProfileId}/pay-salary/`, payload);
      const mapped = mapExpense(res);
      setExpenses((prev) => [...prev, mapped]);
      await refreshBankCards();
      return mapped;
    },
    [refreshBankCards]
  );

  const payEmployeeCommission = useCallback(
    async (
      employeeProfileId: string,
      payload: { period: string; paid_by: string; date: string; notes?: string; force?: boolean }
    ): Promise<Expense> => {
      const res = await postJson<any>(`/employees/${employeeProfileId}/pay-commission/`, payload);
      const mapped = mapExpense(res);
      setExpenses((prev) => [...prev, mapped]);
      await refreshBankCards();
      return mapped;
    },
    [refreshBankCards]
  );

  const addDeposit = useCallback(
    (deposit: {
      amount: number;
      date: string;
      fromMethod: string;
      toMethod: string;
      notes?: string;
    }) => {
      const payload = {
        amount: deposit.amount,
        date: deposit.date,
        from_method: deposit.fromMethod,
        to_method: deposit.toMethod,
        notes: deposit.notes || '',
      };
      postJson<any>('/deposits/', payload)
        .then((res) => {
          setDeposits((prev) => [...prev, mapDeposit(res)]);
          return refreshBankCards();
        })
        .catch(() => {});
    },
    [refreshBankCards]
  );

  const updateProcedureStatus = useCallback(
    (id: string, status: Procedure['status'], notes?: string) => {
      const payload: { status: Procedure['status']; notes?: string } = { status };
      if (notes !== undefined) payload.notes = notes;
      patchJson(`/procedures/${id}/`, payload)
        .then(() => {
          setProcedures((prev) =>
            prev.map((p) =>
              p.id === id ? { ...p, status, notes: notes !== undefined ? notes : p.notes } : p
            )
          );
        })
        .catch(() => {});
    },
    []
  );

  const updateProcedure = useCallback(
    async (id: string, updates: Partial<Procedure>): Promise<Procedure> => {
      const existing = procedures.find((p) => p.id === id);
      // Procedure.paid is derived from Payment/PaymentRefund — never PATCH it.
      const payload: Record<string, unknown> = {};
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.notes !== undefined) payload.notes = updates.notes;
      if (updates.assignedEmployeeId !== undefined) {
        payload.assigned_employee = updates.assignedEmployeeId || null;
      }
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.cost !== undefined) payload.cost = updates.cost;
      if (updates.sellingPrice !== undefined) payload.selling_price = updates.sellingPrice;
      const res = await patchJson<any>(`/procedures/${id}/`, payload);
      const mapped = mapProcedure(res);
      setProcedures((prev) => prev.map((p) => (p.id === id ? mapped : p)));
      if (existing && (updates.cost !== undefined || updates.sellingPrice !== undefined)) {
        await Promise.all([refreshBankCards(), refreshCustomers()]);
      }
      return mapped;
    },
    [procedures, refreshBankCards, refreshCustomers]
  );

  const value = useMemo<DataContextType>(
    () => ({
      globalSearchQuery,
      setGlobalSearchQuery,
      customers,
      procedures,
      procedureCategories,
      payments,
      deposits,
      paymentMethods,
      bankCards,
      employees,
      expenses,
      loading,
      ensureLoaded,
      addCustomer,
      updateCustomer,
      removeCustomer,
      addEmployee,
      updateEmployee,
      removeEmployee,
      addProcedure,
      addProcedureCategory,
      fetchProceduresByStatus,
      fetchProceduresFiltered,
      removeProcedure,
      addPayment,
      updatePayment,
      removePayment,
      addBankCard,
      updateBankCard,
      removeBankCard,
      addExpense,
      payEmployeeSalary,
      payEmployeeCommission,
      refreshExpenses,
      refreshEmployees,
      refreshBankCards,
      refreshCustomers,
      refreshProcedures,
      addDeposit,
      updateProcedureStatus,
      updateProcedure,
    }),
    [
      globalSearchQuery,
      customers,
      procedures,
      procedureCategories,
      payments,
      deposits,
      paymentMethods,
      bankCards,
      employees,
      expenses,
      loading,
      ensureLoaded,
      addCustomer,
      updateCustomer,
      removeCustomer,
      addEmployee,
      updateEmployee,
      removeEmployee,
      addProcedure,
      addProcedureCategory,
      fetchProceduresByStatus,
      fetchProceduresFiltered,
      removeProcedure,
      addPayment,
      updatePayment,
      removePayment,
      addBankCard,
      updateBankCard,
      removeBankCard,
      addExpense,
      payEmployeeSalary,
      payEmployeeCommission,
      refreshExpenses,
      refreshEmployees,
      refreshBankCards,
      refreshCustomers,
      refreshProcedures,
      addDeposit,
      updateProcedureStatus,
      updateProcedure,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
