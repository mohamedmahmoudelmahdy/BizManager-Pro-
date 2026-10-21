import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { differenceInCalendarDays, format } from 'date-fns';
import { useData } from '@/app/contexts/DataContext';
import { API_BASE, getJson, postForm, postJson, patchJson, deleteJson } from '@/app/lib/api';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';
import { useAuth } from '@/app/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, Upload } from 'lucide-react';
import { ImportWorkersModal } from '@/app/components/customers/ImportWorkersModal';

const formatDays = (target?: string) => {
  if (!target) return '—';
  const diff = differenceInCalendarDays(new Date(target), new Date());
  return `${diff} days`;
};

const renderDate = (value?: string) => (value ? format(new Date(value), 'yyyy-MM-dd') : '—');

type CustomerDocument = {
  id: string;
  name: string;
  url: string;
};

type WorkerRow = {
  id: string;
  name: string;
  residencyExpiry: string;
  noHealthInsurance?: boolean;
  insuranceExpiry: string;
  companyName?: string;
};

export function CompanyProfilePage() {
  const { t } = useTranslation();
  const { companyId } = useParams();
  const { user } = useAuth();
  const { customers, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['customers']);
  }, [ensureLoaded]);
  const [companyRecord, setCompanyRecord] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadCompany = async () => {
      if (!companyId) return;
      const localCompany = customers.find((customer) => customer.id === companyId && customer.type === 'company');
      if (localCompany) {
        setCompanyRecord(localCompany);
        setIsLoading(false);
        return;
      }
      try {
        const apiCompany = await getJson<any>(`/customers/${companyId}/`);
        if (mounted) {
          setCompanyRecord({
            id: apiCompany.id,
            type: apiCompany.type,
            name: apiCompany.name,
            companyName: apiCompany.company_name || apiCompany.name,
            phone: apiCompany.phone || '',
            phoneSecondary: apiCompany.phone_secondary || '',
            tradeLicense: apiCompany.trade_license || '',
            licenseExpiry: apiCompany.license_expiry || '',
            establishmentCardExpiry: apiCompany.establishment_card_expiry || '',
            workersExpiry: apiCompany.workers_expiry || '',
            echannelExpiry: apiCompany.echannel_expiry || '',
            echannelEmail: apiCompany.echannel_email || '',
            echannelPassword: apiCompany.echannel_password || '',
            noHealthInsurance: !!apiCompany.no_health_insurance,
            healthInsuranceExpiry: apiCompany.health_insurance_expiry || '',
            attachments: [],
            lastActivity: apiCompany.last_activity || '',
          });
        }
      } catch (e) {
        if (mounted) {
          setCompanyRecord(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadCompany();
    return () => {
      mounted = false;
    };
  }, [companyId, customers]);

  useEffect(() => {
    if (!companyId) return;
    loadCompanyEmployees(companyId);
    loadCompanyDocuments(companyId);
  }, [companyId]);

  const company = companyRecord as any;

  if (!companyId) {
    return <Navigate to="/customers" replace />;
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Loading company...</CardTitle>
            <CardDescription>Please wait while we fetch the company record.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Company not found</CardTitle>
            <CardDescription>No company matches this record.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const initialExpiryRows = useMemo(() => {
    const rows: { label: string; date: string }[] = [
      { label: 'License Expiry', date: company.licenseExpiry || '' },
      { label: 'Establishment Card Expiry', date: company.establishmentCardExpiry || '' },
      { label: 'Workers Expiry', date: company.workersExpiry || '' },
      { label: 'Echannel Expiry', date: company.echannelExpiry || '' },
    ];
    if (!company.noHealthInsurance) {
      rows.push({ label: 'Health Insurance Expiry', date: company.healthInsuranceExpiry || '' });
    }
    return rows;
  }, [company.noHealthInsurance, company.healthInsuranceExpiry, company.licenseExpiry, company.establishmentCardExpiry, company.workersExpiry, company.echannelExpiry]);
  const [expiryRows, setExpiryRows] = useState(initialExpiryRows);
  const [isEditingExpiry, setIsEditingExpiry] = useState(false);

  const updateExpiryRow = (index: number, field: 'label' | 'date', value: string) => {
    setExpiryRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addExpiryRow = () => {
    setExpiryRows((prev) => [...prev, { label: '', date: '' }]);
  };

  const cancelExpiryEdits = () => {
    setExpiryRows(initialExpiryRows);
    setIsEditingExpiry(false);
  };

  const [companyDocuments, setCompanyDocuments] = useState<CustomerDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const addAttachment = () => {
    attachmentInputRef.current?.click();
  };

  const resolveFileUrl = (fileUrl: string) => {
    if (!fileUrl) return '';
    const origin = API_BASE.replace(/\/api\/?$/, '');
    if (fileUrl.startsWith('http')) return fileUrl;
    if (fileUrl.startsWith('/')) return `${origin}${fileUrl}`;
    return `${origin}/${fileUrl}`;
  };

  const loadCompanyDocuments = async (id: string) => {
    setDocumentsLoading(true);
    try {
      const docs = await getJson<any>(`/documents/?customer=${id}`);
      const list = Array.isArray(docs) ? docs : docs?.results || [];
      const mapped: CustomerDocument[] = list.map((doc: any) => ({
        id: doc.id,
        name: doc.original_name || (doc.file || '').split('/').pop() || 'document',
        url: doc.file,
      }));
      setCompanyDocuments(mapped);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleAttachmentUpload = async (files: FileList | null) => {
    if (!files || !files.length || !companyId) {
      return;
    }
    const uploads = Array.from(files).map((file) => {
      const form = new FormData();
      form.append('customer', companyId);
      form.append('file', file);
      form.append('original_name', file.name);
      return postForm('/documents/', form);
    });
    await Promise.allSettled(uploads);
    await loadCompanyDocuments(companyId);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
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

  const downloadAllDocuments = async () => {
    if (!companyId) return;
    const token = localStorage.getItem('accessToken');
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/zip/${companyId}/`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const fileBase = (company?.companyName || company?.name || companyId)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim() || companyId;
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `${fileBase}-documents.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const [employeeExpiryRows, setEmployeeExpiryRows] = useState<WorkerRow[]>([]);
  const [isEditingEmployees, setIsEditingEmployees] = useState(false);
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState(false);
  const [isWorkerImportOpen, setIsWorkerImportOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<WorkerRow | null>(null);
  const [deleteConfirmWorkerId, setDeleteConfirmWorkerId] = useState<string | null>(null);
  const [newWorker, setNewWorker] = useState({
    name: '',
    residencyExpiry: '',
    noHealthInsurance: false,
    insuranceExpiry: '',
  });

  const updateEmployeeRow = (index: number, field: 'name' | 'residencyExpiry' | 'insuranceExpiry', value: string) => {
    setEmployeeExpiryRows((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  };

  const addEmployeeRow = () => {
    setEmployeeExpiryRows((prev) => [
      ...prev,
      { id: '', name: '', residencyExpiry: new Date().toISOString().slice(0, 10), noHealthInsurance: false, insuranceExpiry: new Date().toISOString().slice(0, 10) },
    ]);
  };

  const loadCompanyEmployees = async (id: string) => {
    const data = await getJson<any>('/company-employees/');
    const list = Array.isArray(data) ? data : data?.results || [];
    const workers = list
      .filter((item: { company?: string }) => item.company === id)
      .map((item: { id: string; name: string; residency_expiry?: string; no_health_insurance?: boolean; insurance_expiry?: string; company_name?: string }) => ({
        id: item.id,
        name: item.name,
        residencyExpiry: item.residency_expiry || '',
        noHealthInsurance: !!item.no_health_insurance,
        insuranceExpiry: item.insurance_expiry || '',
        companyName: item.company_name,
      }));
    setEmployeeExpiryRows(workers);
  };

  const handleSaveWorker = async () => {
    if (!companyId || !newWorker.name || !newWorker.residencyExpiry) return;
    const noHealthInsurance = !!newWorker.noHealthInsurance;
    if (!noHealthInsurance && !newWorker.insuranceExpiry) return;

    const payload = {
      name: newWorker.name,
      residency_expiry: newWorker.residencyExpiry,
      no_health_insurance: noHealthInsurance,
      insurance_expiry: noHealthInsurance ? null : (newWorker.insuranceExpiry || null),
    };

    if (editingWorker) {
      await patchJson<any>(`/company-employees/${editingWorker.id}/`, payload);
      loadCompanyEmployees(companyId);
      setEditingWorker(null);
      setNewWorker({ name: '', residencyExpiry: '', noHealthInsurance: false, insuranceExpiry: '' });
      setIsWorkerModalOpen(false);
    } else {
      const res = await postJson<any>('/company-employees/', { company: companyId, ...payload });
      setEmployeeExpiryRows((prev) => [
        ...prev,
        {
          id: res.id,
          name: res.name,
          residencyExpiry: res.residency_expiry || '',
          noHealthInsurance: !!res.no_health_insurance,
          insuranceExpiry: res.insurance_expiry || '',
          companyName: res.company_name,
        },
      ]);
      setNewWorker({ name: '', residencyExpiry: '', noHealthInsurance: false, insuranceExpiry: '' });
      setIsWorkerModalOpen(false);
    }
  };

  const handleOpenEditWorker = (row: WorkerRow) => {
    setNewWorker({
      name: row.name,
      residencyExpiry: row.residencyExpiry || '',
      noHealthInsurance: !!row.noHealthInsurance,
      insuranceExpiry: row.insuranceExpiry || '',
    });
    setEditingWorker(row);
    setIsWorkerModalOpen(true);
  };

  const handleDeleteWorker = async () => {
    if (!deleteConfirmWorkerId || !companyId) return;
    await deleteJson(`/company-employees/${deleteConfirmWorkerId}/`);
    loadCompanyEmployees(companyId);
    setDeleteConfirmWorkerId(null);
  };

  const cancelEmployeeEdits = () => {
    if (companyId) {
      loadCompanyEmployees(companyId);
    }
    setIsEditingEmployees(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{company.companyName || company.name}</CardTitle>
          <CardDescription>Company profile and expiry details</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm text-slate-500">Company Name</p>
            <p className="font-medium text-slate-900">{company.companyName || company.name}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Trade License</p>
            <p className="text-sm text-slate-900">{company.tradeLicense || '—'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Contact Numbers</p>
            <p className="text-sm text-slate-900">
              {company.phone}
              {company.phoneSecondary ? `, ${company.phoneSecondary}` : ''}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Last Activity</p>
            <p className="text-sm text-slate-900">{company.lastActivity}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Echannel Email</p>
            <p className="text-sm text-slate-900">{company.echannelEmail || '—'}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Echannel Password</p>
            <p className="text-sm text-slate-900">{company.echannelPassword || '—'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Expiry Dates</CardTitle>
              <CardDescription>Key company documents and their expiry dates</CardDescription>
            </div>
            <div className="flex gap-2">
              {isEditingExpiry ? (
                <>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-accent"
                    onClick={addExpiryRow}
                    type="button"
                  >
                    Add Document
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                    onClick={() => setIsEditingExpiry(false)}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-accent"
                    onClick={cancelExpiryEdits}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                  onClick={() => setIsEditingExpiry(true)}
                  type="button"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Days Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiryRows.map((row, index) => (
                <TableRow key={`${row.label}-${index}`}>
                  <TableCell className="font-medium">
                    {isEditingExpiry ? (
                      <input
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={row.label}
                        onChange={(e) => updateExpiryRow(index, 'label', e.target.value)}
                      />
                    ) : (
                      row.label
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditingExpiry ? (
                      <input
                        type="date"
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={row.date}
                        onChange={(e) => updateExpiryRow(index, 'date', e.target.value)}
                      />
                    ) : (
                      row.date ? format(new Date(row.date), 'yyyy-MM-dd') : '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatDays(row.date)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Company Employees Expiry Dates</CardTitle>
              <CardDescription>Residency and insurance expiry dates per employee</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsWorkerImportOpen(true)}
              >
                <Upload className="size-4 mr-1" />
                {t('customers.workers.importWorkers')}
              </Button>
              <Dialog open={isWorkerModalOpen} onOpenChange={(open) => { setIsWorkerModalOpen(open); if (!open) setEditingWorker(null); }}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditingWorker(null); setNewWorker({ name: '', residencyExpiry: '', noHealthInsurance: false, insuranceExpiry: '' }); }}
                  >
                    Add Worker
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{editingWorker ? 'Edit worker' : 'Add New Worker'}</DialogTitle>
                    <DialogDescription>{editingWorker ? 'Update worker expiry details.' : 'Enter worker expiry details.'}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Name</Label>
                      <Input
                        className="mt-1"
                        value={newWorker.name}
                        onChange={(e) => setNewWorker((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Worker Name"
                      />
                    </div>
                    <div>
                      <Label>Residency Expiry</Label>
                      <Input
                        type="date"
                        className="mt-1"
                        value={newWorker.residencyExpiry}
                        onChange={(e) => setNewWorker((prev) => ({ ...prev, residencyExpiry: e.target.value }))}
                      />
                    </div>
                    {!newWorker.noHealthInsurance && (
                      <div>
                        <Label>Insurance Expiry</Label>
                        <Input
                          type="date"
                          className="mt-1"
                          value={newWorker.insuranceExpiry}
                          onChange={(e) => setNewWorker((prev) => ({ ...prev, insuranceExpiry: e.target.value }))}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="worker-no-health-insurance-cp"
                        checked={!!newWorker.noHealthInsurance}
                        onChange={(e) => setNewWorker((prev) => ({ ...prev, noHealthInsurance: e.target.checked }))}
                        className="rounded border-input"
                      />
                      <Label htmlFor="worker-no-health-insurance-cp" className="font-normal cursor-pointer">{t('customers.workers.noHealthInsurance')}</Label>
                    </div>
                    <DialogFooter className="flex justify-end">
                      <Button onClick={handleSaveWorker}>{editingWorker ? 'Update' : 'Save Worker'}</Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
              {isEditingEmployees ? (
                <>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-accent"
                    onClick={addEmployeeRow}
                    type="button"
                  >
                    Add Employee
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                    onClick={() => setIsEditingEmployees(false)}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-accent"
                    onClick={cancelEmployeeEdits}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                  onClick={() => setIsEditingEmployees(true)}
                  type="button"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العمال</TableHead>
                <TableHead>الاقامة - تاريخ الانتهاء</TableHead>
                <TableHead>الاقامة - باليوم</TableHead>
                <TableHead>الضمان - تاريخ الانتهاء</TableHead>
                <TableHead>الضمان - باليوم</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employeeExpiryRows.map((row, index) => (
                <TableRow key={row.id || `${row.name}-${index}`}>
                  <TableCell className="font-medium">
                    {isEditingEmployees ? (
                      <input
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={row.name}
                        onChange={(e) => updateEmployeeRow(index, 'name', e.target.value)}
                      />
                    ) : (
                      row.name
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditingEmployees ? (
                      <input
                        type="date"
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={row.residencyExpiry || ''}
                        onChange={(e) => updateEmployeeRow(index, 'residencyExpiry', e.target.value)}
                      />
                    ) : (
                      renderDate(row.residencyExpiry)
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatDays(row.residencyExpiry)}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.noHealthInsurance ? '-' : (isEditingEmployees ? (
                      <input
                        type="date"
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        value={row.insuranceExpiry || ''}
                        onChange={(e) => updateEmployeeRow(index, 'insuranceExpiry', e.target.value)}
                      />
                    ) : (
                      renderDate(row.insuranceExpiry)
                    ))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.noHealthInsurance ? '-' : formatDays(row.insuranceExpiry)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditWorker(row)}
                        className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'employee') && (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmWorkerId(row.id)}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {companyId && companyRecord && (
        <ImportWorkersModal
          customerId={companyId}
          customerName={companyRecord.company_name || companyRecord.name}
          open={isWorkerImportOpen}
          onClose={() => setIsWorkerImportOpen(false)}
          onImported={() => loadCompanyEmployees(companyId)}
        />
      )}

      {/* Delete worker confirmation */}
      <Dialog open={!!deleteConfirmWorkerId} onOpenChange={(open) => !open && setDeleteConfirmWorkerId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete worker?</DialogTitle>
            <DialogDescription>This worker will be removed from the list.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteWorker}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Attached Documents</CardTitle>
              <CardDescription>Uploaded company files and documents</CardDescription>
            </div>
            <div className="flex gap-2">
              <button
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-accent"
                onClick={downloadAllDocuments}
                type="button"
                disabled={!companyDocuments.length}
              >
                Download All
              </button>
              <button
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                onClick={addAttachment}
                type="button"
              >
                Add Document
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => handleAttachmentUpload(e.target.files)}
            />
            {documentsLoading ? (
              <p className="text-sm text-slate-600">Loading documents...</p>
            ) : companyDocuments.length ? (
              companyDocuments.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <span className="truncate">{doc.name}</span>
                  <button
                    type="button"
                    className="text-xs text-slate-600 hover:text-slate-900"
                    onClick={() => downloadDocument(doc)}
                  >
                    Download
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600">No documents uploaded.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
