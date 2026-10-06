/**
 * Small operational state kept on local disk.
 *
 * Nothing here is long-term memory, that all lives on Walrus. This file only
 * holds bookkeeping that makes the bot behave well between restarts: which
 * chats exist, which check-ins were already sent today, the trace behind the
 * last reply for /why, and a cache of tombstones. If the file is lost, Anchor
 * still remembers everything that matters; it may just re-send a check-in.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

export interface TraceItem {
  raw: string;
  blobId: string;
  distance: number;
}

export interface UserState {
  firstName: string;
  chatId: number;
  lastSeen: string; // ISO timestamp
  /** commitment id -> date (YYYY-MM-DD) Anchor last nudged about it */
  nudged: Record<string, string>;
  /** date of the last open-ended evening check-in */
  lastGeneralCheckin?: string;
  /** commitment ids Anchor most recently asked about (helps outcome linking) */
  awaitingOutcome: string[];
  /** memory hashes the user asked to forget */
  tombstones: string[];
  lastTrace?: { at: string; query: string; items: TraceItem[] };
}

interface StateFile {
  users: Record<string, UserState>;
  /** Serialized memories Walrus rejected, per user, waiting to be retried. */
  outbox?: Record<string, string[]>;
}

const dir = config.DATA_DIR;
const file = join(dir, "state.json");
let state: StateFile = { users: {} };

try {
  state = JSON.parse(readFileSync(file, "utf8")) as StateFile;
} catch {
  // First boot or unreadable file: start empty.
}

let timer: NodeJS.Timeout | undefined;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(timer);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

export function getUser(userId: number | string): UserState | undefined {
  return state.users[String(userId)];
}

export function upsertUser(userId: number, chatId: number, firstName: string): UserState {
  const key = String(userId);
  const existing = state.users[key];
  const user: UserState = existing ?? { firstName, chatId, lastSeen: "", nudged: {}, awaitingOutcome: [], tombstones: [] };
  user.firstName = firstName || user.firstName;
  user.chatId = chatId;
  user.lastSeen = new Date().toISOString();
  state.users[key] = user;
  persist();
  return user;
}

export function updateUser(userId: number | string, fn: (u: UserState) => void) {
  const user = state.users[String(userId)];
  if (!user) return;
  fn(user);
  persist();
}

export function allUsers(): Array<[string, UserState]> {
  return Object.entries(state.users);
}

/** Park memories that could not be written so they are retried later, not lost. */
export function addToOutbox(userId: number | string, raws: string[]) {
  if (raws.length === 0) return;
  state.outbox ??= {};
  const key = String(userId);
  state.outbox[key] = [...new Set([...(state.outbox[key] ?? []), ...raws])];
  persist();
}

/** Take everything waiting in the outbox (the caller re-queues what still fails). */
export function takeOutbox(): Array<[string, string[]]> {
  const entries = Object.entries(state.outbox ?? {}).filter(([, raws]) => raws.length > 0);
  state.outbox = {};
  persist();
  return entries;
}
