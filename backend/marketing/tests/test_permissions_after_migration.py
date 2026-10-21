from io import StringIO

from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import TestCase

from marketing.groups import seed_marketing_groups
from marketing.permissions import (
    CUSTOM_PERMISSIONS,
    GROUP_PERMISSION_MATRIX,
    MARKETING_EMPLOYEE_PERMISSIONS,
    MARKETING_MANAGER_PERMISSIONS,
    MARKETING_MARKETER_PERMISSIONS,
    OPERATIONS_CRM_USER_PERMISSIONS,
    STANDARD_MODEL_PERMISSIONS,
)


class MarketingPermissionMigrationTests(TestCase):
    def test_custom_permissions_exist(self):
        for code in CUSTOM_PERMISSIONS:
            app_label, codename = code.split(".", 1)
            self.assertTrue(
                Permission.objects.filter(content_type__app_label=app_label, codename=codename).exists(),
                msg=f"Missing custom permission {code}",
            )

    def test_standard_model_permissions_exist(self):
        for code in STANDARD_MODEL_PERMISSIONS:
            app_label, codename = code.split(".", 1)
            self.assertTrue(
                Permission.objects.filter(content_type__app_label=app_label, codename=codename).exists(),
                msg=f"Missing standard permission {code}",
            )

    def test_seed_assigns_matrix_permissions(self):
        result = seed_marketing_groups()
        self.assertEqual(result.missing_unique, [])
        for group_name, expected in GROUP_PERMISSION_MATRIX.items():
            group = Group.objects.get(name=group_name)
            codes = {
                f"{p.content_type.app_label}.{p.codename}"
                for p in group.permissions.select_related("content_type")
            }
            for code in expected:
                self.assertIn(code, codes, msg=f"{code} missing from {group_name}")

    def test_strict_seed_succeeds_after_migrations(self):
        out = StringIO()
        call_command("seed_marketing_groups", strict=True, stdout=out)
        self.assertIn("All expected marketing permissions were found", out.getvalue())

    def test_seed_idempotent(self):
        seed_marketing_groups()
        result = seed_marketing_groups()
        self.assertEqual(result.created_groups, [])
        self.assertEqual(set(result.existing_groups), set(GROUP_PERMISSION_MATRIX.keys()))
        self.assertEqual(result.missing_unique, [])
        # Manager matrix coverage smoke-check
        self.assertTrue(len(MARKETING_MANAGER_PERMISSIONS) >= 15)
        self.assertTrue(len(MARKETING_EMPLOYEE_PERMISSIONS) >= 5)
        self.assertTrue(len(OPERATIONS_CRM_USER_PERMISSIONS) >= 3)
        self.assertTrue(len(MARKETING_MARKETER_PERMISSIONS) >= 10)
