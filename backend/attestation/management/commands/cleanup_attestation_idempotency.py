"""Expire old attestation public Idempotency-Key records."""

from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from attestation.models import AttestationSubmissionIdempotency


class Command(BaseCommand):
    help = "Delete AttestationSubmissionIdempotency rows older than N days (default 30)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Count matching rows without deleting.",
        )

    def handle(self, *args, **options):
        days = max(1, int(options["days"]))
        cutoff = timezone.now() - timedelta(days=days)
        qs = AttestationSubmissionIdempotency.objects.filter(created_at__lt=cutoff)
        count = qs.count()
        if options["dry_run"]:
            self.stdout.write(f"Would delete {count} idempotency row(s) older than {days} days.")
            return
        deleted, _ = qs.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} idempotency row(s)."))
