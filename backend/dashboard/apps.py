from django.apps import AppConfig


class DashboardConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "dashboard"

    def ready(self):
        from dashboard.signals import connect_dashboard_cache_invalidation

        connect_dashboard_cache_invalidation()
