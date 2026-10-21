"""Tests for Lead Contacted By annotation and Outcome list filter."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from marketing.models import Lead, LeadActivity
from marketing.permissions import GROUP_OPERATIONS_CRM_USER
from marketing.services.activities import create_activity
from marketing.services.assignments import assign_lead
from marketing.services.lead_create import create_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class LeadContactedByAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="contact-api",
            password="pass",
            role=User.Roles.EMPLOYEE,
            first_name="Khalid",
            last_name="Ali",
        )
        self.user = _grant(
            self.user,
            "view_lead",
            "add_lead",
            "change_lead",
            "view_leadactivity",
            "add_leadactivity",
            "assign_lead",
        )
        self.other = User.objects.create_user(
            username="contact-other",
            password="pass",
            role=User.Roles.EMPLOYEE,
            first_name="Sara",
            last_name="N",
        )
        self.other = _grant(
            self.other,
            "view_lead",
            "add_lead",
            "view_leadactivity",
            "add_leadactivity",
        )

    def _auth(self, user=None):
        self.client.force_authenticate(user or self.user)

    def test_no_activities_returns_null_contact(self):
        self._auth()
        lead = create_lead(actor=self.user, name="None", raw_phone="0504000001")
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.json()["last_contacted_by"])
        self.assertIsNone(detail.json()["last_contacted_at"])
        listing = self.client.get("/api/marketing/leads/")
        row = next(r for r in listing.json()["results"] if r["id"] == str(lead.pk))
        self.assertIsNone(row["last_contacted_by"])
        self.assertIsNone(row["last_contacted_at"])

    def test_non_contact_activity_only_returns_null(self):
        self._auth()
        lead = create_lead(actor=self.user, name="NoteOnly", raw_phone="0504000002")
        create_activity(
            actor=self.user,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.NOTE,
            notes="internal",
        )
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertIsNone(detail["last_contacted_by"])
        self.assertIsNone(detail["last_contacted_at"])

    def test_one_contact_activity_returns_actor(self):
        self._auth()
        lead = create_lead(actor=self.user, name="OneCall", raw_phone="0504000003")
        when = timezone.now() - timedelta(hours=1)
        create_activity(
            actor=self.user,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.CALL,
            occurred_at=when,
        )
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertEqual(detail["last_contacted_by"]["id"], self.user.pk)
        self.assertEqual(detail["last_contacted_by"]["first_name"], "Khalid")
        self.assertIsNotNone(detail["last_contacted_at"])

    def test_latest_contact_wins_over_earlier_and_later_non_contact(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Multi", raw_phone="0504000004")
        t0 = timezone.now() - timedelta(hours=3)
        t1 = timezone.now() - timedelta(hours=2)
        t2 = timezone.now() - timedelta(hours=1)
        create_activity(
            actor=self.user,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.CALL,
            occurred_at=t0,
        )
        create_activity(
            actor=self.other,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.WHATSAPP,
            occurred_at=t1,
        )
        create_activity(
            actor=self.user,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.NOTE,
            occurred_at=t2,
        )
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertEqual(detail["last_contacted_by"]["id"], self.other.pk)
        self.assertEqual(detail["last_contacted_by"]["first_name"], "Sara")

    def test_inactive_actor_still_displayed(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Inactive", raw_phone="0504000005")
        create_activity(
            actor=self.other,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.EMAIL,
        )
        self.other.is_active = False
        self.other.save(update_fields=["is_active"])
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertEqual(detail["last_contacted_by"]["id"], self.other.pk)
        self.assertEqual(detail["last_contacted_by"]["username"], "contact-other")

    def test_activity_create_updates_contacted_by(self):
        self._auth()
        lead = create_lead(actor=self.user, name="Refresh", raw_phone="0504000006")
        before = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertIsNone(before["last_contacted_by"])
        created = self.client.post(
            "/api/marketing/activities/",
            {
                "lead_id": str(lead.pk),
                "activity_type": "meeting",
                "notes": "visited",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        after = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertEqual(after["last_contacted_by"]["id"], self.user.pk)

    def test_activity_create_rejects_arbitrary_created_by(self):
        self._auth()
        lead = create_lead(actor=self.user, name="NoActor", raw_phone="0504000007")
        response = self.client.post(
            "/api/marketing/activities/",
            {
                "lead_id": str(lead.pk),
                "activity_type": "call",
                "created_by": self.other.pk,
                "contacted_by": self.other.pk,
                "actor": self.other.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["created_by"]["id"], self.user.pk)
        detail = self.client.get(f"/api/marketing/leads/{lead.pk}/").json()
        self.assertEqual(detail["last_contacted_by"]["id"], self.user.pk)

    def test_list_query_count_bounded(self):
        self._auth()
        leads = [
            create_lead(actor=self.user, name=f"Q{i}", raw_phone=f"05040100{i:02d}")
            for i in range(8)
        ]
        for i, lead in enumerate(leads):
            create_activity(
                actor=self.user if i % 2 == 0 else self.other,
                lead_id=lead.pk,
                activity_type=LeadActivity.ActivityType.CALL,
            )
            create_activity(
                actor=self.user,
                lead_id=lead.pk,
                activity_type=LeadActivity.ActivityType.NOTE,
            )
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/marketing/leads/?page=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 8)
        # One list page must not query once per lead for contact actors.
        self.assertLess(len(ctx.captured_queries), 25)

    def test_ops_visibility_enforced_on_detail(self):
        ops1 = User.objects.create_user(username="ops-c1", password="pass", role=User.Roles.EMPLOYEE)
        ops2 = User.objects.create_user(username="ops-c2", password="pass", role=User.Roles.EMPLOYEE)
        group, _ = Group.objects.get_or_create(name=GROUP_OPERATIONS_CRM_USER)
        ops1.groups.add(group)
        ops2.groups.add(group)
        for u in (ops1, ops2):
            _grant(u, "view_lead", "view_leadassignment", "view_leadactivity")
        ops1 = User.objects.get(pk=ops1.pk)
        ops2 = User.objects.get(pk=ops2.pk)
        lead = create_lead(actor=self.user, name="Hidden", raw_phone="0504000008")
        create_activity(
            actor=self.user,
            lead_id=lead.pk,
            activity_type=LeadActivity.ActivityType.CALL,
        )
        assign_lead(actor=self.user, lead_id=lead.pk, operations_employee_id=ops1.pk)
        self.client.force_authenticate(ops2)
        self.assertEqual(self.client.get(f"/api/marketing/leads/{lead.pk}/").status_code, 404)
        self.client.force_authenticate(ops1)
        ok = self.client.get(f"/api/marketing/leads/{lead.pk}/")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["last_contacted_by"]["id"], self.user.pk)


class LeadOutcomeFilterAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="outcome-api", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(self.user, "view_lead", "add_lead", "change_lead")
        self.client.force_authenticate(self.user)
        self.interested = create_lead(
            actor=self.user, name="Int", raw_phone="0505000001", outcome="interested"
        )
        self.blank = create_lead(actor=self.user, name="Blank", raw_phone="0505000002")
        self.no_answer = create_lead(
            actor=self.user, name="NA", raw_phone="0505000003", outcome="no_answer"
        )
        Lead.objects.filter(pk=self.interested.pk).update(status=Lead.Status.CONTACTED)
        Lead.objects.filter(pk=self.no_answer.pk).update(status=Lead.Status.LOST)

    def test_outcome_filter_exact(self):
        response = self.client.get("/api/marketing/leads/?outcome=interested")
        self.assertEqual(response.status_code, 200)
        ids = {r["id"] for r in response.json()["results"]}
        self.assertEqual(ids, {str(self.interested.pk)})

    def test_outcome_filter_excludes_others(self):
        response = self.client.get("/api/marketing/leads/?outcome=no_answer")
        ids = {r["id"] for r in response.json()["results"]}
        self.assertEqual(ids, {str(self.no_answer.pk)})
        self.assertNotIn(str(self.interested.pk), ids)
        self.assertNotIn(str(self.blank.pk), ids)

    def test_blank_outcome_filter(self):
        response = self.client.get("/api/marketing/leads/?outcome=__blank__")
        self.assertEqual(response.status_code, 200)
        ids = {r["id"] for r in response.json()["results"]}
        self.assertIn(str(self.blank.pk), ids)
        self.assertNotIn(str(self.interested.pk), ids)

    def test_invalid_outcome_returns_structured_400(self):
        response = self.client.get("/api/marketing/leads/?outcome=not_a_real_code")
        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["error"]["code"], "invalid_outcome")

    def test_outcome_combines_with_status(self):
        response = self.client.get(
            "/api/marketing/leads/?outcome=interested&status=contacted"
        )
        ids = {r["id"] for r in response.json()["results"]}
        self.assertEqual(ids, {str(self.interested.pk)})
        miss = self.client.get("/api/marketing/leads/?outcome=interested&status=lost")
        self.assertEqual(miss.json()["results"], [])

    def test_outcome_filter_before_pagination(self):
        for i in range(5):
            create_lead(
                actor=self.user,
                name=f"Page{i}",
                raw_phone=f"05050001{i:02d}",
                outcome="duplicate",
            )
        response = self.client.get("/api/marketing/leads/?outcome=duplicate&page=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 5)
        for row in response.json()["results"]:
            self.assertEqual(row["outcome"], "duplicate")
