import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ArrowLeft, Paperclip, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/app/components/ui/button';
import { ExpensePermissionGuard } from '@/app/components/expenses/ExpensePermissionGuard';
import { useExpensePermissions } from '@/app/hooks/useExpensePermissions';
import { expensesApi } from '@/app/lib/expenseApi';
import { formatExpenseErrorMessage } from '@/app/lib/expenseErrors';
import { expenseInputClass, expenseLabelClass } from '@/app/lib/expenseFormat';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_EDITABLE_STATUSES,
  type ExpenseCategory,
  type ExpenseDetail,
} from '@/app/lib/expenseTypes';
import { EXPENSE_PERMISSIONS } from '@/app/lib/expensePermissions';
import { Loader2, AlertTriangle } from 'lucide-react';

type FormState = {
  category: ExpenseCategory;
  date: string;
  amount: string;
  merchant: string;
  business_purpose: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  category: 'office',
  date: format(new Date(), 'yyyy-MM-dd'),
  amount: '',
  merchant: '',
  business_purpose: '',
  notes: '',
});

export function ExpenseFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { expenseId } = useParams<{ expenseId: string }>();
  const isEdit = Boolean(expenseId);
  const perms = useExpensePermissions();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [existing, setExisting] = useState<ExpenseDetail | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await expensesApi.get(expenseId);
      setExisting(detail);
      setForm({
        category: detail.category || 'office',
        date: detail.date || format(new Date(), 'yyyy-MM-dd'),
        amount: String(detail.amount ?? ''),
        merchant: detail.merchant || '',
        business_purpose: detail.business_purpose || '',
        notes: detail.notes || '',
      });
    } catch (err) {
      setError(err);
      setExisting(null);
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    if (isEdit) load();
  }, [isEdit, load]);

  const canEditExisting =
    existing && EXPENSE_EDITABLE_STATUSES.has(String(existing.workflow_status)) && perms.canChangeOwn;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    if (!form.category) return t('expenses.employee.validation.category');
    if (!form.date) return t('expenses.employee.validation.date');
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return t('expenses.employee.validation.amount');
    return null;
  };

  /** Payload never includes actor fields or workflow status. */
  const buildPayload = () => ({
    category: form.category,
    date: form.date,
    amount: form.amount,
    merchant: form.merchant.trim(),
    business_purpose: form.business_purpose.trim(),
    notes: form.notes.trim(),
  });

  const uploadIfNeeded = async (id: string) => {
    if (!receiptFile) return;
    await expensesApi.uploadReceipt(id, receiptFile);
  };

  const handleSave = async (submitAfter: boolean) => {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (isEdit && !canEditExisting) {
      toast.error(t('expenses.errors.expense_not_editable'));
      return;
    }

    setSaving(true);
    try {
      let detail: ExpenseDetail;
      if (isEdit && expenseId) {
        detail = await expensesApi.update(expenseId, buildPayload());
        await uploadIfNeeded(detail.id);
        if (submitAfter && perms.canSubmit) {
          detail = await expensesApi.submit(detail.id);
          toast.success(t('expenses.employee.toasts.submitted'));
        } else {
          toast.success(t('expenses.employee.toasts.updated'));
        }
      } else {
        detail = await expensesApi.create(buildPayload());
        await uploadIfNeeded(detail.id);
        if (submitAfter && perms.canSubmit) {
          detail = await expensesApi.submit(detail.id);
          toast.success(t('expenses.employee.toasts.submitted'));
        } else {
          toast.success(t('expenses.employee.toasts.created'));
        }
      }
      navigate(`/expenses/${detail.id}`);
    } catch (err) {
      toast.error(formatExpenseErrorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ExpensePermissionGuard
      anyOf={
        isEdit
          ? [EXPENSE_PERMISSIONS.changeOwn, EXPENSE_PERMISSIONS.change, EXPENSE_PERMISSIONS.viewOwn]
          : [EXPENSE_PERMISSIONS.addOwn, EXPENSE_PERMISSIONS.add]
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400" role="status">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500" role="alert">
          <AlertTriangle className="size-8 text-amber-500" aria-hidden />
          <p className="text-sm text-center max-w-md">{formatExpenseErrorMessage(error, t)}</p>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            {t('expenses.employee.retry')}
          </Button>
        </div>
      ) : isEdit && existing && !canEditExisting ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('expenses.errors.expense_not_editable')}</p>
          <Button type="button" variant="outline" asChild>
            <Link to={`/expenses/${expenseId}`}>{t('expenses.employee.backToDetail')}</Link>
          </Button>
        </div>
      ) : (
        <section className="space-y-5 max-w-2xl" aria-labelledby="expense-form-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="expense-form-title" className="text-xl font-semibold text-slate-900">
                {isEdit ? t('expenses.employee.editTitle') : t('expenses.employee.createTitle')}
              </h2>
              <p className="text-sm text-slate-500">
                {isEdit
                  ? t('expenses.employee.editDescription')
                  : t('expenses.employee.createDescription')}
              </p>
            </div>
            <Button type="button" variant="outline" asChild>
              <Link to={isEdit && expenseId ? `/expenses/${expenseId}` : '/expenses'}>
                <ArrowLeft className="size-4 me-2" />
                {t('expenses.employee.back')}
              </Link>
            </Button>
          </div>

          <form
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave(false);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="exp-category" className={expenseLabelClass}>
                  {t('expenses.category')} *
                </label>
                <select
                  id="exp-category"
                  className={expenseInputClass}
                  value={form.category}
                  onChange={(e) => setField('category', e.target.value)}
                  required
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`expenses.employee.categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="exp-date" className={expenseLabelClass}>
                  {t('expenses.date')} *
                </label>
                <input
                  id="exp-date"
                  type="date"
                  className={expenseInputClass}
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  required
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label htmlFor="exp-amount" className={expenseLabelClass}>
                {t('expenses.amount')} *
              </label>
              <input
                id="exp-amount"
                type="number"
                min="0.01"
                step="0.01"
                className={expenseInputClass}
                value={form.amount}
                onChange={(e) => setField('amount', e.target.value)}
                placeholder={t('expenses.amountPlaceholder')}
                required
                dir="ltr"
              />
            </div>

            <div>
              <label htmlFor="exp-merchant" className={expenseLabelClass}>
                {t('expenses.employee.fields.merchant')}
              </label>
              <input
                id="exp-merchant"
                className={expenseInputClass}
                value={form.merchant}
                onChange={(e) => setField('merchant', e.target.value)}
                placeholder={t('expenses.employee.fields.merchantPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="exp-purpose" className={expenseLabelClass}>
                {t('expenses.employee.fields.businessPurpose')}
              </label>
              <textarea
                id="exp-purpose"
                className={expenseInputClass}
                rows={3}
                value={form.business_purpose}
                onChange={(e) => setField('business_purpose', e.target.value)}
                placeholder={t('expenses.employee.fields.businessPurposePlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="exp-notes" className={expenseLabelClass}>
                {t('expenses.notes')}
              </label>
              <textarea
                id="exp-notes"
                className={expenseInputClass}
                rows={2}
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder={t('expenses.notesPlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="exp-receipt" className={expenseLabelClass}>
                {t('expenses.employee.fields.receipt')}
              </label>
              <div className="flex items-center gap-2">
                <Paperclip className="size-4 text-slate-400 shrink-0" aria-hidden />
                <input
                  id="exp-receipt"
                  type="file"
                  accept="image/*,.pdf,.png,.jpg,.jpeg,.webp"
                  className="text-sm text-slate-600 file:me-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {existing?.attachments?.length ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  {t('expenses.employee.fields.existingReceipts', {
                    count: existing.attachments.length,
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 me-2 animate-spin" />
                ) : (
                  <Save className="size-4 me-2" />
                )}
                {t('expenses.actions.saveDraft')}
              </Button>
              {perms.canSubmit ? (
                <Button
                  type="button"
                  variant="default"
                  disabled={saving}
                  onClick={() => void handleSave(true)}
                >
                  {saving ? (
                    <Loader2 className="size-4 me-2 animate-spin" />
                  ) : (
                    <Send className="size-4 me-2" />
                  )}
                  {t('expenses.actions.saveAndSubmit')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" asChild disabled={saving}>
                <Link to={isEdit && expenseId ? `/expenses/${expenseId}` : '/expenses'}>
                  {t('common.cancel')}
                </Link>
              </Button>
            </div>
          </form>
        </section>
      )}
    </ExpensePermissionGuard>
  );
}
