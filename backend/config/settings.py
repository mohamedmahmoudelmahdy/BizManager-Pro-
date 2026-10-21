"""
Django settings for BizManager / Attestation.

Production hardening is applied when DEBUG is False. Override via environment.
"""

import sys
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent
_TESTING = "test" in sys.argv

env = environ.Env(
    DEBUG=(bool, False),
    SECRET_KEY=(str, "change-me"),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOW_ALL_ORIGINS=(bool, False),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
    SECURE_SSL_REDIRECT=(bool, False),
    SESSION_COOKIE_SECURE=(bool, False),
    CSRF_COOKIE_SECURE=(bool, False),
    SECURE_HSTS_SECONDS=(int, 0),
    NUM_PROXIES=(int, 1),
    JWT_ACCESS_MINUTES=(int, 30),
    JWT_REFRESH_DAYS=(int, 7),
    REDIS_URL=(str, ""),
    REDIS_CACHE_URL=(str, ""),
    CELERY_BROKER_URL=(str, ""),
    CELERY_RESULT_BACKEND=(str, ""),
    DASHBOARD_SUMMARY_CACHE_TTL=(int, 30),
    PERF_DEBUG_MIDDLEWARE=(bool, False),
)

environ.Env.read_env(env_file=BASE_DIR / ".env")

DEBUG = env("DEBUG")
SECRET_KEY = env("SECRET_KEY")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

_MGMT_COMMAND = sys.argv[1] if len(sys.argv) > 1 else ""
_RUNTIME_SERVING = _MGMT_COMMAND in {
    "runserver",
    "runserver_plus",
} or any("gunicorn" in a or "uvicorn" in a for a in sys.argv)

if not DEBUG and not _TESTING and _RUNTIME_SERVING:
    # Fail closed when actually serving traffic with incomplete production secrets.
    if SECRET_KEY in {"", "change-me", "changeme"}:
        raise RuntimeError("SECRET_KEY must be set to a strong value when DEBUG=False.")
    if not ALLOWED_HOSTS or ALLOWED_HOSTS == ["*"]:
        raise RuntimeError("ALLOWED_HOSTS must be an explicit list when DEBUG=False.")
elif not DEBUG and not _TESTING:
    if SECRET_KEY in {"", "change-me", "changeme"}:
        import warnings

        warnings.warn(
            "SECRET_KEY is weak while DEBUG=False. Set a strong SECRET_KEY before serving traffic.",
            RuntimeWarning,
            stacklevel=1,
        )
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "rest_framework_simplejwt.token_blacklist",
    "accounts",
    "customers",
    "banking",
    "deposits",
    "procedures",
    "payments",
    "documents",
    "expenses",
    "financial_control",
    "dashboard.apps.DashboardConfig",
    "marketing",
    "attestation",
    "einvoicing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Heavy per-request NDJSON timing — opt-in only (PERF_DEBUG_MIDDLEWARE=True).
if env("PERF_DEBUG_MIDDLEWARE"):
    MIDDLEWARE.append("config.perf_debug_middleware.PerfDebugMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
    )
}

# ---------------------------------------------------------------------------
# Redis — optional shared infrastructure (cache + Celery broker)
# ---------------------------------------------------------------------------
# Dev without Redis: LocMem cache; Celery worker requires a broker URL.
# Prod: prefer dedicated Redis for broker (noeviction) vs cache (allkeys-lru).
# Never expose Redis to the public internet; use private network + password/TLS.
from config.redis_settings import resolve_redis_urls  # noqa: E402

_redis_urls = resolve_redis_urls(
    redis_url=env("REDIS_URL"),
    redis_cache_url=env("REDIS_CACHE_URL"),
    celery_broker_url=env("CELERY_BROKER_URL"),
    celery_result_backend=env("CELERY_RESULT_BACKEND"),
)
REDIS_CACHE_URL = _redis_urls["cache"]
CELERY_BROKER_URL = _redis_urls["broker"]
CELERY_RESULT_BACKEND = _redis_urls["result"] or None

if REDIS_CACHE_URL and not _TESTING:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_CACHE_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
                # Soft-fail: cache outage must not take down the API.
                "IGNORE_EXCEPTIONS": True,
                "SOCKET_CONNECT_TIMEOUT": 2,
                "SOCKET_TIMEOUT": 2,
            },
            "KEY_PREFIX": "bizmanager",
            "TIMEOUT": 300,
        }
    }
    _dash_cache_default = True
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "bizmanager-local",
            "TIMEOUT": 300,
        }
    }
    _dash_cache_default = False

# Explicit env wins; otherwise enable dashboard soft-cache only when Redis is wired.
DASHBOARD_SUMMARY_CACHE_ENABLED = env.bool(
    "DASHBOARD_SUMMARY_CACHE_ENABLED", default=_dash_cache_default
)
DASHBOARD_SUMMARY_CACHE_TTL = env("DASHBOARD_SUMMARY_CACHE_TTL")

# Celery — broker required for workers; result backend optional (off by default).
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_DEFAULT_QUEUE = "bizmanager.default"
CELERY_TASK_ROUTES = {
    "einvoicing.process_outbox_event": {"queue": "bizmanager.einvoicing"},
}
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "visibility_timeout": 3600,
    "socket_timeout": 5,
    "socket_connect_timeout": 5,
}
if _TESTING:
    # Avoid requiring a live Redis/RabbitMQ broker during unit tests.
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = True
    CELERY_BROKER_URL = "memory://"
elif not CELERY_BROKER_URL:
    # Empty broker: do not silently default to amqp://localhost.
    CELERY_BROKER_URL = "memory://"
    CELERY_TASK_ALWAYS_EAGER = True

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "static"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
# Attestation PII documents — never expose via public MEDIA_URL / nginx alias.
ATTESTATION_PRIVATE_MEDIA_ROOT = Path(
    env("ATTESTATION_PRIVATE_MEDIA_ROOT", default=str(BASE_DIR / "private_media"))
)
ATTESTATION_PRIVATE_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

# Optional hooks (empty = null implementations; do not invent AV/CAPTCHA).
ATTESTATION_MALWARE_SCANNER = env("ATTESTATION_MALWARE_SCANNER", default="")
ATTESTATION_CAPTCHA_PROVIDER = env("ATTESTATION_CAPTCHA_PROVIDER", default="")

# Coordinated with attestation MAX_SUBMISSION_TOTAL_BYTES (~45 MiB) + overhead.
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 200

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Trust one reverse-proxy hop when deriving client IP for throttling.
NUM_PROXIES = env("NUM_PROXIES")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_RATES": {
        "attestation_public_submit": "30/hour",
        "login": "10/minute",
    },
    "NUM_PROXIES": NUM_PROXIES,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env("JWT_ACCESS_MINUTES")),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env("JWT_REFRESH_DAYS")),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
}

CORS_ALLOW_ALL_ORIGINS = env("CORS_ALLOW_ALL_ORIGINS")
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
SECURE_SSL_REDIRECT = env("SECURE_SSL_REDIRECT")
SESSION_COOKIE_SECURE = env("SESSION_COOKIE_SECURE")
CSRF_COOKIE_SECURE = env("CSRF_COOKIE_SECURE")
SECURE_HSTS_SECONDS = env("SECURE_HSTS_SECONDS")
if SECURE_HSTS_SECONDS:
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "require_debug_false": {"()": "django.utils.log.RequireDebugFalse"},
    },
    "formatters": {
        "verbose": {
            "format": "%(asctime)s [%(levelname)s] %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "loggers": {
        "django.security": {"handlers": ["console"], "level": "INFO"},
        "attestation": {"handlers": ["console"], "level": "INFO"},
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}
