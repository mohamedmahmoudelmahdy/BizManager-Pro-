"""Read-only monthly hybrid profitability + collections for production."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from dashboard.services.collected_profitability import build_collected_profitability


class Command(BaseCommand):
    help = "Print hybrid profitability + collections KPIs for a month (YYYY-MM). Read-only."

    def add_arguments(self, parser):
        parser.add_argument("month", type=str, help="Period YYYY-MM")

    def handle(self, *args, **options):
        payload = build_collected_profitability(period=options["month"])
        self.stdout.write(f"period: {payload.get('period')}")
        self.stdout.write("--- profitability ---")
        for k, v in (payload.get("profitability") or {}).items():
            self.stdout.write(f"  {k}: {v}")
        self.stdout.write("--- collections ---")
        for k, v in (payload.get("collections") or {}).items():
            self.stdout.write(f"  {k}: {v}")
