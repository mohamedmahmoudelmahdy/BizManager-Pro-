from io import StringIO

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.test import TestCase

from marketing.groups import seed_marketing_groups
from marketing.permissions import (
    GROUP_MARKETING_EMPLOYEE,
    GROUP_MARKETING_MANAGER,
    GROUP_MARKETING_MARKETER,
    GROUP_OPERATIONS_CRM_USER,
    GROUP_PERMISSION_MATRIX,
)


def _ensure_extra_perm(app_label: str, codename: str) -> Permission:
    ct, _ = ContentType.objects.get_or_create(app_label=app_label, model=codename)
    perm, _ = Permission.objects.get_or_create(
        content_type=ct,
        codename=codename,
        defaults={"name": f"Can {codename.replace('_', ' ')}"},
    )
    return perm


class SeedMarketingGroupsTests(TestCase):
    def test_creates_three_groups_idempotently(self):
        result1 = seed_marketing_groups()
        # Groups may already exist from a prior seed in the same DB; ensure count matches matrix.
        self.assertEqual(
            Group.objects.filter(name__in=GROUP_PERMISSION_MATRIX.keys()).count(),
            len(GROUP_PERMISSION_MATRIX),
        )
        result2 = seed_marketing_groups()
        self.assertEqual(result2.created_groups, [])
        self.assertEqual(set(result2.existing_groups), set(GROUP_PERMISSION_MATRIX.keys()))

    def test_no_missing_permissions_after_crm_migrations(self):
        result = seed_marketing_groups()
        self.assertEqual(result.missing_unique, [])

    def test_assigns_permissions_idempotently(self):
        result1 = seed_marketing_groups()
        self.assertTrue(
            len(result1.assigned_permissions) > 0 or len(result1.already_assigned) > 0
        )
        result2 = seed_marketing_groups()
        self.assertEqual(result2.assigned_permissions, [])
        self.assertTrue(len(result2.already_assigned) > 0)

    def test_command_default_succeeds(self):
        out = StringIO()
        call_command("seed_marketing_groups", stdout=out)
        output = out.getvalue()
        self.assertIn("seed_marketing_groups completed", output)
        self.assertIn("All expected marketing permissions were found", output)

    def test_command_strict_succeeds(self):
        out = StringIO()
        call_command("seed_marketing_groups", strict=True, stdout=out)
        self.assertIn("All expected marketing permissions were found", out.getvalue())

    def test_command_rerun_does_not_duplicate_groups(self):
        call_command("seed_marketing_groups")
        call_command("seed_marketing_groups")
        self.assertEqual(Group.objects.filter(name=GROUP_MARKETING_MANAGER).count(), 1)
        self.assertEqual(Group.objects.filter(name=GROUP_MARKETING_EMPLOYEE).count(), 1)
        self.assertEqual(Group.objects.filter(name=GROUP_OPERATIONS_CRM_USER).count(), 1)
        self.assertEqual(Group.objects.filter(name=GROUP_MARKETING_MARKETER).count(), 1)

    def test_sync_removes_extra_marketing_permissions_only(self):
        seed_marketing_groups()
        other_app = _ensure_extra_perm("accounts", "custom_other")
        # Attach a marketing permission that Marketing Employee should not have.
        unexpected = Permission.objects.get(
            content_type__app_label="marketing",
            codename="delete_lead",
        )
        group = Group.objects.get(name=GROUP_MARKETING_EMPLOYEE)
        group.permissions.add(unexpected, other_app)

        result = seed_marketing_groups(sync=True)
        group.refresh_from_db()
        self.assertFalse(group.permissions.filter(pk=unexpected.pk).exists())
        self.assertTrue(group.permissions.filter(pk=other_app.pk).exists())
        self.assertIn((GROUP_MARKETING_EMPLOYEE, "marketing.delete_lead"), result.removed_permissions)
