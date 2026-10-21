import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronDown, ChevronRight, Copy, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchImportSheets,
  saveImportMapping,
  validateImportJob,
  type ImportSheetSummary,
  type SheetMappingInput,
} from '@/app/lib/financialControlApi';
import { ApiError } from '@/app/lib/api';
import { SectionCard } from '@/app/components/financial-control/components/SectionCard';
import { cn } from '@/app/components/ui/utils';

const PROFILES = ['generic', 'bizmanager_legacy', 'custom'];
const SHEET_TYPES = ['skip', 'ledger_account', 'ledger_entries', 'expense', 'check', 'debt', 'transfer'];

// Which column fields are relevant per sheet type (keys match the backend mapping).
const FIELDS_BY_TYPE: Record<string, string[]> = {
  ledger_entries: ['date', 'description', 'debit', 'credit', 'balance'],
  ledger_account: ['payee', 'balance'],
  expense: ['date', 'amount', 'description', 'payment_method', 'payee'],
  check: ['due_date', 'amount', 'check_number', 'payee'],
  debt: ['amount', 'payee', 'description'],
  transfer: ['date', 'amount', 'from_account', 'to_account'],
  skip: [],
};

type LocalMap = Record<string, SheetMappingInput & { account_name: string }>;

const TEMPLATE_KEY = 'fc_import_mapping_template_v1';

function signature(s: ImportSheetSummary): string {
  return s.header_labels.map((h) => h.label).join('|');
}

export function ImportMappingPanel({
  jobId,
  onValidated,
}: {
  jobId: string;
  onValidated: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheets, setSheets] = useState<ImportSheetSummary[]>([]);
  const [profile, setProfile] = useState('generic');
  const [mapping, setMapping] = useState<LocalMap>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchImportSheets(jobId);
      setProfile(data.profile || 'generic');
      setSheets(data.sheets);
      const init: LocalMap = {};
      for (const s of data.sheets) {
        init[s.sheet] = {
          type: s.user_type || s.detected_type,
          columns: Object.keys(s.user_columns || {}).length ? s.user_columns : s.columns,
          account_name: s.user_account_name || s.account_name || '',
          header_row: s.header_row,
        };
      }
      setMapping(init);
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  useEffect(() => {
    if (open && sheets.length === 0) load();
  }, [open, sheets.length, load]);

  const setType = (sheet: string, type: string) =>
    setMapping((m) => ({ ...m, [sheet]: { ...m[sheet], type } }));

  const setAccountName = (sheet: string, name: string) =>
    setMapping((m) => ({ ...m, [sheet]: { ...m[sheet], account_name: name } }));

  const setColumn = (sheet: string, field: string, value: string) =>
    setMapping((m) => {
      const cols = { ...(m[sheet]?.columns || {}) };
      if (value === '') delete cols[field];
      else cols[field] = Number(value);
      return { ...m, [sheet]: { ...m[sheet], columns: cols } };
    });

  const applyToSimilar = (sheet: ImportSheetSummary) => {
    const sig = signature(sheet);
    const src = mapping[sheet.sheet];
    let applied = 0;
    setMapping((m) => {
      const next = { ...m };
      for (const s of sheets) {
        if (s.sheet === sheet.sheet) continue;
        if (signature(s) === sig) {
          next[s.sheet] = {
            ...next[s.sheet],
            type: src.type,
            columns: { ...src.columns },
          };
          applied += 1;
        }
      }
      return next;
    });
    toast.success(t('financialControl.excelImport.appliedToSimilar', { count: applied }));
  };

  const saveTemplate = () => {
    try {
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ profile, mapping }));
      toast.success(t('financialControl.excelImport.templateSaved'));
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    }
  };

  const loadTemplate = () => {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY);
      if (!raw) {
        toast.error(t('financialControl.excelImport.noTemplate'));
        return;
      }
      const parsed = JSON.parse(raw) as { profile: string; mapping: LocalMap };
      setProfile(parsed.profile || 'generic');
      // Only apply template entries for sheets present in this workbook.
      setMapping((m) => {
        const next = { ...m };
        for (const s of sheets) {
          if (parsed.mapping[s.sheet]) next[s.sheet] = parsed.mapping[s.sheet];
        }
        return next;
      });
      toast.success(t('financialControl.excelImport.templateLoaded'));
    } catch {
      toast.error(t('financialControl.shell.loadError'));
    }
  };

  const validate = async () => {
    setSaving(true);
    try {
      const sheetsPayload: Record<string, SheetMappingInput> = {};
      for (const [name, cfg] of Object.entries(mapping)) {
        sheetsPayload[name] = {
          type: cfg.type,
          columns: cfg.columns || {},
          account_name: cfg.account_name || '',
          header_row: cfg.header_row,
        };
      }
      await saveImportMapping(jobId, { profile, sheets: sheetsPayload });
      await validateImportJob(jobId);
      toast.success(t('financialControl.excelImport.revalidated'));
      onValidated();
    } catch (e: unknown) {
      const detail =
        e instanceof ApiError ? (e.body as { detail?: string } | null)?.detail || e.detail : '';
      toast.error(detail || t('financialControl.shell.loadError'));
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cfg of Object.values(mapping)) c[cfg.type] = (c[cfg.type] || 0) + 1;
    return c;
  }, [mapping]);

  return (
    <SectionCard>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          <Wand2 className="size-4 text-indigo-600" />
          {t('financialControl.excelImport.mappingTitle')}
        </span>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-500">
                  {t('financialControl.excelImport.profile')}
                </label>
                <select
                  className="border rounded-lg px-2 py-1.5 text-sm"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  {PROFILES.map((p) => (
                    <option key={p} value={p}>
                      {t(`financialControl.excelImport.profile_${p}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={loadTemplate}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs border rounded-lg hover:bg-slate-50"
                >
                  <Save className="size-3.5" /> {t('financialControl.excelImport.loadTemplate')}
                </button>
                <button
                  type="button"
                  onClick={saveTemplate}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs border rounded-lg hover:bg-slate-50"
                >
                  <Save className="size-3.5" /> {t('financialControl.excelImport.saveTemplate')}
                </button>
              </div>

              <div className="text-xs text-slate-400">
                {Object.entries(counts)
                  .map(([type, n]) => `${t(`financialControl.excelImport.type_${type}`)}: ${n}`)
                  .join('  •  ')}
              </div>

              <div className="border rounded-lg divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
                {sheets.map((s) => {
                  const cfg = mapping[s.sheet];
                  if (!cfg) return null;
                  const isOpen = expanded === s.sheet;
                  const fields = FIELDS_BY_TYPE[cfg.type] || [];
                  return (
                    <div key={s.sheet} className="text-sm">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : s.sheet)}
                          className="flex items-center gap-1 min-w-0 flex-1 text-start"
                          disabled={fields.length === 0}
                        >
                          {fields.length > 0 &&
                            (isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />)}
                          <span className="font-medium truncate">{s.sheet}</span>
                          <span className="text-xs text-slate-400 flex-shrink-0">
                            ({s.row_count})
                          </span>
                          {cfg.account_name && (
                            <span className="text-xs text-indigo-500 truncate hidden sm:inline">
                              · {cfg.account_name}
                            </span>
                          )}
                        </button>
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                            s.confidence >= 0.7
                              ? 'bg-emerald-50 text-emerald-700'
                              : s.confidence >= 0.4
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-slate-100 text-slate-500'
                          )}
                        >
                          {Math.round(s.confidence * 100)}%
                        </span>
                        <select
                          className="border rounded-lg px-2 py-1 text-xs flex-shrink-0"
                          value={cfg.type}
                          onChange={(e) => setType(s.sheet, e.target.value)}
                        >
                          {SHEET_TYPES.map((ty) => (
                            <option key={ty} value={ty}>
                              {t(`financialControl.excelImport.type_${ty}`)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {isOpen && fields.length > 0 && (
                        <div className="px-3 pb-3 pt-1 bg-slate-50/60 space-y-2">
                          {(cfg.type === 'ledger_entries') && (
                            <label className="flex items-center gap-2 text-xs">
                              <span className="w-28 text-slate-500">
                                {t('financialControl.excelImport.field_account_name')}
                              </span>
                              <input
                                type="text"
                                value={cfg.account_name}
                                onChange={(e) => setAccountName(s.sheet, e.target.value)}
                                className="flex-1 border rounded px-2 py-1"
                              />
                            </label>
                          )}
                          {fields.map((field) => (
                            <label key={field} className="flex items-center gap-2 text-xs">
                              <span className="w-28 text-slate-500">
                                {t(`financialControl.excelImport.field_${field}`)}
                              </span>
                              <select
                                className="flex-1 border rounded px-2 py-1"
                                value={cfg.columns?.[field] ?? ''}
                                onChange={(e) => setColumn(s.sheet, field, e.target.value)}
                              >
                                <option value="">{t('financialControl.excelImport.ignoreColumn')}</option>
                                {s.header_labels.map((h) => (
                                  <option key={h.index} value={h.index}>
                                    {h.label || `Col ${h.index}`}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => applyToSimilar(s)}
                            className="flex items-center gap-1 px-2 py-1 text-xs border rounded-lg hover:bg-white"
                          >
                            <Copy className="size-3.5" />
                            {t('financialControl.excelImport.applyToSimilar')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={validate}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('financialControl.excelImport.validateWithMapping')}
              </button>
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}
