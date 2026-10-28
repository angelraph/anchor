/**
 * Per-user timezones: "Berlin", "Europe/Berlin", "UTC+1" or "WAT" all become a
 * real IANA zone, so "by 6pm" means 6pm where the person actually is.
 */
import { generateText, Output } from "ai";
import { z } from "zod";
import { LLM_TIMEOUT_MS, withModel } from "./llm/model.js";

const ZONES = Intl.supportedValuesOf("timeZone");
const byLower = new Map(ZONES.map((z) => [z.toLowerCase(), z]));

/** A valid IANA zone name, matched case-insensitively ("europe/berlin" → "Europe/Berlin"). */
export function ianaZone(input: string): string | undefined {
  const s = input.trim().replace(/\s+/g, "_");
  return byLower.get(s.toLowerCase()) ?? (s.toUpperCase() === "UTC" ? "UTC" : undefined);
}

/** "UTC+1", "GMT-5", "utc +3" → Etc/GMT zones (whole hours; note Etc/ signs are inverted). */
export function offsetZone(input: string): string | undefined {
  const m = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?00)?$/i.exec(input.trim());
  if (!m) return undefined;
  const h = Number(m[2]);
  if (h > 14) return undefined;
  if (h === 0) return "UTC";
  return `Etc/GMT${m[1] === "+" ? "-" : "+"}${h}`;
}

/** Resolve what a person typed; places are looked up with Gemini and validated against the IANA list. */
export async function resolveTimezone(input: string): Promise<string | undefined> {
  const direct = ianaZone(input) ?? offsetZone(input);
  if (direct) return direct;
  const place = input.trim().slice(0, 80);
  if (!place) return undefined;
  const { output } = await withModel((model) =>
    generateText({
      model,
      system:
        "Map a place, city, country or timezone abbreviation to one IANA timezone name (e.g. Lagos → Africa/Lagos, Berlin → Europe/Berlin, WAT → Africa/Lagos, New York → America/New_York). If it is ambiguous or not a place, return null.",
      prompt: place,
      output: Output.object({ schema: z.object({ timezone: z.string().nullable() }) }),
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }),
  );
  return output.timezone ? ianaZone(output.timezone) : undefined;
}

/** "Europe/Berlin (now 18:42)" */
export function describeZone(tz: string, now = new Date()): string {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return `${tz} (now ${t})`;
}
