from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from accounts.permissions import permission_required

User = get_user_model()


def _grant_perm(user, app_label: str, codename: str):
    """Attach a real Permission to a user via a temporary content type."""
    ct, _ = ContentType.objects.get_or_create(app_label=app_label, model=codename)
    perm, _ = Permission.objects.get_or_create(
        content_type=ct,
        codename=codename,
        defaults={"name": f"Can {codename.replace('_', ' ')}"},
    )
    user.user_permissions.add(perm)
    return perm


class MePermissionsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="me-user",
            password="pass",
            email="me@example.com",
            role=User.Roles.EMPLOYEE,
            first_name="Me",
            last_name="User",
        )

    def test_unauthenticated_me_is_rejected(self):
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_returns_existing_fields_plus_sorted_permissions_and_groups(self):
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        for field in ("id", "username", "email", "first_name", "last_name", "role"):
            self.assertIn(field, data)
        self.assertEqual(data["username"], "me-user")
        self.assertEqual(data["role"], "employee")
        self.assertIn("permissions", data)
        self.assertIn("groups", data)
        self.assertIsInstance(data["permissions"], list)
        self.assertIsInstance(data["groups"], list)
        self.assertEqual(data["permissions"], sorted(data["permissions"]))
        self.assertEqual(data["groups"], sorted(data["groups"]))

    def test_me_includes_direct_user_permissions(self):
        _grant_perm(self.user, "marketing", "view_lead")
        self.client.force_authenticate(self.user)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("marketing.view_lead", response.json()["permissions"])

    def test_me_includes_group_derived_permissions(self):
        perm = _grant_perm(self.user, "marketing", "import_lead")
        # Remove direct grant; attach via group only
        self.user.user_permissions.clear()
        group = Group.objects.create(name="Temp Marketing")
        group.permissions.add(perm)
        self.user.groups.add(group)

        self.client.force_authenticate(self.user)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("marketing.import_lead", data["permissions"])
        self.assertIn("Temp Marketing", data["groups"])


class PermissionHelperTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.perm_class = permission_required("marketing.view_lead", allow_admin_manager=True)
        self.view = object()

    def _check(self, user):
        request = self.factory.get("/")
        request.user = user
        return self.perm_class().has_permission(request, self.view)

    def test_allows_user_with_required_permission(self):
        user = User.objects.create_user(username="with-perm", password="pass", role=User.Roles.EMPLOYEE)
        _grant_perm(user, "marketing", "view_lead")
        # Refresh permission cache
        user = User.objects.get(pk=user.pk)
        self.assertTrue(self._check(user))

    def test_rejects_user_without_permission(self):
        user = User.objects.create_user(username="no-perm", password="pass", role=User.Roles.EMPLOYEE)
        self.assertFalse(self._check(user))

    def test_admin_bypass_when_enabled(self):
        admin = User.objects.create_user(username="admin-bypass", password="pass", role=User.Roles.ADMIN)
        self.assertTrue(self._check(admin))

    def test_manager_bypass_when_enabled(self):
        manager = User.objects.create_user(
            username="mgr-bypass", password="pass", role=User.Roles.MANAGER
        )
        self.assertTrue(self._check(manager))

    def test_employee_cashier_do_not_bypass_without_permission(self):
        employee = User.objects.create_user(
            username="emp-no", password="pass", role=User.Roles.EMPLOYEE
        )
        cashier = User.objects.create_user(
            username="cash-no", password="pass", role=User.Roles.CASHIER
        )
        self.assertFalse(self._check(employee))
        self.assertFalse(self._check(cashier))

    def test_inactive_user_denied_even_with_permission(self):
        user = User.objects.create_user(
            username="inactive", password="pass", role=User.Roles.EMPLOYEE, is_active=False
        )
        _grant_perm(user, "marketing", "view_lead")
        user = User.objects.get(pk=user.pk)
        self.assertFalse(self._check(user))

    def test_inactive_admin_denied(self):
        admin = User.objects.create_user(
            username="inactive-admin", password="pass", role=User.Roles.ADMIN, is_active=False
        )
        self.assertFalse(self._check(admin))

    def test_allow_admin_manager_false_requires_permission(self):
        klass = permission_required("marketing.view_lead", allow_admin_manager=False)
        admin = User.objects.create_user(
            username="admin-no-bypass", password="pass", role=User.Roles.ADMIN
        )
        request = self.factory.get("/")
        request.user = admin
        self.assertFalse(klass().has_permission(request, self.view))

    def test_any_of_requires_at_least_one(self):
        klass = permission_required(
            "marketing.view_lead",
            "marketing.add_lead",
            any_of=True,
            allow_admin_manager=False,
        )
        user = User.objects.create_user(username="any-of", password="pass", role=User.Roles.EMPLOYEE)
        _grant_perm(user, "marketing", "add_lead")
        user = User.objects.get(pk=user.pk)
        request = self.factory.get("/")
        request.user = user
        self.assertTrue(klass().has_permission(request, self.view))
