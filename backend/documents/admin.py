from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "customer", "uploaded_by", "created_at")
    search_fields = ("original_name", "customer__name")
