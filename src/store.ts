/**
 * Durable state: Anchor's operational state (state.ts) kept in Upstash Redis,
 * so any host works, including free ones whose disk is wiped on restart.
 *
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN set  → state lives in Redis
 *   not set                                                → the local file only (as before)
 *
 * The state is gzipped and saved as one value, at most every 10 seconds, so a
 * busy month stays far inside the free plan (500,000 operations). Memories are
 * not here: they live on Walrus Memory either way.
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { config } from "./config.js";

export const durableStateEnabled = () => !!config.UPSTASH_REDIS_REST_URL && !!config.UPSTASH_REDIS_REST_TOKEN;

async function redis<T>(command: Array<string | number>): Promise<T> {
  const res = await fetch(config.UPSTASH_REDIS_REST_URL.replace(/\/$/, ""), {
    method: "POST",
    headers: { authorization: `Bearer ${config.UPSTASH_REDIS_REST_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(`Upstash ${command[0]} failed: HTTP ${res.status} ${body.error ?? ""}`.trim());
  return body.result as T;
}

/** gzip + base64: one compact string value. Pure, for tests. */
export const pack = (json: string) => gzipSync(Buffer.from(json, "utf8")).toString("base64");
export const unpack = (packed: string) => gunzipSync(Buffer.from(packed, "base64")).toString("utf8");

/** The saved state JSON, or null when nothing has been saved yet. Throws if Redis can't be reached. */
export async function loadDurable(): Promise<string | null> {
  const packed = await redis<string | null>(["GET", config.STATE_KEY]);
  return packed ? unpack(packed) : null;
}

export async function saveDurable(json: string): Promise<void> {
  await redis(["SET", config.STATE_KEY, pack(json)]);
}
