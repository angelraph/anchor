/**
 * Public proof page: live, anonymised numbers straight from Walrus Memory
 * (listNamespaces), so anyone can verify real people are using Anchor.
 */
import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "../config.js";
import { MODEL_LABEL } from "../llm/model.js";
import { listUserNamespaces, memwal, type NamespaceStat } from "../memory/client.js";
import { renderPage } from "./page.js";

let cache: { at: number; stats: NamespaceStat[] } | undefined;
async function stats(): Promise<NamespaceStat[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.stats;
  try {
    const s = await listUserNamespaces();
    cache = { at: Date.now(), stats: s };
    return s;
  } catch (err) {
    if (cache) return cache.stats; // stale numbers beat an error page
    throw err;
  }
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
  };
}

export function startWebServer() {
  const app = new Hono();
  app.get("/", async (c) => c.html(renderPage(proofJson(await stats()))));
  app.get("/proof.json", async (c) => c.json(proofJson(await stats())));
  app.get("/health", async (c) => {
    const memory = await memwal.health().then(
      (h) => ({ ok: true, ...h }),
      (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return c.json({ ok: true, memory }, memory.ok ? 200 : 503);
  });
  app.onError((err, c) => {
    console.error("[web]", err);
    return c.text("Temporarily unavailable, Walrus Memory did not respond.", 503);
  });
  serve({ fetch: app.fetch, port: config.PORT });
  console.log(`[web] proof page on :${config.PORT}`);
}
