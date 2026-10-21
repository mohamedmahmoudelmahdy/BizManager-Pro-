import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Building2,
  Download,
  FileText,
  Loader2,
  Lock,
  PercentCircle,
  Phone,
  RotateCcw,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/app/components/ui/utils';
import { CustomerAttestationPanel } from '@/app/components/customers/CustomerAttestationPanel';
import { useAuth } from '@/app/contexts/AuthContext';
import { useData } from '@/app/contexts/DataContext';
import { ApiError, formatApiErrorMessage } from '@/app/lib/api';
import {
  CustomerAccountStatusModal,
  type CustomerAccountTarget,
  DirectDiscountModal,
} from '@/app/components/customers/CustomerAccountControlModals';
import {
  CustomerFinancialTransferModal,
  type TransferPaymentTarget,
  type TransferProcedureTarget,
} from '@/app/components/customers/CustomerFinancialTransferModal';
import {
  CustomerPaymentRefundModal,
  type RefundPaymentTarget,
} from '@/app/components/customers/CustomerPaymentRefundModal';
import {
  closeCustomerAccount,
  createCustomerFinancialAdjustment,
  fetchCustomerFinancialSummary,
  refundPayment,
  reopenCustomerAccount,
  transferPaymentToCustomer,
  transferProcedureToCustomer,
  type CustomerFinancialSummary,
} from '@/app/lib/customerApi';

function fmtAed(value: string | number) {
  const n = Number(value || 0);
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function refundErrorMessage(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const code = (err.body as { code?: string }).code;
    if (code) {
      const key = `customers.refund.errors.${code}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
  }
  return formatApiErrorMessage(err, t('customers.refund.failed'));
}

function mapProcedureStatus(status: string, t: (k: string) => string) {
  if (status === 'in-process') return t('status.inProcessUi');
  if (status === 'approved' || status === 'need-info') return t('status.needInfoUi');
  if (status === 'done') return t('status.completedUi');
  if (status === 'rejected') return t('status.rejectedUi');
  if (status === 'submitted') return t('status.pendingUi');
  return status;
}

function debtStatusLabel(display: string, t: (k: string) => string) {
  if (display === 'in_debt') return t('customers.profile.inDebt');
  if (display === 'credit') return t('customers.profile.creditBalance');
  return t('customers.profile.clear');
}

function exportStatementCsv(summary: CustomerFinancialSummary, filename: string) {
  const lines = [
    ['Date', 'Type', 'Description', 'Debit', 'Credit', 'Running Balance'].join(','),
    ...summary.statement.map((row) =>
      [
        row.date || '',
        row.kind,
        `"${row.description.replace(/"/g, '""')}"`,
        row.debit,
        row.credit,
        row.running_balance,
      ].join(',')
    ),
    '',
    ['Total Procedure Charges', summary.totals.total_procedure_charges].join(','),
    ['Total Payments', summary.totals.total_payments].join(','),
    ['Total Refunds', summary.totals.total_refunds || '0'].join(','),
    ['Net Collected', summary.totals.net_collected || ''].join(','),
    ['Recorded Balance', summary.totals.recorded_balance].join(','),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CustomerProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { refreshCustomers } = useData();
  const [summary, setSummary] = useState<CustomerFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [accountActionMode, setAccountActionMode] = useState<'close' | 'reopen' | null>(null);
  const [transferMode, setTransferMode] = useState<'procedure' | 'payment' | null>(null);
  const [transferProcedure, setTransferProcedure] = useState<TransferProcedureTarget | null>(null);
  const [transferPayment, setTransferPayment] = useState<TransferPaymentTarget | null>(null);
  const [refundPaymentTarget, setRefundPaymentTarget] = useState<RefundPaymentTarget | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchCustomerFinancialSummary(id);
      setSummary(data);
    } catch {
      setError(t('customers.profile.loadFailed'));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="size-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="text-center py-24">
        <p className="text-gray-500 mb-4">{error || t('customers.profile.notFound')}</p>
        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="text-sm text-blue-600 hover:underline"
        >
          {t('customers.profile.backToList')}
        </button>
      </div>
    );
  }

  const { customer, totals } = summary;
  const balance = Number(customer.balance);
  const isDebt = balance > 0;
  const isCredit = balance < 0;
  const isClosed = customer.account_status === 'closed';
  const canManageCustomerAccount = user?.role === 'admin' || user?.role === 'manager';
  const canTransferFinancials =
    canManageCustomerAccount || user?.role === 'employee';
  const canRefundPayments = canManageCustomerAccount;
  const showPaymentActions = canTransferFinancials || canRefundPayments;
  const statementDebitTotal = summary.statement.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const statementCreditTotal = summary.statement.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const targetCustomer: CustomerAccountTarget = {
    id: customer.id,
    name: customer.display_name,
    balance,
    accountStatus: customer.account_status,
  };

  const handleDirectDiscount = async (payload: { amount: string; date: string; reason: string; notes: string }) => {
    try {
      await createCustomerFinancialAdjustment(customer.id, payload);
      await Promise.all([load(), refreshCustomers()]);
      toast.success(t('customers.account.discountApplied'));
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.account.discountFailed')));
      throw err;
    }
  };

  const handleAccountStatusAction = async (reason: string) => {
    if (!accountActionMode) return;
    try {
      if (accountActionMode === 'close') {
        await closeCustomerAccount(customer.id, reason);
        toast.success(t('customers.account.accountClosed'));
      } else {
        await reopenCustomerAccount(customer.id, reason);
        toast.success(t('customers.account.accountReopened'));
      }
      await Promise.all([load(), refreshCustomers()]);
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.account.statusChangeFailed')));
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="size-4" />
          {t('customers.profile.back')}
        </button>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canManageCustomerAccount && (
            <>
              <button
                type="button"
                onClick={() => setDiscountOpen(true)}
                disabled={isClosed || !isDebt}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PercentCircle className="size-4" />
                {t('customers.account.directDiscount')}
              </button>
              <button
                type="button"
                onClick={() => setAccountActionMode(isClosed ? 'reopen' : 'close')}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium shadow-sm",
                  isClosed
                    ? "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                    : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                )}
              >
                {isClosed ? <RotateCcw className="size-4" /> : <Lock className="size-4" />}
                {isClosed ? t('customers.account.reopenAccount') : t('customers.account.closeAccount')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() =>
              exportStatementCsv(summary, `customer-statement-${customer.display_name.replace(/\s+/g, '-')}.csv`)
            }
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <Download className="size-4" />
            {t('customers.profile.exportStatement')}
          </button>
        </div>
      </div>

      {isClosed && (
        <div className="flex items-start gap-3 bg-gray-900 text-white rounded-lg p-4 text-sm">
          <Lock className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t('customers.account.closedBanner')}</p>
            {customer.closure_reason && <p className="mt-1 text-gray-200">{customer.closure_reason}</p>}
          </div>
        </div>
      )}

      {customer.type === 'company' ? (
        <CustomerAttestationPanel customerId={customer.id} customerType={customer.type} />
      ) : null}

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start gap-4 flex-wrap">
          <div
            className={cn(
              'size-14 rounded-full flex items-center justify-center shrink-0',
              customer.type === 'company' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
            )}
          >
            {customer.type === 'company' ? <Building2 className="size-7" /> : <User className="size-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{customer.display_name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {customer.type === 'company' ? t('customers.type.company') : t('customers.type.individual')}
              {customer.last_activity && (
                <span>
                  {' '}
                  · {t('financials.lastActivity')}:{' '}
                  {format(new Date(customer.last_activity), 'MMM dd, yyyy')}
                </span>
              )}
            </p>
            {(customer.phone || customer.email) && (
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-600">
                {customer.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="size-3.5" />
                    {customer.phone}
                  </span>
                )}
                {customer.email && <span>{customer.email}</span>}
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase font-semibold">{t('financials.currentBalance')}</p>
            <p
              className={cn(
                'text-2xl font-bold mt-1',
                isDebt && 'text-red-600',
                isCredit && 'text-green-600',
                !isDebt && !isCredit && 'text-gray-900'
              )}
            >
              {balance === 0 ? t('financials.settled') : fmtAed(Math.abs(balance))}
            </p>
            <span
              className={cn(
                'inline-block mt-2 px-2 py-0.5 rounded text-xs font-semibold',
                customer.debt_status_display === 'in_debt' && 'bg-red-100 text-red-700',
                customer.debt_status_display === 'credit' && 'bg-blue-100 text-blue-700',
                customer.debt_status_display === 'clear' && 'bg-green-100 text-green-700'
              )}
            >
              {debtStatusLabel(customer.debt_status_display, t)}
            </span>
          </div>
        </div>
      </div>

      {totals.balance_mismatch && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <AlertTriangle className="size-5 shrink-0 mt-0.5" />
          <p>{t('customers.profile.balanceMismatchWarning')}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <SummaryCard
          label={t('customers.profile.totalCharges')}
          value={fmtAed(totals.total_procedure_charges)}
        />
        <SummaryCard label={t('customers.profile.totalPayments')} value={fmtAed(totals.total_payments)} />
        <SummaryCard
          label={t('customers.profile.totalRefunds')}
          value={fmtAed(totals.total_refunds || 0)}
        />
        <SummaryCard
          label={t('customers.profile.netCollected')}
          value={fmtAed(totals.net_collected ?? Number(totals.total_payments) - Number(totals.total_refunds || 0))}
        />
        <SummaryCard
          label={t('customers.profile.procedureCount')}
          value={String(totals.procedure_count)}
        />
        <SummaryCard
          label={t('financials.currentBalance')}
          value={
            balance === 0
              ? t('financials.settled')
              : `${fmtAed(Math.abs(balance))} ${
                  isDebt ? t('customers.refund.debt') : isCredit ? t('customers.refund.credit') : ''
                }`
          }
          highlight
        />
      </div>

      {/* Procedures table */}
      <Section title={t('customers.profile.procedures')} icon={<FileText className="size-4" />}>
        <ResponsiveTable
          headers={[
            t('financials.table.date'),
            t('financials.table.procedure'),
            t('customers.profile.description'),
            t('financials.table.status'),
            t('customers.profile.charge'),
            t('financials.table.cost'),
            t('customers.profile.paid'),
            t('customers.profile.outstanding'),
            ...(canTransferFinancials ? [t('customers.profile.actions')] : []),
          ]}
          wrapColumns={[2]}
          emptyMessage={t('customers.profile.noProcedures')}
          rows={summary.procedures.map((proc) => {
            const linkedCount = summary.payments.filter((p) => p.procedure_id === proc.id).length;
            const cells: (string | React.ReactNode)[] = [
              proc.date || '—',
              proc.category,
              <span
                key={`${proc.id}-desc`}
                dir="auto"
                className="whitespace-pre-wrap break-words"
              >
                {proc.description?.trim() ? proc.description : '—'}
              </span>,
              mapProcedureStatus(proc.status, t),
              fmtAed(proc.selling_price),
              fmtAed(proc.cost),
              fmtAed(proc.paid),
              fmtAed(proc.outstanding),
            ];
            if (canTransferFinancials) {
              cells.push(
                <button
                  key={`${proc.id}-xfer`}
                  type="button"
                  className="text-xs font-medium text-blue-700 underline whitespace-nowrap"
                  onClick={() => {
                    setTransferMode('procedure');
                    setTransferPayment(null);
                    setTransferProcedure({
                      id: proc.id,
                      customerId: proc.customer_id || customer.id,
                      date: proc.date,
                      category: proc.category,
                      description: proc.description,
                      selling_price: proc.selling_price,
                      cost: proc.cost,
                      paid: proc.paid,
                      outstanding: proc.outstanding,
                      linkedPaymentCount: linkedCount,
                    });
                  }}
                >
                  {t('customers.transfer.procedureAction')}
                </button>
              );
            }
            return cells;
          })}
        />
      </Section>

      {/* Payments table */}
      <Section title={t('customers.profile.payments')} icon={<FileText className="size-4" />}>
        <ResponsiveTable
          headers={[
            t('financials.table.date'),
            t('payments.table.amount'),
            t('customers.refund.refunded'),
            t('payments.paymentMethod'),
            t('payments.linkedProcedure'),
            t('customers.profile.notes'),
            ...(showPaymentActions ? [t('customers.profile.actions')] : []),
          ]}
          emptyMessage={t('customers.profile.noPayments')}
          rows={summary.payments.map((pay) => {
            const refunded = Number(pay.refunded_amount || 0);
            const refundable = Number(
              pay.refundable_amount != null
                ? pay.refundable_amount
                : Math.max(Number(pay.amount) - refunded, 0)
            );
            const cells: (string | React.ReactNode)[] = [
              pay.date || '—',
              fmtAed(pay.amount),
              refunded > 0 ? fmtAed(refunded) : '—',
              pay.bank_card_name || pay.type,
              pay.procedure_category || '—',
              pay.notes || '—',
            ];
            if (showPaymentActions) {
              cells.push(
                <div key={`${pay.id}-actions`} className="flex flex-wrap gap-2 justify-end">
                  {canTransferFinancials && (
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-700 underline whitespace-nowrap"
                      onClick={() => {
                        setTransferMode('payment');
                        setTransferProcedure(null);
                        setTransferPayment({
                          id: pay.id,
                          customerId: pay.customer_id || customer.id,
                          date: pay.date,
                          amount: pay.amount,
                          bank_card_name: pay.bank_card_name,
                          type: pay.type,
                          procedure_id: pay.procedure_id,
                          procedure_category: pay.procedure_category,
                        });
                      }}
                    >
                      {t('customers.transfer.paymentAction')}
                    </button>
                  )}
                  {canRefundPayments && refundable > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-rose-700 underline whitespace-nowrap"
                      onClick={() =>
                        setRefundPaymentTarget({
                          id: pay.id,
                          amount: pay.amount,
                          refunded_amount: pay.refunded_amount || '0.00',
                          refundable_amount: String(refundable),
                          bank_card_name: pay.bank_card_name,
                          date: pay.date,
                        })
                      }
                    >
                      {t('customers.refund.action')}
                    </button>
                  )}
                </div>
              );
            }
            return cells;
          })}
        />
      </Section>

      {/* Statement */}
      <Section title={t('customers.profile.statement')} icon={<FileText className="size-4" />}>
        <ResponsiveTable
          headers={[
            t('financials.table.date'),
            t('customers.profile.description'),
            t('financials.table.status'),
            t('customers.profile.debit'),
            t('customers.profile.credit'),
            t('customers.profile.runningBalance'),
          ]}
          emptyMessage={t('customers.profile.noTransactions')}
          rows={summary.statement.map((row) => {
            const rb = Number(row.running_balance);
            return [
              row.date || '—',
              row.description,
              row.kind === 'procedure'
                ? mapProcedureStatus(row.status, t)
                : row.kind === 'refund'
                  ? t('customers.refund.kind')
                  : row.status,
              row.debit !== '0' ? fmtAed(row.debit) : '—',
              row.credit !== '0' ? fmtAed(row.credit) : '—',
              <span
                key={row.id}
                className={cn(
                  'font-mono font-semibold',
                  rb > 0 && 'text-red-600',
                  rb < 0 && 'text-green-600',
                  rb === 0 && 'text-gray-700'
                )}
              >
                {fmtAed(Math.abs(rb))}
                {rb > 0 ? ` ${t('financials.debit')}` : rb < 0 ? ` ${t('financials.credit')}` : ''}
              </span>,
            ];
          })}
          footer={
            <tr className="bg-gray-50 font-bold border-t border-gray-200">
              <td colSpan={3} className="px-4 py-3 text-right text-gray-900">
                {t('customers.profile.totals')}
              </td>
              <td className="px-4 py-3 text-right font-mono">{fmtAed(statementDebitTotal)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmtAed(statementCreditTotal)}</td>
              <td className="px-4 py-3 text-right font-mono text-red-600">{fmtAed(totals.recorded_balance)}</td>
            </tr>
          }
        />
      </Section>

      <p className="text-xs text-gray-400 text-center">
        <Link to="/customers/financials" className="hover:underline">
          {t('customers.profile.viewAllFinancials')}
        </Link>
      </p>
      <DirectDiscountModal
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        customer={targetCustomer}
        onSubmit={handleDirectDiscount}
      />
      <CustomerAccountStatusModal
        open={!!accountActionMode}
        onOpenChange={(open) => !open && setAccountActionMode(null)}
        customer={targetCustomer}
        mode={accountActionMode || 'close'}
        onSubmit={handleAccountStatusAction}
      />
      <CustomerFinancialTransferModal
        open={!!transferMode}
        onOpenChange={(open) => {
          if (!open) {
            setTransferMode(null);
            setTransferProcedure(null);
            setTransferPayment(null);
          }
        }}
        mode={transferMode}
        sourceCustomerId={customer.id}
        sourceCustomerName={customer.display_name}
        procedure={transferProcedure}
        payment={transferPayment}
        onSubmit={async (payload) => {
          if (transferMode === 'procedure' && transferProcedure) {
            const result = await transferProcedureToCustomer(transferProcedure.id, {
              target_customer_id: payload.target_customer_id,
              reason: payload.reason,
              transfer_linked_payments: payload.transfer_linked_payments ?? true,
            });
            toast.success(t('customers.transfer.success'));
            await load();
            await refreshCustomers();
            return { target_customer_id: result.transfer.target_customer_id };
          }
          if (transferMode === 'payment' && transferPayment) {
            const result = await transferPaymentToCustomer(transferPayment.id, {
              target_customer_id: payload.target_customer_id,
              reason: payload.reason,
              target_procedure_id: payload.target_procedure_id ?? null,
            });
            toast.success(t('customers.transfer.success'));
            await load();
            await refreshCustomers();
            return { target_customer_id: result.transfer.target_customer_id };
          }
          throw new Error(t('customers.transfer.failed'));
        }}
      />
      <CustomerPaymentRefundModal
        open={!!refundPaymentTarget}
        onOpenChange={(open) => !open && setRefundPaymentTarget(null)}
        payment={refundPaymentTarget}
        customerBalance={balance}
        onSubmit={async (payload) => {
          if (!refundPaymentTarget) return;
          try {
            const result = await refundPayment(refundPaymentTarget.id, payload);
            setSummary(result.customer_financial_summary);
            await refreshCustomers();
            toast.success(t('customers.refund.success'));
          } catch (err) {
            toast.error(refundErrorMessage(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-white border rounded-xl p-4 shadow-sm',
        highlight ? 'border-gray-300 ring-1 ring-gray-100' : 'border-gray-200'
      )}
    >
      <p className="text-xs text-gray-500 uppercase font-semibold">{label}</p>
      <p className={cn('text-xl font-bold mt-1', highlight ? 'text-gray-900' : 'text-gray-800')}>{value}</p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <span className="text-gray-500">{icon}</span>
        <h2 className="font-bold text-gray-900">{title}</h2>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}

function ResponsiveTable({
  headers,
  rows,
  emptyMessage,
  footer,
  wrapColumns = [],
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
  emptyMessage: string;
  footer?: React.ReactNode;
  /** Column indexes that should wrap long text (e.g. procedure description). */
  wrapColumns?: number[];
}) {
  if (rows.length === 0) {
    return <p className="text-center text-gray-400 py-8 text-sm">{emptyMessage}</p>;
  }

  const wrapSet = new Set(wrapColumns);

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm text-left min-w-[640px]">
        <thead className="bg-gray-50 text-gray-500 font-medium text-xs uppercase">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    wrapSet.has(j)
                      ? 'px-4 py-3 text-gray-700 whitespace-normal break-words max-w-[14rem] sm:max-w-xs md:max-w-sm align-top'
                      : 'px-4 py-3 text-gray-700 whitespace-nowrap'
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}
