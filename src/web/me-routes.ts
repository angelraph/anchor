/**
 * Portable memory: the same Walrus Memory that Anchor uses in Telegram, for
 * any other tool the person works in (Claude Code, Codex, any MCP client via
 * scripts/anchor-mcp.ts). Authenticated with a personal token from /connect.
 *
 *   GET  /api/me                   who this token belongs to
 *   GET  /api/me/memory?q=&limit=  semantic recall from their Walrus namespace
 *   GET  /api/me/promises          open and finished promises
 *   POST /api/me/promises          make a promise {text, due, at?}; Anchor follows up in Telegram
 *   POST /api/me/outcome           report an outcome {id, status, note?}
 */
import { createHash } from "node:crypto";
import type { Api } from "grammy";
import type { Context, Hono } from "hono";
import { enqueue } from "../bot/conversation.js";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { mergeAndFilter, pendingFor, recall, recallCommitments } from "../memory/recall.js";
import { clause, effectiveDue, isOpen, newCommitmentId } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser, userByTokenHash } from "../state.js";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

function auth(c: Context): string | undefined {
  const h = c.req.header("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!/^anc_[\w-]{20,}$/.test(token)) return undefined;
  return userByTokenHash(hashToken(token))?.[0];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function registerMeRoutes(app: Hono, getApi: () => Api | undefined) {
  app.use("/api/me/*", async (c, next) => {
    if (!auth(c)) return c.json({ error: "Missing or invalid token. Send /connect to Anchor in Telegram." }, 401);
    await next();
  });
  app.get("/api/me", (c) => {
    const userId = auth(c);
    if (!userId) return c.json({ error: "Missing or invalid token. Send /connect to Anchor in Telegram." }, 401);
    return c.json({ ok: true, namespace: "walrus-memory", today: todayIn(tzOf(userId)), timezone: tzOf(userId) });
  });

  app.get("/api/me/memory", async (c) => {
    const userId = auth(c)!;
    const q = (c.req.query("q") ?? "").slice(0, 500) || "who the user is, their goals, patterns and what works for them";
    const limit = Math.min(Number(c.req.query("limit")) || 10, 25);
    const hits = mergeAndFilter(userId, await recall(userId, q, { limit, maxDistance: 0.8 }), pendingFor(userId));
    return c.json({
      query: q,
      memories: hits.map((m) => ({ kind: m.kind, date: m.date, text: m.text, relevance: Number((1 - m.distance).toFixed(2)), walrusBlob: m.blobId || null })),
    });
  });

  app.get("/api/me/promises", async (c) => {
    const userId = auth(c)!;
    const states = await recallCommitments(userId);
    return c.json({
      promises: states.map((s) => ({
        id: s.commitment.id,
        text: clause(s.commitment.text),
        due: effectiveDue(s) ?? null,
        at: s.commitment.at ?? null,
        status: isOpen(s) ? "open" : s.outcome!.status,
        verifiedOnSui: !!s.outcome?.proof,
      })),
    });
  });

  app.post("/api/me/promises", async (c) => {
    const userId = auth(c)!;
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; due?: string; at?: string; source?: string };
    const text = (body.text ?? "").trim().slice(0, 300);
    if (!text || !body.due || !DATE.test(body.due) || (body.at && !TIME.test(body.at))) {
      return c.json({ error: "Send {text, due: YYYY-MM-DD, at?: HH:MM}" }, 400);
    }
    const id = newCommitmentId();
    const source = (body.source ?? "another tool").slice(0, 40);
    const record = { kind: "commitment" as const, date: todayIn(tzOf(userId)), id, due: body.due, at: body.at, text: `Promised to ${text.replace(/^promised to /i, "")} (made from ${source})` };
    await enqueue(`write:${userId}`, () => storeMemories(userId, [record]));
    const api = getApi();
    const chatId = getUser(userId)?.chatId;
    if (api && chatId) {
      await api.sendMessage(chatId, `📌 New promise from ${source}: #${id} · ${clause(record.text)} (due ${body.due}${body.at ? ` ${body.at}` : ""}). I'll hold you to it here.`).catch(() => undefined);
    }
    return c.json({ ok: true, id });
  });

  app.post("/api/me/outcome", async (c) => {
    const userId = auth(c)!;
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; status?: string; note?: string };
    const id = (body.id ?? "").replace(/^#/, "");
    if (!id || !["kept", "partial", "broken"].includes(body.status ?? "")) return c.json({ error: "Send {id, status: kept|partial|broken, note?}" }, 400);
    const state = (await recallCommitments(userId)).find((s) => s.commitment.id === id);
    if (!state) return c.json({ error: `No promise #${id}` }, 404);
    if (!isOpen(state)) return c.json({ error: `#${id} is already ${state.outcome!.status}` }, 409);
    const status = body.status as "kept" | "partial" | "broken";
    const verb = { kept: "Kept the promise", partial: "Partly kept the promise", broken: "Did not keep the promise" }[status];
    await enqueue(`write:${userId}`, () =>
      storeMemories(userId, [
        { kind: "outcome", date: todayIn(tzOf(userId)), ref: id, status, text: `${verb}: ${clause(state.commitment.text)}${body.note ? `. ${body.note.slice(0, 200)}` : ""}` },
      ]),
    );
    updateUser(userId, (u) => {
      (u.closed ??= {})[id] = status;
      u.awaitingOutcome = u.awaitingOutcome.filter((x) => x !== id);
    });
    return c.json({ ok: true });
  });
}
