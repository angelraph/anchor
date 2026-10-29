/**
 * Request protection for the web side.
 *
 *   verifyInitData   Telegram mini app sign-in: the initData string is signed
 *                    with the bot token (HMAC-SHA256), checked in constant time
 *                    and only accepted for 24 hours
 *   rateLimit        fixed-window limits per person or per IP, in memory
 *   securityHeaders  nosniff, no referrer, no framing (the mini app may be
 *                    framed by Telegram's own web clients only)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export interface TelegramUser {
  id: number;
  firstName: string;
}

export function verifyInitData(initData: string, botToken: string, opts: { maxAgeSec?: number; now?: number } = {}): TelegramUser | undefined {
  if (!initData || initData.length > 4096) return undefined;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return undefined;
  const authDate = Number(params.get("auth_date"));
  const now = (opts.now ?? Date.now()) / 1000;
  if (!Number.isFinite(authDate) || now - authDate > (opts.maxAgeSec ?? 86_400) || authDate - now > 300) return undefined;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id?: unknown; first_name?: unknown } | null;
    if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id)) return undefined;
    return { id: user.id, firstName: typeof user.first_name === "string" ? user.first_name.slice(0, 64) : "" };
  } catch {
    return undefined;
  }
}

const windows = new Map<string, { start: number; count: number }>();

/** True if `key` is still under `max` hits in the current `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (windows.size > 50_000) for (const [k, w] of windows) if (now - w.start > windowMs) windows.delete(k);
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= max;
}

/** Client IP as seen by the platform's proxy (Railway sets X-Forwarded-For), for per-IP limits. */
export const clientIp = (c: Context) => (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (c.req.path === "/app") {
    // Scripts only from here and Telegram, data only to here: even injected code would have nowhere to send anything.
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org",
    );
  } else if (c.req.path.startsWith("/c/")) {
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  } else if (!c.res.headers.has("X-Frame-Options")) {
    c.header("X-Frame-Options", "DENY");
  }
};
