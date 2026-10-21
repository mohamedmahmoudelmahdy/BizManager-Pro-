"""
Optional CAPTCHA / bot-challenge boundary for public attestation submit.

No third-party provider is wired by default. When deployment credentials exist,
set:

    ATTESTATION_CAPTCHA_PROVIDER = "attestation.services.captcha.NullCaptchaProvider"

or a custom provider implementing ``verify(token, remote_ip) -> bool``.

Public forms may send ``captcha_token``; verification is skipped when unset and
no provider requires it.
"""

from __future__ import annotations

import logging
from importlib import import_module

from django.conf import settings

logger = logging.getLogger("attestation.captcha")


class CaptchaRejected(Exception):
    pass


class NullCaptchaProvider:
    """Accepts all tokens — used until Turnstile/hCaptcha credentials are configured."""

    require_token = False

    def verify(self, token: str | None, remote_ip: str | None = None) -> bool:
        return True


def get_captcha_provider():
    path = getattr(settings, "ATTESTATION_CAPTCHA_PROVIDER", "") or ""
    if not path:
        return NullCaptchaProvider()
    module_name, _, attr = path.rpartition(".")
    if not module_name:
        logger.warning("Invalid ATTESTATION_CAPTCHA_PROVIDER=%r; using null provider", path)
        return NullCaptchaProvider()
    module = import_module(module_name)
    return getattr(module, attr)()


def verify_captcha_token(token: str | None, remote_ip: str | None = None) -> None:
    provider = get_captcha_provider()
    if getattr(provider, "require_token", False) and not token:
        raise CaptchaRejected("captcha_required")
    if not provider.verify(token, remote_ip):
        raise CaptchaRejected("captcha_failed")
