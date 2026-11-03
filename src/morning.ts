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
import { addDays, hourIn, timeIn, todayIn, weekdayOf } from "./dates.js";
import { doneIn, periodKey, progress } from "./habits.js";
import { mergeAndFilter, recall, recallCommitments } from "./memory/recall.js";
import { clause, deadlinePassed, effectiveDue, isOpen, type CommitmentState } from "./memory/types.js";
import { allUsers, getUser, tzOf, updateUser } from "./state.js";
import { allowed, nudge } from "./attention.js";

export const MORNING_HOUR = 8;
const ACTIVE_MS = 14 * 86_400_000;

/** Kept vs closed over the last 7 days. Pure, for tests. */
export function weekScore(states: CommitmentState[], today: string): { kept: number; closed: number } {
  const from = addDays(today, -6);
  const closed = states.filter((s) => s.outcome && s.outcome.status !== "moved" && s.outcome.date >= from && s.outcome.date <= today);
  return { kept: closed.filter((s) => s.outcome!.status === "kept").length, closed: closed.length };
}

/** A promise as a list item: "Read one page", without the "Promised to". */
const item = (s: CommitmentState) => {
  const t = clause(s.commitment.text).replace(/^promised to\s+/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The time of a promise, unless its words already say it. */
const timeOf = (s: CommitmentState) => {
  const at = s.outcome?.status === "moved" ? s.outcome.at : s.commitment.at;
  return at && !s.commitment.text.includes(at) ? at : undefined;
};

/** The brief's promise lists: what's still ahead today, and what already passed unanswered. Pure, for tests. */
export function briefPromises(open: CommitmentState[], today: string, now: string): { ahead: string[]; passed: string[] } {
  const ahead: string[] = [];
  const earlier: string[] = [];
  const before: string[] = [];
  for (const s of open) {
    const due = effectiveDue(s);
    if (!due || due > today) continue;
    const at = timeOf(s);
    if (due < today) before.push(`• ${item(s)} (was due ${weekdayOf(due)})`);
    else if (deadlinePassed(s, today, now) && (s.outcome?.status === "moved" ? s.outcome.at : s.commitment.at)) earlier.push(`• ${item(s)} (was due earlier today)`);
    else ahead.push(`• ${item(s)}${at ? ` (by ${at})` : ""}`);
  }
  return { ahead, passed: [...earlier, ...before].slice(0, 4) };
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
  const { ahead, passed } = briefPromises(open, today, timeIn(tz));
  const lines = [`☀️ Good morning${user?.firstName ? `, ${user.firstName}` : ""}. It's ${weekdayOf(today)}.`];

  if (ahead.length) lines.push("", "Today you promised:", ...ahead);
  if (passed.length) lines.push("", "Still waiting to hear how these went:", ...passed);
  const habits = Object.values(user?.habits ?? {}).filter((h) => h.active && doneIn(h, periodKey(h.per, today)) < h.times);
  if (habits.length) {
    lines.push("", "Habits:");
    for (const h of habits) lines.push(`• ${clause(h.text)}: ${progress(h, today)}`);
  }
  const score = weekScore(states, today);
  if (score.closed) lines.push("", `This week: ${score.kept} of ${score.closed} kept${score.kept === score.closed ? " 🔥 perfect so far" : ""}.`);
  const kept = mergeAndFilter(userId, lessons); // never bring up what they asked Anchor to forget
  const lesson = kept.find((m) => m.kind === "win") ?? kept.find((m) => m.kind === "pattern");
  if (lesson) lines.push("", `💡 From my notes on you: ${clause(lesson.text)}.`);

  lines.push(
    "",
    ahead.length || habits.length
      ? "Send me a photo when it's done and it counts as proof."
      : passed.length
        ? "Tell me how those went, or send a photo as proof. What's one thing you'll get done today?"
        : "Nothing due today. What's one thing you'll get done today? Tell me and I'll hold you to it.",
  );
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
    if (!allowed(userId, "morning")) continue; // quiet or away: no brief (it waits until they're back)
    updateUser(userId, (x) => (x.lastMorning = today));
    try {
      await nudge(api, userId, "morning", await morningBrief(userId), { link_preview_options: { is_disabled: true } });
    } catch (err) {
      console.warn(`[morning] ${userId}:`, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
}
