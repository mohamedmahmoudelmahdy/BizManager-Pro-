import React from 'react';
import { cn } from '@/app/components/ui/utils';

export function MarketingActiveBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
      )}
    >
      <span
        className={cn('me-1.5 size-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-slate-400')}
        aria-hidden
      />
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function MarketingCode({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-slate-600" dir="ltr">
      {children}
    </span>
  );
}
