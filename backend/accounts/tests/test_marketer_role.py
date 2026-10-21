"""Tests for Marketer role, Marketing Marketer group sync, and module isolation."""

from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import EmployeeProfile, User
from accounts.services.role_groups import sync_role_managed_groups
from marketing.groups import seed_marketing_groups
from marketing.permissions import (
    GROUP_MARKETING_EMPLOYEE,
    GROUP_MARKETING_MARKETER,
    GROUP_OPERATIONS_CRM_USER,
    MARKETING_MARKETER_PERMISSIONS,
)


def _refresh(user):
    return User.objects.get(pk=user.pk)


class MarketerRoleTests(TestCase):
    def setUp(self):
        seed_marketing_groups()
        self.client = APIClient()

    def test_employee_role_receives_marketing_employee_group(self):
        user = User.objects.create_user(
            username="emp-mkt",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        sync_role_managed_groups(user)
        user = _refresh(user)
        self.assertTrue(user.groups.filter(name=GROUP_MARKETING_EMPLOYEE).exists())
        self.assertFalse(user.groups.filter(name=GROUP_MARKETING_MARKETER).exists())
        self.assertIn("marketing.view_lead", user.get_all_permissions())
        from attestation.groups import GROUP_ATTESTATION_EMPLOYEE

        self.assertTrue(user.groups.filter(name=GROUP_ATTESTATION_EMPLOYEE).exists())
        self.assertIn(
            "attestation.view_attestationapplication", user.get_all_permissions()
        )
        self.assertIn(
            "attestation.process_attestationapplication", user.get_all_permissions()
        )
        self.assertIn(
            "attestation.view_internal_notes", user.get_all_permissions()
        )
        self.assertIn(
            "attestation.change_attestationapplication", user.get_all_permissions()
        )
        self.assertNotIn(
            "attestation.manage_attestationbatch", user.get_all_permissions()
        )

    def test_marketer_is_valid_role(self):
        user = User.objects.create_user(
            username="mkt-role",
            password="pass",
            role=User.Roles.MARKETER,
        )
        self.assertEqual(user.role, "marketer")
        self.assertEqual(User.Roles.MARKETER, "marketer")

    def test_api_me_syncs_employee_marketing_group(self):
        user = User.objects.create_user(
            username="emp-me-sync",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        self.assertFalse(user.groups.filter(name=GROUP_MARKETING_EMPLOYEE).exists())
        self.client.force_authenticate(user=user)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(GROUP_MARKETING_EMPLOYEE, response.data["groups"])
        self.assertIn("marketing.view_lead", response.data["permissions"])

    def test_marketer_group_seeding_is_idempotent(self):
        r1 = seed_marketing_groups()
        r2 = seed_marketing_groups()
        self.assertEqual(Group.objects.filter(name=GROUP_MARKETING_MARKETER).count(), 1)
        self.assertIn(GROUP_MARKETING_MARKETER, r1.created_groups + r1.existing_groups)
        self.assertEqual(r2.created_groups, [])
        self.assertIn(GROUP_MARKETING_MARKETER, r2.existing_groups)

    def test_marketer_receives_approved_marketing_permissions_only(self):
        user = User.objects.create_user(
            username="mkt-perms",
            password="pass",
            role=User.Roles.MARKETER,
        )
        sync_role_managed_groups(user)
        user = _refresh(user)
        perms = user.get_all_permissions()
        for code in MARKETING_MARKETER_PERMISSIONS:
            self.assertIn(code, perms, msg=f"missing {code}")
        # Must still not receive non-Marketing module permissions
        for forbidden in (
            "customers.view_customer",
            "procedures.view_procedure",
            "payments.view_payment",
            "expenses.view_expense",
        ):
            self.assertNotIn(forbidden, perms, msg=f"unexpected {forbidden}")
        self.assertIn("marketing.assign_lead", perms)
        self.assertIn("marketing.view_leadassignment", perms)
        self.assertIn("marketing.change_leadassignment", perms)
        self.assertIn("marketing.view_marketing_report", perms)

    def test_api_me_returns_marketer_role_and_permissions(self):
        user = User.objects.create_user(
            username="mkt-me",
            password="pass",
            role=User.Roles.MARKETER,
        )
        sync_role_managed_groups(user)
        self.client.force_authenticate(user=_refresh(user))
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["role"], "marketer")
        self.assertIn(GROUP_MARKETING_MARKETER, response.data["groups"])
        self.assertIn("marketing.view_lead", response.data["permissions"])
        self.assertIn("marketing.assign_lead", response.data["permissions"])
        self.assertIn("marketing.change_leadassignment", response.data["permissions"])
        self.assertIn("marketing.view_marketing_report", response.data["permissions"])

    def test_marketer_can_access_marketing_leads(self):
        user = User.objects.create_user(
            username="mkt-leads",
            password="pass",
            role=User.Roles.MARKETER,
        )
        sync_role_managed_groups(user)
        self.client.force_authenticate(user=_refresh(user))
        response = self.client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 200)

    def test_marketer_denied_non_marketing_modules(self):
        user = User.objects.create_user(
            username="mkt-denied",
            password="pass",
            role=User.Roles.MARKETER,
        )
        sync_role_managed_groups(user)
        self.client.force_authenticate(user=_refresh(user))
        for path in (
            "/api/customers/",
            "/api/procedures/",
            "/api/payments/",
            "/api/expenses/",
            "/api/financial-control/overview/",
        ):
            response = self.client.get(path)
            self.assertIn(
                response.status_code,
                (403, 404),
                msg=f"{path} expected deny, got {response.status_code}",
            )

    def test_role_change_adds_and_removes_marketer_group_preserves_unrelated(self):
        user = User.objects.create_user(
            username="mkt-sync",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        ops = Group.objects.get(name=GROUP_OPERATIONS_CRM_USER)
        user.groups.add(ops)
        sync_role_managed_groups(user)
        user = _refresh(user)
        self.assertFalse(user.groups.filter(name=GROUP_MARKETING_MARKETER).exists())
        self.assertTrue(user.groups.filter(name=GROUP_MARKETING_EMPLOYEE).exists())
        self.assertTrue(user.groups.filter(name=GROUP_OPERATIONS_CRM_USER).exists())

        user.role = User.Roles.MARKETER
        user.save()
        sync_role_managed_groups(user)
        user = _refresh(user)
        self.assertTrue(user.groups.filter(name=GROUP_MARKETING_MARKETER).exists())
        self.assertFalse(user.groups.filter(name=GROUP_MARKETING_EMPLOYEE).exists())
        self.assertTrue(user.groups.filter(name=GROUP_OPERATIONS_CRM_USER).exists())

        user.role = User.Roles.EMPLOYEE
        user.save()
        sync_role_managed_groups(user)
        user = _refresh(user)
        self.assertFalse(user.groups.filter(name=GROUP_MARKETING_MARKETER).exists())
        self.assertTrue(user.groups.filter(name=GROUP_MARKETING_EMPLOYEE).exists())
        self.assertTrue(user.groups.filter(name=GROUP_OPERATIONS_CRM_USER).exists())

    def test_employee_profile_create_syncs_marketer_group(self):
        admin = User.objects.create_user(
            username="admin-mkt",
            password="pass",
            role=User.Roles.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        response = self.client.post(
            "/api/employees/",
            {
                "full_name": "Sara Marketer",
                "username": "sara-mkt",
                "email": "sara@example.com",
                "role": "marketer",
                "password": "pass12345",
                "salary": "0",
                "debit": "0",
                "credit": "0",
                "target_monthly": "0",
                "commission_rate": "0",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(username="sara-mkt")
        self.assertEqual(created.role, "marketer")
        self.assertTrue(created.groups.filter(name=GROUP_MARKETING_MARKETER).exists())
        self.assertTrue(EmployeeProfile.objects.filter(user=created).exists())

    def test_employee_log_can_reference_marketer_and_history_intact(self):
        profile = EmployeeProfile.objects.create(
            user=User.objects.create_user(
                username="hist-mkt",
                password="pass",
                role=User.Roles.MARKETER,
            ),
            full_name="History Marketer",
        )
        sync_role_managed_groups(profile.user)
        user_id = profile.user_id
        profile_id = profile.id

        # Deactivate user — profile and historical link remain
        profile.user.is_active = False
        profile.user.save()
        profile.refresh_from_db()
        self.assertEqual(profile.id, profile_id)
        self.assertEqual(profile.user_id, user_id)
        self.assertEqual(profile.user.role, "marketer")
        self.assertFalse(profile.user.is_active)

    def test_active_marketer_appears_in_employee_list_for_selectors(self):
        admin = User.objects.create_user(
            username="admin-sel",
            password="pass",
            role=User.Roles.ADMIN,
        )
        mkt = User.objects.create_user(
            username="sel-mkt",
            password="pass",
            role=User.Roles.MARKETER,
            is_active=True,
        )
        inactive = User.objects.create_user(
            username="sel-mkt-off",
            password="pass",
            role=User.Roles.MARKETER,
            is_active=False,
        )
        EmployeeProfile.objects.create(user=mkt, full_name="Active Marketer")
        EmployeeProfile.objects.create(user=inactive, full_name="Inactive Marketer")
        sync_role_managed_groups(mkt)

        self.client.force_authenticate(user=admin)
        response = self.client.get("/api/employees/")
        self.assertEqual(response.status_code, 200)
        rows = response.data if isinstance(response.data, list) else response.data.get("results", [])
        usernames = {r.get("username") for r in rows}
        self.assertIn("sel-mkt", usernames)
        # Existing API returns inactive profiles too; document current behavior
        self.assertIn("sel-mkt-off", usernames)

        # Marketer can list employees for follow-up selectors
        self.client.force_authenticate(user=_refresh(mkt))
        response = self.client.get("/api/employees/")
        self.assertEqual(response.status_code, 200)
