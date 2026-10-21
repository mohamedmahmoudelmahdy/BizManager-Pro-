# Certificate Attestation — Backend Contract (Phase A)

## Batch relationship

- Commercial work is one existing **Procedure** (bulk Certificate Attestation).
- Operational config is **AttestationBatch** (`customer`, `linked_procedure`, `public_slug`, `expected_applicant_count`, `is_active`).
- Many **AttestationApplication** rows belong to one batch.
- Do **not** create one Procedure per teacher.
- Batch does **not** store charges, payments, or balances.

## Public submission

`POST /api/public/attestation/{public_slug}/applications/`

- Unauthenticated (`AllowAny`), throttled (`attestation_public_submit`, default 30/hour).
- Multipart form fields:
  - `full_name` (required)
  - `phone` (required)
  - `degrees` — JSON array string
  - `passport` — file
  - `degree_{i}_certificate` / `degree_{i}_transcript` — files per degree index
- Optional header: `Idempotency-Key` (scoped per batch).
- Server selects the active batch from `public_slug`. Client cannot send `customer_id` / `procedure_id` / `batch_id` / `status` / `internal_notes`.

### Degree JSON

```json
[
  {
    "study_location": "...",
    "university": "...",
    "degree_level": "...",
    "major": "...",
    "start_year": 2018,
    "completion_year": 2022,
    "final_grade": "Very Good"
  }
]
```

Academic period uses **years** (`start_year` / `completion_year`), not exact calendar dates.

### Success response

```json
{
  "reference_number": "ATT-000001",
  "status": "documents_received",
  "submitted_at": "...",
  "message_code": "attestation_application_submitted"
}
```

No public GET list/detail. No applicant status portal.

## Statuses (exactly four)

1. `documents_received`
2. `dataflow_in_progress`
3. `mohesr_in_progress`
4. `completed`

Transitions are forward-only and non-skipping.

## Internal APIs

- `GET /api/attestation/applications/` — search, status, batch, date range, ordering, page
- `GET /api/attestation/applications/{id}/`
- `PATCH /api/attestation/applications/{id}/` — `internal_notes` only
- `POST .../save-dataflow/` / `set-dataflow/`
- `POST .../save-mohesr/` / `set-mohesr/`
- `POST .../complete/`
- `GET /api/attestation/documents/{id}/download/`

Auth: JWT. Authorization: Django permissions (admin/manager bypass).

## Document categories

| Type | Degree | Default visibility |
|------|--------|--------------------|
| passport | null | applicant_submission |
| degree_certificate | required | applicant_submission |
| transcript | required | applicant_submission |
| dataflow_payment_proof | null | hr |
| dataflow_result | null | hr (optional for transition) |
| mohesr_payment_proof | null | hr |
| final_equivalency | null | hr |
| other_internal | null | internal |

Files: PDF/JPG/JPEG/PNG, max 10 MiB, opaque storage filenames. Serializers never return raw storage paths.

## Transition requirements

- → DataFlow: `dataflow_reference` + DataFlow payment proof
- → MOHESR: `mohesr_reference` + MOHESR payment proof (DataFlow result **not** required)
- → Completed: final equivalency document; sets `completed_at`

## Internal notes

Visible only on internal serializers. Never accepted or returned by public endpoints. HR serializer stub (`HRApplicationSerializer`) intentionally excludes notes.

## Financial non-integration

Public/internal attestation flows do **not** create Payment, Expense, Financial Control entries, or mutate Customer/Procedure balances. The linked bulk Procedure remains the commercial source of truth.

## Phone

Stores raw `phone` + `phone_normalized` (marketing normalizer). Not unique.

## Future phases

- Phase B: internal operations UI ✅
- Phase C: HR read-only dashboard ✅ (`/hr/attestation`, `/api/hr/attestation/`)
- Phase D: production hardening / security ✅ (SLA/notifications remain deferred)
- Phase E: public applicant submission form ✅ (`/attestation/apply`)

### Public applicant form (Phase E → multi-customer)

- Route: `/attestation/apply/:customerSlug` (stable **customer** slug; no login)
- Legacy bare `/attestation/apply` remains only for local env fallback (`VITE_ATTESTATION_PUBLIC_SLUG`)
- Resolve: `Customer.attestation_apply_slug` → active `AttestationBatch` (at most one active batch per customer)
- Legacy fallback: `AttestationBatch.public_slug` still accepted by the public POST API
- Multipart POST: `/api/public/attestation/<slug>/applications/`; `Idempotency-Key` + honeypot `website`
- Success shows `ATT-######` only — no status/tracking link
- Future (not built): `/{product}/apply/{customerSlug}` (e.g. `/visa/apply/...`) and per-product form customization

### Customer profile setup (staff)

- Company Customer profile → Attestation card (requires `manage_attestationbatch` or admin/manager bypass)
- Enable: sets `attestation_apply_slug`, creates linked bulk Procedure + active batch
- Copy public apply link; activate/deactivate batch; create/activate/deactivate HR portal users
- APIs under `/api/customers/<id>/attestation/`

### HR portal (Phase C)

- Auth: existing JWT + `User.role=hr_client` + `HRPortalProfile(customer)`
- Permissions: `view_hr_attestation_portal`, `view_hr_attestationapplication`, `download_hr_attestationdocument`
- APIs (GET only): overview, applications list/detail, document download
- Document visibility: `hr` + `applicant_submission` only
- Customer scoping applied before search/filter/pagination/object lookup
- Create/activate/deactivate user:
  - Customer profile UI (preferred)
  - `python manage.py create_hr_portal_user --username hr1 --customer-id ...` (prompts for password; never prints it)
  - `--deactivate` / `--activate` / `--set-password-only`

---

## Phase D — Production / security

### Public-form threat model

- Unauthenticated multipart POST is abuse-prone (bots, storage fill, slug probing).
- Defenses: dedicated throttle scope `attestation_public_submit` (default 30/hour), honeypot fields (`website`, `company_url`, `fax_number`), optional CAPTCHA provider hook, Idempotency-Key, inactive-batch rejection (`attestation_batch_unavailable`), extension/MIME/signature/size validation, nginx `client_max_body_size 50M` coordinated with ~45 MiB total upload cap.

### Upload restrictions

- Allowed: PDF, JPEG, PNG only (max **10 MiB per file**, **~45 MiB total** per submission).
- Rejected: SVG, HTML/HTM, JS, EXE, archives, macro Office formats, empty files, signature/MIME mismatches.
- Browser Content-Type is never trusted alone; magic-byte checks required.
- Optional malware scanner via `ATTESTATION_MALWARE_SCANNER` (default null — **no fake AV**).

### Private file delivery

- Files stored under `ATTESTATION_PRIVATE_MEDIA_ROOT` (`AttestationPrivateStorage`) — **no public URL**.
- nginx must **not** alias `/media/` publicly (returns 404 in `deploy/nginx.conf`).
- Downloads only via authorized APIs after permission checks:
  - Internal: `GET /api/attestation/documents/{id}/download/`
  - HR: `GET /api/hr/attestation/documents/{id}/download/`
- Response headers: `Content-Disposition: attachment` (sanitized filename), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- Knowing a storage path is **not** sufficient to download.

### HR authorization boundary

- Backend-enforced Customer scoping before lookup; cross-customer document guesses → safe 404.
- Internal-only documents never returned to HR.
- HR has no mutation endpoints (405); cannot call internal process APIs.
- Disabled `User.is_active` or `HRPortalProfile.is_active` denies portal access; JWT access still re-validates active user on each request.

### Account lifecycle

- No shared-password encouragement; one User per HR person.
- No email invitation infrastructure in-repo — ops uses `create_hr_portal_user` temporary password / reset flow until email is deployed.
- Login throttled (`login` scope, default 10/minute) via `ThrottledTokenObtainPairView`.
- SimpleJWT: access ~30m, refresh ~7d, **rotation + blacklist** enabled.

### Batch deactivation / retention

- Inactive batch: public submit rejected; historic applications remain readable to authorized staff/HR.
- **Retention / legal purge period is unresolved business configuration** — do not auto-delete completed records.

### Idempotency

- `Idempotency-Key` scoped per batch; same key returns original payload (no duplicate).
- Cleanup: `python manage.py cleanup_attestation_idempotency --days 30`

### Media integrity / backups

- Recovery requires **both** database backup **and** private media backup (`ATTESTATION_PRIVATE_MEDIA_ROOT`).
- Audit: `python manage.py audit_attestation_media` (read-only; `--delete-orphans` explicit).

### CAPTCHA

- Optional via `ATTESTATION_CAPTCHA_PROVIDER`. Recommend Cloudflare Turnstile (or equivalent) before internet exposure; never hardcode secrets.

### Deployment settings (checklist)

- `DEBUG=False`, strong `SECRET_KEY`, explicit `ALLOWED_HOSTS`
- `SECURE_SSL_REDIRECT` / secure cookies / HSTS only after HTTPS is verified (do not preload blindly)
- `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY`, `SECURE_REFERRER_POLICY`
- `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')`
- Explicit CORS/CSRF origins (no production `CORS_ALLOW_ALL` / wildcard hosts)
- Proxy overwrites `X-Forwarded-For` (see nginx); `NUM_PROXIES` for DRF throttling
- Run: `python manage.py check --deploy`

### Logging

- Application logs must not dump multipart bodies, Authorization headers, passwords, tokens, or file bytes.
- `AttestationAuditEvent` records operational events with safe metadata only (not status-history duplicate).
