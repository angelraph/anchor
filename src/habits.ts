/**
 * Recurring promises ("gym 3x a week", "read 20 minutes daily") with streaks.
 *
 *  - The evening check-in asks "did you do it today?" (one tap: done / not today).
 *  - When a day or week ends, the period is settled: target met → streak +1,
 *    missed → streak resets. Each settled period is written to Walrus as a
 *    [streak] memory, so Anchor learns from streaks like from any promise.
 *
 * The rules (periods, counts, streaks) are pure functions; the rest is glue.
 */
import { generateText, Output } from "ai";
import { InlineKeyboard, type Api } from "grammy";
import { z } from "zod";
import { addDays, hourIn, todayIn } from "./dates.js";
import { weekOf } from "./learning.js";
import { LLM_TIMEOUT_MS, withModel } from "./llm/model.js";
import { clause, newCommitmentId, type MemoryRecord } from "./memory/types.js";
import { allUsers, getUser, tzOf, updateUser, type Habit } from "./state.js";

// pure rules
/** The period a date belongs to: the day itself, or the Monday of its week. */
export const periodKey = (per: Habit["per"], date: string) => (per === "day" ? date : weekOf(date));

/** The period right before `key`. */
export const previousPeriod = (per: Habit["per"], key: string) => addDays(key, per === "day" ? -1 : -7);

/** How many times it was done in a period. */
export const doneIn = (h: Pick<Habit, "per" | "done">, key: string) => new Set(h.done.filter((d) => periodKey(h.per, d) === key)).size;

export interface Settled {
  key: string;
  count: number;
  met: boolean;
  streak: number;
}

/**
 * Settle every finished period since the last one settled (or since the habit
 * was created), oldest first. Mutates `h` (streak, best, settled) and returns
 * what happened in each period. The current period is never settled.
 */
export function settleHabit(h: Habit, today: string): Settled[] {
  const current = periodKey(h.per, today);
  const createdKey = periodKey(h.per, h.createdAt.slice(0, 10));
  let key = h.settled ? addDays(h.settled, h.per === "day" ? 1 : 7) : createdKey;
  const out: Settled[] = [];
  for (let i = 0; i < 60 && key < current; i++) {
    const count = doneIn(h, key);
    const met = count >= h.times;
    h.streak = met ? h.streak + 1 : 0;
    h.best = Math.max(h.best, h.streak);
    h.settled = key;
    out.push({ key, count, met, streak: h.streak });
    key = addDays(key, h.per === "day" ? 1 : 7);
  }
  return out;
}

/** "3x a week", "every day", "twice a day" */
export function describeRep(h: Pick<Habit, "per" | "times">): string {
  if (h.per === "day") return h.times === 1 ? "every day" : `${h.times}x a day`;
  return h.times === 7 ? "every day" : `${h.times}x a week`;
}

/** Quick parse of "gym 3x a week" / "read daily"; null when it needs the model. */
export function parseRepQuick(input: string): { text: string; per: Habit["per"]; times: number } | null {
  const s = input.trim();
  const weekly = /(\d+)\s*(?:x|times)\s*(?:a|per|each|every)?\s*week/i.exec(s);
  if (weekly) return { text: s.replace(weekly[0], "").replace(/\s+/g, " ").trim(), per: "week", times: Math.min(7, Math.max(1, Number(weekly[1]))) };
  const daily = /\b(daily|every\s*day|each\s*day)\b/i.exec(s);
  if (daily) return { text: s.replace(daily[0], "").replace(/\s+/g, " ").trim(), per: "day", times: 1 };
  return null;
}

// creating habits
const parseSchema = z.object({
  text: z.string().describe("What the habit is, short, e.g. 'Go to the gym'"),
  per: z.enum(["day", "week"]),
  times: z.number().int().min(1).max(7),
});

/** Turn free text into a habit definition (regex first, then Gemini). */
export async function parseHabit(input: string): Promise<{ text: string; per: Habit["per"]; times: number } | null> {
  const quick = parseRepQuick(input);
  if (quick && quick.text) return quick;
  const { output } = await withModel((model) =>
    generateText({
      model,
      system: "Turn a habit the user wants to keep into {text, per: day|week, times}. 'Gym three times a week' → {Go to the gym, week, 3}. 'Read every night' → {Read, day, 1}. Default to once a day.",
      prompt: input.slice(0, 200),
      output: Output.object({ schema: parseSchema }),
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }),
  );
  return output.text.trim() ? { text: output.text.trim(), per: output.per, times: output.times } : null;
}

/** A [habit] memory record for a new habit (stored by the caller with storeMemories). */
export function habitRecord(userId: number | string, def: { text: string; per: Habit["per"]; times: number }): MemoryRecord {
  return { kind: "habit", date: todayIn(tzOf(userId)), id: newCommitmentId(), rep: `${def.times}/${def.per}`, text: `Habit: ${def.text}` };
}

/** Mirror [habit] records into local state as they are stored (also catches habits Gemini extracts from chat). */
export function trackHabitRecords(userId: number | string, records: MemoryRecord[]): void {
  const habits = records.filter((r) => r.kind === "habit" && r.id && r.rep);
  if (!habits.length || !getUser(userId)) return;
  updateUser(userId, (u) => {
    u.habits ??= {};
    for (const r of habits) {
      if (u.habits[r.id!]) continue;
      const [times, per] = r.rep!.split("/") as [string, Habit["per"]];
      u.habits[r.id!] = { text: r.text.replace(/^Habit:\s*/i, ""), per, times: Number(times), done: [], skipped: [], streak: 0, best: 0, createdAt: new Date().toISOString(), active: true };
    }
  });
}

// marking and asking
export function habitKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Done today", `h:${id}:done`).text("❌ Not today", `h:${id}:skip`);
}

/** One line of progress: "2/3 this week · 🔥 4" */
export function progress(h: Habit, today: string): string {
  const n = doneIn(h, periodKey(h.per, today));
  return `${h.per === "day" ? (n >= h.times ? "done today" : `${n}/${h.times} today`) : `${n}/${h.times} this week`}${h.streak ? ` · 🔥 ${h.streak} ${h.per === "day" ? "day" : "week"}${h.streak === 1 ? "" : "s"}` : ""}`;
}

/** Record done / not today for today. Returns the updated habit. */
export function markHabit(userId: number | string, id: string, what: "done" | "skip"): Habit | undefined {
  const today = todayIn(tzOf(userId));
  let result: Habit | undefined;
  updateUser(userId, (u) => {
    const h = u.habits?.[id];
    if (!h) return;
    const cutoff = addDays(today, -60);
    if (what === "done") h.done = [...new Set([...h.done.filter((d) => d >= cutoff), today])];
    else h.skipped = [...new Set([...h.skipped.filter((d) => d >= cutoff), today])];
    result = h;
  });
  return result;
}

/** Habits to ask about this evening: active, not answered today, and (weekly) target not reached yet. */
export function habitsToAsk(habits: Record<string, Habit>, today: string): Array<[string, Habit]> {
  return Object.entries(habits).filter(([, h]) => {
    if (!h.active || h.done.includes(today) || h.skipped.includes(today)) return false;
    return doneIn(h, periodKey(h.per, today)) < h.times;
  });
}

/** Called from the evening check-in. */
export async function askHabits(api: Api, userId: string): Promise<number> {
  const u = getUser(userId);
  if (!u?.habits) return 0;
  const today = todayIn(tzOf(userId));
  const due = habitsToAsk(u.habits, today);
  for (const [id, h] of due) {
    await api
      .sendMessage(u.chatId, `🔄 Did you ${clause(h.text).replace(/^\w/, (c) => c.toLowerCase())} today?\n${describeRep(h)} · ${progress(h, today)}`, { reply_markup: habitKeyboard(id) })
      .catch(() => undefined);
  }
  return due.length;
}

/**
 * Runs every minute: settle finished days/weeks for everyone, store each result
 * on Walrus as a [streak] memory, and tell people how their week went.
 */
export async function runHabitSettlement(api: Api): Promise<void> {
  const { storeMemories } = await import("./memory/write.js");
  const { enqueue } = await import("./bot/conversation.js");
  for (const [userId, u] of allUsers()) {
    if (!u.habits) continue;
    const tz = tzOf(userId);
    if (hourIn(tz) < 8) continue; // settle (and talk about) yesterday or last week in the morning, not at midnight
    const today = todayIn(tz);
    const results: Array<{ id: string; h: Habit; s: Settled }> = [];
    updateUser(userId, (x) => {
      for (const [id, h] of Object.entries(x.habits ?? {})) {
        if (!h.active) continue;
        for (const s of settleHabit(h, today)) results.push({ id, h: { ...h }, s });
      }
    });
    if (!results.length) continue;
    const records: MemoryRecord[] = results.map(({ id, h, s }) => ({
      kind: "streak",
      date: today,
      ref: id,
      status: s.met ? "kept" : "broken",
      text: `${clause(h.text)} (${describeRep(h)}): ${h.per === "day" ? s.key : `week of ${s.key}`} done ${s.count}/${h.times}${s.met ? `, streak ${s.streak}` : ", streak reset"}`,
    }));
    void enqueue(`write:${userId}`, () => storeMemories(userId, records)).catch((err) => console.error("[habits] streak write failed:", err));
    // Weekly habits get a short note; daily ones stay quiet (the evening ask is enough).
    for (const { h, s } of results.filter((r) => r.h.per === "week").slice(-3)) {
      const text = s.met
        ? `🔥 Week done: ${clause(h.text)} ${s.count}/${h.times}. Streak: ${s.streak} week${s.streak === 1 ? "" : "s"}${s.streak === h.best && s.streak > 1 ? " (your best)" : ""}.`
        : `Last week: ${clause(h.text)} ${s.count}/${h.times}, so the streak resets. What got in the way? Too ambitious, or a rough week?`;
      await api.sendMessage(u.chatId, text).catch(() => undefined);
    }
  }
}
