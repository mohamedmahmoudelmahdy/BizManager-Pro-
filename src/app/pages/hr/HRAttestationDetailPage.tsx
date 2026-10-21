import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import {
  AttestationCode,
  AttestationStatusBadge,
} from '@/app/components/attestation/AttestationBadges';
import { hrAttestationApi } from '@/app/lib/hrAttestationApi';
import { formatAttestationErrorMessage } from '@/app/lib/attestationErrors';
import {
  formatAttestationDate,
  formatAttestationDateTime,
} from '@/app/lib/attestationFormat';
import type { HRApplicationDetail, HRDocument } from '@/app/lib/hrAttestationTypes';

function DocRow({
  doc,
  onDownload,
  busyId,
}: {
  doc: HRDocument;
  onDownload: (doc: HRDocument) => void;
  busyId: string | null;
}) {
  const { t, i18n } = useTranslation();
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0 flex gap-2">
        <FileText className="size-4 mt-0.5 text-slate-400 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">
            {t(`attestation.documentTypes.${doc.document_type}`, {
              defaultValue: doc.document_type,
            })}
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
        disabled={busyId === doc.id}
        onClick={() => onDownload(doc)}
      >
        {busyId === doc.id ? (
          <Loader2 className="size-4 me-1.5 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4 me-1.5" aria-hidden />
        )}
        {t('hrPortal.attestation.download')}
      </Button>
    </li>
  );
}

export function HRAttestationDetailPage() {
  const { applicationId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [app, setApp] = useState<HRApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!applicationId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await hrAttestationApi.getApplication(
          applicationId,
          signal ? { signal } : undefined
        );
        setApp(data);
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
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  const docsByType = useMemo(() => {
    const map = new Map<string, HRDocument[]>();
    for (const doc of app?.documents ?? []) {
      const list = map.get(doc.document_type) || [];
      list.push(doc);
      map.set(doc.document_type, list);
    }
    return map;
  }, [app]);

  const download = async (doc: HRDocument) => {
    setBusyId(doc.id);
    try {
      const blob = await hrAttestationApi.downloadDocument(doc.id);
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
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-400" role="status">
        <Loader2 className="size-8 animate-spin" aria-hidden />
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
        <div className="flex gap-2">
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>{formatAttestationErrorMessage(error, t)}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/hr/attestation">{t('hrPortal.attestation.back')}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const finalDocs = docsByType.get('final_equivalency') || [];

  return (
    <section className="space-y-5" aria-labelledby="hr-detail-title">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ms-2">
          <Link to="/hr/attestation">
            <ArrowLeft className="size-4 me-1.5" aria-hidden />
            {t('hrPortal.attestation.back')}
          </Link>
        </Button>
        <h1 id="hr-detail-title" className="text-xl font-semibold text-slate-900 break-words">
          {app.full_name}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <AttestationCode>{app.reference_number}</AttestationCode>
          <AttestationStatusBadge status={app.status} />
        </div>
      </div>

      {app.status === 'completed' && finalDocs.length > 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-emerald-950">
            {t('hrPortal.attestation.finalEquivalencyReady')}
          </h2>
          <ul className="space-y-2">
            {finalDocs.map((doc) => (
              <DocRow key={doc.id} doc={doc} onDownload={download} busyId={busyId} />
            ))}
          </ul>
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="overview">{t('attestation.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="degrees">{t('attestation.tabs.degrees')}</TabsTrigger>
          <TabsTrigger value="documents">{t('attestation.tabs.documents')}</TabsTrigger>
          <TabsTrigger value="dataflow">{t('attestation.tabs.dataflow')}</TabsTrigger>
          <TabsTrigger value="mohesr">{t('attestation.tabs.mohesr')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('hrPortal.attestation.timeline')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="rounded-lg border bg-white p-4 shadow-sm">
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
              <dd className="break-words font-medium">{app.full_name}</dd>
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
          </dl>
        </TabsContent>

        <TabsContent value="degrees" className="space-y-3">
          {app.degrees.map((degree, index) => (
            <article key={degree.id} className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold mb-3">
                {t('attestation.degrees.heading', { n: index + 1 })}
              </h2>
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
          ))}
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('attestation.documents.applicantGroup')}</h2>
            <ul className="space-y-2">
              {(docsByType.get('passport') || []).map((doc) => (
                <DocRow key={doc.id} doc={doc} onDownload={download} busyId={busyId} />
              ))}
              {!docsByType.get('passport')?.length ? (
                <li className="text-sm text-slate-500">{t('hrPortal.attestation.noDocument')}</li>
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
                <h2 className="text-sm font-semibold">
                  {t('attestation.degrees.heading', { n: index + 1 })}
                </h2>
                <ul className="space-y-2">
                  {[...certs, ...transcripts].map((doc) => (
                    <DocRow key={doc.id} doc={doc} onDownload={download} busyId={busyId} />
                  ))}
                </ul>
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="dataflow" className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
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
          <ul className="space-y-2">
            {[
              ...(docsByType.get('dataflow_payment_proof') || []),
              ...(docsByType.get('dataflow_result') || []),
            ].map((doc) => (
              <DocRow key={doc.id} doc={doc} onDownload={download} busyId={busyId} />
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="mohesr" className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
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
          <ul className="space-y-2">
            {(docsByType.get('mohesr_payment_proof') || []).map((doc) => (
              <DocRow key={doc.id} doc={doc} onDownload={download} busyId={busyId} />
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="timeline" className="rounded-lg border bg-white p-4 shadow-sm">
          <ol className="space-y-3" aria-label={t('hrPortal.attestation.timeline')}>
            {app.status_history.map((item) => (
              <li key={item.id} className="border-s-2 border-slate-200 ps-3 text-sm">
                <p className="font-medium">
                  {t(`attestation.status.${item.to_status}`, {
                    defaultValue: item.to_status,
                  })}
                </p>
                <p className="text-xs text-slate-500">
                  {formatAttestationDateTime(item.changed_at, i18n.language)}
                </p>
              </li>
            ))}
          </ol>
        </TabsContent>
      </Tabs>
    </section>
  );
}
