# Generated migration: add no_health_insurance to Customer and CompanyEmployee

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customers', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='customer',
            name='no_health_insurance',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='companyemployee',
            name='no_health_insurance',
            field=models.BooleanField(default=False),
        ),
    ]
