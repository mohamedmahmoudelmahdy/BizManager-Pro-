# Generated manually — backfill Customer.attestation_apply_slug from existing batches.

from django.db import migrations


def forwards(apps, schema_editor):
    Customer = apps.get_model("customers", "Customer")
    AttestationBatch = apps.get_model("attestation", "AttestationBatch")
    used = set(
        Customer.objects.exclude(attestation_apply_slug__isnull=True)
        .exclude(attestation_apply_slug="")
        .values_list("attestation_apply_slug", flat=True)
    )
    for batch in (
        AttestationBatch.objects.filter(is_active=True)
        .select_related("customer")
        .order_by("created_at")
    ):
        customer = batch.customer
        if customer.attestation_apply_slug:
            continue
        slug = (batch.public_slug or "").strip()[:64]
        if not slug:
            continue
        base = slug
        n = 2
        while slug in used:
            suffix = f"-{n}"
            slug = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
            n += 1
        customer.attestation_apply_slug = slug
        customer.save(update_fields=["attestation_apply_slug"])
        used.add(slug)


def backwards(apps, schema_editor):
    Customer = apps.get_model("customers", "Customer")
    Customer.objects.exclude(attestation_apply_slug__isnull=True).update(
        attestation_apply_slug=None
    )


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0008_attestation_customer_apply_slug"),
        ("attestation", "0004_attestation_customer_apply_slug"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
