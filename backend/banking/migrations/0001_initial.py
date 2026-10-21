from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="BankCard",
            fields=[
                ("id", models.CharField(default="", editable=False, max_length=16, primary_key=True, serialize=False)),
                ("bank_name", models.CharField(max_length=255)),
                ("cardholder_name", models.CharField(max_length=255)),
                ("card_type", models.CharField(blank=True, max_length=64)),
                ("card_number", models.CharField(max_length=32)),
                ("last4", models.CharField(blank=True, max_length=4)),
                ("expiry_month", models.CharField(max_length=2)),
                ("expiry_year", models.CharField(max_length=4)),
                ("iban", models.CharField(blank=True, max_length=64)),
                ("swift", models.CharField(blank=True, max_length=32)),
                ("account_number", models.CharField(blank=True, max_length=64)),
                ("notes", models.TextField(blank=True)),
                (
                    "method_type",
                    models.CharField(
                        choices=[("cash", "Cash"), ("bank", "Bank")], default="bank", max_length=16
                    ),
                ),
                ("balance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
            ],
        ),
    ]
