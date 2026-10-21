export const fmtCurrency = (n: number) => `AED ${Math.abs(n).toLocaleString('en-AE')}`;

export const fmtCurrencyCompact = (n: number) => {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1)}K`;
  return fmtCurrency(n);
};

export type PayrollStatus = 'Paid' | 'Pending' | 'Overdue';

export const perfColor = (level: string) =>
  ({
    High: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Medium: 'bg-amber-50 text-amber-700 border-amber-200',
    Low: 'bg-rose-50 text-rose-700 border-rose-200',
  }[level] || 'bg-slate-50 text-slate-600');

export const perfDot = (level: string) =>
  ({
    High: 'bg-emerald-500',
    Medium: 'bg-amber-500',
    Low: 'bg-rose-500',
  }[level] || 'bg-slate-400');

export const roleColor = (role: string) =>
  role === 'Administrator'
    ? 'bg-violet-50 text-violet-700'
    : role === 'Manager'
      ? 'bg-blue-50 text-blue-700'
      : role === 'Marketer'
        ? 'bg-teal-50 text-teal-700'
        : 'bg-slate-50 text-slate-600';

export const payrollColor = (status: PayrollStatus) =>
  ({ Paid: 'text-emerald-600', Pending: 'text-amber-600', Overdue: 'text-rose-600' }[status]);
