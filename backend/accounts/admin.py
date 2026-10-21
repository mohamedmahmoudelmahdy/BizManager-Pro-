from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User, EmployeeProfile
from .services.role_groups import sync_role_managed_groups


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Role", {"fields": ("role",)}),
    )
    list_display = ("username", "email", "role", "is_staff", "is_superuser")
    list_filter = ("role", "is_staff", "is_superuser")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        sync_role_managed_groups(obj)


@admin.register(EmployeeProfile)
class EmployeeProfileAdmin(admin.ModelAdmin):
    list_display = ("full_name", "user", "salary", "debit", "credit", "target_monthly", "commission_rate")
    search_fields = ("full_name", "user__username", "user__email")

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        user = form.instance.user
        if user is not None:
            sync_role_managed_groups(user)