import React from 'react';
import { cn } from '@/app/components/ui/utils';

export function LeadStatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'success' && 'bg-emerald-50 text-emerald-700',
        tone === 'warning' && 'bg-amber-50 text-amber-800',
        tone === 'danger' && 'bg-rose-50 text-rose-700',
        tone === 'info' && 'bg-sky-50 text-sky-700',
        tone === 'neutral' && 'bg-slate-100 text-slate-600'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          tone === 'success' && 'bg-emerald-500',
          tone === 'warning' && 'bg-amber-500',
          tone === 'danger' && 'bg-rose-500',
          tone === 'info' && 'bg-sky-500',
          tone === 'neutral' && 'bg-slate-400'
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function leadStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'converted':
      return 'success';
    case 'lost':
    case 'archived':
      return 'danger';
    case 'assigned':
    case 'in_progress':
    case 'qualified':
      return 'info';
    case 'contacted':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function formatUserLabel(user: {
  username?: string;
  first_name?: string;
  last_name?: string;
} | null | undefined): string {
  if (!user) return '—';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || '—';
}
