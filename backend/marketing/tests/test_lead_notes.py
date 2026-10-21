"""Lead registration notes field (Phase 3.4D)."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from marketing.models import Lead, LeadActivity
from marketing.services.lead_archive import archive_lead
from marketing.services.lead_convert import convert_lead_atomic
from marketing.services.lead_create import create_lead
from marketing.services.lead_update import update_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class LeadNotesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="notes-mkt",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        self.user = _grant(
            self.user,
            "view_lead",
            "add_lead",
            "change_lead",
            "convert_lead",
        )

    def _auth(self):
        self.client.force_authenticate(self.user)

    def test_migration_safe_default_empty_string(self):
        lead = create_lead(actor=self.user, name="No Notes", raw_phone="0507000001")
        self.assertEqual(lead.notes, "")

    def test_create_without_notes(self):
        self._auth()
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Plain", "raw_phone": "0507000002"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["notes"], "")
        self.assertEqual(LeadActivity.objects.filter(lead_id=response.json()["id"]).count(), 0)

    def test_create_with_multiline_and_arabic_notes(self):
        self._auth()
        notes = "Line one\nLine two\nملاحظة عربية"
        response = self.client.post(
            "/api/marketing/leads/",
            {"name": "Noted", "raw_phone": "0507000003", "notes": notes},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["notes"], notes)
        detail = self.client.get(f"/api/marketing/leads/{data['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["notes"], notes)
        self.assertEqual(LeadActivity.objects.filter(lead_id=data["id"]).count(), 0)

    def test_list_does_not_include_notes(self):
        self._auth()
        create_lead(
            actor=self.user,
            name="Listed",
            raw_phone="0507000004",
            notes="secret context",
        )
        response = self.client.get("/api/marketing/leads/")
        self.assertEqual(response.status_code, 200)
        rows = response.json().get("results", response.json())
        self.assertTrue(len(rows) >= 1)
        self.assertNotIn("notes", rows[0])

    def test_patch_notes_and_clear_and_omit(self):
        lead = create_lead(
            actor=self.user,
            name="Patchable",
            raw_phone="0507000005",
            notes="original",
        )
        self._auth()

        patched = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"notes": "updated\nsecond"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(patched.json()["notes"], "updated\nsecond")

        cleared = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"notes": ""},
            format="json",
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.json()["notes"], "")

        # Restore then omit notes — value unchanged
        update_lead(lead=lead, actor=self.user, updates={"notes": "keep me"})
        omitted = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"name": "Renamed Only"},
            format="json",
        )
        self.assertEqual(omitted.status_code, 200)
        self.assertEqual(omitted.json()["name"], "Renamed Only")
        self.assertEqual(omitted.json()["notes"], "keep me")
        self.assertEqual(LeadActivity.objects.filter(lead_id=lead.pk).count(), 0)

    def test_archive_preserves_notes(self):
        lead = create_lead(
            actor=self.user,
            name="Archive Notes",
            raw_phone="0507000006",
            notes="keep through archive",
        )
        archived = archive_lead(lead=lead, actor=self.user, reason="duplicate inquiry")
        archived.refresh_from_db()
        self.assertEqual(archived.status, Lead.Status.ARCHIVED)
        self.assertEqual(archived.notes, "keep through archive")

    def test_conversion_preserves_notes(self):
        lead = create_lead(
            actor=self.user,
            name="Convert Notes",
            raw_phone="0507000007",
            notes="keep through convert",
            email="convert-notes@example.com",
        )
        convert_lead_atomic(
            actor=self.user,
            lead=lead,
            mode="create_customer",
            customer_data={},
        )
        lead.refresh_from_db()
        self.assertEqual(lead.status, Lead.Status.CONVERTED)
        self.assertEqual(lead.notes, "keep through convert")

    def test_duplicate_phone_does_not_mutate_notes(self):
        first = create_lead(
            actor=self.user,
            name="First",
            raw_phone="0507000008",
            notes="original notes",
        )
        self._auth()
        response = self.client.post(
            "/api/marketing/leads/",
            {
                "name": "Second",
                "raw_phone": "050-700-0008",
                "notes": "should not apply",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        first.refresh_from_db()
        self.assertEqual(first.notes, "original notes")
        self.assertEqual(Lead.objects.filter(normalized_phone=first.normalized_phone).count(), 1)

    def test_unauthorized_cannot_update_notes(self):
        lead = create_lead(
            actor=self.user,
            name="Locked",
            raw_phone="0507000009",
            notes="secure",
        )
        viewer = User.objects.create_user(
            username="view-only-notes",
            password="pass",
            role=User.Roles.EMPLOYEE,
        )
        viewer = _grant(viewer, "view_lead")
        self.client.force_authenticate(viewer)
        response = self.client.patch(
            f"/api/marketing/leads/{lead.pk}/",
            {"notes": "hacked"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        lead.refresh_from_db()
        self.assertEqual(lead.notes, "secure")
