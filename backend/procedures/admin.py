from django.contrib import admin

from .models import DeletedProcedureLog, Procedure, ProcedureCategory


@admin.register(DeletedProcedureLog)
class DeletedProcedureLogAdmin(admin.ModelAdmin):
    list_display = ("procedure_id", "category", "customer_name", "selling_price", "date", "deleted_by", "deleted_at")
    list_filter = ("deleted_at", "deleted_by")
    search_fields = ("customer_name", "category", "procedure_id")
    readonly_fields = ("procedure_id", "deleted_at", "deleted_by", "customer_name", "category", "selling_price", "date")
    ordering = ("-deleted_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ProcedureCategory)
class ProcedureCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "order")
    ordering = ("order", "name")


@admin.register(Procedure)
class ProcedureAdmin(admin.ModelAdmin):
    list_display = ("category", "customer", "status", "selling_price", "paid", "cash_in", "date")
    search_fields = ("category", "customer__name")
    list_filter = ("status",)
    readonly_fields = ("paid", "created_at", "updated_at")
