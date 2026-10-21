/**
 * Marketing display formatting only — never recalculate business metrics.
 * Backend returns Decimal/ratio strings; this module formats for locale UI.
 */

export function formatMarketingMoney(
  amount: string | number | null | undefined,
  currency = 'AED'
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${currency} ${n.toLocaleString('en-AE', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

/**
 * Format a backend ratio string (0–1) as a localized percentage.
 * Display-only: does not recompute the ratio.
 */
export function formatMarketingRatioPercent(
  ratio: string | null | undefined,
  fractionDigits = 1
): string {
  if (ratio === null || ratio === undefined || ratio === '') return '—';
  const n = Number(ratio);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  })}%`;
}

/** Format average hours string from backend for display. */
export function formatMarketingHours(hours: string | null | undefined): string {
  if (hours === null || hours === undefined || hours === '') return '—';
  const n = Number(hours);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

export function formatMarketingCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

/** ISO date YYYY-MM-DD → localized short date for display. */
export function formatMarketingIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dateOnly = iso.includes('T') ? iso.slice(0, 10) : iso;
  const d = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatMarketingRoas(multiplier: string | null | undefined): string {
  if (multiplier === null || multiplier === undefined || multiplier === '') return '—';
  const n = Number(multiplier);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}×`;
}

export function defaultReportDateFrom(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function defaultReportDateTo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
