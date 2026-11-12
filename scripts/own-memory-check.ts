/**
 * Live check of "move my memory to my own Walrus Memory account" through the
 * mini app's own API: real Walrus Memory, real Telegram sign-in signature,
 * only the outgoing Telegram call intercepted.
 *
 * A smoke-test person gets a few memories, then connects an "own" account
 * (Anchor's own account stands in for the person's, under the "anchor"
 * namespace). Checks that a wrong key is refused fast, that the app answers
 * within seconds while the copy runs on, that the chat hears when it's done,
 * and that every memory really is in the new account afterwards.
 *
 *   npx tsx scripts/own-memory-check.ts     (about 60 Walrus requests)
 */
process.loadEnvFile();
process.env.MEMWAL_NAMESPACE_PREFIX = "anchor:smoke:";
process.env.DATA_DIR = "./data/smoke";

import { createHmac } from "node:crypto";

const { createBot } = await import("../src/bot/bot.js");
const { createWebApp } = await import("../src/web/server.js");
const { upsertUser, getUser, flush } = await import("../src/state.js");
const { memwal, namespaceFor, ownClient, OWN_NAMESPACE } = await import("../src/memory/client.js");
const { serialize } = await import("../src/memory/types.js");

const failures: string[] = [];
const sent: Array<{ chatId?: number; text?: string }> = [];
const bot = createBot();
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as { chat_id?: number; text?: string };
  if (method === "sendMessage") sent.push({ chatId: p.chat_id, text: p.text });
  return { ok: true, result: { message_id: 1, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text } } as never;
});
const web = createWebApp(bot.api);

const USER = 920_000_000 + Math.floor(Math.random() * 1_000_000);
upsertUser(USER, USER, "Judge");
const run = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
const texts = [
  `Smoke ${run}: works night shifts at the hospital`,
  `Smoke ${run}: phone in another room helps with studying`,
  `Smoke ${run}: buddy Tobi checks the landing page every Friday`,
].map((text) => serialize({ kind: "fact", date: today, text }));

console.log(`[own] seeding ${texts.length} memories for ${USER}…`);
const seeded = await memwal.rememberBulkAndWait(texts.map((text) => ({ text, namespace: namespaceFor(USER) })), { timeoutMs: 180_000 });
if (seeded.succeeded !== texts.length) failures.push(`seed: ${seeded.succeeded}/${texts.length} stored`);
await new Promise((r) => setTimeout(r, 35_000)); // Walrus needs ~30 s before new memories are recallable

const initData = (() => {
  const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: USER, first_name: "Judge" }) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
})();
const post = (body: unknown) =>
  web.request("/api/app/memory", { method: "POST", body: JSON.stringify(body), headers: { "x-telegram-init-data": initData, "content-type": "application/json" } });

// 1. A wrong key: refused quickly, nothing switched.
let t = Date.now();
let res = await post({ accountId: process.env.MEMWAL_ACCOUNT_ID, key: "ab".repeat(32) });
let body = (await res.json()) as { error?: string; copying?: boolean };
console.log(`[own] wrong key → ${res.status} in ${Date.now() - t} ms: ${body.error}`);
if (res.status !== 400 || !/rejected|Couldn't reach/.test(body.error ?? "")) failures.push(`wrong key: ${res.status} ${body.error}`);
if (getUser(USER)?.ownMemory) failures.push("wrong key: switched anyway");

// 2. The right key: the app gets its answer in seconds, while the copy runs on.
t = Date.now();
res = await post({ accountId: process.env.MEMWAL_ACCOUNT_ID, key: process.env.MEMWAL_PRIVATE_KEY });
body = (await res.json()) as { error?: string; copying?: boolean };
const answeredIn = Date.now() - t;
console.log(`[own] right key → ${res.status} in ${answeredIn} ms: ${JSON.stringify(body)}`);
if (res.status !== 200 || body.copying !== true) failures.push(`right key: ${res.status} ${JSON.stringify(body)}`);
if (answeredIn > 15_000) failures.push(`right key: the app waited ${answeredIn} ms`);

const dash = (await (await web.request("/api/app/me", { headers: { "x-telegram-init-data": initData } })).json()) as { moving?: boolean };
if (dash.moving !== true) failures.push("dashboard: doesn't show the copy in progress");
const again = await post({ accountId: process.env.MEMWAL_ACCOUNT_ID, key: process.env.MEMWAL_PRIVATE_KEY });
if (again.status !== 400 || !/already moving/.test(((await again.json()) as { error?: string }).error ?? "")) failures.push("a second move while copying was not refused");

// 3. The chat hears when it's done.
const deadline = Date.now() + 8 * 60_000;
while (!sent.some((s) => s.chatId === USER) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
const report = sent.find((s) => s.chatId === USER)?.text ?? "";
console.log(`[own] done after ${Math.round((Date.now() - t) / 1000)} s. Chat message:\n${report}\n`);
if (!/All 3 of your memories are now in your own Walrus Memory account/.test(report)) failures.push(`report: ${report.slice(0, 160) || "no message"}`);
if (getUser(USER)?.ownMemory?.accountId !== process.env.MEMWAL_ACCOUNT_ID) failures.push("not switched after the copy");

// 4. Every memory really is in the new account.
await new Promise((r) => setTimeout(r, 35_000));
const own = ownClient(process.env.MEMWAL_ACCOUNT_ID!, process.env.MEMWAL_PRIVATE_KEY!);
const found = await own.recall({ query: `Smoke ${run}`, namespace: OWN_NAMESPACE, limit: 20 });
const there = texts.filter((x) => found.results.some((r) => r.text === x)).length;
console.log(`[own] in the own account: ${there}/${texts.length}`);
if (there !== texts.length) failures.push(`own account holds ${there}/${texts.length}`);

flush();
console.log(failures.length ? `FAILED:\n- ${failures.join("\n- ")}` : "ALL CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
