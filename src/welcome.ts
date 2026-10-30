/**
 * Welcome back: when someone returns after a quiet stretch, everything that
 * passed while they were away comes back as ONE card, cleared in one tap
 * (or gone through one by one), instead of a pile of old messages.
 */
import { InlineKeyboard, type Api } from "grammy";
import { addDays, timeIn, todayIn, weekdayOf } from "./dates.js";
import { recallCommitments } from "./memory/recall.js";
import { clause, deadlinePassed, effectiveDue, isOpen, type CommitmentState } from "./memory/types.js";
import { getUser, tzOf, updateUser } from "./state.js";

/** Open promises whose time came while they were away (chain-watched ones close themselves). Pure, for tests. */
export function missedPromises(states: CommitmentState[], closed: Record<string, string>, chainIds: string[], today: string, now: string): CommitmentState[] {
  return states.filter((s) => {
    const id = s.commitment.id;
    const due = effectiveDue(s);
    if (!id || !due || !isOpen(s) || closed[id] || chainIds.includes(id)) return false;
    // Due today with no time: the day isn't over, so it isn't missed yet.
    const at = s.outcome?.status === "moved" ? s.outcome.at : s.commitment.at;
    return due < today || (due === today && !!at && deadlinePassed(s, today, now));
  });
}

export const welcomeKeyboard = () =>
  new InlineKeyboard()
    .text("✅ Did them all", "wb:kept")
    .text("📅 Move to tomorrow", "wb:moved")
    .row()
    .text("❌ Let them go", "wb:broken")
    .text("One by one", "wb:each");

/** Send the welcome-back card, if anything slipped. Returns whether a card went out. */
export async function welcomeBack(api: Api, userId: number): Promise<boolean> {
  const u = getUser(userId);
  if (!u) return false;
  const tz = tzOf(userId);
  const today = todayIn(tz);
  const missed = missedPromises(await recallCommitments(userId), u.closed ?? {}, Object.keys(u.chain ?? {}), today, timeIn(tz));
  if (!missed.length) return false;
  const shown = missed.slice(0, 8);
  updateUser(userId, (x) => (x.welcome = shown.map((s) => s.commitment.id!)));
  const lines = shown.map((s) => `• ${clause(s.commitment.text)} (${weekdayOf(effectiveDue(s)!)})`);
  const more = missed.length > shown.length ? `\n…and ${missed.length - shown.length} more in /promises` : "";
  await api.sendMessage(
    u.chatId,
    `👋 Welcome back${u.firstName ? `, ${u.firstName}` : ""}! While you were away, ${shown.length === 1 ? "one promise" : `${shown.length} promises`} passed:\n${lines.join("\n")}${more}\n\nHow did they go? One tap clears them.`,
    { reply_markup: welcomeKeyboard() },
  );
  return true;
}

/** The new date for "move to tomorrow". */
export const tomorrowFor = (userId: number | string) => addDays(todayIn(tzOf(userId)), 1);
