import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/app/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { ApiError } from '@/app/lib/api';
import type { BankCard, Employee, ProcedureCategory } from '@/app/contexts/DataContext';
import { resolveDashboardAlert } from '@/app/lib/dashboardApi';
import type { DashboardExpiryAlert } from '@/app/utils/dashboardAlerts';
import { suggestRenewalDate } from '@/app/utils/dashboardAlerts';

type Props = {
  alert: DashboardExpiryAlert | null;
  open: boolean;
  onClose: () => void;
  onResolved: (result: { procedureCreated: boolean; warning?: string | null }) => void;
  bankCards: BankCard[];
  employees: Employee[];
  procedureCategories: ProcedureCategory[];
  canCreateProcedure: boolean;
};

export function ResolveAlertModal({
  alert,
  open,
  onClose,
  onResolved,
  bankCards,
  employees,
  procedureCategories,
  canCreateProcedure,
}: Props) {
  const { t } = useTranslation();
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [createProcedure, setCreateProcedure] = useState(false);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [cost, setCost] = useState('0');
  const [cashOutType, setCashOutType] = useState('');
  const [cashInType, setCashInType] = useState('');
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('');
  const [status, setStatus] = useState('submitted');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!alert || !open) return;
    setNewExpiryDate(suggestRenewalDate(alert.currentExpiryDate));
    setNotes('');
    setCreateProcedure(false);
    setCategory(procedureCategories[0]?.name || '');
    setDescription(
      t('dashboard.alerts.defaultProcedureDescription', {
        alertType: alert.label,
        company: alert.customerName,
      })
    );
    setSellingPrice('0');
    setCost('0');
    setCashOutType('');
    setCashInType('');
    setAssignedEmployeeId('');
    setStatus('submitted');
  }, [alert, open, procedureCategories, t]);

  const isExpired = alert ? alert.daysRemaining < 0 : false;

  const handleSubmit = async (withProcedure: boolean) => {
    if (!alert || !newExpiryDate) return;
    if (withProcedure && !canCreateProcedure) {
      toast.error(t('dashboard.alerts.noProcedurePermission'));
      return;
    }
    if (withProcedure && !category.trim()) {
      toast.error(t('dashboard.alerts.categoryRequired'));
      return;
    }

    setLoading(true);
    try {
      const result = await resolveDashboardAlert({
        alert_type: alert.alertType,
        customer_id: alert.customerId,
        field: alert.field,
        new_expiry_date: newExpiryDate,
        notes,
        worker_id: alert.workerId,
        create_procedure: withProcedure,
        procedure: withProcedure
          ? {
              category: category.trim(),
              description,
              selling_price: sellingPrice,
              cost: cost,
              paid: sellingPrice,
              cash_out_type: cashOutType || null,
              cash_in_type: cashInType || null,
              assigned_employee: assignedEmployeeId || null,
              status,
              date: new Date().toISOString().slice(0, 10),
            }
          : undefined,
      });

      toast.success(t('dashboard.alerts.resolveSuccess'));
      if (withProcedure && result.procedure) {
        toast.success(t('dashboard.alerts.procedureLinkedSuccess'));
      }
      if (result.warning) {
        toast.warning(result.warning);
      }
      onResolved({ procedureCreated: Boolean(result.procedure), warning: result.warning });
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.detail || t('dashboard.alerts.resolveFailed')
          : t('dashboard.alerts.resolveFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const severityBanner = useMemo(() => {
    if (!alert) return null;
    if (isExpired) {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          {t('dashboard.alerts.expiredWarning')}
        </div>
      );
    }
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        {t('dashboard.alerts.expiringSoonWarning', { days: alert.daysRemaining })}
      </div>
    );
  }, [alert, isExpired, t]);

  if (!alert) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dashboard.alerts.resolveTitle')}</DialogTitle>
          <DialogDescription>{t('dashboard.alerts.resolveDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {severityBanner}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.companyCustomer')}</p>
              <p className="text-sm font-medium text-slate-900">{alert.customerName}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.alertType')}</p>
              <p className="text-sm font-medium text-slate-900">{alert.label}</p>
            </div>
            {alert.workerName && (
              <div>
                <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.worker')}</p>
                <p className="text-sm font-medium text-slate-900">{alert.workerName}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.currentExpiry')}</p>
              <p className="text-sm font-medium text-slate-900">{alert.currentExpiryDate || t('common.empty')}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.daysRemaining')}</p>
              <p className={`text-sm font-medium ${isExpired ? 'text-red-700' : 'text-amber-700'}`}>
                {alert.daysRemaining}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">{t('dashboard.alerts.affectedField')}</p>
              <p className="text-sm font-medium text-slate-900">{alert.field}</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.newExpiryDate')}</label>
            <input
              type="date"
              value={newExpiryDate}
              onChange={(e) => setNewExpiryDate(e.target.value)}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
            />
          </div>

          {canCreateProcedure && (
            <div className="space-y-3 border border-slate-200 rounded-lg p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <Checkbox checked={createProcedure} onCheckedChange={(v) => setCreateProcedure(Boolean(v))} />
                {t('dashboard.alerts.createLinkedProcedure')}
              </label>

              {createProcedure && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.procedureCategory')}</label>
                    <input
                      list="alert-procedure-categories"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    />
                    <datalist id="alert-procedure-categories">
                      {procedureCategories.map((item) => (
                        <option key={item.id} value={item.name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.procedureDescription')}</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.sellingPrice')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.cost')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.cashOutMethod')}</label>
                    <select
                      value={cashOutType}
                      onChange={(e) => setCashOutType(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">{t('common.empty')}</option>
                      {bankCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.bankName} • ****{card.last4}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.alerts.cashInMethod')}</label>
                    <select
                      value={cashInType}
                      onChange={(e) => setCashInType(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">{t('common.empty')}</option>
                      {bankCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.bankName} • ****{card.last4}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.assignedTo')}</label>
                    <select
                      value={assignedEmployeeId}
                      onChange={(e) => setAssignedEmployeeId(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">{t('common.empty')}</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.userId}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{t('dashboard.status')}</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="submitted">{t('status.submittedUi')}</option>
                      <option value="in_process">{t('status.inProcessUi')}</option>
                      <option value="done">{t('status.completedUi')}</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {!canCreateProcedure && (
            <p className="text-xs text-slate-500">{t('dashboard.alerts.noProcedurePermission')}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={loading || !newExpiryDate}
            onClick={() => void handleSubmit(false)}
            className="px-4 py-2 text-sm border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin inline" /> : t('dashboard.alerts.updateExpiryOnly')}
          </button>
          {canCreateProcedure && (
            <button
              type="button"
              disabled={loading || !newExpiryDate || !createProcedure}
              onClick={() => void handleSubmit(true)}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-4 animate-spin inline" /> : t('dashboard.alerts.updateAndCreateProcedure')}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
