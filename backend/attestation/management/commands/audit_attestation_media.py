"""Read-only integrity audit for attestation private media vs DB references."""

from __future__ import annotations

from pathlib import Path

from django.core.management.base import BaseCommand

from attestation.models import ApplicationDocument
from attestation.storage import get_attestation_storage


class Command(BaseCommand):
    help = (
        "Audit attestation private media (READ-ONLY by default). "
        "Reports missing files, orphan files, and empty paths. "
        "Pass --delete-orphans only after careful review."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--delete-orphans",
            action="store_true",
            help="Delete orphan files not referenced by any ApplicationDocument.",
        )

    def handle(self, *args, **options):
        storage = get_attestation_storage()
        root = Path(storage.location)
        referenced: set[str] = set()
        missing = 0
        empty_path = 0

        for doc in ApplicationDocument.objects.iterator():
            name = (doc.file.name or "").strip()
            if not name:
                empty_path += 1
                self.stdout.write(f"EMPTY_PATH document_id={doc.pk}")
                continue
            referenced.add(name)
            if not storage.exists(name):
                missing += 1
                self.stdout.write(f"MISSING document_id={doc.pk} path={name}")

        orphans: list[str] = []
        if root.exists():
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                rel = path.relative_to(root).as_posix()
                if rel not in referenced:
                    orphans.append(rel)
                    self.stdout.write(f"ORPHAN path={rel}")

        deleted = 0
        if options["delete_orphans"] and orphans:
            for rel in orphans:
                storage.delete(rel)
                deleted += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. referenced={len(referenced)} missing={missing} "
                f"empty_path={empty_path} orphans={len(orphans)} deleted={deleted}"
            )
        )
        if options["delete_orphans"] is False and orphans:
            self.stdout.write(
                "Orphans listed only. Re-run with --delete-orphans to remove them."
            )
