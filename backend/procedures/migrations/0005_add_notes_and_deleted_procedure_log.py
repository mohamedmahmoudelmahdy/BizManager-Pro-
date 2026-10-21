# Generated migration: add Procedure.notes and DeletedProcedureLog

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('procedures', '0004_seed_procedure_categories'),
    ]

    operations = [
        migrations.AddField(
            model_name='procedure',
            name='notes',
            field=models.TextField(blank=True, default=''),
            preserve_default=False,
        ),
        migrations.CreateModel(
            name='DeletedProcedureLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('procedure_id', models.UUIDField(editable=False)),
                ('deleted_at', models.DateTimeField(auto_now_add=True)),
                ('customer_name', models.CharField(blank=True, max_length=255)),
                ('category', models.CharField(blank=True, max_length=255)),
                ('selling_price', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('date', models.DateField(blank=True, null=True)),
                ('deleted_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='deleted_procedure_logs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Deleted procedure log',
                'verbose_name_plural': 'Deleted procedure logs',
                'ordering': ['-deleted_at'],
            },
        ),
    ]
