"""Phase 4.1 Revenue Attribution tests."""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from marketing.exceptions import CustomerAlreadyAttributedError
from marketing.models import CampaignSpend, Lead, MarketingCampaign, MarketingChannel, MarketingPlatform
from marketing.services.lead_convert import MODE_CREATE_CUSTOMER, MODE_LINK_EXISTING, convert_lead_atomic
from marketing.services.lead_create import create_lead
from marketing.services.lead_update import update_lead
from payments.models import Payment
from procedures.models import Procedure
from procedures.services.profitability import collected_revenue_sum, net_profit_sum

User = get_user_model()


def _grant(user, *codenames):
    for code in codenames:
        perm = Permission.objects.get(content_type__app_label="marketing", codename=code)
        user.user_permissions.add(perm)
    return User.objects.get(pk=user.pk)


@override_settings(
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class RevenueAttributionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="rev-user", password="pass", role=User.Roles.EMPLOYEE
        )
        self.user = _grant(
            self.user,
            "view_lead",
            "add_lead",
            "change_lead",
            "convert_lead",
            "view_marketing_dashboard",
            "view_marketing_report",
            "view_campaignspend",
            "add_campaignspend",
        )
        self.channel = MarketingChannel.objects.create(name="Social", code="social")
        self.platform = MarketingPlatform.objects.create(
            name="FB", code="fb", channel=self.channel
        )
        self.campaign = MarketingCampaign.objects.create(
            name="Summer", code="cmp-sum", platform=self.platform
        )
        self.client.force_authenticate(self.user)

    def _convert_lead(self, phone="0501111001", name="Cust A"):
        lead = create_lead(
            actor=self.user,
            name=name,
            raw_phone=phone,
            channel_id=self.channel.pk,
            platform_id=self.platform.pk,
            campaign_id=self.campaign.pk,
        )
        return convert_lead_atomic(
            lead=lead,
            actor=self.user,
            mode=MODE_CREATE_CUSTOMER,
            customer_data={"type": "individual", "name": name, "phone": phone},
        )

    def test_net_profit_matches_authoritative_helper(self):
        lead = self._convert_lead()
        customer = lead.linked_customer
        Procedure.objects.create(
            customer=customer,
            category="Visa",
            cost=Decimal("100.00"),
            selling_price=Decimal("400.00"),
            status=Procedure.Status.DONE,
            date=date.today(),
        )
        Procedure.objects.create(
            customer=customer,
            category="Visa",
            cost=Decimal("50.00"),
            selling_price=Decimal("40.00"),  # negative margin → 0
            status=Procedure.Status.DONE,
            date=date.today(),
        )
        expected = net_profit_sum(
            Procedure.objects.filter(customer=customer, status=Procedure.Status.DONE)
        )
        self.assertEqual(expected, Decimal("300.00"))
        resp = self.client.get("/api/marketing/revenue/overview/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["summary"]["net_profit"], "300.00")

    def test_collected_revenue_from_payments(self):
        lead = self._convert_lead(phone="0501111002")
        customer = lead.linked_customer
        Payment.objects.create(
            customer=customer, amount=Decimal("150.50"), date=date.today(), type="cash"
        )
        Payment.objects.create(
            customer=customer, amount=Decimal("49.50"), date=date.today(), type="cash"
        )
        expected = collected_revenue_sum([customer.pk])
        self.assertEqual(expected, Decimal("200.00"))
        resp = self.client.get("/api/marketing/revenue/overview/")
        self.assertEqual(resp.json()["summary"]["collected_revenue"], "200.00")

    def test_marketing_contribution_and_null_ratios_on_zero_spend(self):
        lead = self._convert_lead(phone="0501111003")
        Payment.objects.create(
            customer=lead.linked_customer,
            amount=Decimal("100"),
            date=date.today(),
            type="cash",
        )
        Procedure.objects.create(
            customer=lead.linked_customer,
            category="X",
            cost=Decimal("10"),
            selling_price=Decimal("60"),
            status=Procedure.Status.DONE,
            date=date.today(),
        )
        resp = self.client.get("/api/marketing/revenue/overview/").json()["summary"]
        self.assertEqual(resp["campaign_spend"], "0.00")
        self.assertEqual(resp["marketing_contribution"], "50.00")
        self.assertIsNone(resp["roas"])
        self.assertIsNone(resp["marketing_roi"])
        # CAC = spend / converted; spend 0 with converted customers → "0.00"
        self.assertEqual(resp["customer_acquisition_cost"], "0.00")

    def test_spend_subtracted_once(self):
        lead = self._convert_lead(phone="0501111004")
        CampaignSpend.objects.create(
            campaign=self.campaign,
            amount=Decimal("25.00"),
            spend_date=date.today(),
            created_by=self.user,
        )
        CampaignSpend.objects.create(
            campaign=self.campaign,
            amount=Decimal("15.00"),
            spend_date=date.today(),
            created_by=self.user,
        )
        Procedure.objects.create(
            customer=lead.linked_customer,
            category="X",
            cost=Decimal("0"),
            selling_price=Decimal("100"),
            status=Procedure.Status.DONE,
            date=date.today(),
        )
        summary = self.client.get("/api/marketing/revenue/overview/").json()["summary"]
        self.assertEqual(summary["campaign_spend"], "40.00")
        self.assertEqual(summary["net_profit"], "100.00")
        self.assertEqual(summary["marketing_contribution"], "60.00")

    def test_unconverted_lead_excluded(self):
        create_lead(actor=self.user, name="Open", raw_phone="0501111005")
        resp = self.client.get("/api/marketing/revenue/overview/").json()["summary"]
        self.assertEqual(resp["leads"], 0)
        self.assertEqual(resp["converted_customers"], 0)

    def test_customer_already_attributed(self):
        lead1 = self._convert_lead(phone="0501111006", name="Dup")
        customer = lead1.linked_customer
        customer.phone_secondary = "0501111007"
        customer.save(update_fields=["phone_secondary"])
        lead2 = create_lead(
            actor=self.user,
            name="Other",
            raw_phone="0501111007",
            selected_customer_id=customer.pk,
        )
        with self.assertRaises(CustomerAlreadyAttributedError):
            convert_lead_atomic(
                lead=lead2,
                actor=self.user,
                mode=MODE_LINK_EXISTING,
                customer_id=customer.pk,
            )

    def test_attribution_locked_after_conversion(self):
        from marketing.exceptions import ImmutableFieldError

        lead = self._convert_lead(phone="0501111008")
        other = MarketingChannel.objects.create(name="Other", code="other")
        with self.assertRaises(ImmutableFieldError):
            update_lead(
                lead=lead,
                actor=self.user,
                updates={"channel_id": other.pk},
            )

    def test_mutations_return_405(self):
        for method in ("post", "put", "patch", "delete"):
            call = getattr(self.client, method)
            resp = call("/api/marketing/revenue/overview/", {}, format="json")
            self.assertEqual(resp.status_code, 405, method)

    def test_permission_required(self):
        bare = User.objects.create_user(username="bare-rev", password="pass", role=User.Roles.EMPLOYEE)
        bare = _grant(bare, "view_lead")
        self.client.force_authenticate(bare)
        resp = self.client.get("/api/marketing/revenue/overview/")
        self.assertEqual(resp.status_code, 403)

    def test_financial_date_filter(self):
        lead = self._convert_lead(phone="0501111009")
        old = date.today() - timedelta(days=40)
        Payment.objects.create(
            customer=lead.linked_customer, amount=Decimal("10"), date=old, type="cash"
        )
        Payment.objects.create(
            customer=lead.linked_customer,
            amount=Decimal("90"),
            date=date.today(),
            type="cash",
        )
        today = date.today().isoformat()
        resp = self.client.get(
            f"/api/marketing/revenue/overview/?date_from={today}&date_to={today}"
        ).json()["summary"]
        self.assertEqual(resp["collected_revenue"], "90.00")

    def test_channels_endpoint(self):
        self._convert_lead(phone="0501111010")
        resp = self.client.get("/api/marketing/revenue/channels/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("results", resp.json())

    def test_procedure_types_net_profit_only(self):
        lead = self._convert_lead(phone="0501111011")
        Procedure.objects.create(
            customer=lead.linked_customer,
            category="Emirates ID",
            cost=Decimal("20"),
            selling_price=Decimal("120"),
            status=Procedure.Status.DONE,
            date=date.today(),
        )
        resp = self.client.get("/api/marketing/revenue/procedure-types/")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()["results"]
        self.assertTrue(any(r["procedure_type"] == "Emirates ID" for r in rows))
        row = next(r for r in rows if r["procedure_type"] == "Emirates ID")
        self.assertEqual(row["net_profit"], "100.00")
        self.assertIsNone(row["collected_revenue"])

    def test_no_payment_details_in_response(self):
        lead = self._convert_lead(phone="0501111012")
        Payment.objects.create(
            customer=lead.linked_customer,
            amount=Decimal("5"),
            date=date.today(),
            type="cash",
            notes="secret-ref-xyz",
        )
        body = self.client.get("/api/marketing/revenue/leads/").content.decode()
        self.assertNotIn("secret-ref-xyz", body)
        self.assertNotIn("bank_card", body)
