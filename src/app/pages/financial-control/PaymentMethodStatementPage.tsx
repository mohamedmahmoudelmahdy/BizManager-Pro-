import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle, Download, GitCompare, Loader2, X } from 'lucide-react';
import { SectionHeader } from '@/app/components/financial-control/components/SectionHeader';
import { KpiCard } from '@/app/components/financial-control/components/KpiCard';
import { CompareBankStatementModal } from '@/app/components/financial-control/modals/CompareBankStatementModal';
import { fmtAed } from '@/app/components/financial-control/utils/format';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  fetchPaymentMethodStatement,
  type PaymentMethodStatement,
  type StatementComparisonJob,
  type StatementComparisonMatch,
  type StatementComparisonRow,
} from '@/app/lib/paymentMethodApi';

const SOURCE_TYPES = [
  'customer_payment',
  'procedure_cash_in',
  'procedure_cash_out',
  'expense',
  'salary_payment',
  'commission_payment',
  'employee_advance',
  'debt_payment',
  'check_deduction',
  'transfer_in',
  'transfer_out',
  'ledger_manual',
] as const;

type ComparisonTab = 'matched' | 'bank_only' | 'system_only' | 'possible';

function exportCsv(data: PaymentMethodStatement, filename: string) {
  const header = [
    'Date',
    'Description',
    'Source',
    'Money In',
    'Money Out',
    'Running Balance',
    'Customer',
    'Procedure',
    'Reference',
    'Recorded By',
    'Status',
  ].join(',');
  const lines = data.rows.map((row) =>
    [
      row.date || '',
      `"${row.description.replace(/"/g, '""')}"`,
      row.source_type,
      row.money_in,
      row.money_out,
      row.running_balance,
      `"${(row.customer_name || '').replace(/"/g, '""')}"`,
      `"${(row.procedure_name || '').replace(/"/g, '""')}"`,
      row.reference,
      `"${(row.created_by || '').replace(/"/g, '""')}"`,
      row.status,
    ].join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReconciliationCsv(job: StatementComparisonJob, filename: string) {
  const header = [
    'Category',
    'Match Type',
    'Confidence',
    'Reason',
    'Bank Date',
    'Bank Description',
    'Bank Money In',
    'Bank Money Out',
    'Bank Reference',
    'System Date',
    'System Description',
    'System Money In',
    'System Money Out',
    'System Reference',
  ].join(',');

  const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
  const rowLine = (category: string, match: StatementComparisonMatch | null, row?: StatementComparisonRow) => {
    const bank = match?.bank_row || (row?.source === 'bank' ? row : null);
    const system = match?.system_row || (row?.source === 'system' ? row : null);
    return [
      category,
      match?.match_type || '',
      match?.confidence || '',
      esc(match?.reason || ''),
      bank?.date || '',
      esc(bank?.description || ''),
      bank?.money_in || '',
      bank?.money_out || '',
      esc(bank?.reference || ''),
      system?.date || '',
      esc(system?.description || ''),
      system?.money_in || '',
      system?.money_out || '',
      esc(system?.reference || ''),
    ].join(',');
  };

  const lines = [
    ...job.exact_matches.map((m) => rowLine('matched', m)),
    ...job.possible_matches.map((m) => rowLine('possible', m)),
    ...job.bank_only.map((r) => rowLine('bank_only', null, r)),
    ...job.system_only.map((r) => rowLine('system_only', null, r)),
  ];

  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ComparisonRowTable({
  rows,
  showMatchMeta,
  language,
}: {
  rows: Array<{ match?: StatementComparisonMatch; row?: StatementComparisonRow }>;
  showMatchMeta: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-slate-400 text-sm">
        {t('financialControl.paymentMethods.comparison.noRows')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            {showMatchMeta && (
              <>
                <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.comparison.confidence')}</th>
                <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.comparison.reason')}</th>
              </>
            )}
            <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colDate')}</th>
            <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colDescription')}</th>
            <th className="px-4 py-3 text-end">{t('financialControl.paymentMethods.colIn')}</th>
            <th className="px-4 py-3 text-end">{t('financialControl.paymentMethods.colOut')}</th>
            <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.comparison.reference')}</th>
            {!showMatchMeta && (
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.comparison.source')}</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((item, idx) => {
            const bank = item.match?.bank_row;
            const system = item.match?.system_row;
            const single = item.row;
            const entries = item.match
              ? [
                  { label: 'bank', data: bank },
                  { label: 'system', data: system },
                ]
              : [{ label: single?.source || '', data: single }];

            return entries.map((entry, subIdx) => (
              <tr key={`${idx}-${subIdx}`} className="hover:bg-slate-50">
                {showMatchMeta && subIdx === 0 && (
                  <>
                    <td className="px-4 py-3" rowSpan={entries.length}>
                      {item.match?.confidence}%
                    </td>
                    <td className="px-4 py-3" rowSpan={entries.length}>
                      {item.match?.reason}
                    </td>
                  </>
                )}
                {showMatchMeta && subIdx > 0 && null}
                <td className="px-4 py-3 whitespace-nowrap">{entry.data?.date || '—'}</td>
                <td className="px-4 py-3">
                  {showMatchMeta && (
                    <span className="text-xs font-semibold text-slate-500 uppercase me-2">
                      {entry.label === 'bank'
                        ? t('financialControl.paymentMethods.comparison.bank')
                        : t('financialControl.paymentMethods.comparison.system')}
                    </span>
                  )}
                  {entry.data?.description || '—'}
                </td>
                <td className="px-4 py-3 text-end font-mono text-emerald-700">
                  {entry.data && entry.data.money_in !== '0.00'
                    ? fmtAed(Number(entry.data.money_in), language)
                    : '—'}
                </td>
                <td className="px-4 py-3 text-end font-mono text-rose-700">
                  {entry.data && entry.data.money_out !== '0.00'
                    ? fmtAed(Number(entry.data.money_out), language)
                    : '—'}
                </td>
                <td className="px-4 py-3">{entry.data?.reference || '—'}</td>
                {!showMatchMeta && (
                  <td className="px-4 py-3 text-xs uppercase">
                    {entry.data?.source === 'bank'
                      ? t('financialControl.paymentMethods.comparison.bank')
                      : t('financialControl.paymentMethods.comparison.system')}
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentMethodStatementPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canCompare = user?.role === 'admin' || user?.role === 'manager';

  const [data, setData] = useState<PaymentMethodStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparisonJob, setComparisonJob] = useState<StatementComparisonJob | null>(null);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>('matched');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await fetchPaymentMethodStatement(id, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        source_type: sourceType || undefined,
      });
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, dateFrom, dateTo, sourceType]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p>{t('financialControl.paymentMethods.statementLoadFailed')}</p>
        <button type="button" onClick={() => navigate('/financial-control/payment-methods')} className="text-sm text-indigo-600 mt-2 hover:underline">
          {t('financialControl.paymentMethods.backToList')}
        </button>
      </div>
    );
  }

  const pm = data.payment_method;
  const comparisonTabs: { id: ComparisonTab; label: string; count: number }[] = comparisonJob
    ? [
        {
          id: 'matched',
          label: t('financialControl.paymentMethods.comparison.tabs.matched'),
          count: comparisonJob.summary.matched_count,
        },
        {
          id: 'bank_only',
          label: t('financialControl.paymentMethods.comparison.tabs.bankOnly'),
          count: comparisonJob.summary.bank_only_count,
        },
        {
          id: 'system_only',
          label: t('financialControl.paymentMethods.comparison.tabs.systemOnly'),
          count: comparisonJob.summary.system_only_count,
        },
        {
          id: 'possible',
          label: t('financialControl.paymentMethods.comparison.tabs.possible'),
          count: comparisonJob.summary.possible_match_count,
        },
      ]
    : [];

  const comparisonRows = (() => {
    if (!comparisonJob) return [];
    if (comparisonTab === 'matched') {
      return comparisonJob.exact_matches.map((match) => ({ match }));
    }
    if (comparisonTab === 'possible') {
      return comparisonJob.possible_matches.map((match) => ({ match }));
    }
    if (comparisonTab === 'bank_only') {
      return comparisonJob.bank_only.map((row) => ({ row }));
    }
    return comparisonJob.system_only.map((row) => ({ row }));
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/financial-control/payment-methods')}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          {t('financialControl.paymentMethods.backToList')}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {canCompare && (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-indigo-200 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <GitCompare className="size-4" />
              {t('financialControl.paymentMethods.comparison.compareButton')}
            </button>
          )}
          <button
            type="button"
            onClick={() => exportCsv(data, `payment-method-${pm.name.replace(/\s+/g, '-')}.csv`)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
          >
            <Download className="size-4" />
            {t('financialControl.paymentMethods.exportCsv')}
          </button>
        </div>
      </div>

      <SectionHeader
        title={pm.name}
        subtitle={
          [
            pm.method_type === 'cash' ? t('paymentMethods.cash') : t('paymentMethods.bank'),
            pm.masked_number,
            pm.card_type,
          ]
            .filter(Boolean)
            .join(' · ')
        }
      />

      {data.opening_balance_estimated && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          {t('financialControl.paymentMethods.openingBalanceWarning')}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={t('financialControl.paymentMethods.currentBalance')} value={fmtAed(Number(data.current_balance), i18n.language)} />
        <KpiCard label={t('financialControl.paymentMethods.totalIn')} value={fmtAed(Number(data.totals.money_in), i18n.language)} />
        <KpiCard label={t('financialControl.paymentMethods.totalOut')} value={fmtAed(Number(data.totals.money_out), i18n.language)} />
        <KpiCard label={t('financialControl.paymentMethods.netChange')} value={fmtAed(Number(data.totals.net_change), i18n.language)} />
      </div>

      {comparisonJob && (
        <div className="bg-white border border-slate-200 rounded-xl space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                {t('financialControl.paymentMethods.comparison.resultsTitle')}
              </h3>
              <p className="text-sm text-slate-500">
                {comparisonJob.file_name} · {comparisonJob.detected_columns.format.toUpperCase()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  exportReconciliationCsv(
                    comparisonJob,
                    `reconciliation-${pm.name.replace(/\s+/g, '-')}-${comparisonJob.id}.csv`
                  )
                }
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
              >
                <Download className="size-4" />
                {t('financialControl.paymentMethods.comparison.exportReport')}
              </button>
              <button
                type="button"
                onClick={() => setComparisonJob(null)}
                className="p-1.5 text-slate-500 hover:text-slate-800"
                aria-label={t('common.close')}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <KpiCard
              label={t('financialControl.paymentMethods.comparison.bankDebit')}
              value={fmtAed(Number(comparisonJob.summary.bank_total_debit), i18n.language)}
            />
            <KpiCard
              label={t('financialControl.paymentMethods.comparison.bankCredit')}
              value={fmtAed(Number(comparisonJob.summary.bank_total_credit), i18n.language)}
            />
            <KpiCard
              label={t('financialControl.paymentMethods.comparison.systemOut')}
              value={fmtAed(Number(comparisonJob.summary.system_total_money_out), i18n.language)}
            />
            <KpiCard
              label={t('financialControl.paymentMethods.comparison.systemIn')}
              value={fmtAed(Number(comparisonJob.summary.system_total_money_in), i18n.language)}
            />
            <KpiCard label={t('financialControl.paymentMethods.comparison.tabs.matched')} value={String(comparisonJob.summary.matched_count)} />
            <KpiCard label={t('financialControl.paymentMethods.comparison.tabs.bankOnly')} value={String(comparisonJob.summary.bank_only_count)} />
            <KpiCard label={t('financialControl.paymentMethods.comparison.tabs.systemOnly')} value={String(comparisonJob.summary.system_only_count)} />
            <KpiCard label={t('financialControl.paymentMethods.comparison.tabs.possible')} value={String(comparisonJob.summary.possible_match_count)} />
          </div>

          {comparisonJob.detected_columns.columns && (
            <p className="text-xs text-slate-500">
              {t('financialControl.paymentMethods.comparison.detectedColumns')}:{' '}
              {Object.entries(comparisonJob.detected_columns.columns)
                .map(([field, header]) => `${field}=${header}`)
                .join(', ')}
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
            {comparisonTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setComparisonTab(tab.id)}
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  comparisonTab === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <ComparisonRowTable
            rows={comparisonRows}
            showMatchMeta={comparisonTab === 'possible'}
            language={i18n.language}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.paymentMethods.dateFrom')}</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.paymentMethods.dateTo')}</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">{t('financialControl.paymentMethods.sourceType')}</label>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 text-sm min-w-[180px]">
            <option value="">{t('financialControl.paymentMethods.allSources')}</option>
            {SOURCE_TYPES.map((st) => (
              <option key={st} value={st}>
                {t(`financialControl.paymentMethods.sources.${st}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colDate')}</th>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colDescription')}</th>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colSource')}</th>
              <th className="px-4 py-3 text-end">{t('financialControl.paymentMethods.colIn')}</th>
              <th className="px-4 py-3 text-end">{t('financialControl.paymentMethods.colOut')}</th>
              <th className="px-4 py-3 text-end">{t('financialControl.paymentMethods.colBalance')}</th>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colCustomer')}</th>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colProcedure')}</th>
              <th className="px-4 py-3 text-start">{t('financialControl.paymentMethods.colRecordedBy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  {t('financialControl.paymentMethods.noRows')}
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap">{row.date || '—'}</td>
                  <td className="px-4 py-3">{row.description}</td>
                  <td className="px-4 py-3 text-xs">{t(`financialControl.paymentMethods.sources.${row.source_type}`, row.source_type)}</td>
                  <td className="px-4 py-3 text-end font-mono text-emerald-700">{row.money_in !== '0.00' ? fmtAed(Number(row.money_in), i18n.language) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono text-rose-700">{row.money_out !== '0.00' ? fmtAed(Number(row.money_out), i18n.language) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono font-semibold">{fmtAed(Number(row.running_balance), i18n.language)}</td>
                  <td className="px-4 py-3">{row.customer_name || '—'}</td>
                  <td className="px-4 py-3">{row.procedure_name || '—'}</td>
                  <td className="px-4 py-3">{row.created_by || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 text-center">
        <Link to="/financial-control/payment-methods" className="hover:underline">
          {t('financialControl.paymentMethods.backToList')}
        </Link>
      </p>

      {id && (
        <CompareBankStatementModal
          cardId={id}
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          onCompared={(job) => {
            setComparisonJob(job);
            setComparisonTab('matched');
          }}
        />
      )}
    </div>
  );
}
