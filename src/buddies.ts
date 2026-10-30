/**
 * Accountability buddies: social pressure, the thing that actually changes behaviour.
 *
 *   /buddy            invite link → friend taps Accept
 *   outcomes          the buddy hears when you keep or miss a promise (or a habit week)
 *   👏 / 💬           one tap cheers you on or nudges you
 *   /buddy private    buddies see "a promise", not what it was
 *
 * Buddies are other Anchor users; they only ever see outcomes, never memories.
 */
import { randomBytes } from "node:crypto";
import { InlineKeyboard, type Api } from "grammy";
import { clause, type MemoryRecord } from "./memory/types.js";
import { getUser, putInvite, takeInvite, updateUser } from "./state.js";
import { allowed, nudge, presence } from "./attention.js";

type BuddyNote = { text: string; button?: { label: string; data: string } };

/**
 * Buddy news (a friend kept a promise, a friend cheered you) goes out now if the
 * person can hear it, waits for the morning if it's their night, and is dropped
 * if they're away: a quiet friend is not flooded with someone else's week.
 */
async function deliver(a: Api, userId: string, note: BuddyNote): Promise<void> {
  const u = getUser(userId);
  if (!u) return;
  if (allowed(userId, "buddy")) {
    const extra = note.button ? { reply_markup: new InlineKeyboard().text(note.button.label, note.button.data) } : undefined;
    await nudge(a, userId, "buddy", note.text, extra).catch(() => undefined);
  } else if (presence(u.lastSeen) !== "away" && !u.paused) {
    updateUser(userId, (x) => (x.buddyQueue = [...(x.buddyQueue ?? []), note].slice(-5)));
  }
}

/** Deliver buddy news held overnight, once the person can hear it (runs every minute). */
export async function flushBuddyQueue(a: Api, userId: string): Promise<void> {
  const queued = getUser(userId)?.buddyQueue;
  if (!queued?.length || !allowed(userId, "buddy")) return;
  updateUser(userId, (u) => delete u.buddyQueue);
  for (const q of queued) {
    const extra = q.button ? { reply_markup: new InlineKeyboard().text(q.button.label, q.button.data) } : undefined;
    await a.sendMessage(getUser(userId)!.chatId, q.text, extra).catch(() => undefined);
  }
}

let api: Api | undefined;
export const setBuddyApi = (a: Api) => (api = a);

export function newInvite(ownerId: string): string {
  const token = randomBytes(9).toString("base64url");
  putInvite(token, ownerId, 7 * 86_400_000);
  return token;
}

export const inviteLink = (botUsername: string, token: string) => `https://t.me/${botUsername}?start=buddy_${token}`;

/** Accept an invite: link both sides. Returns the owner's id, or why it failed. */
export function acceptInvite(token: string, friendId: string): { ownerId: string } | { error: string } {
  const ownerId = takeInvite(token);
  if (!ownerId) return { error: "That invite has expired. Ask your friend to send /buddy again." };
  if (ownerId === friendId) return { error: "That's your own invite: send it to a friend." };
  updateUser(ownerId, (u) => {
    u.buddies = [...new Set([...(u.buddies ?? []), friendId])];
  });
  updateUser(friendId, (u) => {
    u.watching = [...new Set([...(u.watching ?? []), ownerId])];
  });
  return { ownerId };
}

export function removeBuddies(ownerId: string): number {
  const ids = getUser(ownerId)?.buddies ?? [];
  for (const id of ids) updateUser(id, (u) => (u.watching = (u.watching ?? []).filter((x) => x !== ownerId)));
  updateUser(ownerId, (u) => (u.buddies = []));
  return ids.length;
}

/** What a buddy is told about one stored record, if anything. Pure, for tests. */
export function buddyMessage(ownerName: string, r: MemoryRecord, share: boolean): { text: string; good: boolean } | undefined {
  const what = (t: string) => (share ? `: ${clause(t.replace(/^(Kept|Partly kept|Did not keep) the promise(, verified on Sui)?:\s*/i, ""))}` : "");
  if (r.kind === "outcome" && r.status && r.status !== "moved") {
    if (r.status === "kept") return { text: `🟢 ${ownerName} kept a promise${what(r.text)}${r.proof ? " (verified on Sui)" : r.pic ? " (with photo proof)" : ""}`, good: true };
    if (r.status === "partial") return { text: `🟡 ${ownerName} partly kept a promise${what(r.text)}`, good: true };
    return { text: `🔴 ${ownerName} missed a promise${what(r.text)}`, good: false };
  }
  if (r.kind === "streak" && r.text.includes("week of")) {
    return r.status === "kept"
      ? { text: `🔥 ${ownerName} hit a habit week${share ? `: ${clause(r.text)}` : ""}`, good: true }
      : { text: `🧊 ${ownerName}'s habit streak reset${share ? `: ${clause(r.text)}` : ""}`, good: false };
  }
  return undefined;
}

/** Called whenever records are stored: tell this person's buddies about outcomes. */
export function notifyBuddies(ownerId: number | string, records: MemoryRecord[]): void {
  const owner = getUser(ownerId);
  if (!api || !owner?.buddies?.length) return;
  const name = owner.firstName || "Your buddy";
  for (const r of records) {
    const m = buddyMessage(name, r, owner.buddyShare !== false);
    if (!m) continue;
    const button = { label: m.good ? "👏 Cheer" : "💬 Nudge", data: `b:${m.good ? "cheer" : "nudge"}:${ownerId}` };
    for (const id of owner.buddies) void deliver(api, id, { text: m.text, button });
  }
}

/** A buddy tapped Cheer or Nudge. */
export async function sendBuddyReaction(fromId: string, ownerId: string, kind: "cheer" | "nudge"): Promise<boolean> {
  const owner = getUser(ownerId);
  const from = getUser(fromId);
  if (!api || !owner || !(owner.buddies ?? []).includes(fromId)) return false;
  const who = from?.firstName || "Your buddy";
  const text = kind === "cheer" ? `👏 ${who} cheered you on. Keep it going.` : `💬 ${who} is checking on you. Want to move the promise, or try again tomorrow? Just tell me.`;
  await deliver(api, ownerId, { text });
  return true;
}
