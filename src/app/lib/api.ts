export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://localhost:8000/api" : "/api");

const getAccessToken = () => localStorage.getItem("accessToken");
const getRefreshToken = () => localStorage.getItem("refreshToken");

const saveTokens = (access: string, refresh: string) => {
  localStorage.setItem("accessToken", access);
  localStorage.setItem("refreshToken", refresh);
};

export const clearTokens = () => {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
};

async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(`${API_BASE.replace(/\/$/, "")}/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  if (data.access) {
    // SimpleJWT rotation may return a new refresh token; keep the old one only as fallback.
    saveTokens(data.access, data.refresh || refresh);
    return data.access;
  }
  return null;
}

async function authFetch(path: string, options: RequestInit = {}) {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // #region agent log
  const _dbgT0 = performance.now();
  const _dbgPath = path.replace(/^\//, "");
  const _dbgOn = import.meta.env.VITE_AGENT_DEBUG === "1";
  // #endregion

  let res = await fetch(`${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      headers.Authorization = `Bearer ${newAccess}`;
      res = await fetch(`${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
        ...options,
        headers,
      });
    }
  }

  // #region agent log
  if (_dbgOn) {
    const elapsed_ms = Math.round(performance.now() - _dbgT0);
    const cl = res.headers.get("content-length");
    fetch("http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "3d910e",
      },
      body: JSON.stringify({
        sessionId: "3d910e",
        runId: "post-fix",
        hypothesisId: "A-D",
        location: "api.ts:authFetch",
        message: "api_fetch",
        data: {
          path: _dbgPath,
          method: (options.method || "GET").toUpperCase(),
          status: res.status,
          elapsed_ms,
          contentLength: cl ? Number(cl) : null,
          hasToken: !!token,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  return res;
}

export async function loginApi(username: string, password: string) {
  const res = await fetch(`${API_BASE.replace(/\/$/, "")}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const data = await res.json();
  if (data.access && data.refresh) saveTokens(data.access, data.refresh);
  return data;
}

export async function fetchMe() {
  const res = await authFetch("/me/");
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  endpoint?: string;

  constructor(status: number, body: unknown, endpoint?: string) {
    super(`Request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }

  /** Best-effort human-readable detail from a DRF error body. */
  get detail(): string {
    const b = this.body as Record<string, unknown> | null;
    if (b && typeof b === "object") {
      if (typeof b.detail === "string") return b.detail;
      try {
        return JSON.stringify(b);
      } catch {
        /* ignore */
      }
    }
    if (typeof this.body === "string" && this.body) return this.body;
    return "";
  }
}

/** Human-readable message from a failed API call (DRF detail + field errors). */
export function formatApiErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error && err.message ? err.message : fallback;
  }
  const body = err.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return err.detail || fallback;
  }
  if (typeof body.detail === "string" && body.detail) {
    return body.detail;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === "detail") continue;
    if (Array.isArray(value)) {
      parts.push(`${key}: ${value.map(String).join(", ")}`);
    } else if (typeof value === "string") {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.length ? parts.join(" · ") : err.detail || fallback;
}

export async function getJson<T>(path: string, init?: RequestInit) {
  const res = await authFetch(path, init);
  if (!res.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await res.json();
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(res.status, errorBody, path);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown, init?: RequestInit) {
  const res = await authFetch(path, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, errorBody, path);
  }
  return (await res.json()) as T;
}

export async function putJson<T>(path: string, body: any) {
  const res = await authFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function patchJson<T>(path: string, body: unknown, init?: RequestInit) {
  const res = await authFetch(path, {
    ...init,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, errorBody, path);
  }
  return (await res.json()) as T;
}

export async function postForm<T>(path: string, body: FormData) {
  // Note: do NOT set Content-Type here — the browser adds the multipart
  // boundary automatically for FormData bodies.
  const res = await authFetch(path, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await res.json();
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(res.status, errorBody, path);
  }
  return (await res.json()) as T;
}

export async function deleteJson(path: string) {
  const res = await authFetch(path, {
    method: "DELETE",
  });
  if (!res.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, errorBody, path);
  }
}

/** Authorized download of a non-JSON response (e.g. CSV) as a Blob. */
export async function getBlob(path: string): Promise<Blob> {
  const res = await authFetch(path);
  if (!res.ok) throw new ApiError(res.status, null, path);
  return res.blob();
}
