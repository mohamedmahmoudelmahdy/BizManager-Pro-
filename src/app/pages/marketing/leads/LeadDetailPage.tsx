import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  MessageSquarePlus,
  Pencil,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { MarketingPageShell } from '@/app/components/marketing/MarketingPageShell';
import { MarketingLoadingState } from '@/app/components/marketing/MarketingLoadingState';
import { MarketingErrorState } from '@/app/components/marketing/MarketingErrorState';
import { MarketingPermissionGuard } from '@/app/components/marketing/MarketingPermissionGuard';
import { MarketingCode } from '@/app/components/marketing/campaigns/MarketingBadges';
import { LeadFormDialog } from '@/app/components/marketing/leads/LeadFormDialog';
import { LeadArchiveDialog } from '@/app/components/marketing/leads/LeadArchiveDialog';
import { LeadConvertDialog } from '@/app/components/marketing/leads/LeadConvertDialog';
import { LeadActivitiesPanel } from '@/app/components/marketing/leads/LeadActivitiesPanel';
import { LeadFollowUpsPanel } from '@/app/components/marketing/leads/LeadFollowUpsPanel';
import { LeadAssignmentsPanel } from '@/app/components/marketing/leads/LeadAssignmentsPanel';
import {
  formatUserLabel,
  LeadStatusBadge,
  leadStatusTone,
} from '@/app/components/marketing/leads/LeadBadges';
import { Button } from '@/app/components/ui/button';
import { marketingLeadsApi, marketingAssignmentsApi } from '@/app/lib/marketingApi';
import { MARKETING_PERMISSIONS } from '@/app/lib/marketingPermissions';
import { formatMarketingErrorMessage } from '@/app/lib/marketingErrors';
import type { LeadDetail } from '@/app/lib/marketingTypes';
import { useMarketingPermissions } from '@/app/hooks/useMarketingPermissions';
import { useAuth } from '@/app/contexts/AuthContext';
import { cn } from '@/app/components/ui/utils';

type DetailTab = 'overview' | 'activities' | 'followups' | 'assignments';

export function LeadDetailPage() {
  const { t } = useTranslation();
  const { leadId } = useParams<{ leadId: string }>();
  const { hasPermission } = useAuth();
  const perms = useMarketingPermissions();
  const canViewCustomer = hasPermission('customers.view_customer', { allowAdminManager: true });
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [activityCreateToken, setActivityCreateToken] = useState(0);
  const [followUpCreateToken, setFollowUpCreateToken] = useState(0);
  const [assignToken, setAssignToken] = useState(0);
  const [hasActiveAssignment, setHasActiveAssignment] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      setLead(await marketingLeadsApi.get(leadId));
    } catch (err) {
      setError(err);
      setLead(null);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  const refreshActiveAssignment = useCallback(async () => {
    if (!leadId || !(perms.canViewAssignments || perms.canAssignLead)) {
      setHasActiveAssignment(false);
      return;
    }
    try {
      const res = await marketingAssignmentsApi.list({
        lead: leadId,
        active: true,
        page: 1,
      });
      const rows = Array.isArray(res) ? res : res.results ?? [];
      setHasActiveAssignment(rows.length > 0);
    } catch {
      setHasActiveAssignment(false);
    }
  }, [leadId, perms.canViewAssignments, perms.canAssignLead]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    refreshActiveAssignment();
  }, [refreshActiveAssignment]);

  const canEdit =
    perms.canChangeLead && lead && lead.status !== 'archived' && lead.status !== 'converted';
  const canArchive = perms.canChangeLead && lead && lead.status !== 'archived';
  const canConvert =
    perms.canConvertLead && lead && lead.status !== 'converted' && lead.status !== 'archived';
  const canAddActivity = perms.canAddActivity && lead && lead.status !== 'archived';
  const canScheduleFollowUp = perms.canAddFollowUp && lead && lead.status !== 'archived';
  const canAssign =
    perms.canAssignLead && lead && lead.status !== 'archived' && lead.status !== 'converted';

  const tabs: { id: DetailTab; labelKey: string; visible: boolean }[] = [
    { id: 'overview', labelKey: 'marketing.leadManagement.tabs.overview', visible: true },
    {
      id: 'activities',
      labelKey: 'marketing.leadManagement.tabs.activities',
      visible: perms.canViewActivities,
    },
    {
      id: 'followups',
      labelKey: 'marketing.leadManagement.tabs.followups',
      visible: perms.canViewFollowUps,
    },
    {
      id: 'assignments',
      labelKey: 'marketing.leadManagement.tabs.assignments',
      visible: perms.canViewAssignments || perms.canAssignLead || perms.canChangeAssignment,
    },
  ];

  return (
    <MarketingPermissionGuard permission={MARKETING_PERMISSIONS.viewLead}>
      {loading ? (
        <MarketingLoadingState />
      ) : error || !lead ? (
        <MarketingErrorState
          message={formatMarketingErrorMessage(error ?? new Error('missing'), t)}
          onRetry={load}
        />
      ) : (
        <MarketingPageShell
          title={lead.name}
          description={t('marketing.leadManagement.detail.subtitle', {
            number: lead.lead_number,
          })}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild>
                <Link to="/marketing/leads">
                  <ArrowLeft className="size-4 me-2" />
                  {t('marketing.leadManagement.detail.back')}
                </Link>
              </Button>
              {canEdit ? (
                <Button type="button" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4 me-2" />
                  {t('common.edit')}
                </Button>
              ) : null}
              {canAddActivity ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTab('activities');
                    setActivityCreateToken((n) => n + 1);
                  }}
                >
                  <MessageSquarePlus className="size-4 me-2" />
                  {t('marketing.leads.actions.addActivity')}
                </Button>
              ) : null}
              {canScheduleFollowUp ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTab('followups');
                    setFollowUpCreateToken((n) => n + 1);
                  }}
                >
                  <CalendarClock className="size-4 me-2" />
                  {t('marketing.leads.actions.scheduleFollowUp')}
                </Button>
              ) : null}
              {canAssign ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTab('assignments');
                    setAssignToken((n) => n + 1);
                  }}
                >
                  <UserPlus className="size-4 me-2" />
                  {hasActiveAssignment
                    ? t('marketing.leads.actions.reassign')
                    : t('marketing.leads.actions.assign')}
                </Button>
              ) : null}
              {canConvert ? (
                <Button type="button" onClick={() => setConvertOpen(true)}>
                  <UserCheck className="size-4 me-2" />
                  {t('marketing.leadManagement.conversion.title')}
                </Button>
              ) : null}
              {canArchive ? (
                <Button type="button" variant="outline" onClick={() => setArchiveOpen(true)}>
                  <Archive className="size-4 me-2" />
                  {t('marketing.leadManagement.archive.confirm')}
                </Button>
              ) : null}
            </div>
          }
        >
          <div className="space-y-5">
            <nav
              className="flex flex-wrap gap-1.5 rounded-lg bg-slate-100 p-1.5"
              aria-label={t('marketing.leadManagement.tabs.ariaLabel')}
            >
              {tabs
                .filter((item) => item.visible)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                      tab === item.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    )}
                    aria-current={tab === item.id ? 'page' : undefined}
                    onClick={() => setTab(item.id)}
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
            </nav>

            {tab === 'overview' ? (
              <div className="space-y-4">
                <section className="rounded-lg border border-slate-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">
                    {t('marketing.leadManagement.sections.overview')}
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.leadNumber')}
                      </dt>
                      <dd className="mt-1">
                        <MarketingCode>{lead.lead_number}</MarketingCode>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.status')}
                      </dt>
                      <dd className="mt-1">
                        <LeadStatusBadge
                          label={t(`marketing.leadManagement.status.${lead.status}`, {
                            defaultValue: lead.status,
                          })}
                          tone={leadStatusTone(lead.status)}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.phone')}
                      </dt>
                      <dd className="mt-1" dir="ltr">
                        {lead.raw_phone}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.normalizedPhone')}
                      </dt>
                      <dd className="mt-1" dir="ltr">
                        {lead.normalized_phone || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.email')}
                      </dt>
                      <dd className="mt-1 break-words" dir="ltr">
                        {lead.email || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.outcome')}
                      </dt>
                      <dd className="mt-1">
                        {lead.outcome
                          ? t(`marketing.leadManagement.outcome.${lead.outcome}`, {
                              defaultValue: lead.outcome,
                            })
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.lastContactedBy')}
                      </dt>
                      <dd className="mt-1 break-words">
                        {lead.last_contacted_by
                          ? formatUserLabel(lead.last_contacted_by)
                          : t('marketing.leadManagement.empty.notContacted')}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.lastContactedAt')}
                      </dt>
                      <dd className="mt-1">
                        {lead.last_contacted_at ? (
                          <time dateTime={lead.last_contacted_at}>
                            {new Date(lead.last_contacted_at).toLocaleString()}
                          </time>
                        ) : (
                          t('marketing.leadManagement.empty.notContacted')
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.linkedCustomer')}
                      </dt>
                      <dd className="mt-1 break-words">
                        {lead.linked_customer ? (
                          canViewCustomer ? (
                            <Link
                              to={`/customers/${lead.linked_customer.id}`}
                              className="text-blue-700 underline font-medium"
                            >
                              {lead.linked_customer.name}
                            </Link>
                          ) : (
                            lead.linked_customer.name
                          )
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.owner')}
                      </dt>
                      <dd className="mt-1">{formatUserLabel(lead.marketing_owner)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.createdBy')}
                      </dt>
                      <dd className="mt-1">{formatUserLabel(lead.created_by)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400 font-semibold uppercase">
                        {t('marketing.leadManagement.fields.createdAt')}
                      </dt>
                      <dd className="mt-1" dir="ltr">
                        {lead.created_at}
                      </dd>
                    </div>
                    {lead.converted_at ? (
                      <div>
                        <dt className="text-xs text-slate-400 font-semibold uppercase">
                          {t('marketing.leadManagement.fields.convertedAt')}
                        </dt>
                        <dd className="mt-1" dir="ltr">
                          {lead.converted_at} · {formatUserLabel(lead.converted_by)}
                        </dd>
                      </div>
                    ) : null}
                    {lead.archived_at ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-400 font-semibold uppercase">
                          {t('marketing.leadManagement.fields.archiveReason')}
                        </dt>
                        <dd className="mt-1 break-words">
                          {lead.archive_reason || '—'} ({lead.archived_at})
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">
                    {t('marketing.leadManagement.sections.notes')}
                  </h3>
                  {lead.notes?.trim() ? (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                      {lead.notes}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {t('marketing.leadManagement.empty.notes')}
                    </p>
                  )}
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">
                    {t('marketing.leadManagement.sections.attribution')}
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    {(
                      [
                        ['channel', lead.channel],
                        ['platform', lead.platform],
                        ['campaign', lead.campaign],
                        ['adSet', lead.ad_set],
                        ['advertisement', lead.advertisement],
                      ] as const
                    ).map(([key, ref]) => (
                      <div key={key}>
                        <dt className="text-xs text-slate-400 font-semibold uppercase">
                          {t(`marketing.leadManagement.fields.${key}`)}
                        </dt>
                        <dd className="mt-1 break-words">
                          {ref?.name ?? '—'}
                          {ref?.code ? (
                            <>
                              {' '}
                              <MarketingCode>({ref.code})</MarketingCode>
                            </>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            ) : null}

            {tab === 'activities' ? (
              <LeadActivitiesPanel
                leadId={lead.id}
                openCreateToken={activityCreateToken}
                onChanged={load}
              />
            ) : null}
            {tab === 'followups' ? (
              <LeadFollowUpsPanel leadId={lead.id} openCreateToken={followUpCreateToken} />
            ) : null}
            {tab === 'assignments' ? (
              <LeadAssignmentsPanel
                leadId={lead.id}
                onChanged={() => {
                  load();
                  refreshActiveAssignment();
                }}
                openAssignToken={assignToken}
              />
            ) : null}
          </div>

          <LeadFormDialog
            open={editOpen}
            lead={lead}
            onClose={() => setEditOpen(false)}
            onSuccess={(updated) => {
              if (updated) setLead(updated);
              else load();
            }}
          />
          <LeadArchiveDialog
            open={archiveOpen}
            leadId={lead.id}
            leadName={lead.name}
            leadNumber={lead.lead_number}
            onClose={() => setArchiveOpen(false)}
            onSuccess={load}
          />
          <LeadConvertDialog
            open={convertOpen}
            lead={lead}
            onClose={() => setConvertOpen(false)}
            onSuccess={(updated) => setLead(updated)}
          />
        </MarketingPageShell>
      )}
    </MarketingPermissionGuard>
  );
}
