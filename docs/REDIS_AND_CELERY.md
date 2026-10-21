# Redis & Celery — BizManager Pro

Redis is **shared infrastructure** for:

1. Selective Django cache (performance)
2. Celery task broker (future UAE E-Invoicing async jobs)

Redis is **not** a legal requirement of UAE E-Invoicing; it is our async transport choice. Invoice state is always stored in the primary database.

## Architecture

| Role | Redis DB (single-host) | Eviction | Notes |
|------|------------------------|----------|-------|
| Django cache | `/0` (`REDIS_CACHE_URL`) | Prefer dedicated instance with `allkeys-lru` | Soft-fail via `IGNORE_EXCEPTIONS` |
| Celery broker | `/1` (`CELERY_BROKER_URL`) | **`noeviction` required** | Never share an LRU-only Redis with the broker |
| Celery results | optional `/2` | off by default | Not required for e-invoicing foundation |

**Production recommendation:** two Redis instances (cache vs broker) when traffic grows. Small VPS may start with one Redis + `noeviction` and short cache TTLs.

## Security

- Bind Redis to private interfaces only (`127.0.0.1` or Docker `appnet`)
- Require a password (`--requirepass` / ACL)
- Use `rediss://` TLS for managed Redis over untrusted networks
- Never publish Redis to the public internet
- Store URLs only in `.env` / systemd `EnvironmentFile` (never hardcode)

### Windows Redis (dev) hardening notes

Local verification set `requirepass` (persisted via `CONFIG REWRITE`).  
`CONFIG SET bind` is **unsupported** on Redis 3.0 for Windows — the service may still
listen on `0.0.0.0:6379` until an Administrator runs:

`deploy/secure_redis_bind.ps1`

(or manually uncomments `bind 127.0.0.1` in
`C:\Program Files\Redis\redis.windows-service.conf` and restarts the Redis service).

Password file (gitignored): `backend/.redis_local_password.txt`

### Dashboard cache invalidation

Financial mutations on `Payment`, `PaymentRefund`, `Procedure`, and `Expense`
bump a Redis generation key so all dashboard summary entries miss on next read.
TTL remains a backstop; cache is never used for authoritative balance math.

## Development (Windows / local)

This workstation may not have Docker or Redis installed. Options:

1. **Docker Desktop** (when available): `docker compose up redis -d` then set in `backend/.env`:
   ```
   REDIS_URL=redis://:changeme@127.0.0.1:6379/0
   CELERY_BROKER_URL=redis://:changeme@127.0.0.1:6379/1
   ```
2. **WSL2 + Redis package**
3. **Memurai** (Windows Redis-compatible)

Without Redis, the API still runs using LocMem cache. Celery workers will not process jobs until a broker URL is set.

```bash
cd backend
python manage.py check_redis
python manage.py migrate
celery -A config.celery worker -l info -Q bizmanager.default,bizmanager.einvoicing
```

## Dashboard cache policy

Endpoint: `GET /api/dashboard/summary/`

- Soft cache only (default TTL **30s**)
- Key includes **actor user id** + period
- Response header `X-Cache: HIT|MISS`
- **Not** used for payment/refund/balance mutations
- On Redis outage: miss → recompute from DB (no client error)

## E-Invoicing readiness

- Models: `EInvoiceDocument`, `EInvoiceOutbox` (DB is system of record)
- Unique `idempotency_key` prevents duplicate issuance records
- Outbox + `transaction.on_commit` → Celery task
- Task is idempotent (claim with `select_for_update(skip_locked=True)`)
- **No** provider submission, tax rules, or XML in this phase

## Production (Hostinger / VPS)

1. Install Redis (apt) or use a private managed Redis
2. Configure `REDIS_CACHE_URL` / `CELERY_BROKER_URL` in `backend/.env`
3. Enable systemd units:
   - `deploy/backend.service` (Gunicorn)
   - `deploy/celery-worker.service` (Celery)
4. Verify: `python manage.py check_redis`
5. Confirm Redis listens only on localhost/private IP (`ss -lntp | grep 6379`)

**Do not claim production readiness until Redis outage, worker restart, and failure-mode tests are run on the target host.**
