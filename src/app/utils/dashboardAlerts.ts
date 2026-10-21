import type { Customer } from '@/app/contexts/DataContext';

export type AlertSeverity = 'expired' | 'expiring_soon';
export type AlertCategory = 'company' | 'worker';

export type AlertFilterSeverity = 'all' | 'expired' | 'expiring_soon';
export type AlertFilterGroup =
  | 'all'
  | 'company_documents'
  | 'worker_documents'
  | 'license'
  | 'trade_license'
  | 'insurance'
  | 'workers'
  | 'residency'
  | 'establishment'
  | 'echannel';

export type CompanyEmployeeAlert = {
  id: string;
  company: string;
  company_name?: string;
  name: string;
  residency_expiry: string;
  no_health_insurance?: boolean;
  insurance_expiry: string;
};

export type DashboardExpiryAlert = {
  id: string;
  alertType: string;
  category: AlertCategory;
  severity: AlertSeverity;
  customerId: string;
  customerName: string;
  field: string;
  label: string;
  currentExpiryDate: string;
  daysRemaining: number;
  workerId?: string;
  workerName?: string;
  filterGroup: AlertFilterGroup;
};

export const ALERT_THRESHOLD_DAYS = 30;

type CompanyFieldConfig = {
  key: keyof Customer;
  field: string;
  alertType: string;
  filterGroup: AlertFilterGroup;
  skipWhenNoHealthInsurance?: boolean;
};

const COMPANY_FIELD_CONFIG: CompanyFieldConfig[] = [
  { key: 'licenseExpiry', field: 'license_expiry', alertType: 'license_expiry', filterGroup: 'license' },
  {
    key: 'licenseExpiry',
    field: 'license_expiry',
    alertType: 'trade_license_expiry',
    filterGroup: 'trade_license',
  },
  { key: 'establishmentCardExpiry', field: 'establishment_card_expiry', alertType: 'establishment_card_expiry', filterGroup: 'establishment' },
  { key: 'workersExpiry', field: 'workers_expiry', alertType: 'workers_expiry', filterGroup: 'workers' },
  {
    key: 'healthInsuranceExpiry',
    field: 'health_insurance_expiry',
    alertType: 'health_insurance_expiry',
    filterGroup: 'insurance',
    skipWhenNoHealthInsurance: true,
  },
  { key: 'echannelExpiry', field: 'echannel_expiry', alertType: 'echannel_expiry', filterGroup: 'echannel' },
  { key: 'visaExpiry', field: 'visa_expiry', alertType: 'visa_expiry', filterGroup: 'residency' },
  { key: 'insuranceExpiry', field: 'insurance_expiry', alertType: 'insurance_expiry', filterGroup: 'insurance' },
];

export function daysUntilExpiry(date?: string): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function severityForDays(days: number): AlertSeverity {
  return days < 0 ? 'expired' : 'expiring_soon';
}

export function buildDashboardExpiryAlerts(
  customers: Customer[],
  workers: CompanyEmployeeAlert[],
  labels: Record<string, string>
): DashboardExpiryAlert[] {
  const alerts: DashboardExpiryAlert[] = [];

  for (const company of customers.filter((c) => c.type === 'company')) {
    for (const config of COMPANY_FIELD_CONFIG) {
      if (config.filterGroup === 'license' && company.tradeLicense) continue;
      if (config.filterGroup === 'trade_license' && !company.tradeLicense) continue;
      if (config.skipWhenNoHealthInsurance && company.noHealthInsurance) continue;
      const dateValue = company[config.key] as string | undefined;
      const remaining = daysUntilExpiry(dateValue);
      if (remaining === null || remaining > ALERT_THRESHOLD_DAYS) continue;

      const label =
        config.filterGroup === 'trade_license'
          ? labels.tradeLicense || 'Trade License Expiry'
          : labels[config.key] || config.field;

      alerts.push({
        id: `${company.id}:${config.alertType}`,
        alertType: config.alertType,
        category: 'company',
        severity: severityForDays(remaining),
        customerId: company.id,
        customerName: company.companyName || company.name,
        field: config.field,
        label,
        currentExpiryDate: dateValue || '',
        daysRemaining: remaining,
        filterGroup: config.filterGroup,
      });
    }
  }

  for (const worker of workers) {
    const residencyRemaining = daysUntilExpiry(worker.residency_expiry);
    if (residencyRemaining !== null && residencyRemaining <= ALERT_THRESHOLD_DAYS) {
      alerts.push({
        id: `${worker.id}:worker_residency_expiry`,
        alertType: 'worker_residency_expiry',
        category: 'worker',
        severity: severityForDays(residencyRemaining),
        customerId: worker.company,
        customerName: worker.company_name || '',
        workerId: worker.id,
        workerName: worker.name,
        field: 'residency_expiry',
        label: labels.workerResidency || 'Worker Residency Expiry',
        currentExpiryDate: worker.residency_expiry,
        daysRemaining: residencyRemaining,
        filterGroup: 'residency',
      });
    }
    if (!worker.no_health_insurance) {
      const insuranceRemaining = daysUntilExpiry(worker.insurance_expiry);
      if (insuranceRemaining !== null && insuranceRemaining <= ALERT_THRESHOLD_DAYS) {
        alerts.push({
          id: `${worker.id}:worker_insurance_expiry`,
          alertType: 'worker_insurance_expiry',
          category: 'worker',
          severity: severityForDays(insuranceRemaining),
          customerId: worker.company,
          customerName: worker.company_name || '',
          workerId: worker.id,
          workerName: worker.name,
          field: 'insurance_expiry',
          label: labels.workerInsurance || 'Worker Insurance Expiry',
          currentExpiryDate: worker.insurance_expiry,
          daysRemaining: insuranceRemaining,
          filterGroup: 'insurance',
        });
      }
    }
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function filterDashboardAlerts(
  alerts: DashboardExpiryAlert[],
  options: {
    search?: string;
    severity?: AlertFilterSeverity;
    group?: AlertFilterGroup;
  }
): DashboardExpiryAlert[] {
  const search = (options.search || '').trim().toLowerCase();
  const severity = options.severity || 'all';
  const group = options.group || 'all';

  return alerts.filter((alert) => {
    if (severity === 'expired' && alert.severity !== 'expired') return false;
    if (severity === 'expiring_soon' && alert.severity !== 'expiring_soon') return false;
    if (group === 'company_documents' && alert.category !== 'company') return false;
    if (group === 'worker_documents' && alert.category !== 'worker') return false;
    if (group !== 'all' && group !== 'company_documents' && group !== 'worker_documents') {
      if (alert.filterGroup !== group) return false;
    }
    if (!search) return true;
    const haystack = [alert.customerName, alert.workerName || '', alert.label, alert.alertType]
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });
}

export function suggestRenewalDate(currentExpiry?: string): string {
  const base = currentExpiry ? new Date(currentExpiry) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setFullYear(fallback.getFullYear() + 1);
    return fallback.toISOString().slice(0, 10);
  }
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
}
