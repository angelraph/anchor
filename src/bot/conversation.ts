/**
 * The core memory loop for one chat turn:
 *   recall (Walrus) → generate (Gemini) → reply → extract + store (Walrus, in background)
 */
import { generateText, type ModelMessage } from "ai";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { withModel } from "../llm/model.js";
import { systemPrompt } from "../llm/prompts.js";
import { recallForTurn, type TurnContext } from "../memory/recall.js";
import { dropDuplicates, extractMemories, storeMemories } from "../memory/write.js";
import { getUser, updateUser } from "../state.js";

const HISTORY_TURNS = 8;
const history = new Map<string, ModelMessage[]>();

/** Short-term context: the last few turns of this chat, kept in process memory only. */
function historyFor(userId: number): ModelMessage[] {
  return history.get(String(userId)) ?? [];
}

function pushHistory(userId: number, user: string, assistant: string) {
  const h = [...historyFor(userId), { role: "user", content: user } as const, { role: "assistant", content: assistant } as const];
  history.set(String(userId), h.slice(-HISTORY_TURNS * 2));
}

/** Per-user queue so turns and memory writes for one user never interleave. */
const queues = new Map<string, Promise<unknown>>();
export function enqueue<T>(userId: number | string, task: () => Promise<T>): Promise<T> {
  const key = String(userId);
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

export interface TurnResult {
  reply: string;
  context: TurnContext | null;
}

export async function generateReply(opts: {
  userId: number;
  firstName: string;
  message: string;
  withMemory: boolean;
  useHistory?: boolean;
}): Promise<TurnResult> {
  const today = todayIn(config.TIMEZONE);
  const context = opts.withMemory ? await recallForTurn(opts.userId, opts.message) : null;
  const { text } = await withModel((model) =>
    generateText({
      model,
      system: systemPrompt({
        firstName: opts.firstName,
        today,
        memories: context?.memories ?? null,
        commitments: context?.commitments ?? [],
        awaiting: opts.withMemory ? (getUser(opts.userId)?.awaitingOutcome ?? []) : [],
      }),
      messages: [...(opts.useHistory === false ? [] : historyFor(opts.userId)), { role: "user", content: opts.message }],
      temperature: 0.6,
      maxRetries: 0,
    }),
  );
  return { reply: cleanReply(text), context };
}

/** Gemini sometimes slips in markdown despite instructions; Telegram shows it raw. */
function cleanReply(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim() || "…";
}

/** A normal chat turn: reply now, learn in the background. */
export async function chatTurn(userId: number, firstName: string, message: string): Promise<TurnResult> {
  const result = await generateReply({ userId, firstName, message, withMemory: true });
  pushHistory(userId, message, result.reply);

  updateUser(userId, (u) => {
    u.lastTrace = {
      at: new Date().toISOString(),
      query: message,
      items: (result.context?.memories ?? []).map((m) => ({ raw: m.raw, blobId: m.blobId, distance: m.distance })),
    };
  });

  // Learn from this exchange without blocking the reply. Writes have their own
  // per-user queue so a slow Walrus upload never delays the next answer.
  const context = result.context!;
  void enqueue(`write:${userId}`, async () => {
    try {
      const candidates = await extractMemories({ userMessage: message, assistantReply: result.reply, commitments: context.commitments });
      const fresh = await dropDuplicates(userId, candidates, context.memories);
      await storeMemories(userId, fresh);
      if (fresh.some((r) => r.kind === "outcome")) {
        const answered = new Set(fresh.flatMap((r) => (r.kind === "outcome" && r.ref ? [r.ref] : [])));
        updateUser(userId, (u) => {
          u.awaitingOutcome = u.awaitingOutcome.filter((id) => !answered.has(id));
        });
      }
    } catch (err) {
      console.error(`[memory] learning failed for user ${userId}:`, err);
    }
  });

  return result;
}
