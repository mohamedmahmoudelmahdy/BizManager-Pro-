# Data migration: ensure "Customer Card / كرت العميل" exists for procedure cash-out option

from django.db import migrations

CUSTOMER_CARD_ID = "CUSTOMER_CARD"
CUSTOMER_CARD_BANK_NAME = "Customer Card / كرت العميل"


def create_customer_card(apps, _schema_editor):
    BankCard = apps.get_model("banking", "BankCard")
    if not BankCard.objects.filter(pk=CUSTOMER_CARD_ID).exists():
        BankCard.objects.create(
            id=CUSTOMER_CARD_ID,
            bank_name=CUSTOMER_CARD_BANK_NAME,
            cardholder_name="N/A",
            card_type="",
            card_number="0",
            last4="0000",
            expiry_month="12",
            expiry_year="99",
            method_type="bank",
            balance=0,
        )


def remove_customer_card(apps, _schema_editor):
    BankCard = apps.get_model("banking", "BankCard")
    BankCard.objects.filter(pk=CUSTOMER_CARD_ID).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("banking", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_customer_card, remove_customer_card),
    ]
