from django.core.management.base import BaseCommand, CommandError

from marketing.groups import seed_marketing_groups


class Command(BaseCommand):
    help = (
        "Create Marketing CRM Django Groups and assign existing marketing permissions. "
        "Safe to rerun after Phase 2B migrations create model permissions."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit with error if any expected marketing permissions are missing.",
        )
        parser.add_argument(
            "--sync",
            action="store_true",
            help=(
                "Remove marketing-app permissions from each group that are not in the "
                "expected matrix. Does not touch non-marketing permissions."
            ),
        )

    def handle(self, *args, **options):
        strict = options["strict"]
        sync = options["sync"]
        result = seed_marketing_groups(sync=sync)

        for name in result.created_groups:
            self.stdout.write(self.style.SUCCESS(f"Created group: {name}"))
        for name in result.existing_groups:
            self.stdout.write(f"Group already exists: {name}")

        for group_name, code in result.assigned_permissions:
            self.stdout.write(self.style.SUCCESS(f"Assigned {code} -> {group_name}"))
        for group_name, code in result.already_assigned:
            self.stdout.write(f"Already assigned {code} -> {group_name}")

        for group_name, code in result.removed_permissions:
            self.stdout.write(self.style.WARNING(f"Removed {code} from {group_name}"))

        missing = result.missing_unique
        if missing:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(missing)} expected permission(s) not found "
                    "(will be assignable after Phase 2B model migrations):"
                )
            )
            for code in missing:
                self.stdout.write(f"  - {code}")
            if strict:
                raise CommandError(
                    f"Strict mode: {len(missing)} expected marketing permission(s) are missing."
                )
        else:
            self.stdout.write(self.style.SUCCESS("All expected marketing permissions were found."))

        self.stdout.write(self.style.SUCCESS("seed_marketing_groups completed."))
