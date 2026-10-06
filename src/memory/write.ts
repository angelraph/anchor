import { generateText, Output } from "ai";
import { z } from "zod";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { withModel } from "../llm/model.js";
import { extractionPrompt } from "../llm/prompts.js";
import { memwal, namespaceFor, withRetry } from "./client.js";
import { recall } from "./recall.js";
import { newCommitmentId, normalise, serialize, type MemoryRecord, type RecalledMemory, type CommitmentState } from "./types.js";

const extractionSchema = z.object({
  memories: z.array(
    z.object({
      kind: z.enum(["commitment", "outcome", "pattern", "win", "fact", "preference"]),
      text: z.string().describe("One short third-person sentence"),
      due: z.string().nullable().describe("YYYY-MM-DD for commitments or moved outcomes, else null"),
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
}): Promise<MemoryRecord[]> {
  const today = todayIn(config.TIMEZONE);
  const { output } = await withModel((model) =>
    generateText({
      model,
      system: extractionPrompt({ today, commitments: opts.commitments }),
      prompt: `USER: ${opts.userMessage}\n\nANCHOR: ${opts.assistantReply}`,
      output: Output.object({ schema: extractionSchema }),
      temperature: 0,
      maxRetries: 0,
    }),
  );

  const knownIds = new Set(opts.commitments.map((c) => c.commitment.id));
  const records: MemoryRecord[] = [];
  for (const m of output.memories) {
    const text = m.text.trim();
    if (!text) continue;
    const due = m.due && ISO.test(m.due) ? m.due : undefined;
    if (m.kind === "commitment") {
      records.push({ kind: "commitment", date: today, id: newCommitmentId(), due, text });
    } else if (m.kind === "outcome") {
      const ref = m.ref?.replace(/^#/, "");
      records.push({
        kind: "outcome",
        date: today,
        ref: ref && knownIds.has(ref) ? ref : undefined,
        status: m.status ?? undefined,
        due: m.status === "moved" ? due : undefined,
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
 * against what was recalled this turn; near-duplicates (distance < 0.2, same
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
    if (c.kind !== "outcome" && c.kind !== "commitment") {
      const near = await recall(userId, c.text, { limit: 3, maxDistance: 0.2 }).catch(() => []);
      if (near.some((n) => n.kind === c.kind)) continue;
    }
    kept.push(c);
  }
  return kept;
}

/** Write records to the user's namespace on Walrus and wait until they are indexed. */
export async function storeMemories(userId: number | string, records: MemoryRecord[]): Promise<string[]> {
  if (records.length === 0) return [];
  const namespace = namespaceFor(userId);
  let pending = records.map((r) => serialize(r));
  const stored: string[] = [];
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
      else {
        console.warn(`[memwal] remember ${r.status} for user ${userId}: ${r.error ?? "no error message"}`);
        failed.push(pending[i]!);
      }
    });
    pending = failed;
  }
  if (pending.length) console.error(`[memwal] gave up on ${pending.length} memories for user ${userId}`);
  for (const s of stored) console.log(`[memory] user ${userId} += ${s}`);
  return stored;
}
