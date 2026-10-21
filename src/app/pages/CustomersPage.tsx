import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  User, 
  Building2, 
  Phone, 
  Calendar,
  FileText,
  Upload,
  CreditCard,
  Clock,
  ArrowLeft,
  Eye,
  Mail,
  AlertCircle,
  Pencil,
  Trash2,
  UserRound
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { CustomerAreaNav } from '@/app/components/customers/CustomerAreaNav';
import { ImportWorkersModal } from '@/app/components/customers/ImportWorkersModal';
import { useAuth } from '@/app/contexts/AuthContext';
import { useData } from '@/app/contexts/DataContext';
import { API_BASE, getJson, postForm, postJson, patchJson, deleteJson } from '@/app/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { format, differenceInDays, parseISO } from 'date-fns';

// Types
type Worker = {
  id: string;
  name: string;
  residencyExpiry: string;
  noHealthInsurance?: boolean;
  insuranceExpiry: string;
};

type CompanyDocument = {
  name: string;
  expiry: string;
};

type CustomerDocument = {
  id: string;
  name: string;
  url: string;
};

type CustomerRecord = {
  id: string;
  type: 'Individual' | 'Company';
  name: string; // Company Name or Individual Name
  contact1: string;
  contact2?: string;
  email?: string;
  
  // Individual Specific
  emiratesId?: string;
  visaExpiry?: string;
  insuranceExpiry?: string;
  
  // Company Specific
  tradeLicenseId?: string;
  licenseExpiry?: string;
  establishmentCardExpiry?: string;
  workersExpiry?: string;
  echannelExpiry?: string;
  echannelEmail?: string;
  echannelPassword?: string;
  noHealthInsurance?: boolean;
  healthInsuranceExpiry?: string;
  
  // Common
  balance: number;
  debtStatus: 'Clear' | 'In Debt' | 'Credit';
  lastActivity: string;
  
  // Relations
  workers: Worker[];
};

/** Normalize pasted text to yyyy-MM-dd for controlled <input type="date" /> fields */
function normalizePastedDateToIso(raw: string): string | null {
  const t = raw.trim().replace(/[\u200e\u200f]/g, '');
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function customerMatchesListSearch(customer: CustomerRecord, rawQuery: string): boolean {
  const q = rawQuery.trim();
  if (!q) return true;
  const qLower = q.toLocaleLowerCase();
  const fields = [
    customer.name,
    customer.contact1,
    customer.contact2,
    customer.email,
    customer.emiratesId,
    customer.tradeLicenseId,
  ];
  return fields.some((value) => {
    if (!value) return false;
    return value.includes(q) || value.toLocaleLowerCase().includes(qLower);
  });
}

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customers, addCustomer, updateCustomer, removeCustomer, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['customers']);
  }, [ensureLoaded]);

  const [activeTab, setActiveTab] = useState<'Individual' | 'Company'>('Individual');
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [deleteConfirmCustomerId, setDeleteConfirmCustomerId] = useState<string | null>(null);
  const [viewingCustomerId, setViewingCustomerId] = useState<string | null>(null);
  const [viewingIndividualId, setViewingIndividualId] = useState<string | null>(null);
  const [companyEmployees, setCompanyEmployees] = useState<Record<string, Worker[]>>({});
  const [companyDocuments, setCompanyDocuments] = useState<Record<string, CustomerDocument[]>>({});
  const [individualDocuments, setIndividualDocuments] = useState<Record<string, CustomerDocument[]>>({});
  const [documentsLoading, setDocumentsLoading] = useState(false);
  
  // Customer Form State
  const [newCustomer, setNewCustomer] = useState<Partial<CustomerRecord>>({
    type: 'Individual'
  });

  // Worker Form State
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
  const [isWorkerImportOpen, setIsWorkerImportOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [deleteConfirmWorkerId, setDeleteConfirmWorkerId] = useState<string | null>(null);
  const [newWorker, setNewWorker] = useState<Partial<Worker>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [customerSaveError, setCustomerSaveError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const handleCustomerDatePaste =
    (
      field:
        | 'visaExpiry'
        | 'insuranceExpiry'
        | 'licenseExpiry'
        | 'establishmentCardExpiry'
        | 'workersExpiry'
        | 'healthInsuranceExpiry'
        | 'echannelExpiry'
    ) =>
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const iso = normalizePastedDateToIso(e.clipboardData.getData('text/plain'));
      if (iso) {
        e.preventDefault();
        setNewCustomer((prev) => ({ ...prev, [field]: iso }));
      }
    };

  const mapDebtStatus = (status: string) => {
    if (status === 'warning') return 'In Debt';
    if (status === 'exceeded') return 'Credit';
    return 'Clear';
  };

  const mapCustomer = (customer: any): CustomerRecord => ({
    id: customer.id,
    type: customer.type === 'company' ? 'Company' : 'Individual',
    name: customer.companyName || customer.name,
    contact1: customer.phone,
    contact2: customer.phoneSecondary || '',
    email: customer.email || '',
    emiratesId: customer.emiratesId || '',
    visaExpiry: customer.visaExpiry || '',
    tradeLicenseId: customer.tradeLicense || '',
    licenseExpiry: customer.licenseExpiry || '',
    establishmentCardExpiry: customer.establishmentCardExpiry || '',
    workersExpiry: customer.workersExpiry || '',
    echannelExpiry: customer.echannelExpiry || '',
    echannelEmail: customer.echannelEmail || '',
    echannelPassword: customer.echannelPassword || '',
    noHealthInsurance: customer.noHealthInsurance ?? false,
    healthInsuranceExpiry: customer.healthInsuranceExpiry || '',
    balance: Number(customer.balance || 0),
    debtStatus: mapDebtStatus(customer.debtStatus || 'clear'),
    lastActivity: customer.lastActivity || '',
    workers: [],
  });

  const customersUi = useMemo(() => customers.map(mapCustomer), [customers]);

  const filteredCustomers = customersUi.filter(c => c.type === activeTab);

  const displayCustomers = useMemo(() => {
    if (!listSearchQuery.trim()) return filteredCustomers;
    return filteredCustomers.filter((c) => customerMatchesListSearch(c, listSearchQuery));
  }, [filteredCustomers, listSearchQuery]);

  const viewingCustomer = useMemo(() => {
    if (!viewingCustomerId) return null;
    return customersUi.find((item) => item.id === viewingCustomerId) || null;
  }, [customersUi, viewingCustomerId]);

  const viewingIndividual = useMemo(() => {
    if (!viewingIndividualId) return null;
    return customersUi.find((item) => item.id === viewingIndividualId) || null;
  }, [customersUi, viewingIndividualId]);

  const getCompanyDocuments = (customer: CustomerRecord): CompanyDocument[] => {
    const docs: CompanyDocument[] = [
      { name: 'Trade License', expiry: customer.licenseExpiry || '' },
      { name: 'Establishment Card', expiry: customer.establishmentCardExpiry || '' },
      { name: 'Workers Expiry', expiry: customer.workersExpiry || '' },
      { name: 'Echannel Expiry', expiry: customer.echannelExpiry || '' },
    ];
    if (!customer.noHealthInsurance) {
      docs.push({ name: 'Health Insurance Expiry', expiry: customer.healthInsuranceExpiry || '' });
    }
    return docs;
  };

  const handleSaveCustomer = async () => {
    if (isSavingCustomer) return;
    if (!newCustomer.name?.trim() || !newCustomer.type) return;
    setCustomerSaveError(null);
    setIsSavingCustomer(true);

    try {
      if (editingCustomerId) {
        const existing = customersUi.find((c) => c.id === editingCustomerId);
        await updateCustomer(editingCustomerId, {
          type: newCustomer.type === 'Company' ? 'company' : 'individual',
          name: newCustomer.name,
          companyName: newCustomer.type === 'Company' ? newCustomer.name : undefined,
          phone: newCustomer.contact1?.trim() || '',
          phoneSecondary: newCustomer.contact2 || undefined,
          email: newCustomer.email || undefined,
          emiratesId: newCustomer.emiratesId || undefined,
          tradeLicense: newCustomer.tradeLicenseId || undefined,
          licenseExpiry: newCustomer.licenseExpiry || undefined,
          establishmentCardExpiry: newCustomer.establishmentCardExpiry || undefined,
          workersExpiry: newCustomer.workersExpiry || undefined,
          echannelExpiry: newCustomer.echannelExpiry || undefined,
          echannelEmail: newCustomer.echannelEmail || undefined,
          echannelPassword: newCustomer.echannelPassword || undefined,
          noHealthInsurance: newCustomer.noHealthInsurance,
          healthInsuranceExpiry: newCustomer.noHealthInsurance ? undefined : (newCustomer.healthInsuranceExpiry || undefined),
          visaExpiry: newCustomer.visaExpiry || undefined,
          balance: existing?.balance ?? 0,
          debtStatus: existing?.debtStatus === 'In Debt' ? 'warning' : existing?.debtStatus === 'Credit' ? 'exceeded' : 'clear',
          lastActivity: existing?.lastActivity ?? format(new Date(), 'yyyy-MM-dd'),
        });
        setEditingCustomerId(null);
        setNewCustomer({ type: activeTab });
        setIsModalOpen(false);
      } else {
        const created = await addCustomer({
          type: newCustomer.type === 'Company' ? 'company' : 'individual',
          name: newCustomer.name,
          companyName: newCustomer.type === 'Company' ? newCustomer.name : undefined,
          phone: newCustomer.contact1?.trim() || '',
          phoneSecondary: newCustomer.contact2 || undefined,
          email: newCustomer.email || undefined,
          emiratesId: newCustomer.emiratesId || undefined,
          tradeLicense: newCustomer.tradeLicenseId || undefined,
          licenseExpiry: newCustomer.licenseExpiry || undefined,
          establishmentCardExpiry: newCustomer.establishmentCardExpiry || undefined,
          workersExpiry: newCustomer.workersExpiry || undefined,
          echannelExpiry: newCustomer.echannelExpiry || undefined,
          echannelEmail: newCustomer.echannelEmail || undefined,
          echannelPassword: newCustomer.echannelPassword || undefined,
          noHealthInsurance: newCustomer.noHealthInsurance,
          healthInsuranceExpiry: newCustomer.noHealthInsurance ? undefined : (newCustomer.healthInsuranceExpiry || undefined),
          visaExpiry: newCustomer.visaExpiry || undefined,
          balance: 0,
          debtStatus: 'clear',
          lastActivity: format(new Date(), 'yyyy-MM-dd'),
        });
        if (attachments.length) {
          await Promise.all(
            attachments.map((file) => {
              const formData = new FormData();
              formData.append('customer', created.id);
              formData.append('file', file);
              formData.append('original_name', file.name);
              return postForm('/documents/', formData);
            })
          );
          setAttachments([]);
          if (attachmentInputRef.current) {
            attachmentInputRef.current.value = '';
          }
        }
        setNewCustomer({ type: activeTab });
        setIsModalOpen(false);
      }
    } catch {
      setCustomerSaveError(
        editingCustomerId
          ? (t('customers.updateFailed') || 'Unable to update customer. Please check the entered fields and try again.')
          : (t('customers.saveFailed') || 'Unable to save customer. Please check the entered fields and try again.')
      );
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleOpenEditCustomer = (customer: CustomerRecord) => {
    setCustomerSaveError(null);
    setNewCustomer({
      type: customer.type,
      name: customer.name,
      contact1: customer.contact1,
      contact2: customer.contact2,
      email: customer.email,
      emiratesId: customer.emiratesId,
      visaExpiry: customer.visaExpiry,
      insuranceExpiry: customer.insuranceExpiry,
      tradeLicenseId: customer.tradeLicenseId,
      licenseExpiry: customer.licenseExpiry,
      establishmentCardExpiry: customer.establishmentCardExpiry,
      workersExpiry: customer.workersExpiry,
      echannelExpiry: customer.echannelExpiry,
      echannelEmail: customer.echannelEmail,
      echannelPassword: customer.echannelPassword,
      noHealthInsurance: customer.noHealthInsurance,
      healthInsuranceExpiry: customer.healthInsuranceExpiry,
    });
    setEditingCustomerId(customer.id);
    setIsModalOpen(true);
  };

  const handleConfirmDeleteCustomer = (customer: CustomerRecord) => {
    setDeleteConfirmCustomerId(customer.id);
  };

  const handleDeleteCustomer = () => {
    if (!deleteConfirmCustomerId) return;
    removeCustomer(deleteConfirmCustomerId);
    if (viewingCustomerId === deleteConfirmCustomerId) setViewingCustomerId(null);
    if (viewingIndividualId === deleteConfirmCustomerId) setViewingIndividualId(null);
    setDeleteConfirmCustomerId(null);
  };

  const handleSaveWorker = () => {
    if (!viewingCustomer || !newWorker.name || !newWorker.residencyExpiry) return;
    const noHealthInsurance = !!newWorker.noHealthInsurance;
    if (!noHealthInsurance && !newWorker.insuranceExpiry) return;

    const payload = {
      name: newWorker.name,
      residency_expiry: newWorker.residencyExpiry,
      no_health_insurance: noHealthInsurance,
      insurance_expiry: noHealthInsurance ? null : (newWorker.insuranceExpiry || null),
    };

    if (editingWorker) {
      patchJson<any>(`/company-employees/${editingWorker.id}/`, payload).then(() => {
        loadCompanyEmployees(viewingCustomer.id);
        setEditingWorker(null);
        setNewWorker({});
        setIsWorkerModalOpen(false);
      });
    } else {
      postJson<any>('/company-employees/', { company: viewingCustomer.id, ...payload }).then((res) => {
        const worker: Worker = {
          id: res.id,
          name: res.name,
          residencyExpiry: res.residency_expiry,
          noHealthInsurance: !!res.no_health_insurance,
          insuranceExpiry: res.insurance_expiry || '',
        };
        setCompanyEmployees((prev) => ({
          ...prev,
          [viewingCustomer.id]: [...(prev[viewingCustomer.id] || []), worker],
        }));
        setNewWorker({});
        setIsWorkerModalOpen(false);
      });
    }
  };

  const handleOpenEditWorker = (worker: Worker) => {
    setNewWorker({
      name: worker.name,
      residencyExpiry: worker.residencyExpiry,
      noHealthInsurance: worker.noHealthInsurance,
      insuranceExpiry: worker.insuranceExpiry,
    });
    setEditingWorker(worker);
    setIsWorkerModalOpen(true);
  };

  const handleDeleteWorker = () => {
    if (!deleteConfirmWorkerId || !viewingCustomer) return;
    deleteJson(`/company-employees/${deleteConfirmWorkerId}/`).then(() => {
      loadCompanyEmployees(viewingCustomer.id);
      setDeleteConfirmWorkerId(null);
    });
  };

  const loadCompanyEmployees = async (companyId: string) => {
    const data = await getJson<any>('/company-employees/');
    const list = Array.isArray(data) ? data : data?.results || [];
    const workers = list
      .filter((item: { company?: string }) => item.company === companyId)
      .map((item: { id: string; name: string; residency_expiry?: string; no_health_insurance?: boolean; insurance_expiry?: string }) => ({
        id: item.id,
        name: item.name,
        residencyExpiry: item.residency_expiry || '',
        noHealthInsurance: !!item.no_health_insurance,
        insuranceExpiry: item.insurance_expiry || '',
      }));
    setCompanyEmployees((prev) => ({
      ...prev,
      [companyId]: workers,
    }));
  };

  const resolveFileUrl = (fileUrl: string) => {
    if (!fileUrl) return '';
    const origin = API_BASE.replace(/\/api\/?$/, '');
    if (fileUrl.startsWith('http')) return fileUrl;
    if (fileUrl.startsWith('/')) return `${origin}${fileUrl}`;
    return `${origin}/${fileUrl}`;
  };

  const loadCompanyDocuments = async (companyId: string) => {
    setDocumentsLoading(true);
    try {
      const docs = await getJson<any>(`/documents/?customer=${companyId}`);
      const list = Array.isArray(docs) ? docs : docs?.results || [];
      const mapped: CustomerDocument[] = list.map((doc: any) => ({
        id: doc.id,
        name: doc.original_name || (doc.file || '').split('/').pop() || 'document',
        url: doc.file,
      }));
      setCompanyDocuments((prev) => ({
        ...prev,
        [companyId]: mapped,
      }));
    } finally {
      setDocumentsLoading(false);
    }
  };

  const loadIndividualDocuments = async (customerId: string) => {
    setDocumentsLoading(true);
    try {
      const docs = await getJson<any>(`/documents/?customer=${customerId}`);
      const list = Array.isArray(docs) ? docs : docs?.results || [];
      const mapped: CustomerDocument[] = list.map((doc: any) => ({
        id: doc.id,
        name: doc.original_name || (doc.file || '').split('/').pop() || 'document',
        url: doc.file,
      }));
      setIndividualDocuments((prev) => ({
        ...prev,
        [customerId]: mapped,
      }));
    } finally {
      setDocumentsLoading(false);
    }
  };

  const downloadDocument = async (doc: CustomerDocument) => {
    const url = resolveFileUrl(doc.url);
    if (!url) return;
    const token = localStorage.getItem('accessToken');
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = doc.name || 'document';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const downloadAllDocuments = async (companyId: string, fileName?: string) => {
    const token = localStorage.getItem('accessToken');
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/zip/${companyId}/`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const fileBase = (fileName || companyId).replace(/[\\/:*?"<>|]+/g, '_').trim() || companyId;
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${fileBase}-documents.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  // --- Detailed View Component ---
  if (viewingCustomer) {
    const today = new Date();
    const workers = companyEmployees[viewingCustomer.id] || [];
    const expiryDocuments = getCompanyDocuments(viewingCustomer);
    const attachments = companyDocuments[viewingCustomer.id] || [];
    
    const getDaysRemaining = (dateStr?: string) => {
      if (!dateStr) return '-';
      try {
        const days = differenceInDays(parseISO(dateStr), today);
        return days;
      } catch (e) {
        return '-';
      }
    };

    return (
      <div className="flex flex-col h-full bg-gray-50/50">
        <div className="flex items-center gap-4 mb-6">
          <button 
            onClick={() => setViewingCustomerId(null)}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors"
          >
            <ArrowLeft className="size-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{viewingCustomer.name}</h1>
            <p className="text-gray-500 text-sm flex items-center gap-2">
              <Calendar className="size-3" />
              {format(today, 'dd/MM/yyyy')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Contact Info Card */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <User className="size-4 text-gray-500" /> Contact Details
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-500">Phone 1</span>
                <span className="font-medium">{viewingCustomer.contact1}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-50">
                <span className="text-gray-500">Phone 2</span>
                <span className="font-medium">{viewingCustomer.contact2 || '-'}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Email</span>
                <span className="font-medium">{viewingCustomer.email || '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-gray-50">
                <span className="text-gray-500">Echannel Email</span>
                <span className="font-medium">{viewingCustomer.echannelEmail || '-'}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Echannel Password</span>
                <span className="font-medium">{viewingCustomer.echannelPassword || '-'}</span>
              </div>
            </div>
          </div>

          {/* Company Documents Table - Takes up 2 cols */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
               <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <FileText className="size-4 text-gray-500" /> Company Documents
              </h3>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 font-medium text-xs uppercase">
                <tr>
                  <th className="px-6 py-3">{t('customers.documents.name')}</th>
                  <th className="px-6 py-3">{t('customers.documents.expiryDate')}</th>
                  <th className="px-6 py-3 text-right">{t('customers.documents.daysRemaining')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expiryDocuments.length > 0 ? (
                  expiryDocuments.map((doc, idx) => {
                    const days = getDaysRemaining(doc.expiry);
                    const isUrgent = typeof days === 'number' && days < 30;
                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium text-gray-900">{doc.name}</td>
                        <td className="px-6 py-3 text-gray-500">{doc.expiry ? format(parseISO(doc.expiry), 'dd/MM/yyyy') : '-'}</td>
                        <td className="px-6 py-3 text-right">
                          <span className={cn(
                            "px-2 py-1 rounded text-xs font-bold",
                            isUrgent ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                          )}>
                            {days} Days
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-gray-400">No documents found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <FileText className="size-4 text-gray-500" /> Attached Documents
            </h3>
            <button
              onClick={() => downloadAllDocuments(viewingCustomer.id, viewingCustomer.name)}
              disabled={!attachments.length}
              className="text-xs bg-black text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
            >
              Download All
            </button>
          </div>
          {documentsLoading ? (
            <p className="text-sm text-gray-500">Loading documents...</p>
          ) : attachments.length ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => downloadDocument(doc)}
                  className="px-3 py-1 rounded-full bg-gray-100 text-xs text-gray-700 hover:bg-gray-200"
                >
                  {doc.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No documents uploaded.</p>
          )}
        </div>

        {/* Workers Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
             <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <UsersIcon className="size-4 text-gray-500" /> Workers List
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsWorkerImportOpen(true)}
                className="text-xs border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded-md font-medium hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
              >
                <Upload className="size-3.5" />
                {t('customers.workers.importWorkers')}
              </button>
            <Dialog open={isWorkerModalOpen} onOpenChange={(open) => { setIsWorkerModalOpen(open); if (!open) setEditingWorker(null); }}>
              <DialogTrigger asChild>
                <button
                  onClick={() => { setEditingWorker(null); setNewWorker({}); }}
                  className="text-xs bg-black text-white px-3 py-1.5 rounded-md font-medium hover:bg-gray-800 transition-colors"
                >
                  Add Worker
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>{editingWorker ? (t('customers.workers.editWorker') || 'Edit worker') : t('customers.workers.addWorker')}</DialogTitle>
                  <DialogDescription>
                    {editingWorker ? 'Update worker details.' : `Enter worker details for ${viewingCustomer.name}`}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <label className="text-right text-sm font-medium">Name</label>
                    <input
                      className="col-span-3 border rounded-md px-3 py-2 text-sm"
                      placeholder="Worker Name"
                      value={newWorker.name || ''}
                      onChange={(e) => setNewWorker({...newWorker, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <label className="text-right text-sm font-medium">Visa Expiry</label>
                    <input
                      type="date"
                      className="col-span-3 border rounded-md px-3 py-2 text-sm"
                      value={newWorker.residencyExpiry || ''}
                      onChange={(e) => setNewWorker({...newWorker, residencyExpiry: e.target.value})}
                    />
                  </div>
                  {!newWorker.noHealthInsurance && (
                    <div className="grid grid-cols-4 items-center gap-4">
                      <label className="text-right text-sm font-medium">Ins. Expiry</label>
                      <input
                        type="date"
                        className="col-span-3 border rounded-md px-3 py-2 text-sm"
                        value={newWorker.insuranceExpiry || ''}
                        onChange={(e) => setNewWorker({...newWorker, insuranceExpiry: e.target.value})}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="worker-no-health-insurance"
                      checked={!!newWorker.noHealthInsurance}
                      onChange={(e) => setNewWorker({...newWorker, noHealthInsurance: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="worker-no-health-insurance" className="text-sm text-gray-700">{t('customers.workers.noHealthInsurance')}</label>
                  </div>
                </div>
                <DialogFooter>
                  <button 
                    onClick={handleSaveWorker}
                    className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-900"
                  >
                    {editingWorker ? (t('common.update') || 'Update') : 'Save Worker'}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 font-medium text-xs uppercase">
                <tr>
                  <th className="px-6 py-3">{t('customers.workers.name')}</th>
                  <th className="px-6 py-3 border-l border-gray-200 text-center" colSpan={2}>{t('customers.workers.residencyVisa')}</th>
                  <th className="px-6 py-3 border-l border-gray-200 text-center" colSpan={2}>{t('customers.workers.insurance')}</th>
                  <th className="px-6 py-3 border-l border-gray-200 text-right w-24">{t('customers.table.actions')}</th>
                </tr>
                <tr className="border-t border-gray-200 bg-gray-100/50">
                  <th className="px-6 py-2"></th>
                  <th className="px-6 py-2 text-gray-400 border-l border-gray-200 text-xs font-normal">{t('customers.workers.expiryDate')}</th>
                  <th className="px-6 py-2 text-gray-400 text-xs font-normal text-right">{t('customers.workers.daysLeft')}</th>
                  <th className="px-6 py-2 text-gray-400 border-l border-gray-200 text-xs font-normal">{t('customers.workers.expiryDate')}</th>
                  <th className="px-6 py-2 text-gray-400 text-xs font-normal text-right">{t('customers.workers.daysLeft')}</th>
                  <th className="px-6 py-2 border-l border-gray-200"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {workers.length > 0 ? (
                  workers.map((worker) => {
                    const resDays = getDaysRemaining(worker.residencyExpiry);
                    const insDays = getDaysRemaining(worker.insuranceExpiry);
                    
                    return (
                      <tr key={worker.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium text-gray-900">{worker.name}</td>
                        
                        {/* Residency */}
                        <td className="px-6 py-3 text-gray-500 border-l border-gray-100">
                          {worker.residencyExpiry ? format(parseISO(worker.residencyExpiry), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={cn(
                             "px-2 py-0.5 rounded text-xs font-medium",
                             (typeof resDays === 'number' && resDays < 60) ? "text-red-600 bg-red-50" : "text-gray-600"
                          )}>
                            {resDays}
                          </span>
                        </td>

                        {/* Insurance */}
                        <td className="px-6 py-3 text-gray-500 border-l border-gray-100">
                           {worker.noHealthInsurance ? '-' : (worker.insuranceExpiry ? format(parseISO(worker.insuranceExpiry), 'dd/MM/yyyy') : '-')}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={cn(
                             "px-2 py-0.5 rounded text-xs font-medium",
                             (typeof insDays === 'number' && insDays < 60) ? "text-red-600 bg-red-50" : "text-gray-600"
                          )}>
                            {worker.noHealthInsurance ? '-' : insDays}
                          </span>
                        </td>
                        <td className="px-6 py-3 border-l border-gray-100 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEditWorker(worker)}
                              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                              title={t('common.edit') || 'Edit'}
                            >
                              <Pencil className="size-4" />
                            </button>
                            {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee') && (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmWorkerId(worker.id)}
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                                title={t('common.delete') || 'Delete'}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No workers recorded</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delete worker confirmation */}
        <Dialog open={!!deleteConfirmWorkerId} onOpenChange={(open) => !open && setDeleteConfirmWorkerId(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('customers.workers.deleteConfirmTitle') || 'Delete worker?'}</DialogTitle>
              <DialogDescription>
                {t('customers.workers.deleteConfirmDesc') || 'This worker will be removed from the list.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose className="px-4 py-2 rounded-md border border-gray-200 hover:bg-gray-50">
                {t('common.cancel') || 'Cancel'}
              </DialogClose>
              <button
                onClick={handleDeleteWorker}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {t('common.delete') || 'Delete'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ImportWorkersModal
          customerId={viewingCustomer.id}
          customerName={viewingCustomer.name}
          open={isWorkerImportOpen}
          onClose={() => setIsWorkerImportOpen(false)}
          onImported={() => loadCompanyEmployees(viewingCustomer.id)}
        />
      </div>
    );
  }

  // --- Main List View ---
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500">Manage your client database</p>
        </div>
        
        <Dialog
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open) {
              setEditingCustomerId(null);
              setCustomerSaveError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <button 
              onClick={() => { setEditingCustomerId(null); setCustomerSaveError(null); setNewCustomer({ type: activeTab }); }}
              className="bg-black text-white px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-gray-800 transition-colors shadow-sm"
            >
              <Plus className="size-4" />
          Add Customer
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl gap-0 p-0 overflow-hidden bg-white [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
            <DialogHeader className="p-6 pb-2">
              <DialogTitle className="text-xl font-bold">
                {editingCustomerId ? (t('customers.editCustomer') || 'Edit customer') : t('customers.addCustomer')}
              </DialogTitle>
              <DialogDescription>
                {editingCustomerId ? 'Update customer details.' : 'Enter customer details and required documents.'}
              </DialogDescription>
            </DialogHeader>

            <div className="p-6 pt-2 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900">Customer Type</label>
                <div className="relative">
                  <select 
                    className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm appearance-none outline-none focus:ring-1 focus:ring-black"
                    value={newCustomer.type}
                    onChange={e => setNewCustomer({...newCustomer, type: e.target.value as any})}
                  >
                    <option value="Individual">Individual</option>
                    <option value="Company">Company</option>
                  </select>
                  <div className="absolute right-3 top-2.5 pointer-events-none">
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L5 5L9 1" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>

              {newCustomer.type === 'Individual' ? (
                // INDIVIDUAL FORM
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Name</label>
                      <input 
                        type="text"
                        placeholder="Full name"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.name || ''}
                        onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Contact Number 1</label>
                      <input 
                        type="text"
                        placeholder="+9715XXXXXXXX"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.contact1 || ''}
                        onChange={e => setNewCustomer({...newCustomer, contact1: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-900">Contact Number 2</label>
                    <input 
                      type="text"
                      placeholder="+9715XXXXXXXX"
                      className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                      value={newCustomer.contact2 || ''}
                      onChange={e => setNewCustomer({...newCustomer, contact2: e.target.value})}
                    />
      </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Visa Expiry Date</label>
                      <div className="relative">
                        <input 
                          type="date"
                          className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                          value={newCustomer.visaExpiry || ''}
                          onChange={e => setNewCustomer({...newCustomer, visaExpiry: e.target.value})}
                          onPaste={handleCustomerDatePaste('visaExpiry')}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Insurance Expiry Date</label>
          <div className="relative">
                        <input 
                          type="date"
                          className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                          value={newCustomer.insuranceExpiry || ''}
                          onChange={e => setNewCustomer({...newCustomer, insuranceExpiry: e.target.value})}
                          onPaste={handleCustomerDatePaste('insuranceExpiry')}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                // COMPANY FORM
                <>
                   <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Company Name</label>
                      <input 
                        type="text"
                        placeholder="Company legal name"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.name || ''}
                        onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Trade License</label>
                      <input 
                        type="text"
                        placeholder="Trade License ID"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.tradeLicenseId || ''}
                        onChange={e => setNewCustomer({...newCustomer, tradeLicenseId: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Contact Number 1</label>
                      <input 
                        type="text"
                        placeholder="+9715XXXXXXXX"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.contact1 || ''}
                        onChange={e => setNewCustomer({...newCustomer, contact1: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-900">Contact Number 2</label>
                      <input 
                        type="text"
                        placeholder="+9715XXXXXXXX"
                        className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-black placeholder:text-gray-400"
                        value={newCustomer.contact2 || ''}
                        onChange={e => setNewCustomer({...newCustomer, contact2: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-bold leading-snug text-gray-900 break-words hyphens-auto">
                        License Expiry
                      </label>
                      <input 
                        type="date"
                        className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                        value={newCustomer.licenseExpiry || ''}
                        onChange={e => setNewCustomer({...newCustomer, licenseExpiry: e.target.value})}
                        onPaste={handleCustomerDatePaste('licenseExpiry')}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-bold leading-snug text-gray-900 break-words hyphens-auto">
                        Establishment Card Expiry
                      </label>
                      <input 
                        type="date"
                        className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                        value={newCustomer.establishmentCardExpiry || ''}
                        onChange={e => setNewCustomer({...newCustomer, establishmentCardExpiry: e.target.value})}
                        onPaste={handleCustomerDatePaste('establishmentCardExpiry')}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-bold leading-snug text-gray-900 break-words hyphens-auto">
                        Workers Expiry
                      </label>
                      <input 
                        type="date"
                        className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                        value={newCustomer.workersExpiry || ''}
                        onChange={e => setNewCustomer({...newCustomer, workersExpiry: e.target.value})}
                        onPaste={handleCustomerDatePaste('workersExpiry')}
                      />
                    </div>
                    {!newCustomer.noHealthInsurance && (
                      <div className="min-w-0 space-y-2">
                        <label className="block text-xs font-bold leading-snug text-gray-900 break-words hyphens-auto">
                          Health Ins. Expiry
                        </label>
                        <input 
                          type="date"
                          className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                          value={newCustomer.healthInsuranceExpiry || ''}
                          onChange={e => setNewCustomer({...newCustomer, healthInsuranceExpiry: e.target.value})}
                          onPaste={handleCustomerDatePaste('healthInsuranceExpiry')}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-bold leading-snug text-gray-900 break-words">Echannel Expiry</label>
                      <input
                        type="date"
                        className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                        value={newCustomer.echannelExpiry || ''}
                        onChange={e => setNewCustomer({...newCustomer, echannelExpiry: e.target.value})}
                        onPaste={handleCustomerDatePaste('echannelExpiry')}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-bold leading-snug text-gray-900 break-words">Echannel Email</label>
                      <input
                        type="email"
                        className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                        placeholder="example@company.com"
                        value={newCustomer.echannelEmail || ''}
                        onChange={e => setNewCustomer({...newCustomer, echannelEmail: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <label className="block text-xs font-bold leading-snug text-gray-900 break-words">Echannel Password</label>
                    <input
                      type="text"
                      className="w-full min-w-0 bg-gray-50 border border-gray-200 rounded-md px-2 py-2 text-xs outline-none focus:ring-1 focus:ring-black"
                      value={newCustomer.echannelPassword || ''}
                      onChange={e => setNewCustomer({...newCustomer, echannelPassword: e.target.value})}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      id="company-no-health-insurance"
                      checked={!!newCustomer.noHealthInsurance}
                      onChange={e => setNewCustomer({...newCustomer, noHealthInsurance: e.target.checked})}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="company-no-health-insurance" className="text-sm text-gray-700">{t('customers.companyNoHealthInsurance')}</label>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900">Customer Documents</label>
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-500 flex items-center gap-2 hover:bg-gray-100 transition-colors"
                >
                  <span className="font-semibold text-gray-900">Choose Files</span>
                  <span>{attachments.length ? `${attachments.length} file(s) selected` : 'No file chosen'}</span>
                </button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => setAttachments(Array.from(e.target.files || []))}
                />
                {!!attachments.length && (
                  <div className="mt-2 space-y-1 text-xs text-gray-500">
                    {attachments.map((file, index) => (
                      <div key={`${file.name}-${index}`}>{file.name}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {customerSaveError && (
              <p className="px-6 pb-2 text-sm text-red-600">{customerSaveError}</p>
            )}

            <DialogFooter className="p-6 border-t bg-gray-50">
              <button 
                onClick={handleSaveCustomer}
                disabled={isSavingCustomer}
                className={cn(
                  "w-full sm:w-auto px-6 py-2 rounded-md text-sm font-medium transition-colors",
                  isSavingCustomer
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-[#0B1120] text-white hover:bg-gray-900"
                )}
              >
                {isSavingCustomer ? "Saving..." : editingCustomerId ? (t('common.update') || "Update") : "Save Customer"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete customer confirmation */}
        <Dialog open={!!deleteConfirmCustomerId} onOpenChange={(open) => !open && setDeleteConfirmCustomerId(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('customers.deleteConfirmTitle') || 'Delete customer?'}</DialogTitle>
              <DialogDescription>
                {t('customers.deleteConfirmDesc') || 'This cannot be undone. All related data (procedures, workers, documents) may be affected.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose className="px-4 py-2 rounded-md border border-gray-200 hover:bg-gray-50">
                {t('common.cancel') || 'Cancel'}
              </DialogClose>
              <button
                onClick={handleDeleteCustomer}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {t('common.delete') || 'Delete'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <CustomerAreaNav />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('Individual')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
            activeTab === 'Individual' 
              ? "bg-white text-gray-900 shadow-sm border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <User className="size-4" />
          Individuals ({customersUi.filter(c => c.type === 'Individual').length})
        </button>
        <button
          onClick={() => setActiveTab('Company')}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
            activeTab === 'Company' 
              ? "bg-white text-gray-900 shadow-sm border border-gray-200" 
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          <Building2 className="size-4" />
          Companies ({customersUi.filter(c => c.type === 'Company').length})
        </button>
      </div>

      {/* Content Table */}
      <div className="bg-white border border-gray-200 rounded-lg flex-1 overflow-hidden flex flex-col shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">
            {activeTab === 'Individual' ? 'Individual Customers' : 'Company Customers'}
          </h3>
          <p className="text-sm text-gray-500">
            {activeTab === 'Individual' ? 'Personal clients and their information' : 'Business clients and corporate information'}
          </p>
          <div className="relative max-w-md mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input
              type="search"
              value={listSearchQuery}
              onChange={(e) => setListSearchQuery(e.target.value)}
              placeholder={t('customers.listSearchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-black transition-all"
              aria-label={t('customers.listSearchPlaceholder')}
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-white text-gray-900 font-bold border-b border-gray-100">
              <tr>
                {activeTab === 'Individual' ? (
                  <>
                    <th className="px-6 py-4">{t('customers.individualTable.name')}</th>
                    <th className="px-6 py-4">{t('customers.individualTable.contacts')}</th>
                    <th className="px-6 py-4">{t('customers.individualTable.emiratesId')}</th>
                    <th className="px-6 py-4">{t('customers.individualTable.balance')}</th>
                    <th className="px-6 py-4">{t('customers.individualTable.debtStatus')}</th>
                    <th className="px-6 py-4">{t('customers.individualTable.lastActivity')}</th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-4">{t('customers.companyTable.companyName')}</th>
                    <th className="px-6 py-4">{t('customers.companyTable.contacts')}</th>
                    <th className="px-6 py-4">{t('customers.companyTable.tradeLicense')}</th>
                    <th className="px-6 py-4">{t('customers.companyTable.licenseExpiry')}</th>
                    <th className="px-6 py-4">{t('customers.companyTable.balance')}</th>
                    <th className="px-6 py-4">{t('customers.companyTable.debtStatus')}</th>
                  </>
                )}
                <th className="px-6 py-4 text-right">{t('customers.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-gray-400 italic">
                    {listSearchQuery.trim()
                      ? t('customers.noSearchResults')
                      : `No ${activeTab.toLowerCase()} customers found.`}
                  </td>
                </tr>
              ) : (
                displayCustomers.map(customer => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition-colors group">
                    {activeTab === 'Individual' ? (
                      <>
                        <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-3">
                          <div className="size-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs">
                            {customer.name.substring(0, 2).toUpperCase()}
                          </div>
                          {customer.name}
                        </td>
                        <td className="px-6 py-4 text-gray-500">
                          <div>{customer.contact1}</div>
                          {customer.contact2 && <div className="text-xs text-gray-400 mt-0.5">{customer.contact2}</div>}
                        </td>
                        <td className="px-6 py-4 text-gray-500 font-mono text-xs">{customer.emiratesId || '-'}</td>
                        <td className="px-6 py-4 font-bold text-gray-900">AED {customer.balance.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded text-xs font-semibold",
                            customer.debtStatus === 'Clear' && "bg-green-100 text-green-700",
                            customer.debtStatus === 'In Debt' && "bg-red-100 text-red-700",
                            customer.debtStatus === 'Credit' && "bg-blue-100 text-blue-700",
                          )}>
                            {customer.debtStatus}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-500 text-xs">
                           <div className="flex items-center gap-1">
                             <Clock className="size-3" />
                             {customer.lastActivity}
                           </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-3">
                          <div className="p-2 rounded bg-blue-50 text-blue-600">
                            <Building2 className="size-4" />
                          </div>
                          {customer.name}
                        </td>
                        <td className="px-6 py-4 text-gray-500">
                          <div>{customer.contact1}</div>
                          {customer.contact2 && <div className="text-xs text-gray-400 mt-0.5">{customer.contact2}</div>}
                        </td>
                        <td className="px-6 py-4 text-gray-500 font-mono text-xs">{customer.tradeLicenseId || '-'}</td>
                        <td className="px-6 py-4 text-gray-500 text-xs">
                           {customer.licenseExpiry ? format(parseISO(customer.licenseExpiry), 'dd/MM/yyyy') : '-'}
                        </td>
                         <td className="px-6 py-4 font-bold text-gray-900">AED {customer.balance.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-1 rounded text-xs font-semibold",
                            customer.debtStatus === 'Clear' && "bg-green-100 text-green-700",
                            customer.debtStatus === 'In Debt' && "bg-red-100 text-red-700",
                            customer.debtStatus === 'Credit' && "bg-blue-100 text-blue-700",
                          )}>
                            {customer.debtStatus}
                          </span>
                        </td>
                      </>
                    )}
                    
                    <td className="px-6 py-4 text-right">
                       <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button
                           onClick={() => navigate(`/customers/${customer.id}`)}
                           className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"
                           title={t('customers.viewProfile')}
                         >
                           <UserRound className="size-5" />
                         </button>
                         {customer.type === 'Company' && (
                           <button 
                            onClick={() => {
                              setViewingCustomerId(customer.id);
                              loadCompanyEmployees(customer.id);
                              loadCompanyDocuments(customer.id);
                            }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded" 
                            title="View Details"
                           >
                             <Eye className="size-5" />
                           </button>
                         )}
                         {customer.type === 'Individual' && (
                           <button
                             onClick={() => {
                               setViewingIndividualId(customer.id);
                               loadIndividualDocuments(customer.id);
                             }}
                             className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                             title="View Details"
                           >
                             <Eye className="size-5" />
                           </button>
                         )}
                         <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                             <button className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                               <MoreHorizontal className="size-5" />
                             </button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end">
                             <DropdownMenuItem onClick={() => handleOpenEditCustomer(customer)}>
                               <Pencil className="mr-2 size-4" /> {t('common.edit') || 'Edit'}
                             </DropdownMenuItem>
                            {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee') && (
                               <DropdownMenuItem
                                 className="text-red-600 focus:text-red-600"
                                 onClick={() => handleConfirmDeleteCustomer(customer)}
                               >
                                 <Trash2 className="mr-2 size-4" /> {t('common.delete') || 'Delete'}
                               </DropdownMenuItem>
                             )}
                           </DropdownMenuContent>
                         </DropdownMenu>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <IndividualDocumentsDialog
        open={!!viewingIndividualId}
        onOpenChange={(open) => !open && setViewingIndividualId(null)}
        customer={viewingIndividual}
        documents={viewingIndividualId ? (individualDocuments[viewingIndividualId] || []) : []}
        loading={documentsLoading}
        onDownloadAll={() => {
          if (viewingIndividualId) {
            downloadAllDocuments(viewingIndividualId, viewingIndividual?.name || undefined);
          }
        }}
        onDownload={downloadDocument}
      />
    </div>
  );
}

function IndividualDocumentsDialog({
  open,
  onOpenChange,
  customer,
  documents,
  loading,
  onDownloadAll,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerRecord | null;
  documents: CustomerDocument[];
  loading: boolean;
  onDownloadAll: () => void;
  onDownload: (doc: CustomerDocument) => void;
}) {
  if (!customer) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Individual Customer Details</DialogTitle>
          <DialogDescription>Documents for {customer.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Attachments</h3>
            <button
              onClick={onDownloadAll}
              disabled={!documents.length}
              className="text-xs bg-black text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
            >
              Download All
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading documents...</p>
          ) : documents.length ? (
            <div className="flex flex-wrap gap-2">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onDownload(doc)}
                  className="px-3 py-1 rounded-full bg-gray-100 text-xs text-gray-700 hover:bg-gray-200"
                >
                  {doc.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No documents uploaded.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
