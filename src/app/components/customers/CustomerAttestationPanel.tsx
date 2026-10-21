import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, GraduationCap, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/app/components/ui/button';
import { formatApiErrorMessage } from '@/app/lib/api';
import {
  buildPublicApplyAbsoluteUrl,
  customerAttestationApi,
  type CustomerAttestationStatus,
} from '@/app/lib/customerAttestationApi';
import { useAttestationPermissions } from '@/app/hooks/useAttestationPermissions';
import { attestationInputClass, attestationLabelClass } from '@/app/lib/attestationFormat';

type Props = {
  customerId: string;
  customerType: string;
};

export function CustomerAttestationPanel({ customerId, customerType }: Props) {
  const { t } = useTranslation();
  const perms = useAttestationPermissions();
  const canManage = perms.can(perms.codes.manageBatch);

  const [status, setStatus] = useState<CustomerAttestationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hrUsername, setHrUsername] = useState('');
  const [hrPassword, setHrPassword] = useState('');
  const [hrEmail, setHrEmail] = useState('');

  const load = useCallback(async () => {
    if (!canManage || customerType !== 'company') return;
    setLoading(true);
    try {
      const data = await customerAttestationApi.status(customerId);
      setStatus(data);
    } catch (err) {
      setStatus(null);
      toast.error(formatApiErrorMessage(err, t('customers.attestation.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [canManage, customerId, customerType, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (customerType !== 'company' || !canManage) {
    return null;
  }

  const applyUrl = buildPublicApplyAbsoluteUrl(status?.apply_path);

  const onEnable = async () => {
    setBusy(true);
    try {
      const data = await customerAttestationApi.enable(customerId);
      setStatus(data);
      toast.success(t('customers.attestation.enabled'));
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.attestation.enableFailed')));
    } finally {
      setBusy(false);
    }
  };

  const onToggleBatch = async (is_active: boolean) => {
    setBusy(true);
    try {
      const data = await customerAttestationApi.setActive(customerId, is_active);
      setStatus(data);
      toast.success(
        is_active
          ? t('customers.attestation.activated')
          : t('customers.attestation.deactivated')
      );
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.attestation.updateFailed')));
    } finally {
      setBusy(false);
    }
  };

  const onCopyLink = async () => {
    if (!applyUrl) return;
    try {
      await navigator.clipboard.writeText(applyUrl);
      toast.success(t('customers.attestation.linkCopied'));
    } catch {
      toast.error(t('customers.attestation.copyFailed'));
    }
  };

  const onCreateHr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hrUsername.trim() || !hrPassword) {
      toast.error(t('customers.attestation.hrRequired'));
      return;
    }
    setBusy(true);
    try {
      const data = await customerAttestationApi.createHrUser(customerId, {
        username: hrUsername.trim(),
        password: hrPassword,
        email: hrEmail.trim() || undefined,
      });
      setStatus(data);
      setHrUsername('');
      setHrPassword('');
      setHrEmail('');
      toast.success(t('customers.attestation.hrCreated'));
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.attestation.hrCreateFailed')));
    } finally {
      setBusy(false);
    }
  };

  const onToggleHr = async (userId: string, is_active: boolean) => {
    setBusy(true);
    try {
      const data = await customerAttestationApi.setHrUserActive(
        customerId,
        userId,
        is_active
      );
      setStatus(data);
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('customers.attestation.updateFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-[color-mix(in_srgb,#003875_12%,white)] p-2 text-[#003875]">
            <GraduationCap className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('customers.attestation.title')}
            </h2>
            <p className="text-sm text-gray-500">{t('customers.attestation.subtitle')}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {t('customers.attestation.refresh')}
        </Button>
      </div>

      {loading && !status ? (
        <div className="flex justify-center py-8 text-gray-400">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : !status?.enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{t('customers.attestation.notEnabled')}</p>
          <Button type="button" disabled={busy} onClick={() => void onEnable()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('customers.attestation.enable')}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className={attestationLabelClass}>{t('customers.attestation.applyLink')}</p>
            <div className="flex flex-wrap gap-2 items-center">
              <code
                className="text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-md px-3 py-2 break-all flex-1 min-w-0"
                dir="ltr"
              >
                {applyUrl}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={() => void onCopyLink()}>
                <Copy className="size-4" aria-hidden />
                {t('customers.attestation.copyLink')}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {t('customers.attestation.slugLabel')}:{' '}
              <span dir="ltr">{status.attestation_apply_slug}</span>
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 space-y-2">
            <p className="text-sm font-medium text-slate-900">
              {t('customers.attestation.batchHeading')}
            </p>
            {status.active_batch ? (
              <>
                <p className="text-sm text-slate-700">{status.active_batch.title}</p>
                <p className="text-xs text-slate-500">
                  {t('customers.attestation.expected')}:{' '}
                  {status.active_batch.expected_applicant_count ?? '—'} ·{' '}
                  {t('customers.attestation.applications')}:{' '}
                  {status.active_batch.application_count ?? 0}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onToggleBatch(false)}
                >
                  {t('customers.attestation.deactivateBatch')}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-700">
                  {t('customers.attestation.noActiveBatch')}
                </p>
                {status.latest_batch ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onToggleBatch(true)}
                  >
                    {t('customers.attestation.activateBatch')}
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-900">
              {t('customers.attestation.hrUsers')}
            </p>
            <p className="text-xs text-slate-500">{t('customers.attestation.hrHint')}</p>
            {status.hr_users.length === 0 ? (
              <p className="text-sm text-slate-500">{t('customers.attestation.noHrUsers')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {status.hr_users.map((u) => (
                  <li
                    key={u.user_id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-slate-900" dir="ltr">
                        {u.username}
                      </p>
                      {u.email ? (
                        <p className="text-xs text-slate-500" dir="ltr">
                          {u.email}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onToggleHr(u.user_id, !u.is_active)}
                    >
                      {u.is_active
                        ? t('customers.attestation.deactivateHr')
                        : t('customers.attestation.activateHr')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={(e) => void onCreateHr(e)} className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={attestationLabelClass} htmlFor={`hr-user-${customerId}`}>
                  {t('customers.attestation.hrUsername')}
                </label>
                <input
                  id={`hr-user-${customerId}`}
                  className={attestationInputClass}
                  value={hrUsername}
                  onChange={(e) => setHrUsername(e.target.value)}
                  autoComplete="off"
                  dir="ltr"
                />
              </div>
              <div>
                <label className={attestationLabelClass} htmlFor={`hr-pass-${customerId}`}>
                  {t('customers.attestation.hrPassword')}
                </label>
                <input
                  id={`hr-pass-${customerId}`}
                  type="password"
                  className={attestationInputClass}
                  value={hrPassword}
                  onChange={(e) => setHrPassword(e.target.value)}
                  autoComplete="new-password"
                  dir="ltr"
                />
              </div>
              <div>
                <label className={attestationLabelClass} htmlFor={`hr-email-${customerId}`}>
                  {t('customers.attestation.hrEmail')}
                </label>
                <input
                  id={`hr-email-${customerId}`}
                  type="email"
                  className={attestationInputClass}
                  value={hrEmail}
                  onChange={(e) => setHrEmail(e.target.value)}
                  autoComplete="off"
                  dir="ltr"
                />
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t('customers.attestation.createHr')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
