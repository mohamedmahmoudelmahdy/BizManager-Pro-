"""API tests for Lead conversion endpoint (Phase 2C.4)."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from marketing.models import Lead
from marketing.permissions import GROUP_OPERATIONS_CRM_USER
from marketing.services.assignments import assign_lead
from marketing.services.lead_archive import archive_lead
from marketing.services.lead_convert import convert_lead_atomic
from marketing.services.lead_create import create_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class LeadConversionAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="conv-api", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(
            self.user,
            "view_lead",
            "add_lead",
            "change_lead",
            "convert_lead",
            "assign_lead",
        )

    def _auth(self):
        self.client.force_authenticate(self.user)

    def test_auth_required(self):
        lead = create_lead(actor=self.user, name="A", raw_phone="0503030301")
        self.assertEqual(
            self.client.post(
                f"/api/marketing/leads/{lead.pk}/convert/",
                {"mode": "create_customer"},
                format="json",
            ).status_code,
            401,
        )

    def test_permission_required(self):
        bare = User.objects.create_user(username="bare-c", password="pass", role=User.Roles.EMPLOYEE)
        bare = _grant(bare, "view_lead", "add_lead")
        lead = create_lead(actor=self.user, name="P", raw_phone="0503030302")
        self.client.force_authenticate(bare)
        response = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "create_customer", "customer": {"type": "individual"}},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_create_customer_success(self):
        self._auth()
        lead = create_lead(
            actor=self.user, name="API Create", raw_phone="0503030303", email="a@b.com"
        )
        response = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "create_customer", "customer": {"type": "individual"}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["status"], "converted")
        self.assertIsNotNone(data["converted_at"])
        self.assertIsNotNone(data["linked_customer"])
        self.assertEqual(data["linked_customer"]["name"], "API Create")
        self.assertEqual(data["lead_number"], lead.lead_number)

    def test_link_existing_and_matching_response(self):
        self._auth()
        customer = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Link Me",
            phone="0503030304",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.user,
            name="API Link",
            raw_phone="0503030304",
            selected_customer_id=customer.pk,
        )
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None, status=Lead.Status.NEW)

        missing = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "link_existing_customer"},
            format="json",
        )
        self.assertEqual(missing.status_code, 409)
        self.assertEqual(missing.json()["error"]["code"], "matching_customer_found")
        self.assertTrue(missing.json()["error"]["details"]["matches"])

        ok = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {
                "mode": "link_existing_customer",
                "customer_id": str(customer.pk),
            },
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["linked_customer"]["id"], str(customer.pk))

    def test_invalid_selected_customer(self):
        self._auth()
        match = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match",
            phone="0503030305",
            balance=Decimal("0"),
        )
        other = Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Other",
            phone="0403030305",
            balance=Decimal("0"),
        )
        lead = create_lead(
            actor=self.user,
            name="Bad Link",
            raw_phone="0503030305",
            selected_customer_id=match.pk,
        )
        Lead.objects.filter(pk=lead.pk).update(linked_customer=None, status=Lead.Status.NEW)
        response = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {
                "mode": "link_existing_customer",
                "customer_id": str(other.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_customer_link")

    def test_already_converted_and_archived(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Twice", raw_phone="0503030306")
        convert_lead_atomic(
            lead=lead, actor=self.user, mode="create_customer", customer_data={}
        )
        again = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "create_customer"},
            format="json",
        )
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["error"]["code"], "lead_already_converted")

        lead2 = create_lead(actor=self.user, name="Arch", raw_phone="0503030307")
        archive_lead(lead=lead2, actor=self.user, reason="x")
        archived = self.client.post(
            f"/api/marketing/leads/{lead2.pk}/convert/",
            {"mode": "create_customer"},
            format="json",
        )
        self.assertEqual(archived.status_code, 400)
        self.assertEqual(archived.json()["error"]["code"], "lead_not_convertible")

    def test_invalid_mode_and_conflicting_payload(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Bad", raw_phone="0503030308")
        bad_mode = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "magic"},
            format="json",
        )
        self.assertEqual(bad_mode.status_code, 400)

        conflict = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {
                "mode": "create_customer",
                "customer_id": "00000000-0000-0000-0000-000000000001",
                "customer": {"type": "individual"},
            },
            format="json",
        )
        self.assertEqual(conflict.status_code, 400)

    def test_ops_cannot_convert_invisible_lead(self):
        ops1 = User.objects.create_user(username="ops-c1", password="pass", role=User.Roles.EMPLOYEE)
        ops2 = User.objects.create_user(username="ops-c2", password="pass", role=User.Roles.EMPLOYEE)
        group, _ = Group.objects.get_or_create(name=GROUP_OPERATIONS_CRM_USER)
        ops1.groups.add(group)
        ops2.groups.add(group)
        for u in (ops1, ops2):
            _grant(u, "view_lead", "change_lead", "convert_lead", "view_leadassignment")
        ops1 = User.objects.get(pk=ops1.pk)
        ops2 = User.objects.get(pk=ops2.pk)

        lead = create_lead(actor=self.user, name="Hidden", raw_phone="0503030309")
        assign_lead(actor=self.user, lead_id=lead.pk, operations_employee_id=ops1.pk)

        self.client.force_authenticate(ops2)
        response = self.client.post(
            f"/api/marketing/leads/{lead.pk}/convert/",
            {"mode": "create_customer"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_put_delete_unchanged(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Methods", raw_phone="0503030310")
        self.assertEqual(self.client.delete(f"/api/marketing/leads/{lead.pk}/").status_code, 405)
        self.assertEqual(
            self.client.put(
                f"/api/marketing/leads/{lead.pk}/",
                {"name": "X", "raw_phone": "0503030310"},
                format="json",
            ).status_code,
            405,
        )

    def test_customer_matches_endpoint_returns_safe_summaries(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Lookup", raw_phone="0503030311")
        Customer.objects.create(
            type=Customer.CustomerType.INDIVIDUAL,
            name="Match One",
            phone="0503030311",
            balance=Decimal("0"),
        )
        Customer.objects.create(
            type=Customer.CustomerType.COMPANY,
            name="Other Co",
            company_name="Other Co",
            phone="0503999999",
            balance=Decimal("0"),
        )
        response = self.client.get(f"/api/marketing/leads/{lead.pk}/customer-matches/")
        self.assertEqual(response.status_code, 200, response.content)
        matches = response.json()["matches"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["display_name"], "Match One")
        self.assertIn("id", matches[0])
        self.assertIn("matched_field", matches[0])
        self.assertNotIn("balance", matches[0])

    def test_customer_matches_empty_list(self):
        self._auth()
        lead = create_lead(actor=self.user, name="NoMatch", raw_phone="0503030312")
        response = self.client.get(f"/api/marketing/leads/{lead.pk}/customer-matches/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["matches"], [])

    def test_customer_matches_permission_and_methods(self):
        lead = create_lead(actor=self.user, name="Perm", raw_phone="0503030313")
        bare = User.objects.create_user(username="bare-match", password="pass", role=User.Roles.EMPLOYEE)
        self.client.force_authenticate(bare)
        self.assertEqual(
            self.client.get(f"/api/marketing/leads/{lead.pk}/customer-matches/").status_code,
            403,
        )
        self._auth()
        path = f"/api/marketing/leads/{lead.pk}/customer-matches/"
        self.assertEqual(self.client.post(path, {}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(path, {}, format="json").status_code, 405)
        self.assertEqual(self.client.put(path, {}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(path).status_code, 405)

    def test_customer_matches_ops_visibility(self):
        ops1 = User.objects.create_user(username="ops-m1", password="pass", role=User.Roles.EMPLOYEE)
        ops2 = User.objects.create_user(username="ops-m2", password="pass", role=User.Roles.EMPLOYEE)
        group, _ = Group.objects.get_or_create(name=GROUP_OPERATIONS_CRM_USER)
        ops1.groups.add(group)
        ops2.groups.add(group)
        for u in (ops1, ops2):
            _grant(u, "view_lead", "change_lead", "view_leadassignment")
        ops1 = User.objects.get(pk=ops1.pk)
        ops2 = User.objects.get(pk=ops2.pk)
        lead = create_lead(actor=self.user, name="Hidden Match", raw_phone="0503030314")
        assign_lead(actor=self.user, lead_id=lead.pk, operations_employee_id=ops1.pk)
        self.client.force_authenticate(ops2)
        self.assertEqual(
            self.client.get(f"/api/marketing/leads/{lead.pk}/customer-matches/").status_code,
            404,
        )
        self.client.force_authenticate(ops1)
        self.assertEqual(
            self.client.get(f"/api/marketing/leads/{lead.pk}/customer-matches/").status_code,
            200,
        )
