from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("expenses", "0002_add_payroll_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="expense",
            name="salary_gross",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="salary_advance_deduction",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="salary_manual_deduction",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="salary_remaining_due",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="salary_payment_mode",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
        migrations.AddField(
            model_name="expense",
            name="salary_manual_deduction_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
