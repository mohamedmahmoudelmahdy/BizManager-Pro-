import React from 'react';
import { cn } from '@/app/components/ui/utils';
import { fmtAed } from '@/app/components/financial-control/utils/format';

export function CurrencyAmount({
  value,
  className,
  compact,
}: {
  value: number | string;
  className?: string;
  compact?: boolean;
}) {
  const numeric = Number(value);
  const abs = Math.abs(numeric);
  const text = compact
    ? abs >= 1000
      ? `AED ${(abs / 1000).toFixed(1)}K`
      : fmtAed(abs)
    : fmtAed(abs);
  return (
    <span
      className={cn(
        'font-mono font-semibold',
        numeric < 0 ? 'text-rose-600' : 'text-slate-900',
        className
      )}
    >
      {numeric < 0 ? '-' : ''}
      {text}
    </span>
  );
}
