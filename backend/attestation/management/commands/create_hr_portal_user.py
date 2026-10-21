"""Create or update an HR portal user linked to a Customer (ops helper)."""

from __future__ import annotations

import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from accounts.services.role_groups import sync_role_managed_groups
from attestation.groups import seed_hr_portal_groups
from attestation.models import HRPortalProfile
from customers.models import Customer

User = get_user_model()


class Command(BaseCommand):
    help = (
        "Create or update an HR portal user for a Customer. "
        "Does not print passwords. Prefer --deactivate for lifecycle offboarding."
    )

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument(
            "--password",
            default=None,
            help="Optional; if omitted, prompts securely (getpass).",
        )
        parser.add_argument("--customer-id", required=False)
        parser.add_argument("--email", default="")
        parser.add_argument(
            "--deactivate",
            action="store_true",
            help="Disable the User and HRPortalProfile (login/API denied).",
        )
        parser.add_argument(
            "--activate",
            action="store_true",
            help="Re-enable the User and HRPortalProfile.",
        )
        parser.add_argument(
            "--set-password-only",
            action="store_true",
            help="Only rotate password for an existing HR user (no profile create).",
        )

    def handle(self, *args, **options):
        seed_hr_portal_groups()
        username = options["username"]

        if options["deactivate"]:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError("User not found") from exc
            user.is_active = False
            user.save(update_fields=["is_active"])
            HRPortalProfile.objects.filter(user=user).update(is_active=False)
            self.stdout.write(self.style.SUCCESS(f"Deactivated HR user {username}"))
            return

        if options["activate"]:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError("User not found") from exc
            user.is_active = True
            user.save(update_fields=["is_active"])
            HRPortalProfile.objects.filter(user=user).update(is_active=True)
            self.stdout.write(self.style.SUCCESS(f"Activated HR user {username}"))
            return

        password = options["password"]
        if not password:
            password = getpass.getpass("Password: ")
            confirm = getpass.getpass("Password (again): ")
            if password != confirm:
                raise CommandError("Passwords do not match")
        if not password:
            raise CommandError("Password is required")

        try:
            validate_password(password)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc

        if options["set_password_only"]:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError("User not found") from exc
            if user.role != User.Roles.HR_CLIENT:
                raise CommandError("User is not an HR portal client")
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(
                self.style.SUCCESS(f"Password updated for HR user {username}")
            )
            return

        customer_id = options.get("customer_id")
        if not customer_id:
            raise CommandError("--customer-id is required when creating/updating a profile")
        try:
            customer = Customer.objects.get(pk=customer_id)
        except Customer.DoesNotExist as exc:
            raise CommandError("Customer not found") from exc
        except (ValueError, TypeError) as exc:
            raise CommandError("Invalid customer-id") from exc

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": options["email"],
                "role": User.Roles.HR_CLIENT,
            },
        )
        if not created and user.role not in (User.Roles.HR_CLIENT, ""):
            # Fail safely rather than silently converting an internal staff account.
            if user.role != User.Roles.HR_CLIENT:
                raise CommandError(
                    f"User {username} already exists with role={user.role}; "
                    "refusing to convert. Use a dedicated HR username."
                )

        user.role = User.Roles.HR_CLIENT
        user.email = options["email"] or user.email
        user.set_password(password)
        user.is_active = True
        user.save()
        sync_role_managed_groups(user)

        profile, _ = HRPortalProfile.objects.update_or_create(
            user=user,
            defaults={"customer": customer, "is_active": True},
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if created else 'Updated'} HR user {user.username} "
                f"→ customer {customer.name} (profile {profile.pk}). "
                "Password was set (not printed)."
            )
        )
