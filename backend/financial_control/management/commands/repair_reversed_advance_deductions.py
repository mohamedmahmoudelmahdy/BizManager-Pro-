"""Repair advance deductions whose ledger was reversed without operational rollback."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from financial_control.models import EmployeeAdvance, EmployeeAdvanceDeduction, LedgerEntry
from financial_control.services import employee_advances as advances_svc


class Command(BaseCommand):
    help = (
        "Find advance deductions where the linked ledger entry was reversed generically "
        "but advance, expense, and deduction records were not updated."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report inconsistencies without applying repairs (default).",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply operational repairs without creating duplicate ledger reversals.",
        )

    def handle(self, *args, **options):
        apply_repairs = options["apply"] and not options["dry_run"]
        if options["apply"] and options["dry_run"]:
            self.stdout.write(
                self.style.WARNING("Both --apply and --dry-run set; running dry-run only.")
            )
            apply_repairs = False

        qs = (
            EmployeeAdvanceDeduction.objects.filter(
                status=EmployeeAdvanceDeduction.Status.ACTIVE,
                linked_ledger_entry__status=LedgerEntry.Status.REVERSED,
            )
            .select_related(
                "employee",
                "advance",
                "linked_salary_expense",
                "linked_ledger_entry",
            )
            .order_by("date", "created_at")
        )

        if not qs.exists():
            self.stdout.write(self.style.SUCCESS("No inconsistent advance deductions found."))
            return

        self.stdout.write(f"Found {qs.count()} inconsistent deduction(s):\n")
        repaired = 0
        for deduction in qs:
            advance = deduction.advance
            expense = deduction.linked_salary_expense
            employee_name = getattr(
                getattr(deduction.employee, "employee_profile", None),
                "full_name",
                None,
            ) or deduction.employee.username
            self.stdout.write(
                f"- Employee: {employee_name} | Deduction: {deduction.amount} "
                f"| Advance: {advance.id} (status={advance.status}, "
                f"outstanding={advance.outstanding_balance}) | "
                f"Salary expense: {expense.id if expense else '—'} "
                f"(salary_advance_deduction="
                f"{getattr(expense, 'salary_advance_deduction', '—')})"
            )
            self.stdout.write(
                f"  Expected repair: mark deduction reversed, restore advance balance "
                f"+{deduction.amount}, reduce expense salary_advance_deduction, "
                f"increase salary_remaining_due (no new ledger reversal).\n"
            )
            if apply_repairs:
                advances_svc.reverse_advance_deduction(
                    deduction,
                    user=None,
                    reason="Repair: ledger was reversed without operational rollback",
                    skip_ledger_if_already_reversed=True,
                )
                repaired += 1

        if apply_repairs:
            self.stdout.write(self.style.SUCCESS(f"Repaired {repaired} deduction(s)."))
        else:
            self.stdout.write(
                self.style.WARNING("Dry run complete. Re-run with --apply to fix records.")
            )
