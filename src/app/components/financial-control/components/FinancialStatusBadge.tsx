import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/app/components/ui/utils';

const STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-600',
  inactive: 'bg-slate-100 text-slate-500',
  draft: 'bg-slate-100 text-slate-600',
  posted: 'bg-blue-50 text-blue-700',
  reconciled: 'bg-green-50 text-green-700',
  reversed: 'bg-rose-50 text-rose-700',
  pending: 'bg-slate-100 text-slate-600',
  due_soon: 'bg-orange-50 text-orange-700',
  deducted: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  bounced: 'bg-rose-50 text-rose-700',
  replaced: 'bg-violet-50 text-violet-700',
  overdue: 'bg-rose-50 text-rose-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-50 text-emerald-700',
  high: 'bg-rose-50 text-rose-700',
  medium: 'bg-orange-50 text-orange-700',
  low: 'bg-slate-100 text-slate-500',
  none: 'bg-slate-100 text-slate-400',
  manual: 'bg-slate-100 text-slate-600',
  payroll: 'bg-violet-50 text-violet-700',
  check: 'bg-amber-50 text-amber-700',
  debt: 'bg-rose-50 text-rose-700',
  preview: 'bg-blue-50 text-blue-700',
  validated: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  valid: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  error: 'bg-rose-50 text-rose-700',
  High: 'bg-rose-50 text-rose-700',
  Medium: 'bg-orange-50 text-orange-700',
  Low: 'bg-slate-100 text-slate-500',
};

export function FinancialStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = `financialControl.status.${status}`;
  const label = t(key, { defaultValue: status.replace(/_/g, ' ') });
  const normalized = status.toLowerCase().replace(/\s+/g, '_');
  return (
    <span
      className={cn(
        'inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
        STYLES[normalized] || STYLES[status] || 'bg-slate-100 text-slate-600'
      )}
    >
      {label}
    </span>
  );
}
