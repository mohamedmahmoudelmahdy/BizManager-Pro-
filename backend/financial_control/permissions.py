from rest_framework import permissions


class IsFinancialControlRead(permissions.BasePermission):
    """Admin, manager, and cashier may view Financial Control data."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("admin", "manager", "cashier")
        )


class IsFinancialControlWrite(permissions.BasePermission):
    """Only admin and manager may mutate Financial Control records."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ("admin", "manager")
        )


class IsFinancialControlReadOrWrite(permissions.BasePermission):
    """Safe methods: read roles; unsafe methods: write roles."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return request.user.role in ("admin", "manager", "cashier")
        return request.user.role in ("admin", "manager")
