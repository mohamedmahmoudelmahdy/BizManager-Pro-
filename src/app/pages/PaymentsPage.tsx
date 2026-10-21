import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  MoreHorizontal, 
  CreditCard, 
  Calendar,
  User,
  FileText,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { SearchableCombobox } from '@/app/components/ui/searchable-combobox';
import { buildSearchableText } from '@/app/utils/searchText';
import { useAuth } from '@/app/contexts/AuthContext';
import { useData } from '@/app/contexts/DataContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';
import { format } from 'date-fns';

type PaymentRecord = {
  id: string;
  date: string;
  customer: string;
  customerId?: string;
  amount: number;
  type: 'Cash' | 'POS' | 'Transfer';
  description?: string;
  bankCard?: string;
  recordedBy?: string;
  procedureId?: string;
};

export function PaymentsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    payments,
    deposits,
    customers,
    procedures,
    bankCards,
    addPayment,
    updatePayment,
    removePayment,
    addDeposit,
    ensureLoaded,
  } = useData();

  useEffect(() => {
    void ensureLoaded(['payments', 'deposits', 'customers', 'procedures', 'bankCards'], {
      forceFinancial: true,
    });
  }, [ensureLoaded]);

  const isEmployee = user?.role === 'employee';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMethodId, setFilterMethodId] = useState('');
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [newPayment, setNewPayment] = useState<Partial<PaymentRecord>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    type: 'Cash'
  });
  const [newDeposit, setNewDeposit] = useState({
    amount: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    fromMethod: '',
    toMethod: '',
  });

  type RecordRow = {
    id: string;
    recordType: 'payment' | 'deposit';
    date: string;
    customer: string;
    customerId?: string;
    amount: number;
    type: string;
    description: string;
    bankCard: string;
    recordedBy: string;
  };

  const paymentsUi = useMemo<PaymentRecord[]>(() => {
    return payments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      customer: payment.customerName,
      amount: Number(payment.amount || 0),
      type: payment.type === 'cash' ? 'Cash' : payment.type === 'pos' ? 'POS' : 'Transfer',
      description: payment.notes || '',
      bankCard: payment.bankCard
        ? (bankCards.find((card) => card.id === payment.bankCard)?.bankName || payment.bankCard)
        : '-',
      recordedBy: payment.recordedBy || '-',
    }));
  }, [payments, bankCards]);

  const recordsWithDeposits = useMemo<RecordRow[]>(() => {
    const paymentRows: RecordRow[] = paymentsUi.map((p) => ({
      id: p.id,
      recordType: 'payment' as const,
      date: p.date,
      customer: p.customer,
      customerId: payments.find((x) => x.id === p.id)?.customerId,
      amount: p.amount,
      type: p.type,
      description: p.description || '-',
      bankCard: p.bankCard || '-',
      recordedBy: p.recordedBy || '-',
    }));
    const depositRows: RecordRow[] = deposits.map((d) => {
      const fromName = bankCards.find((c) => c.id === d.fromMethod)?.bankName || d.fromMethod;
      const toName = bankCards.find((c) => c.id === d.toMethod)?.bankName || d.toMethod;
      return {
        id: d.id,
        recordType: 'deposit' as const,
        date: d.date,
        customer: '—',
        amount: d.amount,
        type: t('payments.deposit') || 'Deposit',
        description: '—',
        bankCard: `${fromName} → ${toName}`,
        recordedBy: '—',
      };
    });
    let combined = [...paymentRows, ...depositRows];
    if (filterDateFrom) combined = combined.filter((r) => r.date >= filterDateFrom);
    if (filterDateTo) combined = combined.filter((r) => r.date <= filterDateTo);
    if (filterMethodId) {
      combined = combined.filter((r) => {
        if (r.recordType === 'payment') {
          const pay = payments.find((p) => p.id === r.id);
          return pay?.bankCard === filterMethodId;
        }
        const dep = deposits.find((d) => d.id === r.id);
        return dep?.fromMethod === filterMethodId || dep?.toMethod === filterMethodId;
      });
    }
    if (filterCustomerId) combined = combined.filter((r) => r.recordType === 'payment' && r.customerId === filterCustomerId);
    combined.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
    return combined;
  }, [paymentsUi, payments, deposits, bankCards, filterDateFrom, filterDateTo, filterMethodId, filterCustomerId, t]);

  const cashMethods = useMemo(
    () => bankCards.filter((card) => card.methodType === 'cash'),
    [bankCards]
  );
  const bankMethods = useMemo(
    () => bankCards.filter((card) => card.methodType === 'bank'),
    [bankCards]
  );

  const resetPaymentForm = () => {
    setNewPayment({
      date: format(new Date(), 'yyyy-MM-dd'),
      type: 'Cash',
      customer: '',
      customerId: undefined,
      amount: undefined,
      description: '',
      bankCard: '',
      procedureId: '',
    });
    setEditingPaymentId(null);
  };

  const openCreatePayment = () => {
    resetPaymentForm();
    setIsModalOpen(true);
  };

  const openEditPayment = (paymentId: string) => {
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) return;
    setEditingPaymentId(paymentId);
    setNewPayment({
      id: payment.id,
      date: payment.date,
      customerId: payment.customerId,
      customer: payment.customerName,
      amount: Number(payment.amount),
      type: payment.type === 'cash' ? 'Cash' : payment.type === 'pos' ? 'POS' : 'Transfer',
      bankCard: payment.bankCard,
      description: payment.notes || '',
      procedureId: payment.procedureId || '',
    });
    setIsModalOpen(true);
  };

  const handleSavePayment = async () => {
    const resolvedCustomerId = newPayment.customerId || customers.find((c) => (c.companyName || c.name) === newPayment.customer?.trim())?.id;
    const customerName = newPayment.customer?.trim() || customerComboboxOptions.find((o) => o.value === resolvedCustomerId)?.label;
    if (!newPayment.amount || !resolvedCustomerId || !customerName) return;

    const customerId = resolvedCustomerId;
    const type = newPayment.type === 'Cash' ? 'cash' : newPayment.type === 'POS' ? 'pos' : 'transfer';
    const selectedMethodId = newPayment.bankCard || '';
    if (!selectedMethodId) return;

    setSaving(true);
    try {
      if (editingPaymentId) {
        await updatePayment(editingPaymentId, {
          amount: Number(newPayment.amount),
          date: newPayment.date || format(new Date(), 'yyyy-MM-dd'),
          type: type as 'cash' | 'pos' | 'transfer',
          customerId,
          customerName,
          bankCard: selectedMethodId,
          notes: newPayment.description?.trim() || '',
          procedureId: newPayment.procedureId || undefined,
        });
      } else {
        await addPayment({
          amount: Number(newPayment.amount),
          date: newPayment.date || format(new Date(), 'yyyy-MM-dd'),
          type: type as 'cash' | 'pos' | 'transfer',
          customerId,
          customerName,
          bankCard: selectedMethodId,
          notes: newPayment.description?.trim() || '',
          procedureId: newPayment.procedureId || undefined,
        });
      }
      resetPaymentForm();
      setIsModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletePaymentId) return;
    setSaving(true);
    try {
      await removePayment(deletePaymentId);
      setDeletePaymentId(null);
    } finally {
      setSaving(false);
    }
  };

  const selectedFromMethod = bankCards.find((c) => c.id === newDeposit.fromMethod);
  const fromBalance = Number(selectedFromMethod?.balance ?? 0);
  const depositAmount = Number(newDeposit.amount || 0);
  const insufficientDepositBalance = newDeposit.fromMethod && depositAmount > 0 && depositAmount > fromBalance;

  const handleSaveDeposit = () => {
    if (!newDeposit.amount || !newDeposit.fromMethod || !newDeposit.toMethod) return;
    if (depositAmount > fromBalance) return;
    addDeposit({
      amount: Number(newDeposit.amount),
      date: newDeposit.date,
      fromMethod: newDeposit.fromMethod,
      toMethod: newDeposit.toMethod,
    });
    setNewDeposit({
      amount: 0,
      date: format(new Date(), 'yyyy-MM-dd'),
      fromMethod: '',
      toMethod: '',
    });
    setIsDepositOpen(false);
  };

  const cashBalance = cashMethods.reduce((sum, method) => sum + Number(method.balance || 0), 0);
  const posBalance = bankMethods.reduce((sum, method) => sum + Number(method.balance || 0), 0);
  const totalReceived = cashBalance + posBalance;
  const cashTotal = cashBalance;
  const posTotal = posBalance;
  const outstandingBalance = customers.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);

  const customerComboboxOptions = useMemo(() => {
    return customers
      .map((customer) => {
        const label = customer.companyName || customer.name;
        return {
          value: customer.id,
          label,
          searchText: buildSearchableText(
            customer.name,
            customer.companyName,
            customer.phone,
            customer.phoneSecondary,
            customer.email,
          ),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [customers]);

  const proceduresForCustomer = useMemo(() => {
    if (!newPayment.customerId) return [];
    return procedures
      .filter((p) => p.customerId === newPayment.customerId)
      .map((p) => ({
        id: p.id,
        label: `${p.category} — ${p.date} (${p.status})`,
      }));
  }, [procedures, newPayment.customerId]);

  return (
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.payments')}</h1>
          <p className="text-gray-500">{t('payments.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-2">
          {!isEmployee && (
          <Dialog open={isDepositOpen} onOpenChange={setIsDepositOpen}>
            <DialogTrigger asChild>
              <button className="border border-gray-300 bg-white text-gray-700 px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-gray-100 transition-colors shadow-sm">
                <Plus className="size-4" />
                {t('payments.deposit')}
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden bg-white gap-0">
              <DialogHeader className="p-6 pb-2">
                <DialogTitle className="text-xl font-bold">{t('payments.depositTitle')}</DialogTitle>
                <DialogDescription className="text-sm text-gray-500">{t('payments.depositDesc')}</DialogDescription>
              </DialogHeader>
              <div className="p-6 pt-2 space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex flex-col items-center justify-center">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('payments.depositAmount')}</label>
                  <div className="flex items-center text-3xl font-bold text-gray-900">
                    <span className="text-lg text-gray-400 mr-1">AED</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      className="bg-transparent text-center w-40 outline-none placeholder:text-gray-300"
                      value={newDeposit.amount || ''}
                      onChange={(e) => setNewDeposit({ ...newDeposit, amount: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Calendar className="size-4 text-gray-400" /> {t('payments.date')}
                  </label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                    value={newDeposit.date}
                    onChange={(e) => setNewDeposit({ ...newDeposit, date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">{t('payments.depositFrom')}</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                    value={newDeposit.fromMethod}
                    onChange={(e) => setNewDeposit({ ...newDeposit, fromMethod: e.target.value, toMethod: e.target.value === newDeposit.toMethod ? '' : newDeposit.toMethod })}
                  >
                    <option value="">{t('payments.selectAccount') || 'Select account'}</option>
                    {bankCards.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.bankName} {method.methodType === 'cash' ? `(${t('paymentMethods.cash')})` : `(${t('paymentMethods.bank')})`}
                      </option>
                    ))}
                  </select>
                  {newDeposit.fromMethod && (
                    <p className="text-xs text-gray-500">
                      {t('payments.availableBalance') || 'Available balance'}: AED {fromBalance.toLocaleString()}
                    </p>
                  )}
                  {insufficientDepositBalance && (
                    <p className="text-sm text-amber-600 font-medium">
                      {t('payments.insufficientBalance') || 'Insufficient balance in the selected account.'}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">{t('payments.depositTo')}</label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                    value={newDeposit.toMethod}
                    onChange={(e) => setNewDeposit({ ...newDeposit, toMethod: e.target.value })}
                  >
                    <option value="">{t('payments.selectAccount') || 'Select account'}</option>
                    {bankCards.filter((method) => method.id !== newDeposit.fromMethod).map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.bankName} {method.methodType === 'cash' ? `(${t('paymentMethods.cash')})` : `(${t('paymentMethods.bank')})`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <DialogFooter className="p-6 border-t bg-gray-50 flex gap-2">
                <DialogClose asChild>
                  <button className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                    {t('common.cancel')}
                  </button>
                </DialogClose>
                <button
                  onClick={handleSaveDeposit}
                  disabled={!!insufficientDepositBalance}
                  className={cn(
                    "flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                    insufficientDepositBalance
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-black text-white hover:bg-gray-900"
                  )}
                >
                  {t('payments.saveDeposit')}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}

          <button
            type="button"
            onClick={openCreatePayment}
            className="bg-black text-white px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-gray-800 transition-colors shadow-sm"
          >
            <Plus className="size-4" />
            {t('payments.recordPayment')}
          </button>

          <Dialog
            open={isModalOpen}
            onOpenChange={(open) => {
              setIsModalOpen(open);
              if (!open) resetPaymentForm();
            }}
          >
          <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-white gap-0">
             <DialogHeader className="p-6 pb-2">
               <DialogTitle className="text-xl font-bold">
                 {editingPaymentId ? t('payments.editPayment') : t('payments.recordNew')}
               </DialogTitle>
               <DialogDescription className="text-sm text-gray-500">
                 {editingPaymentId ? t('payments.editPaymentDesc') : t('payments.recordDesc')}
               </DialogDescription>
             </DialogHeader>
             
             <div className="p-6 pt-2 space-y-4">
               {/* Amount Input - Prominent */}
               <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex flex-col items-center justify-center">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('payments.amountReceived')}</label>
                 <div className="flex items-center text-3xl font-bold text-gray-900">
                   <span className="text-lg text-gray-400 mr-1">AED</span>
                   <input 
                     type="number" 
                    placeholder={t('payments.amountPlaceholder')}
                     className="bg-transparent text-center w-40 outline-none placeholder:text-gray-300"
                     value={newPayment.amount || ''}
                     onChange={e => setNewPayment({...newPayment, amount: Number(e.target.value)})}
                     autoFocus
                   />
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Calendar className="size-4 text-gray-400" /> {t('payments.date')}
                   </label>
                   <input 
                     type="date"
                     className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                     value={newPayment.date}
                     onChange={e => setNewPayment({...newPayment, date: e.target.value})}
                   />
      </div>

                 <div className="space-y-2">
                   <label
                     htmlFor="payment-customer"
                     className="text-sm font-medium text-gray-700 flex items-center gap-2"
                   >
                    <User className="size-4 text-gray-400" /> {t('payments.customer')}
                   </label>
                   <SearchableCombobox
                     id="payment-customer"
                     ariaLabel={t('payments.customer')}
                     value={newPayment.customerId || ''}
                     onValueChange={(customerId) => {
                       const option = customerComboboxOptions.find((item) => item.value === customerId);
                       setNewPayment({
                         ...newPayment,
                         customerId,
                         customer: option?.label || '',
                         procedureId: '',
                       });
                     }}
                     options={customerComboboxOptions}
                     placeholder={t('payments.customerPlaceholder')}
                     searchPlaceholder={t('payments.searchCustomer')}
                     emptyText={t('payments.noCustomersFound')}
                     textAlign="left"
                     labelDir="auto"
                     popoverModal={false}
                     triggerClassName="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black bg-white"
                     contentClassName="max-h-[min(240px,45vh)]"
                   />
                 </div>
               </div>

               <div className="space-y-2">
                 <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <CreditCard className="size-4 text-gray-400" /> {t('payments.paymentMethod')}
                 </label>
                 <div className="grid grid-cols-3 gap-2">
                   {(['Cash', 'POS', 'Transfer'] as const).map(type => (
                     <div 
                       key={type}
                       onClick={() => setNewPayment({...newPayment, type})}
                       className={cn(
                         "cursor-pointer border rounded-md py-2 px-3 text-sm text-center font-medium transition-all",
                         newPayment.type === type 
                           ? "bg-black text-white border-black" 
                           : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                       )}
                     >
                      {t(`paymentMethods.${type.toLowerCase()}`)}
                     </div>
                   ))}
                 </div>
               </div>

              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="text-sm font-medium text-gray-700">
                  {newPayment.type === 'Cash' ? t('payments.cashMethod') : t('payments.bankMethod')}
                </label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                  value={newPayment.bankCard || ''}
                  onChange={(e) => setNewPayment({ ...newPayment, bankCard: e.target.value })}
                >
                  <option value="">
                    {newPayment.type === 'Cash'
                      ? t('payments.selectCashMethod')
                      : t('payments.selectBankMethod')}
                  </option>
                  {(newPayment.type === 'Cash' ? cashMethods : bankMethods).map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.bankName}
                    </option>
                  ))}
                </select>
              </div>

               <div className="space-y-2">
                 <label className="text-sm font-medium text-gray-700">{t('payments.linkedProcedure')}</label>
                 <select
                   className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                   value={newPayment.procedureId || ''}
                   onChange={(e) => setNewPayment({ ...newPayment, procedureId: e.target.value })}
                   disabled={!newPayment.customerId}
                 >
                   <option value="">{t('payments.noProcedureLink')}</option>
                   {proceduresForCustomer.map((proc) => (
                     <option key={proc.id} value={proc.id}>
                       {proc.label}
                     </option>
                   ))}
                 </select>
               </div>

               <div className="space-y-2">
                 <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <FileText className="size-4 text-gray-400" /> {t('payments.description')}
                 </label>
                 <input 
                   type="text"
                  placeholder={t('payments.descriptionPlaceholder')}
                   className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                   value={newPayment.description || ''}
                   onChange={e => setNewPayment({...newPayment, description: e.target.value})}
                 />
               </div>
            </div>

             <DialogFooter className="p-6 border-t bg-gray-50 flex gap-2">
               <DialogClose asChild>
                 <button className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                  {t('common.cancel')}
                 </button>
               </DialogClose>
               <button 
                 onClick={handleSavePayment}
                 disabled={saving}
                 className="flex-1 px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50"
               >
                {t('payments.savePayment')}
               </button>
             </DialogFooter>
          </DialogContent>
          </Dialog>

          <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('payments.deletePayment')}</AlertDialogTitle>
                <AlertDialogDescription>{t('payments.deletePaymentConfirm')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  className="bg-red-600 hover:bg-red-700"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleConfirmDelete();
                  }}
                >
                  {t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
            </div>
      </div>

      {/* Stats Cards - hidden for employees */}
      {!isEmployee && (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <StatCard label={t('payments.totalReceived')} value={totalReceived} />
        <StatCard label={t('paymentMethods.cash')} value={cashTotal} />
        <StatCard label={t('payments.posTransfer')} value={posTotal} />
        <StatCard label={t('payments.outstanding')} value={outstandingBalance} isRed />
      </div>
      )}

      {/* Payment method balances - hidden for employees */}
      {!isEmployee && bankCards.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8 shadow-sm">
          <h3 className="text-lg font-bold text-gray-900 mb-4">{t('payments.methodBalances')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {bankCards.map((card) => (
              <div key={card.id} className="flex items-center justify-between p-4 rounded-lg border border-gray-100 bg-gray-50">
                <div className="flex items-center gap-3">
                  <CreditCard className="size-5 text-gray-500" />
                  <div>
                    <p className="font-medium text-gray-900">{card.bankName}</p>
                    <p className="text-xs text-gray-500 capitalize">{card.methodType === 'cash' ? t('paymentMethods.cash') : t('paymentMethods.bank')}</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-gray-900">AED {Number(card.balance ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Payments & Deposits Table - same for all roles (API returns only employee's payments for employees) */}
      <div className="bg-white border border-gray-200 rounded-lg flex-1 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">{t('payments.recentTitle')}</h3>
          <p className="text-sm text-gray-500">{isEmployee ? (t('payments.recentDescYour') || 'Your payment transactions') : t('payments.recentDesc')}</p>
        </div>
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">{t('payments.date')}</label>
            <input
              type="date"
              className="border border-gray-200 rounded px-2 py-1 text-sm"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
            <span className="text-gray-400">–</span>
            <input
              type="date"
              className="border border-gray-200 rounded px-2 py-1 text-sm"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">{t('payments.paymentMethod') || 'Payment method'}</label>
            <select
              className="border border-gray-200 rounded px-2 py-1 text-sm bg-white min-w-[140px]"
              value={filterMethodId}
              onChange={(e) => setFilterMethodId(e.target.value)}
            >
              <option value="">{t('common.all') || 'All'}</option>
              {bankCards.map((card) => (
                <option key={card.id} value={card.id}>{card.bankName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">{t('payments.table.customer')}</label>
            <select
              className="border border-gray-200 rounded px-2 py-1 text-sm bg-white min-w-[160px]"
              value={filterCustomerId}
              onChange={(e) => setFilterCustomerId(e.target.value)}
            >
              <option value="">{t('common.all') || 'All'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName || c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs">
              <tr>
                <th className="px-6 py-4">{t('payments.table.id')}</th>
                <th className="px-6 py-4">{t('payments.table.date')}</th>
                <th className="px-6 py-4">{t('payments.recordType') || 'Type'}</th>
                <th className="px-6 py-4">{t('payments.table.customer')}</th>
                <th className="px-6 py-4">{t('payments.table.amount')}</th>
                <th className="px-6 py-4">{t('payments.table.type')}</th>
                <th className="px-6 py-4">{t('payments.table.description')}</th>
                <th className="px-6 py-4">{t('payments.table.bankCard')}</th>
                <th className="px-6 py-4">{t('payments.table.collectedBy') || 'Collected by'}</th>
                <th className="px-6 py-4 text-right">{t('payments.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recordsWithDeposits.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                    {t('payments.empty')}
                  </td>
                </tr>
              ) : (
                recordsWithDeposits.map((row) => (
                  <tr key={`${row.recordType}-${row.id}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">#{String(row.id).slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-gray-500">{row.date}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-semibold",
                        row.recordType === 'deposit' ? "bg-slate-100 text-slate-700" : "bg-blue-50 text-blue-700"
                      )}>
                        {row.recordType === 'deposit' ? (t('payments.deposit') || 'Deposit') : (t('payments.recordPayment') || 'Payment')}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{row.customer}</td>
                    <td className="px-6 py-4 font-bold text-gray-900">AED {row.amount.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      {row.recordType === 'payment' ? (
                        <span className={cn(
                          "px-2 py-1 rounded text-xs font-semibold",
                          row.type === 'Cash' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        )}>
                          {t(`paymentMethods.${row.type.toLowerCase()}`)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate">{row.description}</td>
                    <td className="px-6 py-4 text-gray-500">{row.bankCard}</td>
                    <td className="px-6 py-4 text-gray-500">{row.recordedBy}</td>
                    <td className="px-6 py-4 text-right">
                      {row.recordType === 'payment' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="text-gray-400 hover:text-gray-600 p-1">
                              <MoreHorizontal className="size-5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditPayment(row.id)}>
                              <Pencil className="mr-2 size-4" /> {t('common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setDeletePaymentId(row.id)}
                            >
                              <Trash2 className="mr-2 size-4" /> {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, isRed }: { label: string; value: number; isRed?: boolean }) {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
      <p className="text-sm font-medium text-gray-500 mb-4">{label}</p>
      <h3 className={cn("text-2xl font-bold", isRed ? "text-red-600" : "text-gray-900")}>
        AED {value.toLocaleString()}
      </h3>
    </div>
  );
}
