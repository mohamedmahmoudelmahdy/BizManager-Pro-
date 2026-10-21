import { useTranslation } from 'react-i18next';
import { cn } from '@/app/components/ui/utils';
import type { AttestationStatus } from '@/app/lib/attestationTypes';

const STATUS_TONES: Record<AttestationStatus, string> = {
  documents_received: 'bg-sky-50 text-sky-800 ring-sky-200',
  dataflow_in_progress: 'bg-amber-50 text-amber-900 ring-amber-200',
  mohesr_in_progress: 'bg-violet-50 text-violet-900 ring-violet-200',
  completed: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
};

export function AttestationStatusBadge({ status }: { status: AttestationStatus | string }) {
  const { t } = useTranslation();
  const tone = STATUS_TONES[status as AttestationStatus] || 'bg-slate-50 text-slate-700 ring-slate-200';
  const label = t(`attestation.status.${status}`, { defaultValue: status });

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset break-words',
        tone
      )}
    >
      <span className="sr-only">{t('attestation.statusLabel')}: </span>
      {label}
    </span>
  );
}

export function AttestationCode({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="font-mono text-sm text-slate-800 tabular-nums">
      {children}
    </span>
  );
}
