import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  ChevronRight,
  Calendar,
  FileText,
  Lock,
  PercentCircle,
  RotateCcw,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/app/components/ui/utils';
import { format } from 'date-fns';
import { useData } from '@/app/contexts/DataContext';
import { useAuth } from '@/app/contexts/AuthContext';
import { CustomerAreaNav } from '@/app/components/customers/CustomerAreaNav';
import {
  CustomerAccountStatusModal,
  type CustomerAccountTarget,
  DirectDiscountModal,
} from '@/app/components/customers/CustomerAccountControlModals';
import {
  closeCustomerAccount,
  createCustomerFinancialAdjustment,
  reopenCustomerAccount,
} from '@/app/lib/customerApi';
import { formatApiErrorMessage } from '@/app/lib/api';

export function CustomerFinancialsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customers, procedures, refreshCustomers, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['customers', 'procedures'], { forceFinancial: true });
  }, [ensureLoaded]);

  const [searchTerm, setSearchTerm] = useState('');
  const [discountCustomer, setDiscountCustomer] = useState<CustomerAccountTarget | null>(null);
  const [accountAction, setAccountAction] = useState<{
    mode: 'close' | 'reopen';
    customer: CustomerAccountTarget;
  } | null>(null);

  const canManageCustomerAccount = user?.role === 'admin' || user?.role === 'manager';

  const financials = useMemo(() => {
    return customers.map((customer) => {
      const customerName = customer.companyName || customer.name;
      const customerProcedures = procedures.filter((proc) => proc.customerId === customer.id);
      const currentBalance = Number(customer.balance || 0);
      return {
        id: customer.id,
        name: customerName,
        type: customer.type === 'company' ? 'Company' : 'Individual',
        totalProcedures: customerProcedures.length,
        currentBalance,
        lastActivity: customer.lastActivity || '',
        accountStatus: customer.accountStatus || 'active',
        closureReason: customer.closureReason || '',
      };
    });
  }, [customers, procedures]);

  const filteredData = financials.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalReceivables = financials.reduce(
    (acc, curr) => acc + (curr.currentBalance > 0 ? curr.currentBalance : 0),
    0
  );
  const totalPayables = financials.reduce(
    (acc, curr) => acc + (curr.currentBalance < 0 ? Math.abs(curr.currentBalance) : 0),
    0
  );

  const handleDirectDiscount = async (payload: { amount: string; date: string; reason: string; notes: string }) => {
    if (!discountCustomer) return;
    try {
      await createCustomerFinancialAdjustment(discountCustomer.id, payload);
      await refreshCustomers();
      toast.success(t('customers.account.discountApplied'));
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.account.discountFailed')));
      throw err;
    }
  };

  const handleAccountStatusAction = async (reason: string) => {
    if (!accountAction) return;
    try {
      if (accountAction.mode === 'close') {
        await closeCustomerAccount(accountAction.customer.id, reason);
        toast.success(t('customers.account.accountClosed'));
      } else {
        await reopenCustomerAccount(accountAction.customer.id, reason);
        toast.success(t('customers.account.accountReopened'));
      }
      await refreshCustomers();
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.account.statusChangeFailed')));
      throw err;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <CustomerAreaNav />

      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('financials.title')}</h1>
          <p className="text-gray-500">{t('financials.subtitle')}</p>
        </div>

        <div className="flex gap-4">
          <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-full text-red-600">
              <ArrowDownLeft className="size-4" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">{t('financials.totalReceivables')}</p>
              <p className="text-lg font-bold text-gray-900">AED {totalReceivables.toLocaleString()}</p>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-full text-green-600">
              <ArrowUpRight className="size-4" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">{t('financials.totalPayables')}</p>
              <p className="text-lg font-bold text-gray-900">AED {totalPayables.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('financials.searchPlaceholder')}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-1 focus:ring-black transition-all shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-3 pr-2">
        {filteredData.map((customer) => {
          const isDebt = customer.currentBalance > 0;
          const isCredit = customer.currentBalance < 0;
          const isClear = customer.currentBalance === 0;
          const isClosed = customer.accountStatus === 'closed';
          const target = {
            id: customer.id,
            name: customer.name,
            balance: customer.currentBalance,
            accountStatus: customer.accountStatus,
          };

          return (
            <div
              key={customer.id}
              className={cn(
                "w-full bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-center justify-between hover:border-gray-300 hover:shadow-md transition-all text-left group",
                isClosed && "bg-gray-50 opacity-80"
              )}
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div
                  className={cn(
                    'size-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0',
                    customer.type === 'Company' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                  )}
                >
                  {customer.type === 'Company' ? <FileText className="size-5" /> : <User className="size-5" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900 truncate">{customer.name}</h3>
                    {isClosed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-700">
                        <Lock className="size-3" />
                        {t('customers.account.closed')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-semibold">
                      {customer.type === 'Company' ? t('customers.type.company') : t('customers.type.individual')}
                    </span>
                    <span>• {t('financials.proceduresCount', { count: customer.totalProcedures })}</span>
                    {isClosed && <span>• {t('customers.account.closedHelper')}</span>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right hidden sm:block">
                  <p className="text-xs text-gray-400 font-medium uppercase">{t('financials.lastActivity')}</p>
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-1 justify-end">
                    <Calendar className="size-3" />
                    {customer.lastActivity
                      ? format(new Date(customer.lastActivity), 'MMM dd, yyyy')
                      : t('common.empty')}
                  </p>
                </div>

                <div className="text-right min-w-[120px]">
                  <p className="text-xs text-gray-400 font-medium uppercase">{t('financials.currentBalance')}</p>
                  <p
                    className={cn(
                      'text-xl font-bold',
                      isDebt && 'text-red-600',
                      isCredit && 'text-green-600',
                      isClear && 'text-gray-900'
                    )}
                  >
                    {isClear
                      ? t('financials.settled')
                      : `AED ${Math.abs(customer.currentBalance).toLocaleString()}`}
                    {isDebt && (
                      <span className="text-xs ml-1 font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        {t('financials.debit')}
                      </span>
                    )}
                    {isCredit && (
                      <span className="text-xs ml-1 font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                        {t('financials.credit')}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {canManageCustomerAccount && (
                    <>
                      <button
                        type="button"
                        onClick={() => setDiscountCustomer(target)}
                        disabled={isClosed || !isDebt}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title={isClosed ? t('customers.account.closedCreateBlocked') : undefined}
                      >
                        <PercentCircle className="size-3.5" />
                        {t('customers.account.directDiscount')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAccountAction({ mode: isClosed ? 'reopen' : 'close', customer: target })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium",
                          isClosed
                            ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                            : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        )}
                      >
                        {isClosed ? <RotateCcw className="size-3.5" /> : <Lock className="size-3.5" />}
                        {isClosed ? t('customers.account.reopenAccount') : t('customers.account.closeAccount')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/customers/${customer.id}`)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900"
                  >
                    {t('customers.profile.viewProfile')}
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <DirectDiscountModal
        open={!!discountCustomer}
        onOpenChange={(open) => !open && setDiscountCustomer(null)}
        customer={discountCustomer}
        onSubmit={handleDirectDiscount}
      />
      <CustomerAccountStatusModal
        open={!!accountAction}
        onOpenChange={(open) => !open && setAccountAction(null)}
        customer={accountAction?.customer || null}
        mode={accountAction?.mode || 'close'}
        onSubmit={handleAccountStatusAction}
      />
    </div>
  );
}
