import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  Search, 
  Calendar,
  User,
  FileText,
  Tag,
  Receipt
} from 'lucide-react';
import { cn } from '@/app/components/ui/utils';
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
import { format } from 'date-fns';

type ExpenseRecord = {
  id: string;
  date: string;
  category: string;
  amount: number;
  paidBy: string;
  employee: string;
  notes: string;
};

const categoryOptions = [
  { value: 'Office', labelKey: 'expenses.categories.office' },
  { value: 'Government Fees', labelKey: 'expenses.categories.governmentFees' },
  { value: 'Salaries', labelKey: 'expenses.categories.salaries' },
  { value: 'Utilities', labelKey: 'expenses.categories.utilities' },
  { value: 'Other', labelKey: 'expenses.categories.other' },
] as const;

export function ExpensesPage() {
  const { t } = useTranslation();
  const { expenses, employees, bankCards, addExpense, ensureLoaded } = useData();

  useEffect(() => {
    void ensureLoaded(['expenses', 'employees', 'bankCards'], { forceFinancial: true });
  }, [ensureLoaded]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState<Partial<ExpenseRecord>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    category: 'Office'
  });

  const expensesUi = useMemo<ExpenseRecord[]>(() => {
    return expenses.map((expense) => ({
      id: expense.id,
      date: expense.date,
      category: expense.category === 'government-fees' ? 'Government Fees'
        : expense.category === 'salaries' ? 'Salaries'
        : expense.category === 'office' ? 'Office'
        : 'Other',
      amount: Number(expense.amount || 0),
      paidBy: expense.paidBy,
      employee: expense.assignedEmployee || '-',
      notes: expense.notes || '-',
    }));
  }, [expenses]);

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'Office':
        return t('expenses.categories.office');
      case 'Government Fees':
        return t('expenses.categories.governmentFees');
      case 'Salaries':
        return t('expenses.categories.salaries');
      case 'Utilities':
        return t('expenses.categories.utilities');
      default:
        return t('expenses.categories.other');
    }
  };

  const getPaidByLabel = (paidBy: string) => {
    const method = bankCards.find((card) => card.id === paidBy);
    return method ? method.bankName : t('common.na');
  };

  const handleSaveExpense = () => {
    if (!newExpense.amount || !newExpense.category || !newExpense.paidBy) return;

    const categoryMap: Record<string, 'office' | 'government-fees' | 'salaries' | 'misc'> = {
      Office: 'office',
      'Government Fees': 'government-fees',
      Salaries: 'salaries',
      Utilities: 'misc',
      Other: 'misc',
    };
    const matchedEmployee = employees.find(
      (employee) => employee.name.toLowerCase() === (newExpense.employee || '').toLowerCase()
    );

    addExpense({
      date: newExpense.date || format(new Date(), 'yyyy-MM-dd'),
      category: categoryMap[newExpense.category] || 'office',
      amount: Number(newExpense.amount),
      paidBy: newExpense.paidBy,
      assignedEmployee: matchedEmployee?.id,
      notes: newExpense.notes || '',
    });

    setNewExpense({
      date: format(new Date(), 'yyyy-MM-dd'),
      category: 'Office',
      amount: undefined,
      paidBy: '',
      employee: '',
      notes: ''
    });
    setIsModalOpen(false);
  };

  const totalExpenses = expensesUi.reduce((sum, e) => sum + e.amount, 0);
  const officeExpenses = expensesUi.filter(e => e.category === 'Office').reduce((sum, e) => sum + e.amount, 0);
  const govFees = expensesUi.filter(e => e.category === 'Government Fees').reduce((sum, e) => sum + e.amount, 0);
  const thisMonthExpenses = totalExpenses;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.expenses')}</h1>
          <p className="text-gray-500">{t('expenses.subtitle')}</p>
        </div>
        
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <button className="bg-black text-white px-4 py-2 rounded-md font-medium flex items-center gap-2 hover:bg-gray-800 transition-colors shadow-sm">
              <Plus className="size-4" />
              {t('expenses.addExpense')}
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-white gap-0">
             <DialogHeader className="p-6 pb-2">
               <DialogTitle className="text-xl font-bold">{t('expenses.recordTitle')}</DialogTitle>
               <DialogDescription className="text-gray-500">{t('expenses.recordDesc')}</DialogDescription>
             </DialogHeader>
             
             <div className="p-6 pt-2 space-y-4">
               {/* Amount Input */}
               <div className="bg-red-50 p-4 rounded-lg border border-red-100 flex flex-col items-center justify-center">
                <label className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">{t('expenses.amount')}</label>
                 <div className="flex items-center text-3xl font-bold text-gray-900">
                   <span className="text-lg text-gray-400 mr-1">AED</span>
                   <input 
                     type="number" 
                    placeholder={t('expenses.amountPlaceholder')}
                     className="bg-transparent text-center w-40 outline-none placeholder:text-gray-300"
                     value={newExpense.amount || ''}
                     onChange={e => setNewExpense({...newExpense, amount: Number(e.target.value)})}
                     autoFocus
                   />
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Calendar className="size-4 text-gray-400" /> {t('expenses.date')}
                   </label>
                   <input 
                     type="date"
                     className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                     value={newExpense.date}
                     onChange={e => setNewExpense({...newExpense, date: e.target.value})}
                   />
                 </div>
                 
                 <div className="space-y-2">
                   <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Tag className="size-4 text-gray-400" /> {t('expenses.category')}
                   </label>
                   <select
                     className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                     value={newExpense.category}
                     onChange={e => setNewExpense({...newExpense, category: e.target.value})}
                   >
                    {categoryOptions.map((category) => (
                      <option key={category.value} value={category.value}>
                        {t(category.labelKey)}
                      </option>
                     ))}
                   </select>
                 </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                   <Receipt className="size-4 text-gray-400" /> {t('expenses.paidBy')}
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none bg-white"
                    value={newExpense.paidBy || ''}
                    onChange={(e) => setNewExpense({ ...newExpense, paidBy: e.target.value })}
                  >
                    <option value="">{t('expenses.paidByPlaceholder')}</option>
                    {bankCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.bankName}
                      </option>
                    ))}
                  </select>
                </div>
                 
                 <div className="space-y-2">
                   <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <User className="size-4 text-gray-400" /> {t('expenses.table.employee')}
                  </label>
                  <input 
                    type="text"
                    placeholder={t('expenses.employeePlaceholder')}
                     className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none"
                     value={newExpense.employee || ''}
                     onChange={e => setNewExpense({...newExpense, employee: e.target.value})}
                   />
                 </div>
               </div>

               <div className="space-y-2">
                 <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <FileText className="size-4 text-gray-400" /> {t('expenses.notes')}
                 </label>
                 <textarea
                  placeholder={t('expenses.notesPlaceholder')}
                   className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-black focus:border-black outline-none min-h-[80px] resize-none"
                   value={newExpense.notes || ''}
                   onChange={e => setNewExpense({...newExpense, notes: e.target.value})}
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
                 onClick={handleSaveExpense}
                 className="flex-1 px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-900 transition-colors"
               >
                {t('expenses.saveExpense')}
               </button>
             </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard label={t('expenses.totalExpenses')} value={totalExpenses} />
        <StatCard label={t('expenses.categories.office')} value={officeExpenses} />
        <StatCard label={t('expenses.categories.governmentFees')} value={govFees} />
        <StatCard label={t('expenses.thisMonth')} value={thisMonthExpenses} />
      </div>

      {/* Expense Records Table */}
      <div className="bg-white border border-gray-200 rounded-lg flex-1 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">{t('expenses.recordsTitle')}</h3>
          <p className="text-sm text-gray-500">{t('expenses.recordsDesc')}</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium text-xs">
              <tr>
                <th className="px-6 py-4">{t('expenses.table.id')}</th>
                <th className="px-6 py-4">{t('expenses.table.date')}</th>
                <th className="px-6 py-4">{t('expenses.table.category')}</th>
                <th className="px-6 py-4">{t('expenses.table.amount')}</th>
                <th className="px-6 py-4">{t('expenses.table.paidBy')}</th>
                <th className="px-6 py-4">{t('expenses.table.employee')}</th>
                <th className="px-6 py-4">{t('expenses.table.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expensesUi.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-gray-400 italic">
                    {t('expenses.empty')}
                  </td>
                </tr>
              ) : (
                expensesUi.map(expense => (
                  <tr key={expense.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">#{expense.id}</td>
                    <td className="px-6 py-4 text-gray-500">{expense.date}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-gray-100 rounded text-xs font-semibold text-gray-700">
                        {getCategoryLabel(expense.category)}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-bold text-gray-900">AED {expense.amount.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-600">{getPaidByLabel(expense.paidBy)}</td>
                    <td className="px-6 py-4 text-gray-600">{expense.employee}</td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate">{expense.notes}</td>
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm min-h-[140px] flex flex-col justify-between">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <h3 className="text-3xl font-bold text-gray-900">
        AED {value.toLocaleString()}
      </h3>
    </div>
  );
}
