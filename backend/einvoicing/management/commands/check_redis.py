"""Report Redis cache/broker connectivity without requiring Redis at import time."""

from __future__ import annotations

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Check Redis cache connectivity and print Celery broker configuration."

    def handle(self, *args, **options):
        cache_url = getattr(settings, "REDIS_CACHE_URL", "") or "(not set)"
        broker_url = getattr(settings, "CELERY_BROKER_URL", "") or "(not set)"
        result_backend = getattr(settings, "CELERY_RESULT_BACKEND", None) or "(disabled)"
        backend = settings.CACHES.get("default", {}).get("BACKEND", "")

        self.stdout.write(f"CACHE backend: {backend}")
        self.stdout.write(f"REDIS_CACHE_URL: {self._redact(cache_url)}")
        self.stdout.write(f"CELERY_BROKER_URL: {self._redact(broker_url)}")
        self.stdout.write(f"CELERY_RESULT_BACKEND: {self._redact(str(result_backend))}")
        self.stdout.write(
            f"DASHBOARD_SUMMARY_CACHE_ENABLED: {settings.DASHBOARD_SUMMARY_CACHE_ENABLED}"
        )

        if "redis" not in backend.lower():
            self.stdout.write(
                self.style.WARNING(
                    "Redis cache is not active (LocMem/fallback). "
                    "Set REDIS_URL or REDIS_CACHE_URL to enable."
                )
            )
            return

        probe_key = "bizmanager:health:redis_probe"
        try:
            cache.set(probe_key, "ok", timeout=10)
            value = cache.get(probe_key)
            cache.delete(probe_key)
            if value == "ok":
                self.stdout.write(self.style.SUCCESS("Redis cache connectivity: OK"))
            else:
                self.stdout.write(
                    self.style.ERROR("Redis cache connectivity: unexpected miss")
                )
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(
                self.style.ERROR(f"Redis cache connectivity: FAIL ({exc})")
            )

    @staticmethod
    def _redact(url: str) -> str:
        if not url or url.startswith("("):
            return url
        if "@" not in url:
            return url
        # redis://:password@host:6379/0 → redis://:***@host:6379/0
        scheme, rest = url.split("://", 1)
        creds, hostpart = rest.rsplit("@", 1)
        if ":" in creds:
            user, _pw = creds.split(":", 1)
            creds = f"{user}:***"
        else:
            creds = "***"
        return f"{scheme}://{creds}@{hostpart}"
