"""Private filesystem storage for attestation documents (not publicly URL-served)."""

from __future__ import annotations

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible


@deconstructible
class AttestationPrivateStorage(FileSystemStorage):
    """
    Stores attestation uploads under ATTESTATION_PRIVATE_MEDIA_ROOT.

    base_url is intentionally unset so files are not exposed via MEDIA_URL.
    Authorized downloads must stream through Django after permission checks.
    """

    def __init__(self, location=None, base_url=None, **kwargs):
        root = location or str(
            getattr(settings, "ATTESTATION_PRIVATE_MEDIA_ROOT", settings.MEDIA_ROOT)
        )
        # Never advertise a public URL for these objects.
        super().__init__(location=root, base_url=base_url or "", **kwargs)

    def url(self, name):
        # Force callers to use authorized download endpoints.
        raise ValueError(
            "Attestation private storage has no public URL; use the secure download API."
        )


def get_attestation_storage() -> AttestationPrivateStorage:
    return AttestationPrivateStorage()
