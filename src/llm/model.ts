import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { config } from "../config.js";

const google = createGoogleGenerativeAI({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY });

/** Primary Gemini model first, then fallbacks for when Google returns 503 "high demand". */
const MODEL_IDS = [config.GEMINI_MODEL, ...config.GEMINI_FALLBACK_MODELS.split(",").map((s) => s.trim())].filter(
  (id, i, all) => id && all.indexOf(id) === i,
);
const models = MODEL_IDS.map((id) => ({ id, model: google(id) }));

/** Per-model time limit; past it we fail over instead of making the user wait. */
export const LLM_TIMEOUT_MS = 12_000;

export const MODEL_LABEL = `Google ${config.GEMINI_MODEL}`;

function isRetryable(err: unknown): boolean {
  const e = err as { statusCode?: number; isRetryable?: boolean; lastError?: { statusCode?: number }; message?: string };
  const status = e?.statusCode ?? e?.lastError?.statusCode;
  if (status !== undefined) return [404, 408, 429, 500, 502, 503, 504].includes(status);
  if (e?.isRetryable) return true; // e.g. ECONNRESET: no HTTP status, but the SDK marks it retryable
  return /high demand|overloaded|unavailable|timeout|timed out|aborted|fetch failed|cannot connect|ECONNRESET|socket hang up|network|quota/i.test(
    e?.message ?? "",
  );
}

/** Models that recently failed are skipped for a while instead of retried on every call. */
const cooldownUntil = new Map<string, number>();
/** Smoothed response time per model (ms), learned from real calls. */
const speed = new Map<string, number>();
const COOLDOWN_MS = 15 * 60_000;

/**
 * Run a Gemini call, failing over to the next model on overload/availability
 * errors. Usage: `withModel((model) => generateText({ model, ... }))`.
 */

export async function withModel<T>(call: (model: LanguageModel) => Promise<T>): Promise<T> {
  try {
    return await tryChain(call, false);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    // Every model failed at once: Google demand spikes usually clear in seconds.
    console.warn("[llm] all models busy; retrying the whole chain in 3 s");
    await new Promise((r) => setTimeout(r, 3_000));
    return tryChain(call, true);
  }
}

/** True for errors caused by provider load or availability rather than our request. */
export function isOverloadError(err: unknown): boolean {
  return isRetryable(err);
}

async function tryChain<T>(call: (model: LanguageModel) => Promise<T>, all: boolean): Promise<T> {
  const now = Date.now();
  const healthy = models.filter((m) => (cooldownUntil.get(m.id) ?? 0) <= now);
  // On the second pass, or if every model is cooling down, try them all.
  // Fastest known healthy model first. Untried models count as 4 s (the
  // primary as 0 s, so it is tried first until we learn otherwise).
  const order = (all || !healthy.length ? models : healthy)
    .map((m, i) => ({ m, i, ms: speed.get(m.id) ?? (i === 0 ? 0 : 4_000) }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i)
    .map((x) => x.m);
  let lastError: unknown;
  for (const { id, model } of order) {
    const started = Date.now();
    try {
      const result = await call(model);
      const ms = Date.now() - started;
      const prev = speed.get(id);
      speed.set(id, prev === undefined ? ms : prev * 0.7 + ms * 0.3);
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
      cooldownUntil.set(id, Date.now() + COOLDOWN_MS);
      console.warn(`[llm] ${id} unavailable (${(err as Error).message?.slice(0, 80)}); skipping it for 15 min`);
    }
  }
  throw lastError;
}
