/**
 * Group mode: a study group, a team or a family chat holds each other to their word.
 *
 *   /promise <what, by when>   a member promises in front of the group
 *   at the deadline            the group sees a check only that member can answer
 *   kept / missed              announced to the group, however it was answered
 *                              (in the group, in private, by photo or by the chain)
 *   /board                     this week's follow-through, member by member
 *
 * The group only ever sees the promise and its outcome, never anyone's memories.
 */
import { InlineKeyboard, type Api } from "grammy";
import { addDays, timeIn, todayIn } from "./dates.js";
import { clause, type MemoryRecord } from "./memory/types.js";
import { allGroups, getUser, tzOf, updateGroup, type GroupPromise, type GroupState } from "./state.js";

let api: Api | undefined;
export const setGroupApi = (a: Api) => (api = a);

const ICON: Record<string, string> = { kept: "✅", partial: "🟡", broken: "❌" };
const nameOf = (userId: string) => getUser(userId)?.firstName || "Someone";

export const groupOutcomeKeyboard = (ownerId: string, id: string) =>
  new InlineKeyboard().text("✅ Did it", `g:${ownerId}:${id}:kept`).text("🟡 Partly", `g:${ownerId}:${id}:partial`).text("❌ Didn't", `g:${ownerId}:${id}:broken`);

/** Is this group promise past its deadline in the owner's own time? Pure, for tests. */
export function groupPromiseDue(p: GroupPromise, today: string, now: string): boolean {
  if (!p.due || p.status) return false;
  if (p.due < today) return true;
  if (p.due > today) return false;
  return p.at ? p.at <= now : now >= "19:00";
}

/** Called whenever records are stored: tell the group about outcomes of promises made there. */
export function notifyGroups(userId: number | string, records: MemoryRecord[]): void {
  const uid = String(userId);
  for (const r of records) {
    if (r.kind !== "outcome" || !r.ref || !r.status || r.status === "moved") continue;
    for (const [chatId, g] of allGroups()) {
      const p = g.promises[r.ref];
      if (!p || p.userId !== uid || p.status) continue;
      updateGroup(chatId, (x) => (x.promises[r.ref!]!.status = r.status));
      const how = r.pic ? " 📸 with photo proof" : r.proof ? " ⛓ verified on Sui" : "";
      const verb = r.status === "kept" ? "kept" : r.status === "partial" ? "partly kept" : "missed";
      void api?.sendMessage(Number(chatId), `${ICON[r.status]} ${nameOf(uid)} ${verb}: ${clause(p.text)}${how}`).catch(() => undefined);
    }
  }
}

/** Deadline checks posted in the group (runs every minute). */
export async function runGroupNudges(a: Api): Promise<void> {
  for (const [chatId, g] of allGroups()) {
    for (const [id, p] of Object.entries(g.promises)) {
      if (p.nudged) continue;
      const tz = tzOf(p.userId);
      if (!groupPromiseDue(p, todayIn(tz), timeIn(tz))) continue;
      updateGroup(chatId, (x) => (x.promises[id]!.nudged = true));
      await a
        .sendMessage(Number(chatId), `⏰ ${nameOf(p.userId)}, time's up for: ${clause(p.text)}\nHow did it go? (Only ${nameOf(p.userId)} can answer.)`, {
          reply_markup: groupOutcomeKeyboard(p.userId, id),
        })
        .catch(() => undefined);
    }
    // Keep the list small: drop settled promises older than five weeks.
    const cutoff = addDays(todayIn("UTC"), -35);
    const old = Object.entries(g.promises).filter(([, p]) => p.status && (p.due ?? p.createdAt.slice(0, 10)) < cutoff);
    if (old.length) updateGroup(chatId, (x) => old.forEach(([id]) => delete x.promises[id]));
  }
}

/** The week's board: kept / due per member, best first. Pure, for tests. */
export function boardLines(g: GroupState, today: string): string[] {
  const from = addDays(today, -6);
  const rows = new Map<string, { kept: number; partial: number; due: number; open: number }>();
  for (const p of Object.values(g.promises)) {
    const day = p.due ?? p.createdAt.slice(0, 10);
    if (day < from || day > addDays(today, 7)) continue;
    const r = rows.get(p.userId) ?? { kept: 0, partial: 0, due: 0, open: 0 };
    if (p.status) {
      r.due++;
      if (p.status === "kept") r.kept++;
      if (p.status === "partial") r.partial++;
    } else r.open++;
    rows.set(p.userId, r);
  }
  const score = (r: { kept: number; partial: number; due: number }) => (r.due ? (r.kept + r.partial / 2) / r.due : -1);
  const sorted = [...rows.entries()].sort((a, b) => score(b[1]) - score(a[1]) || b[1].kept - a[1].kept);
  const medal = ["🥇", "🥈", "🥉"];
  return sorted.map(([uid, r], i) => {
    const pct = r.due ? `${Math.round(score(r) * 100)}%` : "no deadlines yet";
    return `${medal[i] ?? "  "} ${nameOf(uid)}: ${r.kept}/${r.due} kept (${pct})${r.open ? ` · ${r.open} open` : ""}`;
  });
}
