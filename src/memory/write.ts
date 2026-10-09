import { generateText, Output } from "ai";
import { z } from "zod";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { LLM_TIMEOUT_MS, withModel } from "../llm/model.js";
import { extractionPrompt } from "../llm/prompts.js";
import { trackRecords } from "../reminders.js";
import { addToOutbox, takeOutbox } from "../state.js";
import { memwal, namespaceFor, withRetry } from "./client.js";
import { notePending, recall } from "./recall.js";
import { newCommitmentId, normalise, serialize, similarity, type MemoryRecord, type RecalledMemory, type CommitmentState } from "./types.js";

const extractionSchema = z.object({
  memories: z.array(
    z.object({
      kind: z.enum(["commitment", "outcome", "pattern", "win", "fact", "preference"]),
      text: z.string().describe("One short third-person sentence"),
      due: z.string().nullable().describe("YYYY-MM-DD for commitments or moved outcomes, else null"),
      at: z.string().nullable().describe("Time of day the promise is due, HH:MM 24h, if the user gave one, else null"),
      ref: z.string().nullable().describe("Promise id for outcomes, else null"),
      status: z.enum(["kept", "broken", "partial", "moved"]).nullable().describe("Outcome status, else null"),
    }),
  ),
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Ask Gemini which durable facts the latest exchange contains, as typed Anchor records. */
export async function extractMemories(opts: {
  userMessage: string;
  assistantReply: string;
  commitments: CommitmentState[];
  known?: RecalledMemory[];
  closed?: Record<string, string>;
  /** The exchange before this one, for context ("Today at 2pm" answers a question). */
  previous?: { user: string; assistant: string };
}): Promise<MemoryRecord[]> {
  const today = todayIn(config.TIMEZONE);
  const { output } = await withModel((model) =>
    generateText({
      model,
      system: extractionPrompt({ today, commitments: opts.commitments, known: (opts.known ?? []).map((m) => m.text), closed: opts.closed ?? {} }),
      prompt:
        (opts.previous
          ? `EARLIER EXCHANGE (context only; its memories are already stored):\nUSER: ${opts.previous.user}\nANCHOR: ${opts.previous.assistant}\n\nLATEST EXCHANGE (extract from this, using the earlier one to understand it):\n`
          : "") + `USER: ${opts.userMessage}\n\nANCHOR: ${opts.assistantReply}`,
      output: Output.object({ schema: extractionSchema }),
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }),
  );

  const knownIds = new Set(opts.commitments.map((c) => c.commitment.id));
  const records: MemoryRecord[] = [];
  for (const m of output.memories) {
    const text = m.text.trim();
    if (!text) continue;
    const due = m.due && ISO.test(m.due) ? m.due : undefined;
    const at = m.at && /^([01]\d|2[0-3]):[0-5]\d$/.test(m.at) ? m.at : undefined;
    if (m.kind === "commitment") {
      records.push({ kind: "commitment", date: today, id: newCommitmentId(), due, at, text });
    } else if (m.kind === "outcome") {
      const ref = m.ref?.replace(/^#/, "");
      if (ref && opts.closed?.[ref]) continue; // already recorded (e.g. via the check-in button)
      records.push({
        kind: "outcome",
        date: today,
        ref: ref && knownIds.has(ref) ? ref : undefined,
        status: m.status ?? undefined,
        due: m.status === "moved" ? due : undefined,
        at: m.status === "moved" ? at : undefined,
        text,
      });
    } else {
      records.push({ kind: m.kind, date: today, text });
    }
  }
  return records;
}

/**
 * Drop candidates Walrus already holds. Exact-text duplicates are caught
 * against what was recalled this turn; near-duplicates (distance < 0.3, same
 * kind) with one extra recall per candidate. Walrus Memory is append-only, so
 * deduplication has to happen in the app.
 */
export async function dropDuplicates(
  userId: number | string,
  candidates: MemoryRecord[],
  alreadyRecalled: RecalledMemory[],
): Promise<MemoryRecord[]> {
  const seen = new Set(alreadyRecalled.map((m) => `${m.kind}|${normalise(m.text)}`));
  const kept: MemoryRecord[] = [];
  for (const c of candidates) {
    const key = `${c.kind}|${normalise(c.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Outcomes are events: two similar outcomes on different days are both real.
    // Everything else is checked against the memories already loaded this turn
    // (which include the user's profile and habits), at no extra Walrus cost.
    if (c.kind !== "outcome" && c.kind !== "commitment") {
      if (alreadyRecalled.some((m) => m.kind === c.kind && similarity(m.text, c.text) >= 0.7)) continue;
    }
    kept.push(c);
  }
  return kept;
}

/** Write records to the user's namespace on Walrus and wait until they are indexed. */
export async function storeMemories(userId: number | string, records: MemoryRecord[]): Promise<string[]> {
  trackRecords(userId, records); // timed promises get an exact-time reminder
  return storeRaw(userId, records.map((r) => serialize(r)));
}

/**
 * Write already-serialized memories. Only jobs Walrus reports as "failed" are
 * re-sent: a "timeout" job is usually still finishing, and re-sending it would
 * store the memory twice (Walrus Memory is append-only). Anything that still
 * fails, or a relayer that is down entirely, goes to the outbox for later.
 */
export async function storeRaw(userId: number | string, raws: string[]): Promise<string[]> {
  if (raws.length === 0) return [];
  notePending(userId, raws); // usable right away, before Walrus finishes indexing
  const namespace = namespaceFor(userId);
  let pending = raws;
  const stored: string[] = [];
  try {
    for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
      const res = await withRetry("rememberBulkAndWait", () =>
        memwal.rememberBulkAndWait(
          pending.map((text) => ({ text, namespace })),
          { timeoutMs: 120_000 },
        ),
      );
      const failed: string[] = [];
      res.results.forEach((r, i) => {
        if (r.status === "done") stored.push(pending[i]!);
        else if (r.status === "timeout") console.warn(`[memwal] remember still processing for user ${userId}; not re-sending`);
        else {
          console.warn(`[memwal] remember failed for user ${userId}: ${r.error ?? "no error message"}`);
          failed.push(pending[i]!);
        }
      });
      pending = failed;
    }
  } catch (err) {
    console.error(`[memwal] relayer unavailable for user ${userId}:`, err instanceof Error ? err.message : err);
  }
  if (pending.length) {
    console.error(`[memwal] parking ${pending.length} memories for user ${userId} in the outbox`);
    addToOutbox(userId, pending);
  }
  for (const s of stored) console.log(`[memory] user ${userId} += ${s}`);
  return stored;
}

/**
 * Backup learning path: when Gemini cannot extract memories (quota, outage),
 * let Walrus Memory's own server-side extractor (analyze) pull facts from the
 * exchange so the conversation is still remembered, just without Anchor's types.
 */
export async function analyzeFallback(userId: number | string, userMessage: string, assistantReply: string): Promise<number> {
  const res = await withRetry("analyze", () =>
    memwal.analyze(`User: ${userMessage}\nAssistant: ${assistantReply}`, {
      namespace: namespaceFor(userId),
      occurredAt: new Date(),
    }),
  );
  for (const f of res.facts) console.log(`[memory] user ${userId} += (analyze) ${f.text}`);
  return res.fact_count;
}

/** Retry everything parked in the outbox (runs on a timer). */
export async function drainOutbox(): Promise<void> {
  for (const [userId, raws] of takeOutbox()) {
    console.log(`[memwal] retrying ${raws.length} parked memories for user ${userId}`);
    await storeRaw(userId, raws);
  }
}
