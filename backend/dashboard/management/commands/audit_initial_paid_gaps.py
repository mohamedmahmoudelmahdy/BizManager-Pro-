"""Read-only audit: Procedure.paid vs authoritative linked net payments.

Invariant (linked collections):
  Procedure.paid  ==  SUM(Payment.amount linked to procedure)
                    - SUM(PaymentRefund.amount against those payments)

Exceptions (historical gaps or allocation moves) are reported only — never mutated.
"""
from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import F, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from payments.models import Payment, PaymentRefund
from procedures.models import Procedure
from procedures.services.create_with_accounting import INITIAL_PAYMENT_NOTE


class Command(BaseCommand):
    help = (
        "List procedures where stored Procedure.paid != linked net payments "
        "(SUM payments − SUM refunds on those payments). Read-only."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Max rows to print (default 100)",
        )
        parser.add_argument(
            "--only-gaps",
            action="store_true",
            help="Only rows where stored paid > linked net (legacy initial-paid gaps).",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        only_gaps = options["only_gaps"]

        pay_sub = (
            Payment.objects.filter(procedure_id=OuterRef("pk"))
            .values("procedure_id")
            .annotate(t=Sum("amount"))
            .values("t")[:1]
        )
        ref_sub = (
            PaymentRefund.objects.filter(payment__procedure_id=OuterRef("pk"))
            .values("payment__procedure_id")
            .annotate(t=Sum("amount"))
            .values("t")[:1]
        )

        qs = (
            Procedure.objects.annotate(
                pay_sum=Coalesce(Subquery(pay_sub), Value(Decimal("0"))),
                ref_sum=Coalesce(Subquery(ref_sub), Value(Decimal("0"))),
            )
            .annotate(net_payments=F("pay_sum") - F("ref_sum"))
            .exclude(paid=F("net_payments"))
            .order_by("-date", "-pk")
        )
        if only_gaps:
            qs = qs.filter(paid__gt=F("net_payments"))

        total = qs.count()
        self.stdout.write(f"Procedure.paid discrepancies: {total}")
        self.stdout.write(
            "Invariant: stored_paid == linked_net_paid "
            "(SUM linked Payment.amount − SUM refunds on those Payments)."
        )
        self.stdout.write(
            "These are exceptions for manual review — do NOT auto-backfill Payments."
        )
        self.stdout.write(
            f"(Initial-payment note marker for new creates: {INITIAL_PAYMENT_NOTE})"
        )
        self.stdout.write("")
        self.stdout.write(
            "date | procedure_id | stored_paid | expected_linked_net_paid | difference | "
            "sell | cost | category"
        )

        for proc in qs[:limit]:
            stored = Decimal(str(proc.paid or 0))
            expected = Decimal(str(proc.net_payments or 0))
            difference = stored - expected
            category = (proc.category or "")[:40]
            self.stdout.write(
                f"{proc.date} | {proc.pk} | stored_paid={stored} | "
                f"expected_linked_net_paid={expected} | difference={difference:.2f} | "
                f"sell={proc.selling_price} cost={proc.cost} | {category}"
            )

        if total > limit:
            self.stdout.write(f"... truncated ({limit} of {total})")
