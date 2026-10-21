# Generated manually for Lead registration notes.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("marketing", "0001_crm_core_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="lead",
            name="notes",
            field=models.TextField(blank=True, default=""),
        ),
    ]
