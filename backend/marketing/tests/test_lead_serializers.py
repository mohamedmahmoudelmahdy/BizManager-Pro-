"""Serializer-focused lead validation tests."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from marketing.exceptions import MarketingAPIException
from marketing.serializers import LeadCreateSerializer, LeadUpdateSerializer
from marketing.services.lead_create import create_lead

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


class LeadSerializerTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(
            username="ser-user", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(self.user, "add_lead", "change_lead")
        self.request = self.factory.post("/api/marketing/leads/")
        self.request.user = self.user

    def test_create_ignores_client_normalized_phone_and_lead_number(self):
        serializer = LeadCreateSerializer(
            data={
                "name": "Ser Lead",
                "raw_phone": "050-777-8888",
                "normalized_phone": "SHOULD_IGNORE",
                "lead_number": "L-999999",
            },
            context={"request": self.request},
        )
        # Extra fields are ignored by Serializer (not ModelSerializer with extra).
        self.assertTrue(serializer.is_valid(), serializer.errors)
        lead = serializer.save()
        self.assertEqual(lead.normalized_phone, "0507778888")
        self.assertEqual(lead.lead_number, "L-000001")

    def test_update_rejects_immutable_via_service(self):
        lead = create_lead(actor=self.user, name="U", raw_phone="0507770001")
        request = self.factory.patch(f"/api/marketing/leads/{lead.pk}/")
        request.user = self.user
        serializer = LeadUpdateSerializer(
            lead,
            data={"lead_number": "L-000999", "name": "Still"},
            partial=True,
            context={"request": request},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        with self.assertRaises(MarketingAPIException) as ctx:
            serializer.save()
        self.assertEqual(ctx.exception.detail["error"]["code"], "immutable_field")
