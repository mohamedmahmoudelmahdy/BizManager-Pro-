from django.contrib import admin
from .models import BankCard


@admin.register(BankCard)
class BankCardAdmin(admin.ModelAdmin):
    list_display = ("bank_name", "cardholder_name", "card_type", "last4", "expiry_month", "expiry_year")
    search_fields = ("bank_name", "cardholder_name", "card_type", "last4")
