import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/contexts/AuthContext';
import { Plus, Trash2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Save, MessageSquare, StickyNote, Download } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, getBlob, formatApiErrorMessage } from '@/app/lib/api';
import { format, addDays, isSameDay, parse, startOfDay, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { cn } from '@/app/components/ui/utils';
import { useData, type Procedure } from '@/app/contexts/DataContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription
} from "@/app/components/ui/dialog";
import { SearchableCombobox } from '@/app/components/ui/searchable-combobox';

type DiaryStatus = 'Submitted' | 'In Process' | 'Need Information' | 'Completed' | 'Rejected';

type DiaryEntry = {
  id: string;
  date: string;
  serial: number;
  procedureName: string;
  sales: number | '';
  cost: number | '';
  cashOutType: string;
  description: string;
  status: DiaryStatus;
  customer: string;
  notes?: string;
  assignedEmployee?: string;
  assignedEmployeeId?: string;
};

const INITIAL_DATA: DiaryEntry[] = [
  {
    id: '1',
    date: format(new Date(), 'dd-MMM-yy'),
    serial: 1,
    procedureName: 'New Visa Processing - Ahmed',
    sales: 1500,
    cost: 500,
    cashOutType: 'Cash',
    description: 'New Visa Processing - Ahmed',
    status: 'Completed',
    customer: 'Al Rayan Contracting',
    notes: 'Everything completed smoothly. Documents handed over.'
  },
  {
    id: '2',
    date: format(new Date(), 'dd-MMM-yy'),
    serial: 2,
    procedureName: 'Typing Services',
    sales: 300,
    cost: '',
    cashOutType: '',
    description: 'Typing Services',
    status: 'Submitted',
    customer: 'Walk-in Customer',
  }
];

export function ProceduresPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    customers,
    procedures,
    procedureCategories,
    bankCards,
    employees,
    addProcedure,
    addProcedureCategory,
    updateProcedureStatus,
    updateProcedure,
    removeProcedure,
    fetchProceduresByStatus,
    fetchProceduresFiltered,
    ensureLoaded,
  } = useData();

  useEffect(() => {
    void ensureLoaded([
      'procedures',
      'customers',
      'procedureCategories',
      'bankCards',
      'employees',
    ]);
  }, [ensureLoaded]);

  const [procedureNotes, setProcedureNotes] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [proceduresWhenStatusFiltered, setProceduresWhenStatusFiltered] = useState<typeof procedures | null>(null);
  const [loadingStatusFilter, setLoadingStatusFilter] = useState(false);
  const [adminFilteredProcedures, setAdminFilteredProcedures] = useState<typeof procedures | null>(null);
  const [loadingAdminFilters, setLoadingAdminFilters] = useState(false);
  const [filterAssignedEmployeeId, setFilterAssignedEmployeeId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterLastMonthsEnabled, setFilterLastMonthsEnabled] = useState(false);
  const [filterLastMonths, setFilterLastMonths] = useState(3);
  const [filterPanelStatus, setFilterPanelStatus] = useState<DiaryStatus | ''>('');
  const [exportingCsv, setExportingCsv] = useState(false);

  // Add new procedure category modal
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addCategoryError, setAddCategoryError] = useState<string | null>(null);

  // Status Update Modal State
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [newStatus, setNewStatus] = useState<DiaryStatus>('Submitted');
  const [statusFilter, setStatusFilter] = useState<DiaryStatus | null>(null);

  const [newEntry, setNewEntry] = useState<Partial<DiaryEntry>>({
    procedureName: '',
    sales: '',
    cost: '',
    cashOutType: '',
    description: '',
    customer: '',
    assignedEmployeeId: '',
  });
  const [statusAssigneeId, setStatusAssigneeId] = useState('');

  const canAssignEmployee = user?.role === 'admin' || user?.role === 'manager';

  const hasActiveAdminFilters =
    canAssignEmployee &&
    (filterAssignedEmployeeId !== '' ||
      filterDateFrom !== '' ||
      filterDateTo !== '' ||
      filterLastMonthsEnabled ||
      filterPanelStatus !== '');

  const assignableEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.role === 'employee' || e.role === 'manager')
        .map((e) => ({ userId: e.userId, name: e.name })),
    [employees]
  );

  const canManageEntry = (entry: DiaryEntry) => {
    if (user?.role === 'admin' || user?.role === 'manager') return true;
    if (user?.role === 'employee' && user?.id) {
      return entry.assignedEmployeeId === user.id;
    }
    return false;
  };

  const CUSTOMER_CARD_ID = 'CUSTOMER_CARD';
  const CUSTOMER_CARD_LABEL = 'Customer Card / كرت العميل';
  const cashOutOptions = useMemo(() => {
    const fromCards = bankCards.map((card) => {
      const base = card.bankName || card.cardType || 'Method';
      const detail = card.last4 ? `**** ${card.last4}` : card.cardType;
      const label = detail ? `${base} (${detail})` : base;
      return { id: card.id, label };
    });
    if (!fromCards.some((o) => o.id === CUSTOMER_CARD_ID)) {
      fromCards.unshift({ id: CUSTOMER_CARD_ID, label: CUSTOMER_CARD_LABEL });
    }
    return fromCards;
  }, [bankCards]);

  const getCashOutLabel = (value?: string) => {
    if (!value) return '';
    const match = cashOutOptions.find((option) => option.id === value);
    return match ? match.label : value;
  };
  const isCustomerCardSelected = newEntry.cashOutType === CUSTOMER_CARD_ID;

  const procedureCatalog = useMemo(() => {
    const catalog = new Map<
      string,
      { label: string; cost: number; sellingPrice: number; timestamp: number }
    >();
    procedures.forEach((proc) => {
      const key = (proc.category || '').trim().toLowerCase();
      if (!key) return;
      const timestamp = new Date(proc.date).getTime() || 0;
      const current = catalog.get(key);
      if (!current || timestamp >= current.timestamp) {
        catalog.set(key, {
          label: proc.category,
          cost: Number(proc.cost || 0),
          sellingPrice: Number(proc.sellingPrice || 0),
          timestamp,
        });
      }
    });
    return Array.from(catalog.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [procedures]);

  const procedureTypeOptions = useMemo(() => {
    const options = procedureCategories.map((category) => ({
      value: category.name,
      label: category.name,
    }));
    procedureCatalog
      .filter((proc) => !procedureCategories.some((category) => category.name === proc.label))
      .forEach((proc) => {
        options.push({ value: proc.label, label: proc.label });
      });
    return options;
  }, [procedureCategories, procedureCatalog]);

  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    return customers
      .map((customer) => customer.companyName || customer.name)
      .filter((name) => {
        const key = (name || '').trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const mapStatusToUi = (status: string): DiaryStatus => {
    if (status === 'in-process') return 'In Process';
    if (status === 'approved') return 'Need Information';
    if (status === 'need-info') return 'Need Information';
    if (status === 'done') return 'Completed';
    if (status === 'rejected') return 'Rejected';
    return 'Submitted';
  };

  const statusLabel = (status: DiaryStatus) => {
    switch (status) {
      case 'In Process':
        return t('status.inProcessUi');
      case 'Need Information':
        return t('status.needInfoUi');
      case 'Rejected':
        return t('status.rejectedUi');
      case 'Completed':
        return t('status.completedUi');
      default:
        return t('status.submittedUi');
    }
  };

  const mapStatusToApi = (status: DiaryStatus) => {
    if (status === 'In Process') return 'in-process';
    if (status === 'Need Information') return 'need-info';
    if (status === 'Completed') return 'done';
    if (status === 'Rejected') return 'rejected';
    return 'submitted';
  };

  // When employee applies a status filter, fetch all procedures with that status from the API
  useEffect(() => {
    if (user?.role !== 'employee' || !statusFilter) {
      setProceduresWhenStatusFiltered(null);
      return;
    }
    setLoadingStatusFilter(true);
    fetchProceduresByStatus(mapStatusToApi(statusFilter))
      .then(setProceduresWhenStatusFiltered)
      .catch(() => setProceduresWhenStatusFiltered([]))
      .finally(() => setLoadingStatusFilter(false));
  }, [user?.role, statusFilter, fetchProceduresByStatus]);

  useEffect(() => {
    if (!hasActiveAdminFilters) {
      setAdminFilteredProcedures(null);
      return;
    }
    setLoadingAdminFilters(true);
    const statusParam = filterPanelStatus
      ? mapStatusToApi(filterPanelStatus)
      : statusFilter
        ? mapStatusToApi(statusFilter)
        : undefined;
    fetchProceduresFiltered({
      assigned_employee: filterAssignedEmployeeId || undefined,
      status: statusParam,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      months: filterLastMonthsEnabled ? filterLastMonths : undefined,
    })
      .then(setAdminFilteredProcedures)
      .catch(() => setAdminFilteredProcedures([]))
      .finally(() => setLoadingAdminFilters(false));
  }, [
    hasActiveAdminFilters,
    filterAssignedEmployeeId,
    filterPanelStatus,
    statusFilter,
    filterDateFrom,
    filterDateTo,
    filterLastMonthsEnabled,
    filterLastMonths,
    fetchProceduresFiltered,
  ]);

  const parseProcedureDate = (value: string) => {
    if (!value) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsedLocal = parse(value, 'yyyy-MM-dd', new Date());
      if (!Number.isNaN(parsedLocal.getTime())) {
        return parsedLocal;
      }
    }
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  };

  const sourceProcedures = useMemo(() => {
    if (user?.role === 'employee' && statusFilter && proceduresWhenStatusFiltered !== null) {
      return proceduresWhenStatusFiltered;
    }
    if (hasActiveAdminFilters && adminFilteredProcedures !== null) {
      return adminFilteredProcedures;
    }
    return procedures;
  }, [
    user?.role,
    statusFilter,
    proceduresWhenStatusFiltered,
    procedures,
    hasActiveAdminFilters,
    adminFilteredProcedures,
  ]);

  const entries = useMemo<DiaryEntry[]>(() => {
    return sourceProcedures.map((procedure) => {
      const date = parseProcedureDate(procedure.date);
      return {
        id: procedure.id,
        date: format(date, 'dd-MMM-yy'),
        serial: 0,
        procedureName: procedure.category || '',
        sales: Number(procedure.sellingPrice || 0),
        cost: Number(procedure.cost || 0),
        cashOutType: getCashOutLabel(procedure.cashOutType),
        description: procedure.description ?? '',
        status: mapStatusToUi(procedure.status),
        customer: procedure.customerName,
        notes: procedure.notes ?? procedureNotes[procedure.id] ?? '',
        assignedEmployee: procedure.assignedEmployee ?? '',
        assignedEmployeeId: procedure.assignedEmployeeId ?? '',
      };
    });
  }, [sourceProcedures, procedureNotes, cashOutOptions]);

  // Filter entries for the selected day (when no status filter, or for non-employee)
  const dailyEntries = useMemo(() => {
    if (user?.role === 'employee' && statusFilter) {
      return entries;
    }
    const filtered = entries.filter(entry => {
      try {
        const entryDate = parse(entry.date, 'dd-MMM-yy', new Date());
        return isSameDay(entryDate, selectedDate);
      } catch (e) {
        return false;
      }
    });
    return filtered.map((entry, index) => ({ ...entry, serial: index + 1 }));
  }, [entries, selectedDate, user?.role, statusFilter]);

  const monthlyCountEntries = useMemo<DiaryEntry[]>(() => {
    return procedures.map((procedure) => {
      const date = parseProcedureDate(procedure.date);
      return {
        id: procedure.id,
        date: format(date, 'dd-MMM-yy'),
        serial: 0,
        procedureName: procedure.category || '',
        sales: Number(procedure.sellingPrice || 0),
        cost: Number(procedure.cost || 0),
        cashOutType: getCashOutLabel(procedure.cashOutType),
        description: procedure.description ?? '',
        status: mapStatusToUi(procedure.status),
        customer: procedure.customerName,
        notes: procedure.notes ?? '',
        assignedEmployee: procedure.assignedEmployee ?? '',
        assignedEmployeeId: procedure.assignedEmployeeId ?? '',
      };
    });
  }, [procedures, cashOutOptions]);

  // Counts for the cards — always current calendar month, unaffected by table filters
  const counts = useMemo(() => {
    const c = {
      Submitted: 0,
      'In Process': 0,
      'Need Information': 0,
      Completed: 0,
      Rejected: 0
    };
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    monthlyCountEntries.forEach(e => {
      const entryDate = parse(e.date, 'dd-MMM-yy', new Date());
      if (!isWithinInterval(entryDate, { start: monthStart, end: monthEnd })) {
        return;
      }
      if (c[e.status] !== undefined) {
        c[e.status]++;
      }
    });
    return c;
  }, [monthlyCountEntries]);

  const filteredEntries = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    const isInCurrentMonth = (entry: DiaryEntry) => {
      const entryDate = parse(entry.date, 'dd-MMM-yy', new Date());
      return isWithinInterval(entryDate, { start: monthStart, end: monthEnd });
    };

    if (hasActiveAdminFilters) {
      let list = entries;
      const effectiveStatus = filterPanelStatus || statusFilter;
      if (effectiveStatus) {
        list = list.filter((entry) => entry.status === effectiveStatus);
      }
      return list.map((entry, index) => ({ ...entry, serial: index + 1 }));
    }

    if (!statusFilter) return dailyEntries;
    if (user?.role === 'employee') {
      return entries
        .filter(isInCurrentMonth)
        .map((entry, index) => ({ ...entry, serial: index + 1 }));
    }
    const filtered = entries.filter((entry) => entry.status === statusFilter);
    return filtered.map((entry, index) => ({ ...entry, serial: index + 1 }));
  }, [dailyEntries, statusFilter, entries, user?.role, hasActiveAdminFilters, filterPanelStatus]);

  const buildExportQuery = () => {
    const qs = new URLSearchParams();
    const statusParam = filterPanelStatus
      ? mapStatusToApi(filterPanelStatus)
      : statusFilter
        ? mapStatusToApi(statusFilter)
        : '';
    if (hasActiveAdminFilters) {
      if (filterAssignedEmployeeId) qs.set('assigned_employee', filterAssignedEmployeeId);
      if (statusParam) qs.set('status', statusParam);
      if (filterDateFrom) qs.set('date_from', filterDateFrom);
      if (filterDateTo) qs.set('date_to', filterDateTo);
      if (filterLastMonthsEnabled && filterLastMonths > 0) {
        qs.set('months', String(filterLastMonths));
      }
    } else {
      qs.set('date', format(selectedDate, 'yyyy-MM-dd'));
      if (statusParam) qs.set('status', statusParam);
    }
    const query = qs.toString();
    return query ? `?${query}` : '';
  };

  const buildExportFilename = () => {
    if (hasActiveAdminFilters) {
      if (filterDateFrom && filterDateTo) {
        return `procedures-audit-${filterDateFrom}-to-${filterDateTo}.csv`;
      }
      if (filterLastMonthsEnabled) {
        return `procedures-audit-last-${filterLastMonths}-months.csv`;
      }
      if (filterAssignedEmployeeId) {
        const emp = assignableEmployees.find((e) => e.userId === filterAssignedEmployeeId);
        const slug = (emp?.name || filterAssignedEmployeeId).replace(/\s+/g, '-');
        return `procedures-audit-employee-${slug}.csv`;
      }
      if (filterPanelStatus || statusFilter) {
        const statusSlug = (filterPanelStatus || statusFilter || 'filtered')
          .toLowerCase()
          .replace(/\s+/g, '-');
        return `procedures-audit-${statusSlug}.csv`;
      }
      return `procedures-audit-filtered-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    }
    return `procedures-audit-${format(selectedDate, 'yyyy-MM-dd')}.csv`;
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const blob = await getBlob(`/procedures/export/${buildExportQuery()}`);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = buildExportFilename();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      const message =
        err instanceof ApiError && err.detail
          ? err.detail
          : t('procedures.exportFailed');
      toast.error(message);
    } finally {
      setExportingCsv(false);
    }
  };

  const handleClearAdminFilters = () => {
    setFilterAssignedEmployeeId('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterLastMonthsEnabled(false);
    setFilterLastMonths(3);
    setFilterPanelStatus('');
    setStatusFilter(null);
    setAdminFilteredProcedures(null);
  };

  const isTableLoading = loadingStatusFilter || loadingAdminFilters;

  const handleAddEntry = async () => {
    if (!newEntry.procedureName?.trim()) return;
    if (!newEntry.customer?.trim()) return;
    setAddError(null);
    
    // Calculate next serial for this day
    const nextSerial = dailyEntries.length > 0 
      ? Math.max(...dailyEntries.map(e => e.serial)) + 1 
      : 1;

    const entry: DiaryEntry = {
      id: Math.random().toString(36).substr(2, 9),
      date: format(selectedDate, 'dd-MMM-yy'),
      serial: nextSerial,
      procedureName: newEntry.procedureName || '',
      sales: newEntry.sales !== '' ? Number(newEntry.sales) : '',
      cost: newEntry.cost !== '' ? Number(newEntry.cost) : '',
      cashOutType: newEntry.cashOutType || '',
      description: newEntry.description || '',
      status: 'Submitted',
      customer: newEntry.customer || '',
    };
    
    const trimmedCustomer = newEntry.customer?.trim() || '';
    const existingCustomer = customers.find((customer) => {
      const displayName = (customer.companyName || customer.name).toLowerCase();
      return displayName === trimmedCustomer.toLowerCase();
    });

    if (!existingCustomer) {
      navigate('/customers');
      return;
    }
    if (isCustomerCardSelected && Number(newEntry.cost || 0) !== 0) {
      setAddError('Cost must be 0 when cash out type is Customer Card.');
      return;
    }

    try {
      await addProcedure({
        customerId: existingCustomer.id,
        customerName: trimmedCustomer,
        category: newEntry.procedureName || '',
        description: newEntry.description ?? '',
        cost: Number(newEntry.cost || 0),
        sellingPrice: Number(newEntry.sales || 0),
        cashIn: 0,
        cashOutType: newEntry.cashOutType || undefined,
        cashInType: undefined,
        customerCardMode: isCustomerCardSelected,
        status: 'submitted',
        assignedEmployeeId: canAssignEmployee ? newEntry.assignedEmployeeId || undefined : user?.id,
        assignedEmployee: canAssignEmployee ? '' : user?.name || '',
        date: format(selectedDate, 'yyyy-MM-dd'),
        paid: 0,
      });
      setNewEntry({
        procedureName: '',
        sales: '',
        cost: '',
        cashOutType: '',
        description: '',
        customer: '',
        assignedEmployeeId: '',
      });
    } catch (err) {
      setAddError(formatApiErrorMessage(err, t('procedures.saveFailed')));
    }
  };

  const handleDeleteEntry = (id: string) => {
    removeProcedure(id);
  };

  const handleDateChange = (days: number) => {
    setSelectedDate(prev => addDays(prev, days));
  };

  const openAddCategoryModal = () => {
    setIsAddCategoryOpen(true);
    setNewCategoryName('');
    setAddCategoryError(null);
    setNewEntry((prev) => ({ ...prev, procedureName: '' }));
  };

  const handleProcedureNameChange = (value: string) => {
    const match = procedureCatalog.find((proc) => proc.label === value);
    setNewEntry((prev) => ({
      ...prev,
      procedureName: value,
      cost: match ? match.cost : prev.cost,
      sales: match ? match.sellingPrice : prev.sales,
    }));
  };

  const handleAddCategorySubmit = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      setAddCategoryError(t('procedures.categoryNameRequired') || 'Enter a name for the procedure type.');
      return;
    }
    setAddCategoryError(null);
    try {
      const category = await addProcedureCategory(name);
      setNewEntry((prev) => ({ ...prev, procedureName: category.name }));
      setIsAddCategoryOpen(false);
      setNewCategoryName('');
    } catch {
      setAddCategoryError(t('procedures.addCategoryFailed') || 'Could not add procedure type. It may already exist.');
    }
  };

  const handleDescriptionChange = (value: string) => {
    setNewEntry((prev) => ({ ...prev, description: value }));
  };

  const handleNumberChange =
    (field: 'sales' | 'cost') => (value: string) => {
      if (field === 'cost' && isCustomerCardSelected) {
        setNewEntry((prev) => ({ ...prev, cost: 0 }));
        return;
      }
      if (value === '') {
        setNewEntry((prev) => ({ ...prev, [field]: '' }));
        return;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed) || parsed < 0) return;
      setNewEntry((prev) => ({ ...prev, [field]: parsed }));
    };

  const openStatusModal = (entry: DiaryEntry) => {
    setEditingEntry(entry);
    setNewStatus(entry.status);
    setStatusNote(entry.notes || '');
    setStatusAssigneeId(entry.assignedEmployeeId || '');
    setIsStatusModalOpen(true);
  };

  const handleUpdateStatus = async () => {
    if (!editingEntry) return;

    try {
      if (canAssignEmployee) {
        await updateProcedure(editingEntry.id, {
          status: mapStatusToApi(newStatus) as Procedure['status'],
          notes: statusNote,
          assignedEmployeeId: statusAssigneeId || undefined,
        });
      } else {
        updateProcedureStatus(editingEntry.id, mapStatusToApi(newStatus) as any, statusNote);
      }
      setProcedureNotes((prev) => ({
        ...prev,
        [editingEntry.id]: statusNote,
      }));
      setIsStatusModalOpen(false);
      setEditingEntry(null);
    } catch (err) {
      setAddError(formatApiErrorMessage(err, t('procedures.saveFailed')));
    }
  };

  const formattedSelectedDate = format(selectedDate, 'EEE, dd MMM yyyy');
  const isPastDayForEmployee = false; // Employees can add/edit/delete procedures for any date

  const handleClearFilter = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!statusFilter) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-status-card="true"]')) return;
    setStatusFilter(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50" onDoubleClick={handleClearFilter}>
      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white p-4 shadow-sm border border-gray-200 rounded-sm mb-6">
          
          {/* Header with Date Filter */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">{t('procedures.title')}</h2>
            
            <div className="flex items-center gap-4 bg-gray-100 p-1.5 rounded-lg border border-gray-200">
              <button 
                onClick={() => handleDateChange(-1)}
                className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-gray-600"
              >
                <ChevronLeft className="size-5" />
              </button>
              
              <div className="flex items-center gap-2 px-2 min-w-[160px] justify-center font-medium text-gray-700">
                <CalendarIcon className="size-4 text-gray-500" />
                <span>{formattedSelectedDate}</span>
              </div>
              
              <button 
                onClick={() => handleDateChange(1)}
                className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-gray-600"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>
          </div>

          {canAssignEmployee && (
            <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 min-w-[160px] flex-1">
                  <label className="text-xs font-semibold text-gray-600">{t('procedures.filters.assignedEmployee')}</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                    value={filterAssignedEmployeeId}
                    onChange={(e) => setFilterAssignedEmployeeId(e.target.value)}
                  >
                    <option value="">{t('procedures.filters.allEmployees')}</option>
                    {assignableEmployees.map((emp) => (
                      <option key={emp.userId} value={emp.userId}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 min-w-[140px]">
                  <label className="text-xs font-semibold text-gray-600">{t('procedures.filters.status')}</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                    value={filterPanelStatus}
                    onChange={(e) => setFilterPanelStatus(e.target.value as DiaryStatus | '')}
                  >
                    <option value="">{t('procedures.filters.allStatuses')}</option>
                    <option value="Submitted">{t('status.submittedUi')}</option>
                    <option value="In Process">{t('status.inProcessUi')}</option>
                    <option value="Need Information">{t('status.needInfoUi')}</option>
                    <option value="Completed">{t('status.completedUi')}</option>
                    <option value="Rejected">{t('status.rejectedUi')}</option>
                  </select>
                </div>
                <div className="space-y-1 min-w-[130px]">
                  <label className="text-xs font-semibold text-gray-600">{t('procedures.filters.dateFrom')}</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    disabled={filterLastMonthsEnabled}
                  />
                </div>
                <div className="space-y-1 min-w-[130px]">
                  <label className="text-xs font-semibold text-gray-600">{t('procedures.filters.dateTo')}</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    disabled={filterLastMonthsEnabled}
                  />
                </div>
                <div className="space-y-1 min-w-[200px]">
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterLastMonthsEnabled}
                      onChange={(e) => setFilterLastMonthsEnabled(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    {t('procedures.filters.lastMonths')}
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:opacity-50"
                    value={filterLastMonths}
                    onChange={(e) => setFilterLastMonths(Number(e.target.value))}
                    disabled={!filterLastMonthsEnabled}
                  >
                    <option value={1}>{t('procedures.filters.monthsOption', { count: 1 })}</option>
                    <option value={3}>{t('procedures.filters.monthsOption', { count: 3 })}</option>
                    <option value={6}>{t('procedures.filters.monthsOption', { count: 6 })}</option>
                    <option value={12}>{t('procedures.filters.monthsOption', { count: 12 })}</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={exportingCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {exportingCsv ? t('common.loading') : t('procedures.filters.exportCsv')}
                </button>
                <button
                  type="button"
                  onClick={handleClearAdminFilters}
                  disabled={!hasActiveAdminFilters && !statusFilter}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('procedures.filters.clear')}
                </button>
              </div>
            </div>
          )}

          {/* Excel-like Table */}
          <div className="border-2 border-black inline-block min-w-full overflow-x-auto">
            <table className="w-full border-collapse text-sm text-center">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-black p-2 w-16 font-bold uppercase">{t('procedures.table.serial')}</th>
                  <th className="border border-black p-2 min-w-[180px] font-bold uppercase">{t('procedures.table.procedureName') || 'Procedure name'}</th>
                  <th className="border border-black p-2 w-24 font-bold uppercase">{t('procedures.table.sales')}</th>
                  <th className="border border-black p-2 w-24 font-bold uppercase">{t('procedures.table.cost')}</th>
                  <th className="border border-black p-2 w-32 font-bold uppercase">{t('procedures.table.cashOutType')}</th>
                  <th className="border border-black p-2 min-w-[250px] font-bold uppercase">{t('procedures.table.desc')}</th>
                  <th className="border border-black p-2 w-32 font-bold uppercase">{t('procedures.table.status')}</th>
                  <th className="border border-black p-2 w-40 font-bold uppercase">{t('procedures.table.customer')}</th>
                  {canAssignEmployee && (
                    <th className="border border-black p-2 w-36 font-bold uppercase">{t('procedures.table.assignedEmployee')}</th>
                  )}
                  <th className="border border-black p-2 w-10 bg-gray-50"></th>
                </tr>
              </thead>
              <tbody>
                {isTableLoading ? (
                  <tr>
                    <td colSpan={canAssignEmployee ? 10 : 9} className="border border-black p-8 text-center text-gray-500">
                      {t('common.loading') || 'Loading...'}
                    </td>
                  </tr>
                ) : filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={canAssignEmployee ? 10 : 9} className="border border-black p-8 text-center text-gray-400 italic">
                      {hasActiveAdminFilters
                        ? t('procedures.filters.empty')
                        : statusFilter
                          ? t('procedures.emptyFiltered', { status: statusLabel(statusFilter) })
                          : t('procedures.empty')}
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-blue-50">
                      <td className="border border-black p-2 font-mono text-gray-500">{entry.serial}</td>
                      <td className="border border-black p-2 text-right text-gray-800 font-medium" dir="rtl">{entry.procedureName || '-'}</td>
                      <td className="border border-black p-2 font-medium">{entry.sales || '-'}</td>
                      <td className="border border-black p-2 text-red-600 font-medium">{entry.cost || '-'}</td>
                      <td className="border border-black p-2 text-gray-600">{entry.cashOutType || '-'}</td>
                      <td className="border border-black p-2 text-right text-gray-800" dir="rtl">{entry.description}</td>
                      <td className="border border-black p-2">
                         <div className="flex items-center justify-center gap-2">
                           <button
                            onClick={() => openStatusModal(entry)}
                            disabled={isPastDayForEmployee}
                            className={cn(
                              "px-2 py-0.5 rounded text-xs font-semibold border cursor-pointer hover:opacity-80 transition-opacity",
                              isPastDayForEmployee && "opacity-60 cursor-not-allowed",
                              entry.status === 'Submitted' && "bg-gray-100 text-gray-700 border-gray-300",
                              entry.status === 'In Process' && "bg-blue-50 text-blue-700 border-blue-200",
                          entry.status === 'Need Information' && "bg-amber-50 text-amber-700 border-amber-200",
                          entry.status === 'Completed' && "bg-green-50 text-green-700 border-green-200",
                          entry.status === 'Rejected' && "bg-red-50 text-red-700 border-red-200",
                            )}
                           >
                            {statusLabel(entry.status)}
                           </button>
                           {entry.notes && (
                             <div className="group relative">
                               <StickyNote className="size-4 text-yellow-500 fill-yellow-100 cursor-help" />
                               <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black text-white text-xs p-2 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                                 {entry.notes}
                                 <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black"></div>
                               </div>
                             </div>
                           )}
                         </div>
                      </td>
                      <td className="border border-black p-2 text-gray-800 font-medium">{entry.customer}</td>
                      {canAssignEmployee && (
                        <td className="border border-black p-2 text-gray-600 text-xs">{entry.assignedEmployee || '—'}</td>
                      )}
                      <td className="border border-black p-1">
                        {canManageEntry(entry) && (
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={isPastDayForEmployee}
                            className={cn(
                              "text-gray-400 flex justify-center w-full",
                              isPastDayForEmployee ? "opacity-60 cursor-not-allowed" : "hover:text-red-500"
                            )}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}

                {/* Input Row */}
                <tr className="bg-yellow-50">
                  <td className="border border-black p-2 text-center text-gray-400">#</td>
                  <td className="border border-black p-2">
                    <SearchableCombobox
                      value={newEntry.procedureName || ''}
                      onValueChange={handleProcedureNameChange}
                      options={procedureTypeOptions}
                      placeholder={t('procedures.placeholders.procedureName')}
                      searchPlaceholder={t('procedures.searchProcedureType')}
                      emptyText={t('procedures.noProcedureTypesFound')}
                      disabled={isPastDayForEmployee}
                      labelDir="rtl"
                      footerAction={{
                        label: t('procedures.addNewType'),
                        onSelect: openAddCategoryModal,
                      }}
                    />
                  </td>
                  <td className="border border-black p-2">
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      className="w-full bg-transparent outline-none text-center placeholder:text-gray-400"
                      value={newEntry.sales}
                      onChange={(e) => handleNumberChange('sales')(e.target.value)}
                      disabled={isPastDayForEmployee}
                    />
                  </td>
                  <td className="border border-black p-2">
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      className="w-full bg-transparent outline-none text-center placeholder:text-gray-400"
                      value={isCustomerCardSelected ? 0 : newEntry.cost}
                      onChange={(e) => handleNumberChange('cost')(e.target.value)}
                      disabled={isPastDayForEmployee || isCustomerCardSelected}
                    />
                  </td>
                  <td className="border border-black p-2">
                    <select
                      className="w-full bg-transparent outline-none text-center text-sm text-gray-700"
                      value={newEntry.cashOutType || ''}
                      onChange={(e) => {
                        const selected = e.target.value;
                        setNewEntry((prev) => ({
                          ...prev,
                          cashOutType: selected,
                          cost: selected === CUSTOMER_CARD_ID ? 0 : prev.cost,
                        }));
                      }}
                      disabled={isPastDayForEmployee}
                    >
                      <option value="">{t('procedures.placeholders.type')}</option>
                      {cashOutOptions.map((option) => (
                        <option key={`out-${option.id}`} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-black p-2">
                    <input
                      type="text"
                      placeholder={t('procedures.placeholders.details')}
                      className="w-full bg-transparent outline-none text-right placeholder:text-gray-400"
                      dir="rtl"
                      value={newEntry.description}
                      onChange={(e) => handleDescriptionChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddEntry();
                      }}
                      disabled={isPastDayForEmployee}
                    />
                  </td>
                  <td className="border border-black p-2 text-center text-gray-400 text-xs">
                    {t('status.submittedUi')}
                  </td>
                  <td className="border border-black p-2">
                    <input
                      type="text"
                      placeholder={t('procedures.placeholders.customer')}
                      className="w-full bg-transparent outline-none text-center placeholder:text-gray-400"
                      value={newEntry.customer}
                      onChange={(e) => setNewEntry({ ...newEntry, customer: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddEntry();
                      }}
                      list="customer-options"
                      disabled={isPastDayForEmployee}
                    />
                    <datalist id="customer-options">
                      {customerOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </td>
                  {canAssignEmployee && (
                    <td className="border border-black p-2">
                      <select
                        className="w-full bg-transparent outline-none text-center text-xs text-gray-700"
                        value={newEntry.assignedEmployeeId || ''}
                        onChange={(e) => setNewEntry({ ...newEntry, assignedEmployeeId: e.target.value })}
                        disabled={isPastDayForEmployee}
                      >
                        <option value="">{t('procedures.unassigned')}</option>
                        {assignableEmployees.map((emp) => (
                          <option key={emp.userId} value={emp.userId}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="border border-black p-1 text-center">
                    <button 
                      onClick={handleAddEntry}
                      disabled={isPastDayForEmployee}
                      className={cn(
                        "p-1 rounded flex items-center justify-center w-full h-full",
                        isPastDayForEmployee
                          ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                          : "bg-black text-white hover:bg-gray-800"
                      )}
                    >
                      <Plus className="size-4" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {t('procedures.serialNote')}
          </p>
          {addError && (
            <p className="mt-2 text-xs text-red-600">{addError}</p>
          )}
        </div>

        {/* Status Cards Footer */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pb-6">
          <StatusCard
            label={t('status.submittedUi')}
            count={counts.Submitted}
            active={statusFilter === 'Submitted'}
            onClick={() => setStatusFilter('Submitted')}
            onDoubleClick={() => setStatusFilter(null)}
          />
          <StatusCard
            label={t('status.inProcessUi')}
            count={counts['In Process']}
            active={statusFilter === 'In Process'}
            onClick={() => setStatusFilter('In Process')}
            onDoubleClick={() => setStatusFilter(null)}
          />
          <StatusCard
            label={t('status.needInfoUi')}
            count={counts['Need Information']}
            active={statusFilter === 'Need Information'}
            onClick={() => setStatusFilter('Need Information')}
            onDoubleClick={() => setStatusFilter(null)}
          />
          <StatusCard
            label={t('status.completedUi')}
            count={counts.Completed}
            active={statusFilter === 'Completed'}
            onClick={() => setStatusFilter('Completed')}
            onDoubleClick={() => setStatusFilter(null)}
          />
          <StatusCard
            label={t('status.rejectedUi')}
            count={counts.Rejected}
            active={statusFilter === 'Rejected'}
            onClick={() => setStatusFilter('Rejected')}
            onDoubleClick={() => setStatusFilter(null)}
          />
        </div>
        <p className="text-xs text-gray-500 text-center -mt-2 pb-6">
          {t('procedures.monthlyCountsHint')}
        </p>
      </div>

      {/* Update Status Modal */}
      <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
            <DialogTitle>{t('procedures.updateStatusTitle')}</DialogTitle>
                          <DialogDescription>
              {t('procedures.updateStatusDesc')}
                          </DialogDescription>
                        </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('procedures.status')}</label>
              <select 
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as DiaryStatus)}
              >
                <option value="Submitted">{t('status.submittedUi')}</option>
                <option value="In Process">{t('status.inProcessUi')}</option>
                <option value="Need Information">{t('status.needInfoUi')}</option>
                <option value="Completed">{t('status.completedUi')}</option>
                <option value="Rejected">{t('status.rejectedUi')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('procedures.notes')}</label>
              <textarea 
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[100px]"
                placeholder={t('procedures.notesPlaceholder')}
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
              />
            </div>
            {canAssignEmployee && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('procedures.table.assignedEmployee')}</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={statusAssigneeId}
                  onChange={(e) => setStatusAssigneeId(e.target.value)}
                >
                  <option value="">{t('procedures.unassigned')}</option>
                  {assignableEmployees.map((emp) => (
                    <option key={emp.userId} value={emp.userId}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            </div>
          <DialogFooter>
            <button 
              onClick={handleUpdateStatus}
              className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-900"
            >
              {t('procedures.updateStatus')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add new procedure type modal */}
      <Dialog open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('procedures.addNewTypeTitle') || 'Add new procedure type'}</DialogTitle>
            <DialogDescription>
              {t('procedures.addNewTypeDesc') || 'Enter the name of the procedure type. It will appear in the procedure list.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('procedures.categoryName') || 'Name'}</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder={t('procedures.placeholders.procedureName') || 'e.g. إقامة وهويّة'}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategorySubmit()}
                dir="rtl"
                autoFocus
              />
            </div>
            {addCategoryError && (
              <p className="text-sm text-red-600">{addCategoryError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose className="rounded-md px-4 py-2 text-sm border border-gray-300 hover:bg-gray-50">
              {t('common.cancel') || 'Cancel'}
            </DialogClose>
            <button
              onClick={handleAddCategorySubmit}
              className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-900"
            >
              {t('procedures.addNewType') || 'Add procedure type'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCard({
  label,
  count,
  active,
  onClick,
  onDoubleClick,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <button
      data-status-card="true"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "bg-white p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow text-left flex flex-col justify-between h-32 group",
        active ? "border-blue-500 ring-1 ring-blue-200" : "border-gray-200"
      )}
    >
      <span className="font-medium text-gray-700 group-hover:text-black">{label}</span>
      <span className="text-3xl font-bold text-black">{count}</span>
    </button>
  );
}
