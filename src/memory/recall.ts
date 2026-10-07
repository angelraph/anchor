import { getUser } from "../state.js";
import { memwal, namespaceFor, withRetry } from "./client.js";
import { commitmentStates, mergeMemories, parse, type CommitmentState, type OutcomeStatus, type RecalledMemory } from "./types.js";

/** Memories written recently, usable before Walrus finishes indexing them (~30 s). */
const PENDING_MS = 5 * 60_000;
const pending = new Map<string, Array<{ raw: string; at: number }>>();

export function notePending(userId: number | string, raws: string[]) {
  const key = String(userId);
  const now = Date.now();
  const kept = (pending.get(key) ?? []).filter((p) => now - p.at < PENDING_MS);
  pending.set(key, [...kept, ...raws.map((raw) => ({ raw, at: now }))].slice(-30));
}

function pendingFor(userId: number | string): RecalledMemory[] {
  const now = Date.now();
  return (pending.get(String(userId)) ?? [])
    .filter((p) => now - p.at < PENDING_MS)
    .map((p) => ({ ...parse(p.raw), raw: p.raw, blobId: "", distance: 0.4, createdAt: new Date(p.at).toISOString() }));
}

/** Profile and habit recalls change slowly; reuse them for a while to save Walrus requests. */
const STABLE_MS = 10 * 60_000;
const stableCache = new Map<string, { at: number; memories: RecalledMemory[] }>();

async function stableRecall(userId: number | string): Promise<RecalledMemory[]> {
  const key = String(userId);
  const hit = stableCache.get(key);
  if (hit && Date.now() - hit.at < STABLE_MS) return hit.memories;
  const [profile, habits] = await Promise.all([
    recall(userId, "who the user is: name, work, goals, people in their life, how they want to be coached", { limit: 5, maxDistance: 0.8 }),
    recall(userId, "what distracts or derails the user, what helps them follow through, when and how they work best", { limit: 6, maxDistance: 0.8 }),
  ]);
  const memories = [...profile, ...habits];
  stableCache.set(key, { at: Date.now(), memories });
  return memories;
}

interface RecallOpts {
  limit?: number;
  maxDistance?: number;
  sort?: "relevance" | "recent";
}

/** One recall against the user's namespace, parsed into Anchor records. */
export async function recall(userId: number | string, query: string, opts: RecallOpts = {}): Promise<RecalledMemory[]> {
  const res = await withRetry("recall", () =>
    memwal.recall({
      query,
      namespace: namespaceFor(userId),
      limit: opts.limit ?? 8,
      maxDistance: opts.maxDistance,
      sort: opts.sort,
    }),
  );
  return res.results.map((r) => ({
    ...parse(r.text),
    raw: r.text,
    blobId: r.blob_id,
    distance: r.distance,
    createdAt: r.created_at,
  }));
}

export function mergeAndFilter(userId: number | string, ...groups: RecalledMemory[][]): RecalledMemory[] {
  return mergeMemories(groups, getUser(userId)?.tombstones ?? []);
}

/**
 * Walrus takes ~30 s to make a new memory recallable. Outcomes recorded in the
 * last few minutes (button taps) are applied from local state so a promise
 * never shows as open right after the user closed it.
 */
function withRecentOutcomes(userId: number | string, states: CommitmentState[]): CommitmentState[] {
  const closed = getUser(userId)?.closed ?? {};
  return states.map((s) => {
    const status = closed[s.commitment.id ?? ""];
    if (s.outcome || !status) return s;
    const outcome: RecalledMemory = {
      kind: "outcome", date: s.commitment.date, ref: s.commitment.id, status: status as OutcomeStatus,
      text: `Marked ${status} with the check-in button`, raw: "", blobId: "", distance: 1,
    };
    return { ...s, outcome };
  });
}

export interface TurnContext {
  memories: RecalledMemory[];
  commitments: CommitmentState[];
  /** True when Walrus could not be reached and Anchor is answering without memory. */
  unavailable?: boolean;
}

/**
 * Everything Anchor recalls before answering a message:
 *  1. semantic: memories about what the user is talking about right now
 *  2. recent: the latest promises and outcomes, regardless of topic
 *  3. profile: who they are and how they want to be coached
 */
export async function recallForTurn(userId: number | string, message: string): Promise<TurnContext> {
  const settled = await Promise.allSettled([
    recall(userId, message, { limit: 8, maxDistance: 0.75 }),
    recall(userId, "promises, commitments, deadlines and whether they were kept or broken", { limit: 8, sort: "recent" }),
    stableRecall(userId),
  ]);
  const groups = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (groups.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const memories = mergeAndFilter(userId, ...groups, pendingFor(userId)).sort((a, b) => a.distance - b.distance);
  return { memories, commitments: withRecentOutcomes(userId, commitmentStates(memories)) };
}

/** Broad sweep of a user's commitments and outcomes (for /promises and check-ins). */
export async function recallCommitments(userId: number | string): Promise<CommitmentState[]> {
  const [commitments, outcomes] = await Promise.all([
    recall(userId, "[commitment] a promise to do something by a due date", { limit: 30, sort: "recent" }),
    recall(userId, "[outcome] whether a promise was kept, broken, partly done or moved", { limit: 30, sort: "recent" }),
  ]);
  return withRecentOutcomes(userId, commitmentStates(mergeAndFilter(userId, commitments, outcomes, pendingFor(userId))));
}
