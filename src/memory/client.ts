import { MemWal } from "@mysten-incubation/memwal";
import { config } from "../config.js";

/** One MemWal client for the whole app; every call passes the user's namespace. */
export const memwal = MemWal.create({
  key: config.MEMWAL_PRIVATE_KEY,
  accountId: config.MEMWAL_ACCOUNT_ID,
  serverUrl: config.MEMWAL_SERVER_URL,
  namespace: `${config.MEMWAL_NAMESPACE_PREFIX}system`,
});

/** Each Telegram user gets an isolated Walrus Memory namespace. */
export function namespaceFor(userId: number | string): string {
  return `${config.MEMWAL_NAMESPACE_PREFIX}${userId}`;
}

const hidden = new Set(config.HIDDEN_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean));

/** Real Telegram users only: numeric ids under our prefix, minus hidden test accounts. */
export function userIdFromNamespace(ns: string): string | undefined {
  if (!ns.startsWith(config.MEMWAL_NAMESPACE_PREFIX)) return undefined;
  const id = ns.slice(config.MEMWAL_NAMESPACE_PREFIX.length);
  return /^\d+$/.test(id) && !hidden.has(id) ? id : undefined;
}

/** Retry transient relayer failures (timeouts, 429, 5xx) with a short backoff. */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const permanent = /\b(400|401|403|404)\b/.test(msg);
      console.warn(`[memwal] ${label} failed (attempt ${i + 1}/${attempts}): ${msg}`);
      if (permanent || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastError;
}

export interface NamespaceStat {
  userId: string;
  memoryCount: number;
  updatedAt: string;
}

/** All Anchor users that have memories on Walrus, with their memory counts. */
export async function listUserNamespaces(): Promise<NamespaceStat[]> {
  const out: NamespaceStat[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await withRetry("listNamespaces", () => memwal.listNamespaces({ cursor, limit: 500 }));
    for (const ns of res.namespaces) {
      const userId = userIdFromNamespace(ns.name);
      if (userId) out.push({ userId, memoryCount: ns.memory_count, updatedAt: ns.updated_at });
    }
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}
