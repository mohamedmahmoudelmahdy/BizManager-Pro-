import React from 'react';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/app/components/ui/utils';

export function KpiCard({
  label,
  value,
  sub,
  icon,
  iconBg,
  trend,
  warn,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  iconBg?: string;
  trend?: 'up' | 'down';
  warn?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={cn(
        'bg-white rounded-xl border shadow-sm p-4 flex items-start gap-3 transition-all',
        warn ? 'border-orange-200' : 'border-slate-100',
        onClick && 'cursor-pointer hover:shadow-md hover:border-slate-300'
      )}
    >
      {icon && iconBg ? (
        <div className={cn('p-2 rounded-lg flex-shrink-0', iconBg)}>{icon}</div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-400 font-medium truncate">{label}</div>
        <div className="text-lg font-bold text-slate-900 leading-tight mt-0.5">{value}</div>
        {sub && (
          <div
            className={cn(
              'text-xs mt-0.5 flex items-center gap-1',
              trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-slate-400'
            )}
          >
            {trend === 'up' && <TrendingUp className="size-3" />}
            {trend === 'down' && <TrendingDown className="size-3" />}
            {sub}
          </div>
        )}
      </div>
      {warn && <AlertTriangle className="size-4 text-orange-500 flex-shrink-0 mt-0.5" />}
    </div>
  );
}
