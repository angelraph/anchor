/**
 * Bring your own Walrus Memory: a person moves their Anchor memory into their
 * own Walrus Memory account (memory.walrus.xyz), so it is theirs outright and
 * any other app they authorise can use it too.
 *
 *   connect     check the delegate key really opens that account, copy what
 *               Anchor already remembers into it, then switch every recall and
 *               save to it
 *   disconnect  switch back to Anchor's account (their own copy stays theirs)
 */
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { sealText } from "../secrets.js";
import { getUser, updateUser } from "../state.js";
import { OWN_NAMESPACE, ownClient, withRetry } from "./client.js";
import { forgetCachedRecalls, mergeAndFilter, recall } from "./recall.js";

/** A Walrus Memory delegate key: 64 hex chars (optionally 0x) or a suiprivkey1… string. */
export const looksLikeKey = (s: string) => /^(0x)?[0-9a-fA-F]{64}$/.test(s) || /^suiprivkey1[0-9a-z]{50,}$/.test(s);
export const looksLikeAccount = (s: string) => /^0x[0-9a-fA-F]{1,64}$/.test(s);

/** Connect the person's own account. Returns how many memories were copied over. */
export async function connectOwnMemory(userId: string, accountId: string, key: string, opts: { copy: boolean }): Promise<number> {
  if (!looksLikeAccount(accountId) || !looksLikeKey(key)) throw new Error("That doesn't look like a Walrus Memory account ID and delegate key.");
  const account = normalizeSuiAddress(accountId);
  const client = ownClient(account, key);
  // A wrong key or account fails here (401/403), before anything is switched.
  try {
    await withRetry("own recall", () => client.recall({ query: "anchor connection check", namespace: OWN_NAMESPACE, limit: 1 }), 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/40[13]/.test(msg) ? "Walrus Memory rejected that key for that account. Check both on memory.walrus.xyz (Delegate keys)." : `Couldn't reach your Walrus Memory account: ${msg.slice(0, 120)}`);
  }
  let copied = 0;
  if (opts.copy && !getUser(userId)?.ownMemory) {
    const [recent, relevant] = await Promise.all([
      recall(userId, "everything about this user: promises, outcomes, facts, patterns, wins, habits", { limit: 100, sort: "recent" }),
      recall(userId, "who the user is, what derails them, what helps them follow through", { limit: 50 }),
    ]);
    const all = mergeAndFilter(userId, recent, relevant).map((m) => m.raw).filter(Boolean);
    for (let i = 0; i < all.length; i += 20) {
      const batch = all.slice(i, i + 20);
      const res = await withRetry("own copy", () => client.rememberBulkAndWait(batch.map((text) => ({ text, namespace: OWN_NAMESPACE })), { timeoutMs: 120_000 }));
      copied += res.results.filter((r) => r.status === "done").length;
    }
  }
  updateUser(userId, (u) => {
    u.ownMemory = { accountId: account, keySealed: sealText("memwal-key", userId, key), since: new Date().toISOString() };
  });
  forgetCachedRecalls(userId);
  return copied;
}

export function disconnectOwnMemory(userId: string): boolean {
  const had = !!getUser(userId)?.ownMemory;
  updateUser(userId, (u) => delete u.ownMemory);
  forgetCachedRecalls(userId);
  return had;
}
