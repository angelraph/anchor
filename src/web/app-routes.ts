/**
 * The Anchor mini app (opens inside Telegram from the menu button or /app).
 *
 *   GET  /app                    the app (app-page.ts)
 *   GET  /api/app/me             dashboard: promises, calendar, weeks, habits, what Anchor learned, proofs
 *   POST /api/app/compare        the memory switch: one question answered without and with memory
 *   GET  /api/app/proof/:id      a photo proof, decrypted for its owner only
 *   POST/DELETE /api/app/memory  connect / disconnect the person's own Walrus Memory account
 *   POST /api/app/morning        morning brief on/off
 *   POST/DELETE /api/app/share   make / stop the public share card
 *   GET  /c/:code                the public share card (first name and counts only)
 *
 * Every /api/app call carries Telegram's signed initData (guard.ts); nothing is
 * served for a person who hasn't started the bot.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomBytes } from "node:crypto";
import { generateReply } from "../bot/conversation.js";
import { config } from "../config.js";
import { addDays, todayIn } from "../dates.js";
import { connectOwnMemory, disconnectOwnMemory } from "../memory/own.js";
import { mergeAndFilter, recall, recallCommitments } from "../memory/recall.js";
import { progress } from "../habits.js";
import { clause, effectiveDue, isOpen, type CommitmentState } from "../memory/types.js";
import { readProof } from "../proof.js";
import { allGroups, getUser, proofsOf, tzOf, updateUser, userByCardCode } from "../state.js";
import { appPage, cardPage } from "./app-page.js";
import { clientIp, rateLimit, verifyInitData } from "./guard.js";

type Status = "kept" | "partial" | "broken";

export interface Summary {
  kept30: number;
  closed30: number;
  /** Last 8 weeks, oldest first: week start (Monday) and kept / closed. */
  weeks: Array<{ week: string; kept: number; closed: number }>;
  /** Last 35 days: date → outcomes recorded that day. */
  days: Record<string, { kept: number; missed: number }>;
  /** Promises kept in a row, counting back from the latest outcome. */
  keptRun: number;
}

const monday = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};

/** Follow-through numbers from commitment states. Pure, for tests. */
export function summarize(states: CommitmentState[], closed: Record<string, string>, today: string): Summary {
  const outcomes: Array<{ date: string; status: Status; at: string; i: number }> = [];
  for (const s of states) {
    const st = (s.outcome?.status ?? closed[s.commitment.id ?? ""]) as Status | "moved" | undefined;
    if (!st || st === "moved") continue;
    const date = s.outcome?.date || today;
    // Just recorded (button tap, not on Walrus yet) counts as the newest.
    outcomes.push({ date, status: st, at: s.outcome?.createdAt ?? (s.outcome ? date : "9999"), i: outcomes.length });
  }
  const from30 = addDays(today, -29);
  const in30 = outcomes.filter((o) => o.date >= from30 && o.date <= today);
  const weeks: Summary["weeks"] = [];
  const thisWeek = monday(today);
  for (let i = 7; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 6);
    const w = outcomes.filter((o) => o.date >= start && o.date <= end);
    weeks.push({ week: start, kept: w.filter((o) => o.status === "kept").length, closed: w.length });
  }
  const days: Summary["days"] = {};
  for (const o of outcomes) {
    if (o.date < addDays(today, -34) || o.date > today) continue;
    const d = (days[o.date] ??= { kept: 0, missed: 0 });
    if (o.status === "broken") d.missed++;
    else d.kept++;
  }
  let keptRun = 0;
  const newestFirst = [...outcomes].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at) || b.i - a.i);
  for (const o of newestFirst) {
    if (o.status !== "kept") break;
    keptRun++;
  }
  return { kept30: in30.filter((o) => o.status === "kept").length, closed30: in30.length, weeks, days, keptRun };
}

/** Dashboards are cached briefly so pull-to-refresh can't burn the Walrus budget. */
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 45_000;

async function dashboard(userId: string) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const u = getUser(userId)!;
  const tz = tzOf(userId);
  const today = todayIn(tz);
  const [states, recalled] = await Promise.all([
    recallCommitments(userId).catch(() => [] as CommitmentState[]),
    recall(userId, "patterns: what derails this person, and wins: what helps them follow through", { limit: 12, maxDistance: 0.85 }).catch(() => []),
  ]);
  const learned = mergeAndFilter(userId, recalled); // never show what they asked Anchor to forget
  const closed = u.closed ?? {};
  const proofs = proofsOf(userId);
  const picFor = new Map(proofs.map((p) => [p.promiseId, p.id]));
  const open = states.filter((s) => isOpen(s) && !closed[s.commitment.id ?? ""]);
  const done = states.filter((s) => !isOpen(s) || closed[s.commitment.id ?? ""]);
  const summary = summarize(states, closed, today);
  const habits = Object.values(u.habits ?? {}).filter((h) => h.active);
  const data = {
    name: u.firstName,
    today,
    tz,
    morning: u.morning !== false,
    ownMemory: u.ownMemory ? { account: `${u.ownMemory.accountId.slice(0, 8)}…${u.ownMemory.accountId.slice(-4)}`, since: u.ownMemory.since.slice(0, 10) } : null,
    wallet: u.wallet ? (u.wallet.name ?? `${u.wallet.address.slice(0, 6)}…${u.wallet.address.slice(-4)}`) : null,
    sharing: !!u.cardCode,
    summary,
    tzLabel: u.tzPlace ? `${u.tzPlace} (${tz})` : tz,
    // Promises kept in a row, or a longer habit streak.
    bestStreak: Math.max(summary.keptRun, ...habits.map((h) => h.streak)),
    open: open
      .map((s) => ({ id: s.commitment.id, text: clause(s.commitment.text), due: effectiveDue(s) ?? null, at: s.commitment.at ?? null }))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    done: done
      .map((s) => ({
        id: s.commitment.id,
        text: clause(s.commitment.text),
        status: s.outcome?.status ?? closed[s.commitment.id ?? ""],
        date: s.outcome?.date ?? null,
        chain: !!s.outcome?.proof,
        pic: s.outcome?.pic ?? picFor.get(s.commitment.id ?? "") ?? null,
      }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 25),
    habits: habits.map((h) => ({ text: clause(h.text), per: h.per, times: h.times, streak: h.streak, best: h.best, progress: progress(h, today), done: h.done.filter((d) => d >= addDays(today, -34)) })),
    learned: {
      patterns: learned.filter((m) => m.kind === "pattern").map((m) => clause(m.text)).slice(0, 6),
      wins: learned.filter((m) => m.kind === "win").map((m) => clause(m.text)).slice(0, 6),
    },
    proofs: proofs
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 12)
      .map((p) => ({ id: p.id, promiseId: p.promiseId, description: p.description, at: p.at.slice(0, 10), stored: !!p.jobId })),
    buddies: (u.buddies ?? []).map((id) => getUser(id)?.firstName || "a friend"),
    groups: allGroups()
      .filter(([, g]) => g.members.includes(userId))
      .map(([, g]) => g.title),
  };
  cache.set(userId, { at: Date.now(), data });
  return data;
}

/** Share-card numbers, cached per card so a viral link costs Walrus nothing extra. */
const cardCache = new Map<string, { at: number; html: string }>();

export function registerAppRoutes(app: Hono) {
  app.get("/app", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(appPage());
  });

  app.use("/api/app/*", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }));
  /** Every API call: per-IP limit, Telegram signature, a known person. */
  const guarded =
    (fn: (c: Context, uid: string) => Response | Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      if (!rateLimit(`ip:${clientIp(c)}`, 120, 60_000)) return c.json({ error: "slow down" }, 429);
      const user = verifyInitData(c.req.header("x-telegram-init-data") ?? "", config.TELEGRAM_BOT_TOKEN);
      if (!user) return c.json({ error: "Open this inside Telegram." }, 401);
      if (!getUser(user.id)) return c.json({ error: "Start a chat with Anchor first." }, 403);
      c.header("Cache-Control", "no-store");
      return fn(c, String(user.id));
    };

  app.get("/api/app/me", guarded(async (c, uid) => c.json(await dashboard(uid))));

  app.post("/api/app/compare", guarded(async (c, uid) => {
    if (!rateLimit(`compare:${uid}`, 6, 10 * 60_000)) return c.json({ error: "Give the memory switch a few minutes' rest." }, 429);
    const { q } = (await c.req.json().catch(() => ({}))) as { q?: unknown };
    const message = typeof q === "string" ? q.trim().slice(0, 300) : "";
    if (!message) return c.json({ error: "Ask something." }, 400);
    const args = { userId: Number(uid), firstName: getUser(uid)?.firstName ?? "", message, useHistory: false, preview: true };
    try {
      const [off, on] = await Promise.all([generateReply({ ...args, withMemory: false }), generateReply({ ...args, withMemory: true })]);
      return c.json({ off: off.reply, on: on.reply, recalled: on.context?.memories.length ?? 0 });
    } catch {
      return c.json({ error: "My AI brain is busy, try again in a minute." }, 503);
    }
  }));

  app.get("/api/app/proof/:id", guarded(async (c, uid) => {
    if (!rateLimit(`proof:${uid}`, 40, 60_000)) return c.json({ error: "slow down" }, 429);
    const id = c.req.param("id") ?? "";
    if (!/^[\w]{4,16}$/.test(id)) return c.json({ error: "bad id" }, 400);
    const p = await readProof(id, uid).catch(() => undefined);
    if (!p) return c.json({ error: "Not available yet (Walrus may still be certifying it)." }, 404);
    return c.body(new Uint8Array(p.bytes), 200, { "content-type": p.mediaType === "image/png" ? "image/png" : "image/jpeg", "cache-control": "private, max-age=600" });
  }));

  app.post("/api/app/memory", guarded(async (c, uid) => {
    if (!rateLimit(`memory:${uid}`, 5, 10 * 60_000)) return c.json({ error: "Too many tries, wait a few minutes." }, 429);
    const { accountId, key } = (await c.req.json().catch(() => ({}))) as { accountId?: unknown; key?: unknown };
    if (typeof accountId !== "string" || typeof key !== "string") return c.json({ error: "Account ID and delegate key are both needed." }, 400);
    try {
      const copied = await connectOwnMemory(uid, accountId.trim(), key.trim(), { copy: true });
      cache.delete(uid);
      return c.json({ ok: true, copied });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "That didn't work." }, 400);
    }
  }));
  app.delete("/api/app/memory", guarded((c, uid) => {
    disconnectOwnMemory(uid);
    cache.delete(uid);
    return c.json({ ok: true });
  }));

  app.post("/api/app/morning", guarded(async (c, uid) => {
    const { on } = (await c.req.json().catch(() => ({}))) as { on?: unknown };
    updateUser(uid, (u) => (u.morning = on !== false));
    cache.delete(uid);
    return c.json({ ok: true });
  }));

  app.post("/api/app/share", guarded((c, uid) => {
    let code = getUser(uid)?.cardCode;
    if (!code) {
      code = randomBytes(8).toString("base64url");
      updateUser(uid, (u) => (u.cardCode = code));
    }
    cache.delete(uid);
    return c.json({ url: `${config.PUBLIC_URL.replace(/\/$/, "")}/c/${code}` });
  }));
  app.delete("/api/app/share", guarded((c, uid) => {
    const code = getUser(uid)?.cardCode;
    if (code) cardCache.delete(code);
    updateUser(uid, (u) => delete u.cardCode);
    cache.delete(uid);
    return c.json({ ok: true });
  }));

  // Public share card: first name and counts only, never promise texts.
  app.get("/c/:code", async (c) => {
    if (!rateLimit(`card:${clientIp(c)}`, 60, 60_000)) return c.text("Slow down.", 429);
    const code = c.req.param("code");
    const hit = cardCache.get(code);
    if (hit && Date.now() - hit.at < 10 * 60_000) return c.html(hit.html);
    const found = /^[\w-]{6,20}$/.test(code) ? userByCardCode(code) : undefined;
    if (!found) return c.html(cardPage(null), 404);
    const [uid, u] = found;
    const today = todayIn(tzOf(uid));
    const states = await recallCommitments(uid).catch(() => [] as CommitmentState[]);
    const s = summarize(states, u.closed ?? {}, today);
    const streak = Math.max(s.keptRun, ...Object.values(u.habits ?? {}).filter((h) => h.active).map((h) => h.streak));
    const html = cardPage({ name: u.firstName || "Someone", kept: s.kept30, closed: s.closed30, streak, weeks: s.weeks, bot: config.BOT_USERNAME || "Anchor_daBot" });
    cardCache.set(code, { at: Date.now(), html });
    return c.html(html);
  });
}
