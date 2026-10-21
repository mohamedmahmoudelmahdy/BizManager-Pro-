import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  CreditCard, 
  Landmark, 
  Wallet, 
  MoreVertical, 
  Check,
  Building2,
  Trash2,
  Pencil,
  FileText,
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
import { useData } from '@/app/contexts/DataContext';
import { format } from 'date-fns';
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
} from "@/app/components/ui/dropdown-menu";

type PaymentMethod = {
  id: string;
  name: string;
  type: 'Bank' | 'Cash';
  details: string;
  balance: number;
  isDefault?: boolean;
};

export function PaymentMethodsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bankCards, addBankCard, updateBankCard, removeBankCard, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['bankCards'], { forceFinancial: true });
  }, [ensureLoaded]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [newMethod, setNewMethod] = useState<Partial<PaymentMethod>>({ type: 'Bank' });
  const [cardDetails, setCardDetails] = useState({ number: '', expiry: '', holder: '' });

  const mapType = (methodType: string) => {
    return methodType === 'cash' ? 'Cash' : 'Bank';
  };

  const methods = useMemo<PaymentMethod[]>(() => {
    return bankCards.map((card) => ({
      id: card.id,
      name: card.bankName,
      type: mapType(card.methodType || 'bank'),
      details: card.notes || card.iban || card.accountNumber || `**** **** **** ${card.last4}`,
      balance: Number(card.balance || 0),
      isDefault: false,
    }));
  }, [bankCards]);

  const handleOpenAdd = () => {
    setEditingId(null);
    setNewMethod({ type: 'Bank', name: '', details: '', balance: 0 });
    setCardDetails({ number: '', expiry: '', holder: '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (method: PaymentMethod) => {
    const card = bankCards.find((item) => item.id === method.id);
    if (!card) return;
    setEditingId(method.id);
    setNewMethod({
      name: method.name,
      type: method.type,
      details: method.details,
      balance: method.balance
    });
    const expiry = card.expiryMonth && card.expiryYear ? `${card.expiryMonth}/${card.expiryYear.slice(-2)}` : '';
    setCardDetails({ number: card.cardNumber || '', expiry, holder: card.cardholderName || '' });
    
    setIsModalOpen(true);
  };

  const handleSaveMethod = () => {
    if (!newMethod.name) return;

    const details = newMethod.details || '';
    const [rawMonth, rawYear] = (cardDetails.expiry || '').split('/');
    const expiryMonth = (rawMonth || '01').padStart(2, '0');
    const expiryYear = rawYear ? `20${rawYear}` : String(new Date().getFullYear());
    const cardNumber = cardDetails.number || '0000';
    const cardholderName = cardDetails.holder || newMethod.name || '';

    if (editingId) {
      updateBankCard(editingId, {
        bankName: newMethod.name || '',
        cardholderName,
        cardType: newMethod.type || 'Bank',
        cardNumber,
        expiryMonth,
        expiryYear,
        notes: details,
        methodType: newMethod.type === 'Cash' ? 'cash' : 'bank',
        balance: Number(newMethod.balance || 0),
      });
    } else {
      addBankCard({
        bankName: newMethod.name!,
        cardholderName,
        cardType: newMethod.type || 'Bank',
        cardNumber,
        last4: cardNumber.slice(-4),
        expiryMonth,
        expiryYear,
        notes: details,
        methodType: newMethod.type === 'Cash' ? 'cash' : 'bank',
        balance: Number(newMethod.balance || 0),
      });
    }

    setIsModalOpen(false);
  };

  const handleDeleteMethod = (id: string) => {
    removeBankCard(id);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'Bank': return Landmark;
      case 'Cash': return Wallet;
      default: return Building2;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('financialControl.nav.paymentMethods')}</h2>
          <p className="text-slate-500 text-sm mt-1">{t('paymentMethodsPage.subtitle')}</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <button 
              onClick={handleOpenAdd}
              className="bg-black text-white px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-gray-800 transition-colors shadow-sm"
            >
              <Plus className="size-4" />
              {t('paymentMethodsPage.addMethod')}
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingId ? t('paymentMethodsPage.editTitle') : t('paymentMethodsPage.addTitle')}</DialogTitle>
              <DialogDescription>
                {editingId ? t('paymentMethodsPage.editDesc') : t('paymentMethodsPage.addDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right text-sm font-medium text-gray-500">
                  {t('paymentMethodsPage.type')}
                </label>
                <div className="col-span-3 flex gap-2">
                  {['Bank', 'Cash'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setNewMethod({ ...newMethod, type: type as any })}
                      className={cn(
                        "px-3 py-1 text-xs rounded-full border transition-all",
                        newMethod.type === type 
                          ? "bg-black text-white border-black" 
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      )}
                    >
                      {t(`paymentMethods.${type.toLowerCase()}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right text-sm font-medium text-gray-500">
                  {t('paymentMethodsPage.balance')}
                </label>
                <input
                  type="number"
                  value={newMethod.balance ?? 0}
                  onChange={(e) => setNewMethod({ ...newMethod, balance: Number(e.target.value) })}
                  placeholder="0.00"
                  className="col-span-3 h-9 px-3 rounded-md border border-gray-200 text-sm outline-none focus:border-black"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right text-sm font-medium text-gray-500">
                  {t('paymentMethodsPage.name')}
                </label>
                <input
                  value={newMethod.name || ''}
                  onChange={(e) => setNewMethod({ ...newMethod, name: e.target.value })}
                  placeholder={t('paymentMethodsPage.namePlaceholder')}
                  className="col-span-3 h-9 px-3 rounded-md border border-gray-200 text-sm outline-none focus:border-black"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right text-sm font-medium text-gray-500">
                  {t('paymentMethodsPage.details')}
                </label>
                <input
                  value={newMethod.details || ''}
                  onChange={(e) => setNewMethod({ ...newMethod, details: e.target.value })}
                  placeholder={newMethod.type === 'Cash' ? t('paymentMethodsPage.cashLocationPlaceholder') : t('paymentMethodsPage.ibanPlaceholder')}
                  className="col-span-3 h-9 px-3 rounded-md border border-gray-200 text-sm outline-none focus:border-black"
                />
              </div>
            </div>
            <DialogFooter>
              <button 
                onClick={handleSaveMethod}
                className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-900"
              >
                {editingId ? t('paymentMethodsPage.updateMethod') : t('paymentMethodsPage.saveMethod')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {methods.map((method) => {
          const Icon = getIcon(method.type);
          return (
            <div key={method.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative group hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div className={cn(
                  "p-3 rounded-lg",
                  method.type === 'Bank' && "bg-blue-50 text-blue-600",
                  method.type === 'Cash' && "bg-green-50 text-green-600",
                )}>
                  <Icon className="size-6" />
                </div>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenEdit(method)}>
                      <Pencil className="mr-2 size-4" /> {t('common.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-red-600 focus:text-red-600"
                      onClick={() => handleDeleteMethod(method.id)}
                    >
                      <Trash2 className="mr-2 size-4" /> {t('common.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              
              <div className="mb-4">
                <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                  {method.name}
                  {method.isDefault && (
                    <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">
                      {t('paymentMethodsPage.default')}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 font-mono mt-1">{method.details}</p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-end justify-between">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium mb-1">{t('paymentMethodsPage.currentBalance')}</p>
                  <p className="text-xl font-bold text-gray-900">AED {method.balance.toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/financial-control/payment-methods/${method.id}`)}
                  className="text-sm font-medium text-gray-600 hover:text-black border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                >
                  <FileText className="size-3.5" />
                  {t('paymentMethodsPage.viewStatement')}
                </button>
              </div>
            </div>
          );
        })}
        
        {/* Add New Card Placeholder */}
        <button 
          onClick={handleOpenAdd}
          className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors min-h-[200px]"
        >
          <div className="size-12 rounded-full bg-gray-50 flex items-center justify-center">
            <Plus className="size-6" />
          </div>
          <span className="font-medium">{t('paymentMethodsPage.addNew')}</span>
        </button>
      </div>

    </div>
  );
}
