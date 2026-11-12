/**
 * Bring your own Walrus Memory: a person moves their Anchor memory into their
 * own Walrus Memory account (memory.walrus.xyz), so it is theirs outright and
 * any other app they authorise can use it too.
 *
 *   start move  check the delegate key really opens that account (a few
 *               seconds, answered right away), then copy everything Anchor
 *               remembers into it in the background and switch every recall
 *               and save to it once the copy is complete
 *   disconnect  switch back to Anchor's account (their own copy stays theirs)
 *
 * The copy can take minutes (Walrus certifies every memory), so nothing waits
 * on it: the chat or the app answers as soon as the key checks out, and the
 * person gets a message when the move is done.
 */
import type { MemWal } from "@mysten-incubation/memwal";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { createHash } from "node:crypto";
import { sealText } from "../secrets.js";
import { getUser, updateUser } from "../state.js";
import { memwal, namespaceFor, OWN_NAMESPACE, ownClient, withRetry } from "./client.js";
import { forgetCachedRecalls, mergeAndFilter, recall } from "./recall.js";

/** A Walrus Memory delegate key: 64 hex chars (optionally 0x) or a suiprivkey1… string. */
export const looksLikeKey = (s: string) => /^(0x)?[0-9a-fA-F]{64}$/.test(s) || /^suiprivkey1[0-9a-z]{50,}$/.test(s);
export const looksLikeAccount = (s: string) => /^0x[0-9a-fA-F]{1,64}$/.test(s);

/** Most memories one move copies (the relayer's recall accepts up to 500). */
export const MAX_COPY = 500;
const BATCH = 20;

export interface MoveResult {
  /** Memories now in the person's own account. */
  copied: number;
  /** Memories Anchor had to copy (deleted and quarantined ones are left out). */
  total: number;
  /** Memories that didn't make it; when > 0 nothing was switched. */
  failed: number;
  /** True when every recall and save now goes to the person's own account. */
  switched: boolean;
}

/** People whose memory is being copied right now. */
const moving = new Map<string, { startedAt: number }>();
export const isMoving = (userId: string | number) => moving.has(String(userId));

/** Check the account ID and delegate key with one recall. A wrong pair fails here, before anything changes. */
export async function verifyOwnAccount(accountId: string, key: string): Promise<{ account: string; client: MemWal }> {
  if (!looksLikeAccount(accountId) || !looksLikeKey(key)) throw new Error("That doesn't look like a Walrus Memory account ID and delegate key.");
  const account = normalizeSuiAddress(accountId);
  const client = ownClient(account, key);
  try {
    await withRetry("own recall", () => client.recall({ query: "anchor connection check", namespace: OWN_NAMESPACE, limit: 1 }), 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/40[13]/.test(msg) ? "Walrus Memory rejected that key for that account. Check both on memory.walrus.xyz (Delegate keys)." : `Couldn't reach your Walrus Memory account: ${msg.slice(0, 120)}`);
  }
  return { account, client };
}

/** How many memories this person has in Anchor's account (0 if unknown). */
async function storedCount(userId: string): Promise<number> {
  const name = namespaceFor(userId);
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await withRetry("listNamespaces", () => memwal.listNamespaces({ cursor, limit: 500 }));
    const hit = res.namespaces.find((ns) => ns.name === name);
    if (hit) return hit.memory_count;
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return 0;
}

/**
 * Everything Anchor remembers about this person, as stored. Recall is a search,
 * so it asks for at least as many as the account holds, newest first, plus a
 * broad search so nothing old is missed. Memories the person deleted (/forget)
 * and quarantined ones (orders or secrets, never facts) are left out.
 */
export async function memoriesToCopy(userId: string): Promise<string[]> {
  const count = await storedCount(userId).catch(() => 0);
  const limit = Math.min(MAX_COPY, Math.max(100, count + 20));
  const [recent, relevant] = await Promise.all([
    recall(userId, "everything about this user: promises, outcomes, facts, patterns, wins, habits", { limit, sort: "recent" }),
    recall(userId, "who the user is, what derails them, what helps them follow through", { limit: 50 }),
  ]);
  return [...new Set(mergeAndFilter(userId, recent, relevant).map((m) => m.raw).filter(Boolean))];
}

const hashOf = (account: string, text: string) => createHash("sha256").update(`${account}\n${text}`).digest("hex").slice(0, 16);

/**
 * Copy texts into the person's account, 20 at a time, skipping any already
 * copied to that account by an earlier try (so a retry never duplicates).
 * Failed items get one more pass.
 */
async function copyInto(userId: string, account: string, client: MemWal, texts: string[]): Promise<{ copied: number; failed: number }> {
  const done = new Set(getUser(userId)?.ownCopy?.account === account ? getUser(userId)!.ownCopy!.hashes : []);
  let todo = texts.filter((t) => !done.has(hashOf(account, t)));
  for (let pass = 0; pass < 2 && todo.length; pass++) {
    const failed: string[] = [];
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      try {
        // Submitting is retried; waiting isn't (a retry would store the batch twice).
        const accepted = await withRetry("own copy", () => client.rememberBulk(batch.map((text) => ({ text, namespace: OWN_NAMESPACE }))));
        const res = await client.waitForRememberJobs(accepted.job_ids, undefined, { timeoutMs: 180_000, pollIntervalMs: 3_000 });
        res.results.forEach((r, j) => (r.status === "done" ? done.add(hashOf(account, batch[j]!)) : failed.push(batch[j]!)));
      } catch (err) {
        console.warn(`[own] copy batch failed for ${userId}: ${err instanceof Error ? err.message : err}`);
        failed.push(...batch);
      }
      updateUser(userId, (u) => (u.ownCopy = { account, hashes: [...done] }));
    }
    todo = failed;
  }
  return { copied: texts.length - todo.length, failed: todo.length };
}

function switchTo(userId: string, account: string, key: string) {
  updateUser(userId, (u) => {
    u.ownMemory = { accountId: account, keySealed: sealText("memwal-key", userId, key), since: new Date().toISOString() };
  });
  forgetCachedRecalls(userId);
}

/**
 * Copy everything, then switch. Anything saved while the copy ran is caught
 * up just before the switch. If any memory fails to copy, nothing is switched:
 * Anchor keeps using its own account, and a retry copies only what's missing.
 */
export async function moveToOwnMemory(userId: string, account: string, key: string, client: MemWal): Promise<MoveResult> {
  const texts = await memoriesToCopy(userId);
  let { copied, failed } = await copyInto(userId, account, client, texts);
  let total = texts.length;
  if (!failed) {
    // Catch up on anything saved while the copy ran (Walrus needs ~30 s to make new memories recallable).
    const fresh = mergeAndFilter(userId, await recall(userId, "latest promises, outcomes and facts", { limit: 30, sort: "recent" }).catch(() => []))
      .map((m) => m.raw)
      .filter((t) => t && !texts.includes(t));
    if (fresh.length) {
      const more = await copyInto(userId, account, client, fresh);
      copied += more.copied;
      failed += more.failed;
      total += fresh.length;
    }
  }
  const switched = failed === 0;
  if (switched) switchTo(userId, account, key);
  return { copied, total, failed, switched };
}

/**
 * Check the key now, move in the background. Resolves as soon as the key
 * checks out (or rejects with a message the person can act on); `done` gets the
 * result when the move finishes.
 */
export async function startOwnMemoryMove(
  userId: string,
  accountId: string,
  key: string,
  done: (res: MoveResult | Error) => void | Promise<void>,
): Promise<{ copying: boolean }> {
  if (isMoving(userId)) throw new Error("I'm already moving your memory. I'll message you in the chat the moment it's done.");
  const { account, client } = await verifyOwnAccount(accountId, key);
  // Already on their own account: their memory lives there, so there's nothing to copy from Anchor's.
  if (getUser(userId)?.ownMemory) {
    switchTo(userId, account, key);
    return { copying: false };
  }
  moving.set(userId, { startedAt: Date.now() });
  void moveToOwnMemory(userId, account, key, client)
    .then(done, (err) => done(err instanceof Error ? err : new Error(String(err))))
    .catch((err) => console.error(`[own] move report failed for ${userId}:`, err))
    .finally(() => moving.delete(userId));
  return { copying: true };
}

/** The chat message sent when a move finishes. */
export function moveReport(res: MoveResult | Error, accountId: string): string {
  const acct = `${accountId.slice(0, 8)}…`;
  if (res instanceof Error) {
    return `I couldn't finish moving your memory (${res.message.slice(0, 120)}).\n\nNothing was switched: I'm still on Anchor's account, so you haven't lost anything. Try again in a little while and I'll copy only what's missing.`;
  }
  if (!res.switched) {
    return `I copied ${res.copied} of ${res.total} memories into your account (${acct}), but ${res.failed} didn't make it.\n\nNothing was switched yet, so you haven't lost anything. Try again in a little while and I'll copy only the ones that are missing.`;
  }
  if (!res.total) return `🗝 Connected. You didn't have any memories with me yet, so there was nothing to copy. From now on everything I remember about you is saved in your own Walrus Memory account (${acct}), in the "anchor" namespace.\n\n/mymemory off switches back.`;
  return `🗝 Done. All ${res.total} of your memories are now in your own Walrus Memory account (${acct}), in the "anchor" namespace. From now on everything I remember about you is saved there.\n\nYour key is stored encrypted, and you can revoke it any time on memory.walrus.xyz. /mymemory off switches back.`;
}

export function disconnectOwnMemory(userId: string): boolean {
  const had = !!getUser(userId)?.ownMemory;
  updateUser(userId, (u) => delete u.ownMemory);
  forgetCachedRecalls(userId);
  return had;
}
