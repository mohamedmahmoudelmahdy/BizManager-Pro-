"""Tests for dashboard alert filter helpers used by the frontend."""

from django.test import SimpleTestCase

from dashboard.services.alert_resolve import (
    ALERT_THRESHOLD_DAYS,
    CUSTOMER_FIELD_ALERT_TYPES,
    WORKER_FIELD_ALERT_TYPES,
    _normalize_field,
)


class DashboardAlertFieldMappingTests(SimpleTestCase):
    def test_license_expiry_field_mapping(self):
        kind, field = _normalize_field("license_expiry", "license_expiry")
        self.assertEqual(kind, "customer")
        self.assertEqual(field, "license_expiry")

    def test_trade_license_alias(self):
        kind, field = _normalize_field("license_expiry", "trade_license_expiry")
        self.assertEqual(kind, "customer")
        self.assertEqual(field, "license_expiry")

    def test_worker_residency_mapping(self):
        kind, field = _normalize_field("residency_expiry", "worker_residency_expiry")
        self.assertEqual(kind, "worker")
        self.assertEqual(field, "residency_expiry")

    def test_all_company_alert_types_map(self):
        for field in CUSTOMER_FIELD_ALERT_TYPES:
            kind, resolved = _normalize_field(field, field)
            self.assertEqual(kind, "customer")
            self.assertEqual(resolved, field)

    def test_all_worker_alert_types_map(self):
        for field, aliases in WORKER_FIELD_ALERT_TYPES.items():
            sample = next(iter(aliases))
            kind, resolved = _normalize_field(field, sample, worker_id="worker-1")
            self.assertEqual(kind, "worker")
            self.assertEqual(resolved, field)

    def test_alert_threshold_constant(self):
        self.assertEqual(ALERT_THRESHOLD_DAYS, 30)
