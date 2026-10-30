/**
 * Respecting attention: every message Anchor sends unprompted passes one gate.
 *
 *   active  (heard from in the last day)  normal service, at most 4 a day, quiet 22:00 to 07:00
 *   quiet   (one to two days)              only the evening check-in and what they set themselves
 *   away    (two days or more)             one "still with me?", then silence until they're back
 *
 * Always allowed: a reminder at a time the person chose, and money results from
 * the chain (their stake, their wallet). Everything they missed meanwhile is
 * offered back in one "welcome back" card when they return (bot.ts).
 */
import type { Api } from "grammy";
import { hourIn, todayIn } from "./dates.js";
import { allUsers, getUser, tzOf, updateUser, type UserState } from "./state.js";

export type Nudge =
  | "reminder" // a reminder at the time the person asked for
  | "deadline" // the check at a deadline time the person gave
  | "chain" // a verdict or payout about their money
  | "headsup" // the automatic 30-minute warning
  | "morning"
  | "checkin"
  | "habit"
  | "weekly"
  | "buddy";

export const DAILY_CAP = 4;
export const QUIET_FROM = 22;
export const QUIET_UNTIL = 7;
const DAY_MS = 86_400_000;

export type Presence = "active" | "quiet" | "away";

/** How recently the person was last heard from. Pure, for tests. */
export function presence(lastSeen: string | undefined, now = Date.now()): Presence {
  const since = now - Date.parse(lastSeen || "0");
  if (since < DAY_MS) return "active";
  if (since < 2 * DAY_MS) return "quiet";
  return "away";
}

/** May Anchor send this kind of message to this person now? Pure, for tests. */
export function mayNudge(u: UserState, kind: Nudge, today: string, hour: number, now = Date.now()): boolean {
  if (kind === "reminder" || kind === "chain") return true; // they asked for it, or it's their money
  if (u.paused) return false;
  const p = presence(u.lastSeen, now);
  if (p === "away") return false;
  if (p === "quiet" && kind !== "checkin" && kind !== "deadline") return false;
  if ((hour >= QUIET_FROM || hour < QUIET_UNTIL) && kind !== "deadline") return false;
  const sentToday = u.nudges?.day === today ? u.nudges.count : 0;
  return sentToday < DAILY_CAP;
}

/** Count a sent message against today's allowance. */
export function noteNudge(userId: number | string, today: string) {
  updateUser(userId, (u) => {
    u.nudges = u.nudges?.day === today ? { day: today, count: u.nudges.count + 1 } : { day: today, count: 1 };
  });
}

/** Check the gate for a person right now (their own clock). */
export function allowed(userId: number | string, kind: Nudge): boolean {
  const u = getUser(userId);
  if (!u) return kind === "reminder" || kind === "chain";
  const tz = tzOf(userId);
  return mayNudge(u, kind, todayIn(tz), hourIn(tz));
}

/**
 * Send an unprompted message through the gate. Returns false (and sends
 * nothing) when the person shouldn't hear from Anchor right now.
 */
export async function nudge(api: Api, userId: number | string, kind: Nudge, text: string, extra?: Parameters<Api["sendMessage"]>[2]): Promise<boolean> {
  const u = getUser(userId);
  if (!u || !allowed(userId, kind)) return false;
  await api.sendMessage(u.chatId, text, extra);
  noteNudge(userId, todayIn(tzOf(userId)));
  return true;
}

export const STILL_WITH_ME =
  "Hey, I haven't heard from you in a couple of days, so I'll stop messaging for now. No pressure. Whenever you're ready, just say hi and we'll pick up where you left off. ⚓";

/**
 * Runs every minute: someone away for two days (and seen in the last two weeks)
 * gets ONE "still with me?" at a decent hour, then Anchor goes quiet.
 */
export async function runAttention(api: Api, now = Date.now()): Promise<void> {
  const { flushBuddyQueue } = await import("./buddies.js");
  for (const [userId, u] of allUsers()) {
    if (u.buddyQueue?.length) await flushBuddyQueue(api, userId).catch(() => undefined);
    if (u.paused || presence(u.lastSeen, now) !== "away") continue;
    if (now - Date.parse(u.lastSeen || "0") > 14 * DAY_MS) continue; // long gone: say nothing at all
    const hour = hourIn(tzOf(userId));
    if (hour < 10 || hour >= 20) continue;
    updateUser(userId, (x) => (x.paused = new Date(now).toISOString()));
    await api.sendMessage(u.chatId, STILL_WITH_ME).catch(() => undefined);
  }
}
