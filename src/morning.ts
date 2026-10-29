/**
 * The morning brief: one message a day, at 08:00 in the person's own time.
 *
 *   ☀️ what's due today (and anything overdue), today's habits and streaks,
 *   how the week is going, and one thing Anchor learned that helps today.
 *
 * It's the daily habit that makes Anchor part of the day, not an app you
 * remember to open. Sent only to people active in the last two weeks; /morning off stops it.
 */
import type { Api } from "grammy";
import { addDays, hourIn, todayIn, weekdayOf } from "./dates.js";
import { doneIn, periodKey, progress } from "./habits.js";
import { mergeAndFilter, recall, recallCommitments } from "./memory/recall.js";
import { clause, effectiveDue, isOpen, type CommitmentState } from "./memory/types.js";
import { allUsers, getUser, tzOf, updateUser } from "./state.js";

export const MORNING_HOUR = 8;
const ACTIVE_MS = 14 * 86_400_000;

/** Kept vs closed over the last 7 days. Pure, for tests. */
export function weekScore(states: CommitmentState[], today: string): { kept: number; closed: number } {
  const from = addDays(today, -6);
  const closed = states.filter((s) => s.outcome && s.outcome.status !== "moved" && s.outcome.date >= from && s.outcome.date <= today);
  return { kept: closed.filter((s) => s.outcome!.status === "kept").length, closed: closed.length };
}

export async function morningBrief(userId: number | string): Promise<string> {
  const user = getUser(userId);
  const tz = tzOf(userId);
  const today = todayIn(tz);
  const [states, lessons] = await Promise.all([
    recallCommitments(userId).catch(() => [] as CommitmentState[]),
    recall(userId, "what helps this person follow through, what works for them", { limit: 4, maxDistance: 0.8 }).catch(() => []),
  ]);
  const closed = user?.closed ?? {};
  const open = states.filter((s) => isOpen(s) && !closed[s.commitment.id ?? ""]);
  const dueToday = open.filter((s) => effectiveDue(s) === today);
  const overdue = open.filter((s) => {
    const d = effectiveDue(s);
    return d && d < today;
  });
  const lines = [`☀️ Good morning${user?.firstName ? `, ${user.firstName}` : ""}. It's ${weekdayOf(today)}.`];

  if (dueToday.length) {
    lines.push("", "Today you promised:");
    for (const s of dueToday) lines.push(`• ${clause(s.commitment.text)}${s.commitment.at ? ` (by ${s.commitment.at})` : ""}`);
  }
  if (overdue.length) {
    lines.push("", "Still open from before:");
    for (const s of overdue.slice(0, 3)) lines.push(`• ${clause(s.commitment.text)} (was due ${effectiveDue(s)})`);
  }
  const habits = Object.values(user?.habits ?? {}).filter((h) => h.active && doneIn(h, periodKey(h.per, today)) < h.times);
  if (habits.length) {
    lines.push("", "Habits:");
    for (const h of habits) lines.push(`• ${clause(h.text)}: ${progress(h, today)}`);
  }
  const score = weekScore(states, today);
  if (score.closed) lines.push("", `This week: ${score.kept} of ${score.closed} kept${score.kept === score.closed ? " 🔥 perfect so far" : ""}.`);
  const kept = mergeAndFilter(userId, lessons); // never bring up what they asked Anchor to forget
  const lesson = kept.find((m) => m.kind === "win") ?? kept.find((m) => m.kind === "pattern");
  if (lesson) lines.push("", `💡 Remember: ${clause(lesson.text)}.`);

  lines.push("", dueToday.length || habits.length ? "Send me a photo when it's done and it counts as proof." : "Nothing due today. What's one thing you'll get done today? Tell me and I'll hold you to it.");
  return lines.join("\n");
}

/** Runs every minute: sends each active person their brief once, at 08:00 their time. */
export async function runMorning(api: Api): Promise<void> {
  const now = Date.now();
  for (const [userId, u] of allUsers()) {
    if (u.morning === false || !u.lastSeen || now - Date.parse(u.lastSeen) > ACTIVE_MS) continue;
    const tz = tzOf(userId);
    const today = todayIn(tz);
    if (u.lastMorning === today || hourIn(tz) !== MORNING_HOUR) continue;
    updateUser(userId, (x) => (x.lastMorning = today));
    try {
      await api.sendMessage(u.chatId, await morningBrief(userId), { link_preview_options: { is_disabled: true } });
    } catch (err) {
      console.warn(`[morning] ${userId}:`, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
}
