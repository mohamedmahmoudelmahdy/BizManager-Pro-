"""DRF throttles for attestation public submit and login."""

from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class AttestationPublicSubmitThrottle(AnonRateThrottle):
    scope = "attestation_public_submit"

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}) or {}
        rates = rates.get("DEFAULT_THROTTLE_RATES") or {}
        return rates.get(self.scope) or "30/hour"


class LoginRateThrottle(SimpleRateThrottle):
    """Throttle credential-guessing on JWT obtain."""

    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}) or {}
        rates = rates.get("DEFAULT_THROTTLE_RATES") or {}
        return rates.get(self.scope) or "10/minute"
