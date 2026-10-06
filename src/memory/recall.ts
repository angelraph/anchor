import { getUser } from "../state.js";
import { memwal, namespaceFor, withRetry } from "./client.js";
import { commitmentStates, mergeMemories, parse, type CommitmentState, type RecalledMemory } from "./types.js";

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
    recall(userId, "who the user is: name, work, goals, people in their life, how they want to be coached", {
      limit: 5,
      maxDistance: 0.8,
    }),
  ]);
  const groups = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (groups.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const memories = mergeAndFilter(userId, ...groups).sort((a, b) => a.distance - b.distance);
  return { memories, commitments: commitmentStates(memories) };
}

/** Broad sweep of a user's commitments and outcomes (for /promises and check-ins). */
export async function recallCommitments(userId: number | string): Promise<CommitmentState[]> {
  const [commitments, outcomes] = await Promise.all([
    recall(userId, "[commitment] a promise to do something by a due date", { limit: 30, sort: "recent" }),
    recall(userId, "[outcome] whether a promise was kept, broken, partly done or moved", { limit: 30, sort: "recent" }),
  ]);
  return commitmentStates(mergeAndFilter(userId, commitments, outcomes));
}
