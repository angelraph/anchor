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

let cache: { at: number; stats: NamespaceStat[] } | undefined;
async function stats(): Promise<NamespaceStat[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.stats;
  const s = await listUserNamespaces();
  cache = { at: Date.now(), stats: s };
  return s;
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(p: ReturnType<typeof proofJson>) {
  const rows = p.users
    .map(
      (u) =>
        `<tr><td><code>${esc(u.user)}</code></td><td class="n">${u.memories}</td><td>${esc(u.lastActive ? new Date(u.lastActive).toUTCString().slice(5, 22) : "—")}</td></tr>`,
    )
    .join("");
  const cta = p.bot ? `<a class="cta" href="${esc(p.bot)}">Talk to Anchor on Telegram →</a>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anchor — the bot that holds you to your word</title>
<style>
:root{--bg:#0b1020;--card:#121a33;--ink:#e8ecf8;--muted:#9aa5c4;--accent:#5eead4;--line:#22305a}
@media (prefers-color-scheme: light){:root{--bg:#f6f7fb;--card:#fff;--ink:#121a33;--muted:#5b6585;--accent:#0f766e;--line:#e3e7f2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 16px 64px}
h1{font-size:clamp(28px,6vw,44px);line-height:1.1;margin:0 0 12px}h1 span{color:var(--accent)}
p.lead{color:var(--muted);font-size:18px;margin:0 0 24px}
.cta{display:inline-block;background:var(--accent);color:#04121a;font-weight:600;padding:12px 18px;border-radius:10px;text-decoration:none}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:32px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.kpi b{display:block;font-size:30px;font-variant-numeric:tabular-nums}.kpi small{color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:500;font-size:14px}
td.n{font-variant-numeric:tabular-nums;font-weight:600}
.how{margin-top:32px;color:var(--muted)}.how li{margin:6px 0}
footer{margin-top:32px;color:var(--muted);font-size:14px}
@media (max-width:520px){.kpis{grid-template-columns:1fr}}
</style></head><body><main>
<h1>⚓ Anchor <span>holds you to your word.</span></h1>
<p class="lead">A Telegram accountability partner with long-term memory on Walrus. Tell it what you'll do and by when — it remembers, checks in when it's due, and learns what actually makes you follow through.</p>
${cta}
<div class="kpis">
<div class="kpi"><b>${p.totalUsers}</b><small>people using Anchor</small></div>
<div class="kpi"><b>${p.totalMemories}</b><small>memories on Walrus</small></div>
<div class="kpi"><b>${p.usersWith10PlusMemories}</b><small>people with 10+ memories</small></div>
</div>
<table><thead><tr><th>User (anonymised)</th><th>Memories</th><th>Last memory (UTC)</th></tr></thead><tbody>${rows || `<tr><td colspan="3">No users yet.</td></tr>`}</tbody></table>
<ol class="how">
<li>Every message is answered with memories recalled from the user's own Walrus Memory namespace.</li>
<li>After each exchange, Gemini extracts promises, outcomes, patterns and wins; they are encrypted and stored on Walrus.</li>
<li>Every evening Anchor recalls due promises and messages people first.</li>
</ol>
<footer>Live data from Walrus Memory <code>listNamespaces</code> · ${esc(p.model)} · updated ${esc(p.generatedAt)} · <a href="/proof.json">JSON</a></footer>
</main></body></html>`;
}

export function startWebServer() {
  const app = new Hono();
  app.get("/", async (c) => c.html(page(proofJson(await stats()))));
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
    return c.text("Temporarily unavailable — Walrus Memory did not respond.", 503);
  });
  serve({ fetch: app.fetch, port: config.PORT });
  console.log(`[web] proof page on :${config.PORT}`);
}
