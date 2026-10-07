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
const COOLDOWN_MS = 15 * 60_000;

/**
 * Run a Gemini call, failing over to the next model on overload/availability
 * errors. Usage: `withModel((model) => generateText({ model, ... }))`.
 */

export async function withModel<T>(call: (model: LanguageModel) => Promise<T>): Promise<T> {
  const now = Date.now();
  const healthy = models.filter((m) => (cooldownUntil.get(m.id) ?? 0) <= now);
  // If every model is cooling down, try them all anyway rather than fail.
  const order = healthy.length ? healthy : models;
  let lastError: unknown;
  for (const { id, model } of order) {
    try {
      return await call(model);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
      cooldownUntil.set(id, Date.now() + COOLDOWN_MS);
      console.warn(`[llm] ${id} unavailable (${(err as Error).message?.slice(0, 80)}); skipping it for 15 min`);
    }
  }
  throw lastError;
}
