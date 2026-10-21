/**
 * Frontend permission helpers for Django app_label.codename strings.
 * Backend enforcement remains authoritative; these are for UX/navigation only.
 */

export type UserRole = "admin" | "manager" | "employee" | "cashier" | "marketer" | "hr_client";

export type PermissionCheckOptions = {
  /** When true, admin/manager roles bypass the permission check (matches backend). */
  allowAdminManager?: boolean;
};

function isAdminOrManager(role?: UserRole | null): boolean {
  return role === "admin" || role === "manager";
}

/** Post-login / unauthorized fallback home path by role category. */
export function homePathForRole(role?: UserRole | null): string {
  if (role === "marketer") return "/marketing";
  if (role === "hr_client") return "/hr/attestation";
  return "/dashboard";
}

export function hasPermission(
  permissions: string[] | null | undefined,
  permission: string,
  role?: UserRole | null,
  options?: PermissionCheckOptions
): boolean {
  if (options?.allowAdminManager && isAdminOrManager(role)) {
    return true;
  }
  const list = permissions ?? [];
  return list.includes(permission);
}

export function hasAnyPermission(
  permissions: string[] | null | undefined,
  required: string[],
  role?: UserRole | null,
  options?: PermissionCheckOptions
): boolean {
  if (options?.allowAdminManager && isAdminOrManager(role)) {
    return true;
  }
  if (!required.length) return false;
  const list = permissions ?? [];
  return required.some((code) => list.includes(code));
}

export function hasAllPermissions(
  permissions: string[] | null | undefined,
  required: string[],
  role?: UserRole | null,
  options?: PermissionCheckOptions
): boolean {
  if (options?.allowAdminManager && isAdminOrManager(role)) {
    return true;
  }
  if (!required.length) return false;
  const list = permissions ?? [];
  return required.every((code) => list.includes(code));
}
