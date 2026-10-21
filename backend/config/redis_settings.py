"""
Redis URL helpers for cache vs Celery broker isolation.

Logical separation (same host OK for small deployments; prefer separate
instances in production):

  Cache  → REDIS_CACHE_URL  (or REDIS_URL with DB 0)
  Broker → CELERY_BROKER_URL (or REDIS_URL with DB 1)

Broker Redis MUST use maxmemory-policy=noeviction so queued tasks are not
evicted. Cache Redis may use allkeys-lru when it is a dedicated instance.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


def _with_db(url: str, db: int) -> str:
    parts = urlsplit(url.strip())
    path = f"/{db}"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def resolve_redis_urls(
    *,
    redis_url: str = "",
    redis_cache_url: str = "",
    celery_broker_url: str = "",
    celery_result_backend: str = "",
) -> dict[str, str]:
    """
    Resolve cache/broker/result URLs from environment-style inputs.

    Empty strings mean "not configured". Result backend is optional and off
    by default (Celery results are not required for e-invoicing foundation).
    """
    base = (redis_url or "").strip()
    cache = (redis_cache_url or "").strip() or (_with_db(base, 0) if base else "")
    broker = (celery_broker_url or "").strip() or (_with_db(base, 1) if base else "")
    result = (celery_result_backend or "").strip()
    return {
        "cache": cache,
        "broker": broker,
        "result": result,
    }
