"""
Short-TTL cache for admin/manager dashboard summary.

Freshness policy
----------------
* TTL default: 30 seconds (DASHBOARD_SUMMARY_CACHE_TTL).
* Key includes actor id + period + generation so responses are not shared
  across users and can be invalidated globally after financial mutations.
* Cache is a soft acceleration layer only — never authoritative for balances,
  payments, refunds, or bank card state.
* On Redis/cache backend failure (IGNORE_EXCEPTIONS), the view recomputes
  from the database with no error to the client.
* Mutating financial endpoints do NOT read this cache for calculations.
* Invalidation: bump generation on Payment / Refund / Procedure / Expense
  create/update/delete (see dashboard.signals).
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.cache import cache

CACHE_KEY_PREFIX = "bizmanager:dash:summary:v1"
CACHE_VERSION = 1
GENERATION_KEY = "bizmanager:dash:summary:generation"


def get_dashboard_summary_generation() -> int:
    try:
        value = cache.get(GENERATION_KEY)
        if value is None:
            cache.add(GENERATION_KEY, 1, timeout=None)
            return 1
        return int(value)
    except Exception:  # noqa: BLE001 — soft-fail
        return 1


def bump_dashboard_summary_generation() -> int:
    """
    Invalidate all dashboard summary entries for all actors/periods.

    Uses a generation counter so we do not need Redis SCAN/KEY delete.
    """
    try:
        try:
            return int(cache.incr(GENERATION_KEY))
        except ValueError:
            cache.set(GENERATION_KEY, 1, timeout=None)
            return 1
    except Exception:  # noqa: BLE001 — soft-fail; TTL still bounds staleness
        return get_dashboard_summary_generation()


def dashboard_summary_cache_key(*, actor_id: int | str, period: str | None) -> str:
    period_part = period or "current"
    gen = get_dashboard_summary_generation()
    return f"{CACHE_KEY_PREFIX}:{CACHE_VERSION}:g{gen}:{actor_id}:{period_part}"


def get_cached_dashboard_summary(*, actor_id: int | str, period: str | None) -> Any | None:
    if not getattr(settings, "DASHBOARD_SUMMARY_CACHE_ENABLED", False):
        return None
    return cache.get(dashboard_summary_cache_key(actor_id=actor_id, period=period))


def set_cached_dashboard_summary(
    *, actor_id: int | str, period: str | None, payload: Any
) -> None:
    if not getattr(settings, "DASHBOARD_SUMMARY_CACHE_ENABLED", False):
        return
    ttl = int(getattr(settings, "DASHBOARD_SUMMARY_CACHE_TTL", 30))
    cache.set(
        dashboard_summary_cache_key(actor_id=actor_id, period=period),
        payload,
        timeout=ttl,
    )


def invalidate_dashboard_summary_cache(*, actor_id: int | str | None = None) -> None:
    """
    Invalidate dashboard summary cache.

    actor_id is accepted for API compatibility but generation bump invalidates
    all actors (required after shared financial mutations).
    """
    bump_dashboard_summary_generation()
