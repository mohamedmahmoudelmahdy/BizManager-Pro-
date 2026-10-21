import React, { useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import {
  createEmptyDegree,
  createEmptyPublicFormState,
  createIdempotencyKey,
  getPublicAttestationSlug,
  publicAttestationApi,
} from '@/app/lib/publicAttestationApi';
import {
  BRAND_LOGO_FULL,
  brandPrimaryBtnClass,
  brandSecondaryBtnClass,
} from '@/app/lib/publicAttestationBrand';
import '@/styles/public-attestation-brand.css';
import {
  formatPublicAttestationErrorMessage,
  isBatchUnavailableError,
  mapPublicAttestationErrorToFields,
} from '@/app/lib/publicAttestationErrors';
import {
  formatFileSize,
  firstFieldErrorKey,
  totalSelectedFileBytes,
  validatePublicAttestationFile,
  validatePublicAttestationForm,
  type FieldErrors,
} from '@/app/lib/publicAttestationValidation';
import type {
  PublicAttestationDegreeInput,
  PublicAttestationFormState,
  PublicAttestationSubmissionResponse,
} from '@/app/lib/publicAttestationTypes';
import {
  PUBLIC_ATTESTATION_MAX_TOTAL_BYTES,
  PUBLIC_ATTESTATION_NAME_MAX,
  PUBLIC_ATTESTATION_PHONE_MAX,
} from '@/app/lib/publicAttestationTypes';
import {
  attestationInputClass,
  attestationLabelClass,
} from '@/app/lib/attestationFormat';

type ViewMode = 'form' | 'review' | 'success' | 'unavailable';

function fieldId(base: string, suffix: string) {
  return `${base}-${suffix}`;
}

function FilePicker({
  id,
  label,
  file,
  error,
  disabled,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  file: File | null;
  error?: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `${id}-error`;
  const [pickError, setPickError] = useState<string | null>(null);
  const shownError = pickError || error;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={attestationLabelClass}>
        {label}
        <span className="text-red-600" aria-hidden>
          {' '}
          *
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          disabled={disabled}
          aria-invalid={Boolean(shownError)}
          aria-describedby={shownError ? errorId : undefined}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (!next) {
              setPickError(null);
              onChange(null);
              return;
            }
            const typeErr = validatePublicAttestationFile(
              next,
              t,
              'attestationPublic.errors.required'
            );
            if (
              typeErr === t('attestationPublic.errors.unsupportedFileType') ||
              typeErr === t('attestationPublic.errors.fileTooLarge')
            ) {
              setPickError(typeErr);
              onChange(null);
              return;
            }
            setPickError(null);
            onChange(next);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={brandSecondaryBtnClass}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {file ? t('attestationPublic.actions.replaceFile') : t('attestationPublic.actions.chooseFile')}
        </Button>
        {file ? (
          <button
            type="button"
            className="text-xs text-slate-500 underline-offset-2 hover:underline"
            disabled={disabled}
            onClick={() => {
              setPickError(null);
              onClear();
            }}
          >
            {t('attestationPublic.actions.clearFile')}
          </button>
        ) : null}
      </div>
      {file ? (
        <p className="text-xs text-slate-600 break-all" dir="auto">
          <span className="font-medium">{file.name}</span>
          <span className="text-slate-400"> · {formatFileSize(file.size)}</span>
        </p>
      ) : (
        <p className="text-xs text-slate-400">{t('attestationPublic.file.hint')}</p>
      )}
      {shownError ? (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}

function DegreeCard({
  degree,
  index,
  total,
  errors,
  disabled,
  formId,
  onChange,
  onRemove,
}: {
  degree: PublicAttestationDegreeInput;
  index: number;
  total: number;
  errors: FieldErrors;
  disabled?: boolean;
  formId: string;
  onChange: (next: PublicAttestationDegreeInput) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const prefix = `degree_${index}`;
  const canRemove = total > 1;

  const setField = <K extends keyof PublicAttestationDegreeInput>(
    key: K,
    value: PublicAttestationDegreeInput[K]
  ) => onChange({ ...degree, [key]: value });

  return (
    <section
      className="brand-degree-card rounded-xl border bg-white p-4 sm:p-5 space-y-4 shadow-sm"
      aria-labelledby={fieldId(formId, `${prefix}-title`)}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          id={fieldId(formId, `${prefix}-title`)}
          className="brand-section-title text-sm font-semibold"
        >
          {t('attestationPublic.degree.title', { n: index + 1 })}
        </h3>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t('attestationPublic.actions.removeDegreeNamed', { n: index + 1 })}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('attestationPublic.actions.removeDegree')}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['study_location', 'studyLocation'],
            ['university', 'university'],
            ['degree_level', 'degreeLevel'],
            ['major', 'major'],
          ] as const
        ).map(([field, labelKey]) => {
          const id = fieldId(formId, `${prefix}_${field}`);
          const err = errors[`${prefix}_${field}`];
          return (
            <div key={field} className={field === 'major' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={id} className={attestationLabelClass}>
                {t(`attestationPublic.fields.${labelKey}`)}
                <span className="text-red-600" aria-hidden>
                  {' '}
                  *
                </span>
              </label>
              <input
                id={id}
                className={`${attestationInputClass} brand-input`}
                value={String(degree[field])}
                disabled={disabled}
                maxLength={255}
                aria-invalid={Boolean(err)}
                aria-describedby={err ? `${id}-error` : undefined}
                onChange={(e) => setField(field, e.target.value)}
              />
              {err ? (
                <p id={`${id}-error`} className="mt-1 text-xs text-red-600" role="alert">
                  {err}
                </p>
              ) : null}
            </div>
          );
        })}

        <div>
          <label htmlFor={fieldId(formId, `${prefix}_start_year`)} className={attestationLabelClass}>
            {t('attestationPublic.fields.startYear')}
            <span className="text-red-600" aria-hidden>
              {' '}
              *
            </span>
          </label>
          <input
            id={fieldId(formId, `${prefix}_start_year`)}
            className={`${attestationInputClass} brand-input`}
            inputMode="numeric"
            dir="ltr"
            placeholder="2018"
            value={degree.start_year}
            disabled={disabled}
            maxLength={4}
            aria-invalid={Boolean(errors[`${prefix}_start_year`])}
            aria-describedby={
              errors[`${prefix}_start_year`]
                ? fieldId(formId, `${prefix}_start_year-error`)
                : undefined
            }
            onChange={(e) => setField('start_year', e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
          />
          {errors[`${prefix}_start_year`] ? (
            <p
              id={fieldId(formId, `${prefix}_start_year-error`)}
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors[`${prefix}_start_year`]}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={fieldId(formId, `${prefix}_completion_year`)}
            className={attestationLabelClass}
          >
            {t('attestationPublic.fields.completionYear')}
            <span className="text-red-600" aria-hidden>
              {' '}
              *
            </span>
          </label>
          <input
            id={fieldId(formId, `${prefix}_completion_year`)}
            className={`${attestationInputClass} brand-input`}
            inputMode="numeric"
            dir="ltr"
            placeholder="2022"
            value={degree.completion_year}
            disabled={disabled}
            maxLength={4}
            aria-invalid={Boolean(errors[`${prefix}_completion_year`])}
            aria-describedby={
              errors[`${prefix}_completion_year`]
                ? fieldId(formId, `${prefix}_completion_year-error`)
                : undefined
            }
            onChange={(e) =>
              setField('completion_year', e.target.value.replace(/[^\d]/g, '').slice(0, 4))
            }
          />
          {errors[`${prefix}_completion_year`] ? (
            <p
              id={fieldId(formId, `${prefix}_completion_year-error`)}
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors[`${prefix}_completion_year`]}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={fieldId(formId, `${prefix}_final_grade`)} className={attestationLabelClass}>
            {t('attestationPublic.fields.finalGrade')}
            <span className="text-red-600" aria-hidden>
              {' '}
              *
            </span>
          </label>
          <input
            id={fieldId(formId, `${prefix}_final_grade`)}
            className={`${attestationInputClass} brand-input`}
            value={degree.final_grade}
            disabled={disabled}
            maxLength={255}
            placeholder={t('attestationPublic.fields.finalGradePlaceholder')}
            aria-invalid={Boolean(errors[`${prefix}_final_grade`])}
            aria-describedby={
              errors[`${prefix}_final_grade`]
                ? fieldId(formId, `${prefix}_final_grade-error`)
                : `${fieldId(formId, `${prefix}_final_grade`)}-hint`
            }
            onChange={(e) => setField('final_grade', e.target.value)}
          />
          <p
            id={`${fieldId(formId, `${prefix}_final_grade`)}-hint`}
            className="mt-1 text-xs text-slate-400"
          >
            {t('attestationPublic.fields.finalGradeHint')}
          </p>
          {errors[`${prefix}_final_grade`] ? (
            <p
              id={fieldId(formId, `${prefix}_final_grade-error`)}
              className="mt-1 text-xs text-red-600"
              role="alert"
            >
              {errors[`${prefix}_final_grade`]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FilePicker
          id={fieldId(formId, `${prefix}_certificate`)}
          label={t('attestationPublic.fields.certificate')}
          file={degree.certificate}
          error={errors[`${prefix}_certificate`]}
          disabled={disabled}
          onChange={(file) => setField('certificate', file)}
          onClear={() => setField('certificate', null)}
        />
        <FilePicker
          id={fieldId(formId, `${prefix}_transcript`)}
          label={t('attestationPublic.fields.transcript')}
          file={degree.transcript}
          error={errors[`${prefix}_transcript`]}
          disabled={disabled}
          onChange={(file) => setField('transcript', file)}
          onClear={() => setField('transcript', null)}
        />
      </div>
    </section>
  );
}

export function PublicAttestationApplyPage() {
  const { t, i18n } = useTranslation();
  const { customerSlug } = useParams<{ customerSlug?: string }>();
  const applySlug = getPublicAttestationSlug(customerSlug);
  const formId = useId();
  const [view, setView] = useState<ViewMode>(() => (applySlug ? 'form' : 'unavailable'));
  const [form, setForm] = useState<PublicAttestationFormState>(() =>
    createEmptyPublicFormState()
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey());
  const [success, setSuccess] = useState<PublicAttestationSubmissionResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

  const updateForm = (patch: Partial<PublicAttestationFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const focusFirstError = (nextErrors: FieldErrors) => {
    const key = firstFieldErrorKey(nextErrors);
    if (!key || key.startsWith('_')) {
      formTopRef.current?.focus();
      return;
    }
    const el = document.getElementById(fieldId(formId, key));
    if (el && 'focus' in el) {
      (el as HTMLElement).focus();
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const goToReview = () => {
    const nextErrors = validatePublicAttestationForm(form, t);
    setErrors(nextErrors);
    setGlobalError(nextErrors._total || null);
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    setView('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    const nextErrors = validatePublicAttestationForm(form, t);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setView('form');
      setGlobalError(nextErrors._total || null);
      focusFirstError(nextErrors);
      return;
    }

    setSubmitting(true);
    setGlobalError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = await publicAttestationApi.submitApplication(form, {
        idempotencyKey,
        signal: controller.signal,
        slug: applySlug,
      });
      setSuccess(payload);
      setView('success');
      // Clear sensitive state after confirmed success.
      setForm(createEmptyPublicFormState());
      setErrors({});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      if (isBatchUnavailableError(err)) {
        setView('unavailable');
        setSubmitting(false);
        return;
      }
      const fieldErrs = mapPublicAttestationErrorToFields(err, t);
      setErrors(fieldErrs);
      setGlobalError(formatPublicAttestationErrorMessage(err, t));
      setView('form');
      focusFirstError(fieldErrs._global ? { _global: fieldErrs._global } : fieldErrs);
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setSuccess(null);
    setForm(createEmptyPublicFormState());
    setErrors({});
    setGlobalError(null);
    setIdempotencyKey(createIdempotencyKey());
    setCopied(false);
    setView('form');
  };

  return (
    <div className="public-attestation-brand min-h-screen flex flex-col">
      <header className="brand-header">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={BRAND_LOGO_FULL}
              alt={t('attestationPublic.brand')}
              className="h-12 sm:h-14 w-auto max-w-[240px] rounded-md bg-white object-contain object-start shadow-sm ring-1 ring-slate-200"
            />
            <div className="min-w-0 hidden xs:block sm:block">
              <p className="text-sm font-semibold text-[var(--brand-navy)] truncate">
                {t('attestationPublic.brand')}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {t('attestationPublic.title')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="brand-lang-btn shrink-0"
            onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
          >
            {i18n.language === 'ar' ? 'EN' : 'ع'}
          </Button>
        </div>
        <div className="brand-accent-bar" aria-hidden />
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {view === 'unavailable' ? (
          <section className="brand-card rounded-xl border bg-white p-6 sm:p-8 text-center space-y-3">
            <h1 className="brand-h1 text-xl font-semibold">
              {t('attestationPublic.unavailable.title')}
            </h1>
            <p className="text-sm text-slate-600">{t('attestationPublic.unavailable.description')}</p>
          </section>
        ) : null}

        {view === 'success' && success ? (
          <section
            className="brand-card rounded-xl border bg-white p-6 sm:p-8 space-y-5 text-center"
            aria-live="polite"
          >
            <CheckCircle2 className="mx-auto size-12 text-[var(--brand-orange)]" aria-hidden />
            <h1 className="brand-h1 text-xl font-semibold">
              {t('attestationPublic.success.title')}
            </h1>
            <div className="space-y-2">
              <p className="text-sm text-slate-500">{t('attestationPublic.success.referenceLabel')}</p>
              <p
                className="brand-success-ref text-2xl sm:text-3xl font-bold tracking-wide select-all"
                dir="ltr"
              >
                {success.reference_number}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`mx-auto ${brandSecondaryBtnClass}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(success.reference_number);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <Copy className="size-4" aria-hidden />
                {copied ? t('attestationPublic.actions.copied') : t('attestationPublic.actions.copyReference')}
              </Button>
            </div>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {t('attestationPublic.success.message')}
            </p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              {t('attestationPublic.success.contactNote')}
            </p>
            <Button type="button" className={brandPrimaryBtnClass} onClick={startAnother}>
              {t('attestationPublic.actions.submitAnother')}
            </Button>
          </section>
        ) : null}

        {view === 'review' ? (
          <section className="space-y-5" aria-labelledby="public-attestation-review-title">
            <div>
              <h1 id="public-attestation-review-title" className="brand-h1 text-xl font-semibold">
                {t('attestationPublic.review.title')}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{t('attestationPublic.review.subtitle')}</p>
            </div>
            <div className="brand-card rounded-xl border bg-white p-4 sm:p-5 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('attestationPublic.fields.fullName')}</span>
                <span className="font-medium text-slate-900 text-end break-words">{form.full_name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('attestationPublic.fields.phone')}</span>
                <span className="font-medium text-slate-900" dir="ltr">
                  {form.phone}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('attestationPublic.review.degreeCount')}</span>
                <span className="font-medium">{form.degrees.length}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{t('attestationPublic.fields.passport')}</span>
                <span className="font-medium text-end break-all" dir="auto">
                  {form.passport?.name}
                </span>
              </div>
              {form.degrees.map((d, i) => (
                <div key={d.clientId} className="border-t border-slate-100 pt-3 space-y-1">
                  <p className="font-semibold text-[var(--brand-navy)]">
                    {t('attestationPublic.degree.title', { n: i + 1 })} — {d.university}
                  </p>
                  <p className="text-slate-600">
                    {d.degree_level} · {d.major} · {d.start_year}–{d.completion_year}
                  </p>
                  <p className="text-slate-500 break-all" dir="auto">
                    {t('attestationPublic.fields.certificate')}: {d.certificate?.name}
                  </p>
                  <p className="text-slate-500 break-all" dir="auto">
                    {t('attestationPublic.fields.transcript')}: {d.transcript?.name}
                  </p>
                </div>
              ))}
            </div>
            {globalError ? (
              <p className="text-sm text-red-600" role="alert">
                {globalError}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className={brandSecondaryBtnClass}
                disabled={submitting}
                onClick={() => setView('form')}
              >
                {t('attestationPublic.actions.edit')}
              </Button>
              <Button
                type="button"
                className={brandPrimaryBtnClass}
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <span>{t('attestationPublic.actions.submitting')}</span>
                  </>
                ) : (
                  t('attestationPublic.actions.submit')
                )}
              </Button>
            </div>
            <div className="sr-only" role="status" aria-live="polite">
              {submitting ? t('attestationPublic.actions.submitting') : ''}
            </div>
          </section>
        ) : null}

        {view === 'form' ? (
          <div
            ref={formTopRef}
            tabIndex={-1}
            className="space-y-6 outline-none"
            aria-labelledby="public-attestation-title"
          >
            <div>
              <h1 id="public-attestation-title" className="brand-h1 text-xl font-semibold">
                {t('attestationPublic.title')}
              </h1>
              <p className="mt-1 text-sm text-slate-600">{t('attestationPublic.subtitle')}</p>
              <p className="mt-2 text-xs text-slate-500">{t('attestationPublic.instructions')}</p>
            </div>

            {globalError ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {globalError}
              </div>
            ) : null}

            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                goToReview();
              }}
              noValidate
            >
              {/* Honeypot — visually hidden, not focusable, ignored by AT */}
              <div
                aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
              >
                <label htmlFor={fieldId(formId, 'website')}>Website</label>
                <input
                  id={fieldId(formId, 'website')}
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => updateForm({ website: e.target.value })}
                />
              </div>

              <section
                className="brand-card rounded-xl border bg-white p-4 sm:p-5 space-y-4 shadow-sm"
                aria-labelledby={fieldId(formId, 'applicant-heading')}
              >
                <h2
                  id={fieldId(formId, 'applicant-heading')}
                  className="brand-section-title text-sm font-semibold"
                >
                  {t('attestationPublic.sections.applicant')}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor={fieldId(formId, 'full_name')} className={attestationLabelClass}>
                      {t('attestationPublic.fields.fullName')}
                      <span className="text-red-600" aria-hidden>
                        {' '}
                        *
                      </span>
                    </label>
                    <input
                      id={fieldId(formId, 'full_name')}
                      className={`${attestationInputClass} brand-input`}
                      value={form.full_name}
                      maxLength={PUBLIC_ATTESTATION_NAME_MAX}
                      disabled={submitting}
                      autoComplete="name"
                      aria-invalid={Boolean(errors.full_name)}
                      aria-describedby={
                        errors.full_name ? fieldId(formId, 'full_name-error') : undefined
                      }
                      onChange={(e) => updateForm({ full_name: e.target.value })}
                    />
                    {errors.full_name ? (
                      <p
                        id={fieldId(formId, 'full_name-error')}
                        className="mt-1 text-xs text-red-600"
                        role="alert"
                      >
                        {errors.full_name}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={fieldId(formId, 'phone')} className={attestationLabelClass}>
                      {t('attestationPublic.fields.phone')}
                      <span className="text-red-600" aria-hidden>
                        {' '}
                        *
                      </span>
                    </label>
                    <input
                      id={fieldId(formId, 'phone')}
                      className={`${attestationInputClass} brand-input`}
                      type="tel"
                      dir="ltr"
                      value={form.phone}
                      maxLength={PUBLIC_ATTESTATION_PHONE_MAX}
                      disabled={submitting}
                      autoComplete="tel"
                      aria-invalid={Boolean(errors.phone)}
                      aria-describedby={
                        errors.phone ? fieldId(formId, 'phone-error') : undefined
                      }
                      onChange={(e) => updateForm({ phone: e.target.value })}
                    />
                    {errors.phone ? (
                      <p
                        id={fieldId(formId, 'phone-error')}
                        className="mt-1 text-xs text-red-600"
                        role="alert"
                      >
                        {errors.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="space-y-3" aria-labelledby={fieldId(formId, 'degrees-heading')}>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h2
                    id={fieldId(formId, 'degrees-heading')}
                    className="brand-section-title text-sm font-semibold"
                  >
                    {t('attestationPublic.sections.degrees')}
                  </h2>
                  {errors.degrees ? (
                    <p className="text-xs text-red-600" role="alert">
                      {errors.degrees}
                    </p>
                  ) : null}
                </div>

                {form.degrees.map((degree, index) => (
                  <DegreeCard
                    key={degree.clientId}
                    degree={degree}
                    index={index}
                    total={form.degrees.length}
                    errors={errors}
                    disabled={submitting}
                    formId={formId}
                    onChange={(next) => {
                      setForm((prev) => ({
                        ...prev,
                        degrees: prev.degrees.map((d) =>
                          d.clientId === degree.clientId ? next : d
                        ),
                      }));
                    }}
                    onRemove={() => {
                      setForm((prev) => {
                        if (prev.degrees.length <= 1) return prev;
                        return {
                          ...prev,
                          degrees: prev.degrees.filter((d) => d.clientId !== degree.clientId),
                        };
                      });
                    }}
                  />
                ))}

                <Button
                  type="button"
                  variant="outline"
                  className={`w-full sm:w-auto ${brandSecondaryBtnClass}`}
                  disabled={submitting}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      degrees: [...prev.degrees, createEmptyDegree()],
                    }))
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  {t('attestationPublic.actions.addDegree')}
                </Button>
              </section>

              <section
                className="brand-card rounded-xl border bg-white p-4 sm:p-5 space-y-3 shadow-sm"
                aria-labelledby={fieldId(formId, 'passport-heading')}
              >
                <h2
                  id={fieldId(formId, 'passport-heading')}
                  className="brand-section-title text-sm font-semibold"
                >
                  {t('attestationPublic.sections.passport')}
                </h2>
                <FilePicker
                  id={fieldId(formId, 'passport')}
                  label={t('attestationPublic.fields.passport')}
                  file={form.passport}
                  error={errors.passport}
                  disabled={submitting}
                  onChange={(file) => updateForm({ passport: file })}
                  onClear={() => updateForm({ passport: null })}
                />
              </section>

              <p className="text-xs text-slate-500">
                {t('attestationPublic.file.totalHint', {
                  used: formatFileSize(totalSelectedFileBytes(form)),
                  max: formatFileSize(PUBLIC_ATTESTATION_MAX_TOTAL_BYTES),
                })}
              </p>

              <div className="brand-sticky-actions">
                <p className="mb-2 text-xs text-slate-500 sm:hidden">
                  {t('attestationPublic.continueHint')}
                </p>
                <Button
                  type="submit"
                  className={`${brandPrimaryBtnClass} w-full`}
                  disabled={submitting}
                >
                  {t('attestationPublic.actions.review')}
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </main>

      <footer className="brand-footer mt-auto">
        <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 text-center text-xs">
          <p>{t('attestationPublic.brand')}</p>
        </div>
      </footer>
    </div>
  );
}
