/** Formatting helpers for Attestation UI. */

export const attestationInputClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300';

export const attestationLabelClass =
  'mb-1.5 block text-xs font-semibold text-slate-600';

export function formatAttestationDateTime(
  value: string | null | undefined,
  locale?: string
): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAttestationDate(
  value: string | null | undefined,
  locale?: string
): string {
  if (!value) return '—';
  // Date-only YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(locale || undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const ATTESTATION_ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

export function isAllowedAttestationFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  return ATTESTATION_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}
