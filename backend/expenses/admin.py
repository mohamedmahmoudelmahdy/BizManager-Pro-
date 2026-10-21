from django.contrib import admin

from .models import Expense


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("category", "amount", "paid_by", "date", "assigned_employee")
    list_filter = ("category", "paid_by")
    search_fields = ("notes", "assigned_employee__username")
