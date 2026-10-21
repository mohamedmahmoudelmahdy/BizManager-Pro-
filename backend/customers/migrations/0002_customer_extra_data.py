from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Adds extra_data JSONField to Customer and makes CompanyEmployee
    residency_expiry / insurance_expiry nullable (schema changes after initial migration).
    """

    dependencies = [
        ('customers', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='customer',
            name='extra_data',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name='companyemployee',
            name='residency_expiry',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='companyemployee',
            name='insurance_expiry',
            field=models.DateField(blank=True, null=True),
        ),
    ]
