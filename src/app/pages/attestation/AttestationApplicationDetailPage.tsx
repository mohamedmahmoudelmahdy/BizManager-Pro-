import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { AttestationPermissionGuard } from '@/app/components/attestation/AttestationPermissionGuard';
import {
  AttestationCode,
  AttestationStatusBadge,
} from '@/app/components/attestation/AttestationBadges';
import { useAttestationPermissions } from '@/app/hooks/useAttestationPermissions';
import { attestationApi } from '@/app/lib/attestationApi';
import { formatAttestationErrorMessage } from '@/app/lib/attestationErrors';
import {
  attestationInputClass,
  attestationLabelClass,
  formatAttestationDate,
  formatAttestationDateTime,
  isAllowedAttestationFile,
} from '@/app/lib/attestationFormat';
import type {
  ApplicationDocument,
  AttestationApplicationDetail,
  AttestationDocumentType,
} from '@/app/lib/attestationTypes';

function DocumentRow({
  doc,
  onDownload,
  downloading,
}: {
  doc: ApplicationDocument;
  onDownload: (doc: ApplicationDocument) => void;
  downloading: string | null;
}) {
  const { t, i18n } = useTranslation();
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0 flex items-start gap-2">
        <FileText className="size-4 mt-0.5 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 break-words">
            {t(`attestation.documentTypes.${doc.document_type}`)}
          </p>
          <p className="text-xs text-slate-500 break-all" dir="auto">
            {doc.original_filename || t('attestation.documents.unnamed')}
          </p>
          <p className="text-xs text-slate-400">
            {formatAttestationDateTime(doc.uploaded_at, i18n.language)}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={downloading === doc.id}
        onClick={() => onDownload(doc)}
        aria-label={t('attestation.actions.downloadNamed', {
          name: doc.original_filename || doc.document_type,
        })}
      >
        {downloading === doc.id ? (
          <Loader2 className="size-4 me-1.5 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4 me-1.5" aria-hidden />
        )}
        {t('attestation.actions.download')}
      </Button>
    </li>
  );
}

export function AttestationApplicationDetailPage() {
  const { applicationId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const perms = useAttestationPermissions();

  const [app, setApp] = useState<AttestationApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [dfRef, setDfRef] = useState('');
  const [dfDate, setDfDate] = useState('');
  const [dfProof, setDfProof] = useState<File | null>(null);
  const [dfResult, setDfResult] = useState<File | null>(null);

  const [mhRef, setMhRef] = useState('');
  const [mhDate, setMhDate] = useState('');
  const [mhProof, setMhProof] = useState<File | null>(null);

  const [equivFile, setEquivFile] = useState<File | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!applicationId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await attestationApi.getApplication(
          applicationId,
          signal ? { signal } : undefined
        );
        setApp(data);
        setNotes(data.internal_notes || '');
        setDfRef(data.dataflow_reference || '');
        setDfDate(data.dataflow_submitted_at || '');
        setMhRef(data.mohesr_reference || '');
        setMhDate(data.mohesr_submitted_at || '');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err);
        setApp(null);
      } finally {
        setLoading(false);
      }
    },
    [applicationId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const docsByType = useMemo(() => {
    const map = new Map<AttestationDocumentType, ApplicationDocument[]>();
    for (const doc of app?.documents ?? []) {
      const list = map.get(doc.document_type) || [];
      list.push(doc);
      map.set(doc.document_type, list);
    }
    return map;
  }, [app]);

  const hasDoc = (type: AttestationDocumentType) =>
    (docsByType.get(type)?.length ?? 0) > 0;

  const validateFile = (file: File | null): boolean => {
    if (!file) return true;
    if (!isAllowedAttestationFile(file)) {
      toast.error(t('attestation.errors.attestation_invalid_file_type'));
      return false;
    }
    return true;
  };

  const downloadDoc = async (doc: ApplicationDocument) => {
    setDownloading(doc.id);
    try {
      const blob = await attestationApi.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_filename || `${doc.document_type}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(formatAttestationErrorMessage(err, t));
    } finally {
      setDownloading(null);
    }
  };

  const saveNotes = async () => {
    if (!app || !perms.canEditNotes) return;
    setSavingNotes(true);
    try {
      const updated = await attestationApi.updateInternalNotes(app.id, {
        internal_notes: notes,
      });
      setApp(updated);
      setNotes(updated.internal_notes || '');
      toast.success(t('attestation.toasts.notesSaved'));
    } catch (err) {
      toast.error(formatAttestationErrorMessage(err, t));
    } finally {
      setSavingNotes(false);
    }
  };

  const runAction = async (fn: () => Promise<AttestationApplicationDetail>, successKey: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      setApp(updated);
      setNotes(updated.internal_notes || '');
      setDfRef(updated.dataflow_reference || '');
      setDfDate(updated.dataflow_submitted_at || '');
      setMhRef(updated.mohesr_reference || '');
      setMhDate(updated.mohesr_submitted_at || '');
      setDfProof(null);
      setDfResult(null);
      setMhProof(null);
      setEquivFile(null);
      toast.success(t(successKey));
    } catch (err) {
      toast.error(formatAttestationErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AttestationPermissionGuard>
        <div className="flex justify-center py-16 text-slate-400" role="status">
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <span className="sr-only">{t('attestation.loading')}</span>
        </div>
      </AttestationPermissionGuard>
    );
  }

  if (error || !app) {
    return (
      <AttestationPermissionGuard>
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-2">
              <p>{formatAttestationErrorMessage(error, t)}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                  {t('attestation.actions.retry')}
                </Button>
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/attestation">{t('attestation.actions.backToList')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AttestationPermissionGuard>
    );
  }

  const isCompleted = app.status === 'completed';
  const canShowDataflowForm = app.status === 'documents_received' && perms.canProcess;
  const canShowMohesrForm = app.status === 'dataflow_in_progress' && perms.canProcess;
  const canShowCompleteForm = app.status === 'mohesr_in_progress' && perms.canProcess;

  return (
    <AttestationPermissionGuard>
      <section className="space-y-5" aria-labelledby="attestation-detail-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Button type="button" variant="ghost" size="sm" asChild className="-ms-2">
              <Link to="/attestation">
                <ArrowLeft className="size-4 me-1.5" aria-hidden />
                {t('attestation.actions.backToList')}
              </Link>
            </Button>
            <h1
              id="attestation-detail-title"
              className="text-xl font-semibold text-slate-900 break-words"
            >
              {app.full_name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <AttestationCode>{app.reference_number}</AttestationCode>
              <AttestationStatusBadge status={app.status} />
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="size-4 me-2" aria-hidden />
            {t('attestation.actions.refresh')}
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            {t('attestation.batch.contextTitle')}
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">{t('attestation.batch.label')}</dt>
              <dd className="font-medium text-slate-900 break-words">{app.batch.title}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('attestation.batch.customer')}</dt>
              <dd className="font-medium text-slate-900 break-words">
                {app.batch.customer_name}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('attestation.batch.procedure')}</dt>
              <dd className="font-medium text-slate-900">
                <AttestationCode>{String(app.batch.procedure_id).slice(0, 8)}…</AttestationCode>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('attestation.batch.expected')}</dt>
              <dd className="font-medium text-slate-900 tabular-nums" dir="ltr">
                {app.batch.expected_applicant_count ?? '—'}
              </dd>
            </div>
          </dl>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">{t('attestation.tabs.overview')}</TabsTrigger>
            <TabsTrigger value="degrees">{t('attestation.tabs.degrees')}</TabsTrigger>
            <TabsTrigger value="documents">{t('attestation.tabs.documents')}</TabsTrigger>
            <TabsTrigger value="dataflow">{t('attestation.tabs.dataflow')}</TabsTrigger>
            <TabsTrigger value="mohesr">{t('attestation.tabs.mohesr')}</TabsTrigger>
            {perms.canViewNotes ? (
              <TabsTrigger value="notes">{t('attestation.tabs.notes')}</TabsTrigger>
            ) : null}
            <TabsTrigger value="history">{t('attestation.tabs.history')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">{t('attestation.fields.reference')}</dt>
                <dd>
                  <AttestationCode>{app.reference_number}</AttestationCode>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.status')}</dt>
                <dd className="mt-1">
                  <AttestationStatusBadge status={app.status} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.applicant')}</dt>
                <dd className="font-medium text-slate-900 break-words">{app.full_name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.phone')}</dt>
                <dd dir="ltr">{app.phone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.submittedAt')}</dt>
                <dd>{formatAttestationDateTime(app.submitted_at, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.updatedAt')}</dt>
                <dd>{formatAttestationDateTime(app.updated_at, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.completedAt')}</dt>
                <dd>{formatAttestationDateTime(app.completed_at, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.dataflowRef')}</dt>
                <dd>
                  {app.dataflow_reference ? (
                    <AttestationCode>{app.dataflow_reference}</AttestationCode>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.mohesrRef')}</dt>
                <dd>
                  {app.mohesr_reference ? (
                    <AttestationCode>{app.mohesr_reference}</AttestationCode>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </TabsContent>

          <TabsContent value="degrees" className="space-y-3">
            {app.degrees.length === 0 ? (
              <p className="text-sm text-slate-500">{t('attestation.empty.degrees')}</p>
            ) : (
              app.degrees.map((degree, index) => (
                <article
                  key={degree.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">
                    {t('attestation.degrees.heading', { n: index + 1 })}
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.studyLocation')}</dt>
                      <dd className="break-words">{degree.study_location}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.university')}</dt>
                      <dd className="break-words">{degree.university}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.degreeLevel')}</dt>
                      <dd className="break-words">{degree.degree_level}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.major')}</dt>
                      <dd className="break-words">{degree.major}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.period')}</dt>
                      <dd dir="ltr">
                        {degree.start_year} → {degree.completion_year}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{t('attestation.degrees.finalGrade')}</dt>
                      <dd className="break-words" dir="auto">
                        {degree.final_grade}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">
                {t('attestation.documents.applicantGroup')}
              </h3>
              <ul className="space-y-2">
                {(docsByType.get('passport') || []).map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onDownload={downloadDoc}
                    downloading={downloading}
                  />
                ))}
                {!hasDoc('passport') ? (
                  <li className="text-sm text-slate-500">{t('attestation.empty.document')}</li>
                ) : null}
              </ul>
            </section>

            {app.degrees.map((degree, index) => {
              const certs = (docsByType.get('degree_certificate') || []).filter(
                (d) => d.degree === degree.id
              );
              const transcripts = (docsByType.get('transcript') || []).filter(
                (d) => d.degree === degree.id
              );
              return (
                <section key={degree.id} className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {t('attestation.degrees.heading', { n: index + 1 })}
                  </h3>
                  <ul className="space-y-2">
                    {[...certs, ...transcripts].map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        onDownload={downloadDoc}
                        downloading={downloading}
                      />
                    ))}
                    {certs.length === 0 && transcripts.length === 0 ? (
                      <li className="text-sm text-slate-500">
                        {t('attestation.empty.document')}
                      </li>
                    ) : null}
                  </ul>
                </section>
              );
            })}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">
                {t('attestation.documents.operationalGroup')}
              </h3>
              <ul className="space-y-2">
                {(
                  [
                    'dataflow_payment_proof',
                    'dataflow_result',
                    'mohesr_payment_proof',
                    'final_equivalency',
                    'other_internal',
                  ] as AttestationDocumentType[]
                ).flatMap((type) => docsByType.get(type) || []).map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    onDownload={downloadDoc}
                    downloading={downloading}
                  />
                ))}
                {!(
                  hasDoc('dataflow_payment_proof') ||
                  hasDoc('dataflow_result') ||
                  hasDoc('mohesr_payment_proof') ||
                  hasDoc('final_equivalency') ||
                  hasDoc('other_internal')
                ) ? (
                  <li className="text-sm text-slate-500">{t('attestation.empty.document')}</li>
                ) : null}
              </ul>
            </section>
          </TabsContent>

          <TabsContent value="dataflow" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">{t('attestation.fields.dataflowRef')}</dt>
                <dd>
                  {app.dataflow_reference ? (
                    <AttestationCode>{app.dataflow_reference}</AttestationCode>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.dataflowSubmittedAt')}</dt>
                <dd>{formatAttestationDate(app.dataflow_submitted_at, i18n.language)}</dd>
              </div>
            </dl>

            {canShowDataflowForm ? (
              <form
                className="space-y-3 border-t border-slate-100 pt-4"
                onSubmit={(e) => e.preventDefault()}
              >
                <div>
                  <label htmlFor="df-ref" className={attestationLabelClass}>
                    {t('attestation.fields.dataflowRef')}
                  </label>
                  <input
                    id="df-ref"
                    className={attestationInputClass}
                    value={dfRef}
                    onChange={(e) => setDfRef(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label htmlFor="df-date" className={attestationLabelClass}>
                    {t('attestation.fields.dataflowSubmittedAt')}
                  </label>
                  <input
                    id="df-date"
                    type="date"
                    className={attestationInputClass}
                    value={dfDate}
                    onChange={(e) => setDfDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="df-proof" className={attestationLabelClass}>
                    {t('attestation.fields.dataflowPaymentProof')}
                  </label>
                  <input
                    id="df-proof"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="block w-full text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (validateFile(f)) setDfProof(f);
                      else e.target.value = '';
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="df-result" className={attestationLabelClass}>
                    {t('attestation.fields.dataflowResultOptional')}
                  </label>
                  <input
                    id="df-result"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="block w-full text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (validateFile(f)) setDfResult(f);
                      else e.target.value = '';
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          attestationApi.saveDataFlow(app.id, {
                            dataflow_reference: dfRef,
                            dataflow_submitted_at: dfDate || undefined,
                            dataflow_payment_proof: dfProof,
                            dataflow_result: dfResult,
                          }),
                        'attestation.toasts.dataflowSaved'
                      )
                    }
                  >
                    {t('attestation.actions.saveDataflow')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          attestationApi.setDataFlow(app.id, {
                            dataflow_reference: dfRef,
                            dataflow_submitted_at: dfDate || undefined,
                            dataflow_payment_proof: dfProof,
                            dataflow_result: dfResult,
                          }),
                        'attestation.toasts.dataflowMoved'
                      )
                    }
                  >
                    {t('attestation.actions.moveDataflow')}
                  </Button>
                </div>
              </form>
            ) : isCompleted || app.status !== 'documents_received' ? (
              <p className="text-sm text-slate-500">{t('attestation.workflow.readOnlyStage')}</p>
            ) : (
              <p className="text-sm text-slate-500">{t('attestation.permissionDenied.process')}</p>
            )}
          </TabsContent>

          <TabsContent value="mohesr" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">{t('attestation.fields.mohesrRef')}</dt>
                <dd>
                  {app.mohesr_reference ? (
                    <AttestationCode>{app.mohesr_reference}</AttestationCode>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('attestation.fields.mohesrSubmittedAt')}</dt>
                <dd>{formatAttestationDate(app.mohesr_submitted_at, i18n.language)}</dd>
              </div>
            </dl>

            {canShowMohesrForm ? (
              <form
                className="space-y-3 border-t border-slate-100 pt-4"
                onSubmit={(e) => e.preventDefault()}
              >
                <div>
                  <label htmlFor="mh-ref" className={attestationLabelClass}>
                    {t('attestation.fields.mohesrRef')}
                  </label>
                  <input
                    id="mh-ref"
                    className={attestationInputClass}
                    value={mhRef}
                    onChange={(e) => setMhRef(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label htmlFor="mh-date" className={attestationLabelClass}>
                    {t('attestation.fields.mohesrSubmittedAt')}
                  </label>
                  <input
                    id="mh-date"
                    type="date"
                    className={attestationInputClass}
                    value={mhDate}
                    onChange={(e) => setMhDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="mh-proof" className={attestationLabelClass}>
                    {t('attestation.fields.mohesrPaymentProof')}
                  </label>
                  <input
                    id="mh-proof"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="block w-full text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (validateFile(f)) setMhProof(f);
                      else e.target.value = '';
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          attestationApi.saveMOHESR(app.id, {
                            mohesr_reference: mhRef,
                            mohesr_submitted_at: mhDate || undefined,
                            mohesr_payment_proof: mhProof,
                          }),
                        'attestation.toasts.mohesrSaved'
                      )
                    }
                  >
                    {t('attestation.actions.saveMohesr')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () =>
                          attestationApi.setMOHESR(app.id, {
                            mohesr_reference: mhRef,
                            mohesr_submitted_at: mhDate || undefined,
                            mohesr_payment_proof: mhProof,
                          }),
                        'attestation.toasts.mohesrMoved'
                      )
                    }
                  >
                    {t('attestation.actions.moveMohesr')}
                  </Button>
                </div>
              </form>
            ) : app.status === 'documents_received' ? (
              <p className="text-sm text-slate-500">
                {t('attestation.workflow.completeDataflowFirst')}
              </p>
            ) : !perms.canProcess && app.status === 'dataflow_in_progress' ? (
              <p className="text-sm text-slate-500">
                {t('attestation.permissionDenied.process')}
              </p>
            ) : app.status === 'dataflow_in_progress' ? null : (
              <p className="text-sm text-slate-500">{t('attestation.workflow.readOnlyStage')}</p>
            )}

            {canShowCompleteForm ? (
              <form
                className="space-y-3 border-t border-slate-100 pt-4"
                onSubmit={(e) => e.preventDefault()}
              >
                <h3 className="text-sm font-semibold text-slate-800">
                  {t('attestation.tabs.completion')}
                </h3>
                <div>
                  <label htmlFor="final-equiv" className={attestationLabelClass}>
                    {t('attestation.fields.finalEquivalency')}
                  </label>
                  <input
                    id="final-equiv"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="block w-full text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (validateFile(f)) setEquivFile(f);
                      else e.target.value = '';
                    }}
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () =>
                        attestationApi.complete(app.id, {
                          final_equivalency: equivFile,
                        }),
                      'attestation.toasts.completed'
                    )
                  }
                >
                  {t('attestation.actions.markCompleted')}
                </Button>
              </form>
            ) : null}
          </TabsContent>

          {perms.canViewNotes ? (
            <TabsContent value="notes" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <label htmlFor="internal-notes" className={attestationLabelClass}>
                {t('attestation.fields.internalNotes')}
              </label>
              <Textarea
                id="internal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
                disabled={!perms.canEditNotes || savingNotes}
                className="whitespace-pre-wrap"
              />
              {perms.canEditNotes ? (
                <Button type="button" disabled={savingNotes} onClick={() => void saveNotes()}>
                  {savingNotes ? (
                    <Loader2 className="size-4 me-2 animate-spin" aria-hidden />
                  ) : null}
                  {t('attestation.actions.saveNotes')}
                </Button>
              ) : (
                <p className="text-sm text-slate-500">{t('attestation.permissionDenied.notes')}</p>
              )}
            </TabsContent>
          ) : null}

          <TabsContent value="history" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {app.status_history.length === 0 ? (
              <p className="text-sm text-slate-500">{t('attestation.empty.history')}</p>
            ) : (
              <ol className="space-y-3" aria-label={t('attestation.tabs.history')}>
                {app.status_history.map((item) => (
                  <li
                    key={item.id}
                    className="border-s-2 border-slate-200 ps-3 text-sm space-y-1"
                  >
                    <p className="font-medium text-slate-900 break-words">
                      {(item.from_status
                        ? t(`attestation.status.${item.from_status}`, {
                            defaultValue: item.from_status,
                          })
                        : t('attestation.history.none')) +
                        ' → ' +
                        t(`attestation.status.${item.to_status}`, {
                          defaultValue: item.to_status,
                        })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatAttestationDateTime(item.changed_at, i18n.language)}
                      {' · '}
                      {item.actor_source === 'public_submission'
                        ? t('attestation.history.publicSubmission')
                        : item.changed_by_username || t('attestation.history.unknownActor')}
                    </p>
                    {item.internal_note ? (
                      <p className="text-xs text-slate-600 whitespace-pre-wrap break-words">
                        {item.internal_note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </AttestationPermissionGuard>
  );
}
