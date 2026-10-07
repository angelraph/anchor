/**
 * Public proof page: live, anonymised numbers straight from Walrus Memory
 * (listNamespaces), so anyone can verify real people are using Anchor.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "../config.js";
import { MODEL_LABEL } from "../llm/model.js";
import { listUserNamespaces, memwal, type NamespaceStat } from "../memory/client.js";
import { logoSvg } from "./logo.js";
import { renderPage } from "./page.js";

// Numbers refresh at most every 5 minutes (each refresh costs Walrus requests),
// and the last good snapshot is kept on disk so the page never shows an error,
// even right after a redeploy while Walrus is busy.
const SNAPSHOT = join(config.DATA_DIR, "stats.json");
let cache: { at: number; stats: NamespaceStat[] } | undefined;
try {
  cache = { ...JSON.parse(readFileSync(SNAPSHOT, "utf8")), at: 0 };
} catch {
  // no snapshot yet
}
let refreshing: Promise<void> | undefined;

function refresh(): Promise<void> {
  refreshing ??= listUserNamespaces()
    .then((s) => {
      cache = { at: Date.now(), stats: s };
      try {
        mkdirSync(config.DATA_DIR, { recursive: true });
        writeFileSync(SNAPSHOT, JSON.stringify({ stats: s }));
      } catch {
        // snapshot is best-effort
      }
    })
    .catch((err) => console.warn("[web] stats refresh failed:", err instanceof Error ? err.message.slice(0, 120) : err))
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/** Read through a function so TypeScript doesn't keep the pre-await narrowing. */
const snapshot = (): NamespaceStat[] => cache?.stats ?? [];

async function stats(): Promise<NamespaceStat[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.stats;
  if (cache) {
    void refresh(); // serve the last numbers now, update in the background
    return cache.stats;
  }
  await refresh();
  return snapshot();
}

const anon = (userId: string) => `user-${createHash("sha256").update(userId).digest("hex").slice(0, 6)}`;

function proofJson(s: NamespaceStat[]) {
  const users = s
    .map((n) => ({ user: anon(n.userId), memories: n.memoryCount, lastActive: n.updatedAt }))
    .sort((a, b) => b.memories - a.memories);
  return {
    bot: config.BOT_USERNAME ? `https://t.me/${config.BOT_USERNAME}` : null,
    model: MODEL_LABEL,
    memory: "Walrus Memory (mainnet relayer)",
    totalUsers: users.length,
    totalMemories: users.reduce((n, u) => n + u.memories, 0),
    usersWith10PlusMemories: users.filter((u) => u.memories >= 10).length,
    users,
    generatedAt: new Date().toISOString(),
    checkinTime: `${String(config.CHECKIN_HOUR).padStart(2, "0")}:00 (${config.TIMEZONE})`,
  };
}

export function startWebServer() {
  const app = new Hono();
  app.get("/", async (c) => c.html(renderPage(proofJson(await stats()))));
  app.get("/proof.json", async (c) => c.json(proofJson(await stats())));
  app.get("/logo.svg", (c) => c.body(logoSvg(512), 200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" }));
  app.get("/img/:name", async (c) => {
    const name = c.req.param("name");
    if (!/^[\w.-]+\.png$/.test(name)) return c.notFound();
    try {
      const buf = await readFile(join(process.cwd(), "docs", "img", name));
      return c.body(new Uint8Array(buf), 200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
    } catch {
      return c.notFound();
    }
  });
  app.get("/health", async (c) => {
    const memory = await memwal.health().then(
      (h) => ({ ok: true, ...h }),
      (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return c.json({ ok: true, memory }, memory.ok ? 200 : 503);
  });
  app.onError((err, c) => {
    console.error("[web]", err);
    // Never show visitors a bare error: fall back to the page with no live numbers.
    if (c.req.path === "/") return c.html(renderPage(proofJson([])), 200);
    return c.text("Temporarily unavailable, please try again in a minute.", 503);
  });
  serve({ fetch: app.fetch, port: config.PORT });
  console.log(`[web] proof page on :${config.PORT}`);
}
