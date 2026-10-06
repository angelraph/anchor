/**
 * Anchor's memory format.
 *
 * Walrus Memory stores plain text and recalls it semantically, so every memory
 * Anchor writes is a single human-readable line with a small typed header:
 *
 *   [commitment] 2026-10-06 id:k3f9 due:2026-10-09 | Send 5 job applications
 *   [outcome] 2026-10-09 ref:k3f9 status:broken | Sent 2; got distracted by…
 *   [pattern] 2026-10-09 | Pushes gym to "next Monday" when work runs late
 *
 * The header keeps the text embeddable (the sentence still dominates the
 * vector) while letting the app parse structure back out after recall.
 */

export const MEMORY_KINDS = [
  "commitment", // a promise the user made to themselves, usually with a due date
  "outcome", // what happened with a commitment (kept / broken / partial / moved)
  "pattern", // a recurring behaviour, excuse, trigger or blocker
  "win", // a strategy, condition or habit that actually worked
  "fact", // durable context: name, job, goals, people, constraints
  "preference", // how the user wants to be coached
  "retracted", // tombstone: the user asked Anchor to forget a memory
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type OutcomeStatus = "kept" | "broken" | "partial" | "moved";

export interface MemoryRecord {
  kind: MemoryKind | "note";
  /** Day the memory was written (YYYY-MM-DD, user's timezone). */
  date: string;
  /** Commitment id (commitments only). */
  id?: string;
  /** Due date (commitments only). */
  due?: string;
  /** For outcomes: the commitment id. For retractions: hash of the forgotten memory. */
  ref?: string;
  status?: OutcomeStatus;
  text: string;
}

/** A memory as recalled from Walrus, with its parsed structure. */
export interface RecalledMemory extends MemoryRecord {
  raw: string;
  blobId: string;
  distance: number;
  createdAt?: string;
}

// Separator is "|"; the legacy em dash (U+2014) is still read so older memories on Walrus parse.
const HEADER = /^\[([a-z]+)\]\s+(\d{4}-\d{2}-\d{2})((?:\s+[a-z]+:\S+)*)\s+(?:\||\u2014)\s+([\s\S]+)$/;
const FIELD = /([a-z]+):(\S+)/g;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function serialize(record: MemoryRecord): string {
  const fields: string[] = [];
  if (record.id) fields.push(`id:${record.id}`);
  if (record.due && DATE.test(record.due)) fields.push(`due:${record.due}`);
  if (record.ref) fields.push(`ref:${record.ref}`);
  if (record.status) fields.push(`status:${record.status}`);
  const text = record.text.replace(/\s+/g, " ").trim();
  return `[${record.kind}] ${record.date}${fields.length ? " " + fields.join(" ") : ""} | ${text}`;
}

export function parse(raw: string): MemoryRecord {
  const m = HEADER.exec(raw.trim());
  if (!m) return { kind: "note", date: "", text: raw.trim() };
  const [, kind, date, fieldStr, text] = m;
  const record: MemoryRecord = {
    kind: (MEMORY_KINDS as readonly string[]).includes(kind!) ? (kind as MemoryKind) : "note",
    date: date!,
    text: text!.trim(),
  };
  for (const [, key, value] of fieldStr!.matchAll(FIELD)) {
    if (key === "id") record.id = value;
    else if (key === "due" && DATE.test(value!)) record.due = value;
    else if (key === "ref") record.ref = value;
    else if (key === "status" && ["kept", "broken", "partial", "moved"].includes(value!))
      record.status = value as OutcomeStatus;
  }
  return record;
}

/** Stable short hash (FNV-1a, base36) of a memory's text, used by tombstones. */
export function memoryHash(raw: string): string {
  let h = 0x811c9dc5;
  for (const ch of raw.trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function newCommitmentId(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** Normalised text used for cheap exact-duplicate detection. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface CommitmentState {
  commitment: RecalledMemory;
  outcome?: RecalledMemory;
}

/**
 * Pair commitments with their most recent outcome. A commitment is "open"
 * while it has no outcome, or its latest outcome is "moved" (rescheduled).
 */
export function commitmentStates(memories: RecalledMemory[]): CommitmentState[] {
  const latestOutcome = new Map<string, RecalledMemory>();
  for (const m of memories) {
    if (m.kind !== "outcome" || !m.ref) continue;
    const prev = latestOutcome.get(m.ref);
    if (!prev || outcomeOrder(m) >= outcomeOrder(prev)) latestOutcome.set(m.ref, m);
  }
  const seen = new Set<string>();
  const states: CommitmentState[] = [];
  for (const m of memories) {
    if (m.kind !== "commitment" || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    states.push({ commitment: m, outcome: latestOutcome.get(m.id) });
  }
  return states;
}

function outcomeOrder(m: RecalledMemory): string {
  return `${m.date}|${m.createdAt ?? ""}`;
}

export function isOpen(state: CommitmentState): boolean {
  return !state.outcome || state.outcome.status === "moved";
}

/** Effective due date: a "moved" outcome may carry the new due date. */
export function effectiveDue(state: CommitmentState): string | undefined {
  if (state.outcome?.status === "moved" && state.outcome.due) return state.outcome.due;
  return state.commitment.due;
}

/**
 * Merge several recalls: dedupe identical text (keeping the closest match),
 * then drop anything the user asked Anchor to forget. Tombstones come from two
 * places, the local cache and any [retracted] memories recalled alongside
 * (a tombstone embeds the forgotten text, so it is recalled next to it).
 */
export function mergeMemories(groups: RecalledMemory[][], cachedTombstones: string[] = []): RecalledMemory[] {
  const byText = new Map<string, RecalledMemory>();
  for (const m of groups.flat()) {
    const key = normalise(m.raw);
    const prev = byText.get(key);
    if (!prev || m.distance < prev.distance) byText.set(key, m);
  }
  const all = [...byText.values()];
  const dead = new Set(cachedTombstones);
  for (const m of all) if (m.kind === "retracted" && m.ref) dead.add(m.ref);
  return all.filter((m) => m.kind !== "retracted" && !dead.has(memoryHash(m.raw)));
}
