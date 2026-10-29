/**
 * Recording how a promise went, from any door: the check-in buttons, the
 * group's deadline check, or a photo proof.
 */
import { todayIn } from "../dates.js";
import { recallCommitments } from "../memory/recall.js";
import { clause, isOpen } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser } from "../state.js";
import { enqueue, noteExchange } from "./conversation.js";

export type Settled = "kept" | "partial" | "broken";

const VERB: Record<Settled, string> = { kept: "Kept the promise", partial: "Partly kept the promise", broken: "Did not keep the promise" };
export const FOLLOW: Record<Settled, string> = {
  kept: "Noted, that's a kept promise. 💪 What made it work this time? I'll remember it for next time.",
  partial: "Noted. Partial still counts for something. What did you get done, and what stopped the rest?",
  broken: "Thanks for being honest, I've noted it. What got in the way? Knowing that is how we fix it.",
};
const TAPPED: Record<Settled, string> = { kept: "Did it", partial: "Partly", broken: "Didn't" };

/**
 * Record an outcome for one of the person's open promises. Returns the promise
 * text, or why it couldn't be recorded.
 */
export async function recordOutcome(
  userId: number,
  id: string,
  status: Settled,
  opts: { pic?: string; note?: string } = {},
): Promise<{ text: string } | { error: string }> {
  const states = await recallCommitments(userId);
  const state = states.find((s) => s.commitment.id === id);
  if (!state) return { error: `I couldn't find promise #${id} anymore.` };
  const already = getUser(userId)?.closed?.[id];
  if (!isOpen(state) || already) return { error: `#${id} is already marked as ${state.outcome?.status ?? already}.` };
  const text = clause(state.commitment.text);
  const today = todayIn(tzOf(userId));
  void enqueue(`write:${userId}`, () =>
    storeMemories(userId, [{ kind: "outcome", date: today, ref: id, status, pic: opts.pic, text: `${VERB[status]}: ${text}${opts.note ? `. ${opts.note}` : ""}` }]),
  ).catch((err) => console.error(`[memory] background write failed for ${userId}:`, err));
  updateUser(userId, (u) => {
    u.awaitingOutcome = u.awaitingOutcome.filter((x) => x !== id);
    (u.closed ??= {})[id] = status;
  });
  noteExchange(userId, `(${opts.pic ? "sent a photo as proof" : `tapped "${TAPPED[status]}"`} for #${id}: ${text})`, FOLLOW[status]);
  return { text };
}
