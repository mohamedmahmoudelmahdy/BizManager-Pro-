import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Undo2,
  Wallet,
  X,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/app/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { ExpensePermissionGuard } from '@/app/components/expenses/ExpensePermissionGuard';
import { ExpenseCode, ExpenseStatusBadge } from '@/app/components/expenses/ExpenseBadges';
import { useExpensePermissions } from '@/app/hooks/useExpensePermissions';
import { useData } from '@/app/contexts/DataContext';
import { expensesApi } from '@/app/lib/expenseApi';
import { formatExpenseErrorMessage } from '@/app/lib/expenseErrors';
import {
  expenseInputClass,
  expenseLabelClass,
  formatExpenseAmount,
  formatExpenseDateTime,
  formatExpenseIsoDate,
  formatExpenseUserLabel,
} from '@/app/lib/expenseFormat';
import {
  EXPENSE_EDITABLE_STATUSES,
  type ExpenseDetail,
} from '@/app/lib/expenseTypes';
import { cn } from '@/app/components/ui/utils';

type ReasonAction = 'reject' | 'return' | null;
type MarkPaidOpen = boolean;

export function ExpenseDetailPage() {
  const { t } = useTranslation();
  const { expenseId } = useParams<{ expenseId: string }>();
  const perms = useExpensePermissions();
  const { bankCards } = useData();

  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [reason, setReason] = useState('');
  const [markPaidOpen, setMarkPaidOpen] = useState<MarkPaidOpen>(false);
  const [paidByCard, setPaidByCard] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    setError(null);
    try {
      setExpense(await expensesApi.get(expenseId));
    } catch (err) {
      setError(err);
      setExpense(null);
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (markPaidOpen && !paidByCard && bankCards[0]?.id) {
      setPaidByCard(bankCards[0].id);
    }
  }, [markPaidOpen, paidByCard, bankCards]);

  const status = expense?.workflow_status ?? '';
  const canEdit =
    Boolean(expense) &&
    EXPENSE_EDITABLE_STATUSES.has(String(status)) &&
    perms.canChangeOwn;
  const canSubmit =
    Boolean(expense) &&
    (status === 'draft' || status === 'returned') &&
    perms.canSubmit;
  const canWithdraw = Boolean(expense) && status === 'submitted' && perms.canWithdraw;
  const canApprove = Boolean(expense) && status === 'submitted' && perms.canApprove;
  const canReject = Boolean(expense) && status === 'submitted' && perms.canReject;
  const canReturn = Boolean(expense) && status === 'submitted' && perms.canReturn;
  const canMarkPaid = Boolean(expense) && status === 'approved' && perms.canMarkPaid;

  const runAction = async (fn: () => Promise<ExpenseDetail>, successKey: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      setExpense(updated);
      toast.success(t(successKey));
    } catch (err) {
      toast.error(formatExpenseErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const confirmReason = async () => {
    if (!expense || !reasonAction) return;
    if (!reason.trim()) {
      toast.error(t('expenses.employee.validation.reason'));
      return;
    }
    setBusy(true);
    try {
      const updated =
        reasonAction === 'reject'
          ? await expensesApi.reject(expense.id, { reason: reason.trim() })
          : await expensesApi.returnForCorrection(expense.id, { reason: reason.trim() });
      setExpense(updated);
      toast.success(
        t(
          reasonAction === 'reject'
            ? 'expenses.employee.toasts.rejected'
            : 'expenses.employee.toasts.returned'
        )
      );
      setReasonAction(null);
      setReason('');
    } catch (err) {
      toast.error(formatExpenseErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const confirmMarkPaid = async () => {
    if (!expense) return;
    if (!paidByCard) {
      toast.error(t('expenses.employee.validation.paidBy'));
      return;
    }
    setBusy(true);
    try {
      const updated = await expensesApi.markPaid(expense.id, {
        paid_by: paidByCard,
        payment_reference: paymentRef.trim() || undefined,
      });
      setExpense(updated);
      toast.success(t('expenses.employee.toasts.paid'));
      setMarkPaidOpen(false);
      setPaymentRef('');
    } catch (err) {
      toast.error(formatExpenseErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const downloadReceipt = async (attachmentId: string, name: string) => {
    if (!expense) return;
    try {
      const blob = await expensesApi.downloadReceiptBlob(expense.id, attachmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'receipt';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(formatExpenseErrorMessage(err, t));
    }
  };

  return (
    <ExpensePermissionGuard>
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400" role="status">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      ) : error || !expense ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500" role="alert">
          <AlertTriangle className="size-8 text-amber-500" aria-hidden />
          <p className="text-sm text-center max-w-md">
            {formatExpenseErrorMessage(error ?? new Error('missing'), t)}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            {t('expenses.employee.retry')}
          </Button>
        </div>
      ) : (
        <section className="space-y-5" aria-labelledby="expense-detail-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="expense-detail-title"
                  className="text-xl font-semibold text-slate-900 break-words"
                >
                  {expense.merchant || t('expenses.employee.claimFallback')}
                </h2>
                <ExpenseStatusBadge status={expense.workflow_status} />
              </div>
              <p className="text-sm text-slate-500">
                <ExpenseCode>{expense.expense_number || expense.id}</ExpenseCode>
                {' · '}
                {formatExpenseIsoDate(expense.date)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild>
                <Link to="/expenses">
                  <ArrowLeft className="size-4 me-2" />
                  {t('expenses.employee.back')}
                </Link>
              </Button>
              {canEdit ? (
                <Button type="button" variant="outline" asChild>
                  <Link to={`/expenses/${expense.id}/edit`}>
                    <Pencil className="size-4 me-2" />
                    {t('common.edit')}
                  </Link>
                </Button>
              ) : null}
              {canSubmit ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () => expensesApi.submit(expense.id),
                      'expenses.employee.toasts.submitted'
                    )
                  }
                >
                  <Send className="size-4 me-2" />
                  {t('expenses.actions.submit')}
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () => expensesApi.withdraw(expense.id),
                      'expenses.employee.toasts.withdrawn'
                    )
                  }
                >
                  <Undo2 className="size-4 me-2" />
                  {t('expenses.actions.withdraw')}
                </Button>
              ) : null}
              {canApprove ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () => expensesApi.approve(expense.id),
                      'expenses.employee.toasts.approved'
                    )
                  }
                >
                  <Check className="size-4 me-2" />
                  {t('expenses.actions.approve')}
                </Button>
              ) : null}
              {canReturn ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReasonAction('return');
                    setReason('');
                  }}
                >
                  <RotateCcw className="size-4 me-2" />
                  {t('expenses.actions.return')}
                </Button>
              ) : null}
              {canReject ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setReasonAction('reject');
                    setReason('');
                  }}
                >
                  <X className="size-4 me-2" />
                  {t('expenses.actions.reject')}
                </Button>
              ) : null}
              {canMarkPaid ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => setMarkPaidOpen(true)}
                >
                  <Wallet className="size-4 me-2" />
                  {t('expenses.actions.markPaid')}
                </Button>
              ) : null}
            </div>
          </div>

          {(expense.rejection_reason || expense.return_reason) && (
            <div
              className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                expense.rejection_reason
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              )}
            >
              <p className="font-medium">
                {expense.rejection_reason
                  ? t('expenses.employee.fields.rejectionReason')
                  : t('expenses.employee.fields.returnReason')}
              </p>
              <p className="mt-1 break-words">
                {expense.rejection_reason || expense.return_reason}
              </p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.amount')}</dt>
                <dd className="font-medium text-slate-900" dir="ltr">
                  {formatExpenseAmount(expense.amount)}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.category')}</dt>
                <dd>
                  {t(`expenses.employee.categories.${expense.category}`, {
                    defaultValue: expense.category,
                  })}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.date')}</dt>
                <dd>{formatExpenseIsoDate(expense.date)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.merchant')}</dt>
                <dd className="break-words">{expense.merchant || '—'}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.businessPurpose')}</dt>
                <dd className="break-words">{expense.business_purpose || '—'}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.notes')}</dt>
                <dd className="break-words">{expense.notes || '—'}</dd>
              </div>
            </dl>

            <dl className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.submittedBy')}</dt>
                <dd>{formatExpenseUserLabel(expense.submitted_by)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.expenseFor')}</dt>
                <dd>{formatExpenseUserLabel(expense.expense_for_user)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.approvedBy')}</dt>
                <dd>{formatExpenseUserLabel(expense.approved_by_user)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.paidAt')}</dt>
                <dd>{formatExpenseDateTime(expense.paid_at)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.paymentMethod')}</dt>
                <dd>{expense.paid_by_name || expense.paid_by || '—'}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <dt className="text-slate-500">{t('expenses.employee.fields.paymentReference')}</dt>
                <dd className="break-words" dir="ltr">
                  {expense.payment_reference || '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {t('expenses.employee.receipts.title')}
            </h3>
            {!expense.attachments?.length ? (
              <p className="text-sm text-slate-500">{t('expenses.employee.receipts.empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {expense.attachments.map((att) => (
                  <li
                    key={att.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="truncate">{att.original_name || att.id}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void downloadReceipt(att.id, att.original_name)}
                    >
                      <Download className="size-4 me-1" />
                      {t('expenses.employee.receipts.download')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {t('expenses.employee.timeline.title')}
            </h3>
            {!expense.audit_events?.length ? (
              <p className="text-sm text-slate-500">{t('expenses.employee.timeline.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {[...expense.audit_events].reverse().map((ev) => (
                  <li key={ev.id} className="flex gap-3 text-sm">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-400"
                      aria-hidden
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-slate-800">
                        {t(`expenses.employee.timeline.actions.${ev.action}`, {
                          defaultValue: ev.action,
                        })}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatExpenseUserLabel(ev.actor)}
                        {' · '}
                        {formatExpenseDateTime(ev.created_at)}
                        {ev.from_status || ev.to_status
                          ? ` · ${ev.from_status || '—'} → ${ev.to_status || '—'}`
                          : ''}
                      </p>
                      {ev.message ? (
                        <p className="text-slate-600 break-words">{ev.message}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

      <Dialog
        open={reasonAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReasonAction(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonAction === 'reject'
                ? t('expenses.actions.reject')
                : t('expenses.actions.return')}
            </DialogTitle>
            <DialogDescription>
              {reasonAction === 'reject'
                ? t('expenses.employee.reasonDialog.rejectHint')
                : t('expenses.employee.reasonDialog.returnHint')}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="expense-reason" className={expenseLabelClass}>
              {t('expenses.employee.fields.reason')} *
            </label>
            <textarea
              id="expense-reason"
              className={expenseInputClass}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReasonAction(null);
                setReason('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmReason()}>
              {busy ? <Loader2 className="size-4 me-2 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('expenses.actions.markPaid')}</DialogTitle>
            <DialogDescription>{t('expenses.employee.markPaidDialog.hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="expense-paid-by" className={expenseLabelClass}>
                {t('expenses.paidBy')} *
              </label>
              <select
                id="expense-paid-by"
                className={expenseInputClass}
                value={paidByCard}
                onChange={(e) => setPaidByCard(e.target.value)}
              >
                <option value="">{t('expenses.paidByPlaceholder')}</option>
                {bankCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.bankName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="expense-pay-ref" className={expenseLabelClass}>
                {t('expenses.employee.fields.paymentReference')}
              </label>
              <input
                id="expense-pay-ref"
                className={expenseInputClass}
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setMarkPaidOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmMarkPaid()}>
              {busy ? <Loader2 className="size-4 me-2 animate-spin" /> : null}
              {t('expenses.actions.markPaid')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ExpensePermissionGuard>
  );
}
