# Backend (Django + DRF + JWT)

## Stack
- Django 5, Django REST Framework
- JWT auth (djangorestframework-simplejwt)
- CORS headers
- Postgres (recommended) with `DATABASE_URL`; falls back to SQLite if unset
- File uploads stored under `MEDIA_ROOT` (local disk on your Hostinger VPS)

## Setup
```bash
python -m venv .venv
. .venv/Scripts/activate  # or source .venv/bin/activate on mac/linux
pip install -r requirements.txt
```

Create `.env` in `backend/`:
```
DEBUG=True
SECRET_KEY=change-me
ALLOWED_HOSTS=127.0.0.1,localhost
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
CORS_ALLOW_ALL_ORIGINS=True
```

Run migrations and superuser:
```bash
python manage.py migrate
python manage.py createsuperuser
```

Run server:
```bash
python manage.py runserver 0.0.0.0:8000
```

## Apps & API
- `accounts`: custom user with role (admin/manager/employee/cashier)
- `customers`: customers (individual/company), company employees
- `procedures`: procedures with cash_in, cost, selling_price, status
- `payments`: payments linked to customers/procedures, optional bank card
- `banking`: bank cards / payment methods
- `documents`: attachments per customer, download ZIP

Key endpoints (JWT):
- `POST /api/token/`, `POST /api/token/refresh/`
- `GET /api/me/`
- CRUD: `/api/customers`, `/api/company-employees`, `/api/procedures`, `/api/payments`, `/api/bank-cards`, `/api/documents`
- `GET /api/documents/zip/<company_id>/`

## Redis & Celery (optional foundation)
- See `../docs/REDIS_AND_CELERY.md` and `backend/.env.example`
- Packages: `redis`, `django-redis`, `celery`
- Without Redis: LocMem cache; API still runs
- With Redis: shared cache + Celery broker for future e-invoicing jobs
- Check: `python manage.py check_redis`
- Worker: `celery -A config.celery worker -l info -Q bizmanager.default,bizmanager.einvoicing`

## Deployment notes (Hostinger VPS)
- Use Postgres service; export `DATABASE_URL`
- Serve media via nginx pointing to `backend/media`
- Set `DEBUG=False`, add your domain to `ALLOWED_HOSTS`
- Use `gunicorn config.wsgi:application` behind nginx
- For Redis/Celery: private Redis + `deploy/celery-worker.service` (verify outage behavior before calling production-ready)
