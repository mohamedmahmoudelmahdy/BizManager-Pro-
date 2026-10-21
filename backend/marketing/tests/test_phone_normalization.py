from django.test import SimpleTestCase

from marketing.services.phone_normalization import PhoneNormalizationError, normalize_phone


class PhoneNormalizationTests(SimpleTestCase):
    def test_formatted_international_number(self):
        self.assertEqual(normalize_phone("+971 50 123 4567"), "971501234567")

    def test_formatted_local_number_preserves_leading_zero(self):
        self.assertEqual(normalize_phone("050-123-4567"), "0501234567")

    def test_parentheses_and_spaces(self):
        self.assertEqual(normalize_phone("(050) 123 4567"), "0501234567")

    def test_leading_plus_removed(self):
        self.assertEqual(normalize_phone("+971501234567"), "971501234567")

    def test_no_uae_country_code_conversion(self):
        self.assertEqual(normalize_phone("0501234567"), "0501234567")
        self.assertNotEqual(normalize_phone("0501234567"), "971501234567")

    def test_alphabetic_input_rejected(self):
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone("050-ABC-4567")

    def test_empty_input_rejected(self):
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone("")
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone("   ")
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone(None)

    def test_punctuation_only_rejected(self):
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone("---")
        with self.assertRaises(PhoneNormalizationError):
            normalize_phone("()+")
