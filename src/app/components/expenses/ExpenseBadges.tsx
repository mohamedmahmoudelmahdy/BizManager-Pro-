import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/app/components/ui/utils';
import { expenseStatusTone } from '@/app/lib/expenseFormat';
import type { ExpenseWorkflowStatus } from '@/app/lib/expenseTypes';

const toneClass: Record<ReturnType<typeof expenseStatusTone>, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-sky-50 text-sky-700',
  warning: 'bg-amber-50 text-amber-800',
  success: 'bg-emerald-50 text-emerald-700',
  danger: 'bg-rose-50 text-rose-700',
};

export function ExpenseStatusBadge({
  status,
  className,
}: {
  status: ExpenseWorkflowStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const tone = expenseStatusTone(status);
  const label = t(`expenses.status.${status}`, { defaultValue: status });

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        toneClass[tone],
        className
      )}
    >
      {label}
    </span>
  );
}

export function ExpenseCode({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-slate-600" dir="ltr">
      {children}
    </span>
  );
}
