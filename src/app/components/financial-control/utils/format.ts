export function fmtAed(n: number, _locale?: string) {
  return `AED ${Math.abs(n).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

export function fmtAedCompact(n: number, _locale?: string) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `AED ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `AED ${(abs / 1_000).toFixed(1)}K`;
  return fmtAed(n);
}

export function num(v: string | number | undefined | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  internal: 'Internal',
  customer: 'Customer',
  vendor: 'Vendor',
  employee: 'Employee',
  partner: 'Partner',
  government_provider: 'Government Provider',
  office_debt: 'Office Debt',
  vehicle: 'Vehicle',
  checks: 'Checks',
  other: 'Other',
};

export function accountTypeToApi(label: string): string {
  const map: Record<string, string> = {
    Internal: 'internal',
    Customer: 'customer',
    Vendor: 'vendor',
    Employee: 'employee',
    Partner: 'partner',
    'Government Provider': 'government_provider',
    'Office Debt': 'office_debt',
    Vehicle: 'vehicle',
    Checks: 'checks',
    Other: 'other',
  };
  return map[label] || label.toLowerCase().replace(/\s+/g, '_');
}
