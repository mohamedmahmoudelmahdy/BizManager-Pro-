# Marketing CRM Reporting Contract (Phase 3.3A)

Read-only backend reporting APIs under `/api/marketing/reports/`.

## Endpoints

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/marketing/reports/overview/` | `view_marketing_dashboard` **OR** `view_marketing_report` |
| GET | `/api/marketing/reports/lead-trends/` | `view_marketing_report` |
| GET | `/api/marketing/reports/campaign-performance/` | `view_marketing_report` |
| GET | `/api/marketing/reports/followup-workload/` | `view_marketing_report` |
| GET | `/api/marketing/reports/assignment-workload/` | `view_marketing_report` |

POST / PATCH / PUT / DELETE → **405**.

**Filter-options endpoint:** not implemented. Use existing hierarchy list endpoints
(`/api/marketing/channels|platforms|campaigns|…`) and status/outcome enum codes from this contract.

## Common filters

ISO dates only (`YYYY-MM-DD`). Default range: **first day of current month → today**
(`timezone.localdate()`), inclusive.

| Param | Notes |
|-------|--------|
| `date_from`, `date_to` | Required as pair when overriding defaults; `date_from <= date_to` |
| `channel_id`, `platform_id`, `campaign_id`, `adset_id`, `advertisement_id` | Hierarchy; child must belong to selected parent; inactive records allowed |
| `status`, `outcome` | Lead enum codes; blank outcome = `""` |
| `assigned_to` | User id (active assignment / follow-up assignee as endpoint-specific) |
| `include_archived` | Default `false` |
| `interval` | lead-trends only: `day` \| `week` \| `month` |
| `search`, `ordering`, `page`, `page_size` | campaign-performance only; `page_size` max 100 |

### Date range limits

- day interval: max 366 days
- week interval: max ~3 years
- month / non-interval: max ~10 years

Error code: `report_date_range_too_large`.

## Date semantics

Inclusive calendar dates. Timestamp fields use:

- start: `date_from` 00:00:00 in `TIME_ZONE`
- end: exclusive start of `date_to + 1 day`

| Metric family | Driving field |
|---------------|---------------|
| Lead creation / lost (created in range) | `Lead.created_at` |
| Conversion events | `Lead.converted_at` |
| Campaign spend | `CampaignSpend.spend_date` (date inclusive) |
| Follow-up overdue / due | `LeadFollowUp.scheduled_for` |
| Assignment completed_in_range | `LeadAssignment.completed_at` |

## Archive semantics

Default `include_archived=false`: operational lead querysets exclude `status=archived`.

Archived leads are historical soft-removals; they are excluded from operational
dashboard counts unless explicitly included. Conversion/spend attribution uses the
same lead queryset archive policy for consistency across endpoints.

## Visibility

`visible_leads_for()` is applied **before** aggregation.

- Managers / admin|manager role: all leads
- Marketing employees: all leads (no assignment filter)
- Operations CRM: self-assigned (active) **or** unassigned (no active assignment)

**Unassigned** = no assignment in `LeadAssignment.ACTIVE_STATUSES` (`pending`, `accepted`).
Historical-only assignments still count as unassigned.

## Spend visibility

CampaignSpend is not Lead-scoped. Callers who pass dashboard/report permission
checks may see Spend totals. Seeded Operations CRM users do **not** receive
report/dashboard permissions, so they cannot access these endpoints or global Spend.

## Metric definitions

### Leads (overview)

- **total** — visible leads with `created_at` in range
- **active** — visible non-archived leads whose status is not terminal
  (`converted`, `lost`, `archived`)
- **converted_cohort** — leads created in range that satisfy conversion invariant
- **conversion_events** — leads with `converted_at` in range (invariant required)
- **lost** — leads created in range with `status=lost` (status, not outcome)
- **conversion_rate** — `converted_cohort / total` as Decimal ratio **0–1** string;
  `null` if denominator is 0
- **average_time_to_conversion_hours** — average `(converted_at - created_at)` hours
  for conversion events in range; negatives excluded; `null` if none

### Conversion invariant

```
status = converted
AND linked_customer IS NOT NULL
AND converted_at IS NOT NULL
```

### Spend

- **total** — sum of `CampaignSpend.amount` where `spend_date` in range and hierarchy matches
- **cost_per_lead** — `total_spend / total_leads` (campaign-attributed); `null` if denom 0
- **cost_per_conversion** — `total_spend / converted_cohort`; `null` if denom 0

Decimals are never computed with float. Money strings use 2 dp; rates use 4 dp.

Does **not** use `expense_id` or accounting posting.

### Follow-ups

Overdue = `status=pending AND scheduled_for < now` (derived; never persisted).

### Assignments

Active = `pending OR accepted`. Workload by assignee uses display-safe
`user_id` + `display_name` only.

## Lead trends

Dense buckets (zeros filled). `converted` uses conversion-event timing;
`created` / `lost` use creation timing.

## Campaign performance

Paginated campaign rows. Lead counts use visibility-scoped subqueries; spend uses
separate spend subqueries (no Lead×Spend join multiplication).

## Structured errors

Envelope:

```json
{
  "error": {
    "code": "invalid_report_date_range",
    "message": "invalid_report_date_range",
    "details": {}
  }
}
```

Codes: `invalid_report_date_range`, `invalid_reporting_interval`,
`invalid_report_filter`, `invalid_report_hierarchy`, `report_date_range_too_large`,
`report_permission_denied`.

## Known limitations

- SQLite vs PostgreSQL `TruncWeek` week-start may differ; series keys are normalized
  in Python for day/month; week buckets are Monday-aligned in Python fill.
- No caching, CSV/PDF export, scheduled reports, or materialized tables.
- No filter-options endpoint (use existing hierarchy APIs).
