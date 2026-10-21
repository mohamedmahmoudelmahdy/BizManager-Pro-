"""End-to-end Redis/Celery verification (dev only)."""

from __future__ import annotations

import os
import sys
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    def _redact(url: str) -> str:
        if not url or "@" not in url:
            return url or "(empty)"
        scheme, rest = url.split("://", 1)
        creds, hostpart = rest.rsplit("@", 1)
        if ":" in creds:
            user, _pw = creds.split(":", 1)
            creds = f"{user}:***"
        else:
            creds = "***"
        return f"{scheme}://{creds}@{hostpart}"

    section("Config")
    print("CACHE_BACKEND", settings.CACHES["default"]["BACKEND"])
    print("REDIS_CACHE_URL", _redact(getattr(settings, "REDIS_CACHE_URL", "") or ""))
    print("CELERY_BROKER_URL", _redact(settings.CELERY_BROKER_URL or ""))
    print("DASHBOARD_SUMMARY_CACHE_ENABLED", settings.DASHBOARD_SUMMARY_CACHE_ENABLED)
    print("CELERY_TASK_ALWAYS_EAGER", getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))

    section("manage.py check_redis")
    call_command("check_redis")

    section("Cache read/write/expire")
    key = "bizmanager:verify:cache_probe"
    cache.delete(key)
    cache.set(key, "alive", timeout=2)
    v1 = cache.get(key)
    print("immediate_get", v1)
    time.sleep(2.2)
    v2 = cache.get(key)
    print("after_ttl_get", v2)
    cache_ok = v1 == "alive" and v2 is None
    print("cache_test", "PASS" if cache_ok else "FAIL")

    section("Celery discovery")
    from config.celery import app, ping

    # Ensure app tasks are imported
    import einvoicing.tasks  # noqa: F401

    registered = sorted(k for k in app.tasks if not k.startswith("celery."))
    print("registered_tasks", registered)
    print("ping_task", ping.name)
    discovery_ok = "bizmanager.ping" in registered and "einvoicing.process_outbox_event" in registered
    print("discovery_test", "PASS" if discovery_ok else "FAIL")

    section("Enqueue ping (async via broker)")
    marker = "bizmanager:verify:last_ping"
    cache.delete(marker)
    token = f"verify-{int(time.time())}"

    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        print("WARN: CELERY_TASK_ALWAYS_EAGER is True — not testing real broker")
        ping.delay(token)
        task_ok = cache.get(marker) == token
        print("eager_marker", cache.get(marker))
        print("task_test", "PASS" if task_ok else "FAIL")
        return 0 if cache_ok and discovery_ok and task_ok else 1

    async_result = ping.apply_async(args=[token], queue="bizmanager.default")
    print("task_id", async_result.id)
    task_ok = False
    for _ in range(40):
        if cache.get(marker) == token:
            task_ok = True
            break
        time.sleep(0.5)
    print("worker_marker", cache.get(marker))
    # Result backend is intentionally disabled; do not call async_result.state/.get().
    print("task_test", "PASS" if task_ok else "FAIL")

    return 0 if cache_ok and discovery_ok and task_ok else 1


if __name__ == "__main__":
    sys.exit(main())
