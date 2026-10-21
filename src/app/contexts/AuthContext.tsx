import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { clearTokens, fetchMe, loginApi } from '@/app/lib/api';
import {
  hasAllPermissions as checkAllPermissions,
  hasAnyPermission as checkAnyPermission,
  hasPermission as checkPermission,
  homePathForRole,
  type PermissionCheckOptions,
  type UserRole,
} from '@/app/lib/permissions';

export type { UserRole, PermissionCheckOptions };
export { homePathForRole };

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  /** Django app_label.codename strings from /api/me/ */
  permissions: string[];
  /** Django group names (display only; do not authorize from these alone) */
  groups: string[];
  /** "hr" | "internal" from /api/me/ */
  portalType?: 'hr' | 'internal';
  /** HR portal customer summary when present */
  customer?: { id: string; display_name: string } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => void;
  /** Existing role helper — unchanged for current modules */
  isAuthorized: (allowedRoles: UserRole[]) => boolean;
  hasPermission: (permission: string, options?: PermissionCheckOptions) => boolean;
  hasAnyPermission: (permissions: string[], options?: PermissionCheckOptions) => boolean;
  hasAllPermissions: (permissions: string[], options?: PermissionCheckOptions) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapMeToUser(me: {
  id: string | number;
  username?: string;
  email?: string;
  role: UserRole;
  permissions?: string[];
  groups?: string[];
  portal_type?: 'hr' | 'internal';
  customer?: { id: string; display_name: string } | null;
}): User {
  return {
    id: String(me.id),
    name: me.username || me.email || 'User',
    role: me.role,
    email: me.email || '',
    permissions: Array.isArray(me.permissions) ? me.permissions : [],
    groups: Array.isArray(me.groups) ? me.groups : [],
    portalType: me.portal_type || (me.role === 'hr_client' ? 'hr' : 'internal'),
    customer: me.customer ?? null,
  };
}

/** Normalize cached/localStorage user shapes from before permissions existed. */
function normalizeCachedUser(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Partial<User> & { id?: string; role?: UserRole };
  if (!u.id || !u.role) return null;
  return {
    id: String(u.id),
    name: u.name || 'User',
    role: u.role,
    email: u.email || '',
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    groups: Array.isArray(u.groups) ? u.groups : [],
    portalType: u.portalType || (u.role === 'hr_client' ? 'hr' : 'internal'),
    customer: u.customer ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const storageKey = 'authUser';

  useEffect(() => {
    (async () => {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      const cachedUser = localStorage.getItem(storageKey);
      if (!accessToken && !refreshToken) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (cachedUser) {
        try {
          setUser(normalizeCachedUser(JSON.parse(cachedUser)));
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
      try {
        const me = await fetchMe();
        const nextUser = mapMeToUser(me);
        setUser(nextUser);
        localStorage.setItem(storageKey, JSON.stringify(nextUser));
      } catch (e) {
        // keep cached user if API is temporarily unavailable
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (username: string, password: string): Promise<User | null> => {
    try {
      await loginApi(username, password);
      const me = await fetchMe();
      const nextUser = mapMeToUser(me);
      setUser(nextUser);
      localStorage.setItem(storageKey, JSON.stringify(nextUser));
      return nextUser;
    } catch (e) {
      clearTokens();
      localStorage.removeItem(storageKey);
      setUser(null);
      return null;
    }
  };

  const logout = () => {
    clearTokens();
    localStorage.removeItem(storageKey);
    setUser(null);
  };

  const isAuthorized = useCallback(
    (allowedRoles: UserRole[]): boolean => {
      return user ? allowedRoles.includes(user.role) : false;
    },
    [user]
  );

  const hasPermission = useCallback(
    (permission: string, options?: PermissionCheckOptions): boolean => {
      if (!user) return false;
      return checkPermission(user.permissions, permission, user.role, options);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[], options?: PermissionCheckOptions): boolean => {
      if (!user) return false;
      return checkAnyPermission(user.permissions, permissions, user.role, options);
    },
    [user]
  );

  const hasAllPermissions = useCallback(
    (permissions: string[], options?: PermissionCheckOptions): boolean => {
      if (!user) return false;
      return checkAllPermissions(user.permissions, permissions, user.role, options);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthorized,
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
