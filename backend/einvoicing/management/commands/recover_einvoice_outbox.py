from django.core.management.base import BaseCommand

from einvoicing.services.recovery import drain_pending_outbox, reclaim_stuck_processing


class Command(BaseCommand):
    help = (
        "Recover e-invoicing outbox: reclaim stuck PROCESSING rows and "
        "re-dispatch PENDING events (DB remains system of record)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--stuck-seconds",
            type=int,
            default=900,
            help="Reclaim PROCESSING rows older than this many seconds (default 900).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=50,
            help="Max PENDING rows to dispatch (default 50).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only reclaim stuck rows; do not dispatch PENDING.",
        )

    def handle(self, *args, **options):
        reclaimed = reclaim_stuck_processing(older_than_seconds=options["stuck_seconds"])
        dispatched = 0
        if not options["dry_run"]:
            dispatched = drain_pending_outbox(limit=options["limit"], dispatch=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"reclaimed_stuck={reclaimed} dispatched_pending={dispatched}"
            )
        )
