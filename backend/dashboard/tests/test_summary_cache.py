from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()


@override_settings(
    DASHBOARD_SUMMARY_CACHE_ENABLED=True,
    DASHBOARD_SUMMARY_CACHE_TTL=60,
)
class DashboardSummaryCacheTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="dashadmin",
            password="DashCache123!",
            role="admin",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_miss_then_hit(self):
        r1 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.get("X-Cache"), "MISS")

        r2 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.get("X-Cache"), "HIT")
        self.assertEqual(r1.json(), r2.json())

    def test_cache_keys_are_user_scoped(self):
        other = User.objects.create_user(
            username="dashmgr",
            password="DashCache123!",
            role="manager",
        )
        r1 = self.client.get("/api/dashboard/summary/")
        self.assertEqual(r1.get("X-Cache"), "MISS")

        other_client = APIClient()
        other_client.force_authenticate(other)
        r2 = other_client.get("/api/dashboard/summary/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.get("X-Cache"), "MISS")
