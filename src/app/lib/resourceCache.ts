/**
 * Bounded in-memory GET cache for DataContext list hydration.
 * Not a source of truth for balances / payments / refunds / reports.
 */

type CacheEntry = {
  at: number;
  data?: unknown;
  promise?: Promise<unknown>;
};

const store = new Map<string, CacheEntry>();
let sessionUserId: string | null = null;

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 40;

export function setResourceSessionUser(userId: string | null): void {
  if (userId === sessionUserId) return;
  store.clear();
  sessionUserId = userId;
}

export function clearResourceCache(): void {
  store.clear();
}

export function invalidateResourceCache(matcher?: string | RegExp): void {
  if (matcher == null) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    const hit = typeof matcher === 'string' ? key === matcher || key.startsWith(matcher) : matcher.test(key);
    if (hit) store.delete(key);
  }
}

function trimStore(): void {
  if (store.size <= MAX_ENTRIES) return;
  const entries = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
  const removeCount = store.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i++) {
    store.delete(entries[i][0]);
  }
}

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key);
  if (existing?.data !== undefined && now - existing.at < ttlMs) {
    return existing.data as T;
  }
  if (existing?.promise) {
    return existing.promise as Promise<T>;
  }

  const promise = fetcher()
    .then((data) => {
      store.set(key, { at: Date.now(), data });
      trimStore();
      return data;
    })
    .catch((err) => {
      store.delete(key);
      throw err;
    });

  store.set(key, { at: now, promise });
  return promise;
}

/** Test/debug helper — entry count only. */
export function resourceCacheSize(): number {
  return store.size;
}
