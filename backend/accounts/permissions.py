from rest_framework import permissions


def _is_authenticated_active(user) -> bool:
    return bool(user and user.is_authenticated and getattr(user, "is_active", False))


def _is_admin_or_manager(user) -> bool:
    return getattr(user, "role", None) in ("admin", "manager")


def permission_required(
    *perms: str,
    allow_admin_manager: bool = False,
    any_of: bool = False,
):
    """
    DRF permission class factory for Django permissions.

    Usage:
        permission_classes = [
            permission_required("marketing.view_lead", allow_admin_manager=True),
        ]
        permission_classes = [
            permission_required(
                "marketing.view_lead",
                "marketing.add_lead",
                any_of=True,
                allow_admin_manager=True,
            ),
        ]

    - Unauthenticated / inactive users are denied.
    - Superusers pass via Django's has_perm() behavior.
    - When allow_admin_manager=True, User.role admin|manager bypasses the perm check.
    - any_of=False (default): all listed permissions required.
    - any_of=True: at least one listed permission required.
    """
    if not perms:
        raise ValueError("permission_required() needs at least one permission string.")

    class PermissionRequired(permissions.BasePermission):
        message = "You do not have permission to perform this action."

        def has_permission(self, request, view):
            user = request.user
            if not _is_authenticated_active(user):
                return False
            if allow_admin_manager and _is_admin_or_manager(user):
                return True
            if any_of:
                return any(user.has_perm(code) for code in perms)
            return all(user.has_perm(code) for code in perms)

    PermissionRequired.__name__ = "PermissionRequired_" + "_".join(
        p.replace(".", "_") for p in perms
    )
    return PermissionRequired


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            _is_authenticated_active(request.user) and request.user.role == "admin"
        )


class IsAdminOrManager(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(_is_authenticated_active(request.user) and _is_admin_or_manager(request.user))


class IsAdminManagerEmployee(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            _is_authenticated_active(request.user)
            and request.user.role in ("admin", "manager", "employee")
        )


class IsAdminManagerEmployeeMarketer(permissions.BasePermission):
    """List/read employee profiles for CRM selectors (includes Marketer)."""

    def has_permission(self, request, view):
        return bool(
            _is_authenticated_active(request.user)
            and request.user.role in ("admin", "manager", "employee", "marketer")
        )


class IsAdminManagerCashier(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            _is_authenticated_active(request.user)
            and request.user.role in ("admin", "manager", "cashier")
        )


class IsAdminManagerEmployeeCashier(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            _is_authenticated_active(request.user)
            and request.user.role in ("admin", "manager", "employee", "cashier")
        )
