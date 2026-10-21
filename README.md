# BizManager Pro

Typing center / business management system with a Django REST API backend and a React + TypeScript (Vite) frontend.

## Stack

- **Frontend:** React 18, TypeScript, Vite, React Router, i18n (EN/AR, RTL/LTR)
- **Backend:** Django 5, Django REST Framework, SimpleJWT
- **Infra:** Redis (cache + Celery broker), Celery workers, optional PostgreSQL
- **Features:** Customers, procedures, payments/refunds, expenses, financial control, marketing, attestation, dashboard summary cache, e-invoicing outbox foundation

## Repository layout

| Path | Purpose |
|------|---------|
| `src/` | React/TypeScript frontend |
| `backend/` | Django project (`config`, apps, migrations) |
| `deploy/` | Deployment helpers (no secrets) |
| `docs/` | Operational docs (Redis/Celery, etc.) |
| `backend/.env.example` | Documented env vars with **placeholders only** |

## Local development

### Prerequisites

- Node.js 20+
- Python 3.12+ (project uses a local `backend/.venv`)
- Optional: Redis with a password; PostgreSQL for production-like DB

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # then edit locally — never commit .env
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Local `.env` may keep `DEBUG=True` for development. **Production must use `DEBUG=False`** and secure cookies/HTTPS settings (see `.env.example`).

### Frontend

```bash
npm install
npm run dev
```

Default API base in development: `http://localhost:8000/api` (`VITE_API_BASE` optional).

### Redis / Celery (optional locally)

See [docs/REDIS_AND_CELERY.md](docs/REDIS_AND_CELERY.md).

- Cache URL → Redis logical DB `0`
- Celery broker → Redis logical DB `1`
- Set passwords via env (`REDIS_CACHE_URL`, `CELERY_BROKER_URL`); never commit password files

**Security note:** Prefer Redis `bind 127.0.0.1` on Windows/Linux hosts. Localhost-only binding should be verified by an administrator after deploy (`deploy/secure_redis_bind.ps1` on Windows). Treat unverified bind configuration as an open security item.

### Useful checks

```bash
# Backend
cd backend
python manage.py check
python manage.py makemigrations --check
python manage.py test

# Frontend (repo root)
npm run typecheck
npm run build
```

## Secrets policy

Do **not** commit:

- `.env` files with real secrets
- Redis password files (`backend/.redis_local_password.txt`)
- SQLite DBs, dumps, media uploads
- Private keys / certificates
- Customer or financial data exports

Use `backend/.env.example` as the template for required variables.

## License / attribution

See `ATTRIBUTIONS.md` for third-party attributions where applicable.