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

/** A promise with a time of day, mirrored locally for exact-time reminders. */
export interface TimedPromise {
  text: string;
  due: string; // YYYY-MM-DD
  at: string; // HH:MM
}

/** A Sui wallet the user linked. `verified` once they signed a message with it. */
export interface WalletLink {
  address: string;
  /** SuiNS name it was linked by, if any. */
  name?: string;
  verified: boolean;
  linkedAt: string;
}

/** A promise the chain can verify, mirrored locally so the verifier needs no Walrus reads. */
export interface ChainPromise {
  text: string;
  due: string; // YYYY-MM-DD
  at?: string; // HH:MM
  /** Serialized ChainCheck (chain/checks.ts). */
  chk: string;
  /** Stake token, when money is staked on it. */
  stake?: string;
}

/** A recurring promise: `times` per day or week, with a running streak of periods that met it. */
export interface Habit {
  text: string;
  per: "day" | "week";
  times: number;
  /** Local dates (YYYY-MM-DD) it was done. Kept for the last ~60 days. */
  done: string[];
  /** Local dates the person said it didn't happen (so they aren't asked again that day). */
  skipped: string[];
  streak: number;
  best: number;
  /** Key of the last period whose result was settled ("2026-10-27" or week "2026-10-26"). */
  settled?: string;
  createdAt: string;
  /** False after /habit stop. */
  active: boolean;
}

export interface UserState {
  firstName: string;
  /** IANA timezone (e.g. "Europe/Berlin"); deadlines, check-ins and summaries use it. */
  tz?: string;
  /** Friends (user ids) who see this person's outcomes. */
  buddies?: string[];
  /** People (user ids) this person is a buddy for. */
  watching?: string[];
  /** false: buddies see "a promise" instead of what it was. */
  buddyShare?: boolean;
  /** Habits by id. */
  habits?: Record<string, Habit>;
  /** Preferred currency for /money (ISO code). */
  currency?: string;
  /** Local date of the last scheduled evening check-in. */
  lastEvening?: string;
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
  /** commitment id -> outcome status recorded recently, so it is not recorded twice */
  closed?: Record<string, string>;
  /** open promises with a time of day, for reminders at the exact deadline */
  timed?: Record<string, TimedPromise>;
  /** date the last weekly summary was sent */
  lastWeekly?: string;
  /** commitment id -> date its 30-minute heads-up was sent */
  warned?: Record<string, string>;
  lastTrace?: { at: string; query: string; items: TraceItem[] };
  /** Linked Sui wallet (for chain-verified promises). */
  wallet?: WalletLink;
  /** Open chain-verifiable promises, by commitment id. */
  chain?: Record<string, ChainPromise>;
  /** Publish a signed report to Walrus every Sunday. */
  reportAuto?: boolean;
  /** Let agents read this user's signed follow-through record (x402, paid). */
  publicRecord?: boolean;
  /** Pending proof of ownership by transfer: send exactly `amount` (SUI base units) to Anchor after `since`. */
  walletProof?: { amount: string; since: number };
  /** Last money pattern learned from the wallet (so it is stored once, not weekly). */
  moneyPattern?: string;
  /** SHA-256 of the personal API token for portable memory (MCP / other tools). */
  apiTokenHash?: string;
  /** Latest published report. */
  lastReport?: { blobId: string; at: string; week: string };
}

export type StakeStatus = "awaiting_payment" | "held" | "refunded" | "forfeited" | "expired" | "payout_failed";

/** Money staked on a promise: back to the payer if kept, to `forfeitTo` if missed. */
export interface Stake {
  token: string;
  userId: string;
  commitmentId: string;
  text: string;
  due: string;
  at?: string;
  /** Human amount, in `coin`. */
  amount: string;
  /** Stablecoin the stake is paid in (USDC when absent, for stakes made before USDsui). */
  coin?: "USDC" | "USDSUI";
  forfeitTo: string;
  forfeitName?: string;
  status: StakeStatus;
  createdAt: string;
  payer?: string;
  payDigest?: string;
  /** Exact amount (base units of `coin`) that pays this stake by direct transfer from the linked wallet. */
  payExact?: string;
  payoutDigest?: string;
  /** The shared Stake object when the stake is locked in the escrow contract instead of Anchor's wallet. */
  escrowId?: string;
  note?: string;
}

/** Counters behind the public "learning loop" numbers. Started fresh in the Total Recall build. */
export interface Metrics {
  since: string;
  replies: number;
  /** Replies whose recalled memories included a learned pattern or win. */
  repliesShapedByLearning: number;
  memoriesByKind: Record<string, number>;
  chainVerified: { kept: number; broken: number };
  reportsPublished: number;
  stakes: { held: number; refunded: number; forfeited: number };
  agentPayments: number;
  /** USDC base units earned from agents. */
  agentRevenue: string;
}

interface StateFile {
  users: Record<string, UserState>;
  /** Serialized memories Walrus rejected, per user, waiting to be retried. */
  outbox?: Record<string, string[]>;
  stakes?: Record<string, Stake>;
  /** One-time wallet-link tokens: token -> { userId, expires (ms) } */
  linkTokens?: Record<string, { userId: string; expires: number }>;
  /** Buddy invites: token -> { userId (who invites), expires (ms) } */
  invites?: Record<string, { userId: string; expires: number }>;
  metrics?: Metrics;
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

/** The user's timezone, or the server default until they set one (/timezone). */
export function tzOf(userId: number | string): string {
  return state.users[String(userId)]?.tz ?? config.TIMEZONE;
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

// ---------------------------------------------------------------- stakes

export function putStake(stake: Stake) {
  (state.stakes ??= {})[stake.token] = stake;
  persist();
}

export function getStake(token: string): Stake | undefined {
  return state.stakes?.[token];
}

export function updateStake(token: string, fn: (s: Stake) => void) {
  const s = state.stakes?.[token];
  if (!s) return;
  fn(s);
  persist();
}

export function allStakes(): Stake[] {
  return Object.values(state.stakes ?? {});
}

// ---------------------------------------------------------------- wallet links

export function putLinkToken(token: string, userId: string, ttlMs = 30 * 60_000) {
  state.linkTokens ??= {};
  const now = Date.now();
  for (const [t, v] of Object.entries(state.linkTokens)) if (v.expires < now) delete state.linkTokens[t];
  state.linkTokens[token] = { userId, expires: now + ttlMs };
  persist();
}

/** The user a link token belongs to, if it is still valid. Does not consume it. */
export function peekLinkToken(token: string): string | undefined {
  const t = state.linkTokens?.[token];
  return t && t.expires > Date.now() ? t.userId : undefined;
}

export function consumeLinkToken(token: string) {
  delete state.linkTokens?.[token];
  persist();
}

// ---------------------------------------------------------------- metrics

export function metrics(): Metrics {
  state.metrics ??= {
    since: new Date().toISOString(),
    replies: 0,
    repliesShapedByLearning: 0,
    memoriesByKind: {},
    chainVerified: { kept: 0, broken: 0 },
    reportsPublished: 0,
    stakes: { held: 0, refunded: 0, forfeited: 0 },
    agentPayments: 0,
    agentRevenue: "0",
  };
  return state.metrics;
}

export function bump(fn: (m: Metrics) => void) {
  fn(metrics());
  persist();
}

/** The user a personal API token belongs to (tokens are stored hashed). */
export function userByTokenHash(hash: string): [string, UserState] | undefined {
  return Object.entries(state.users).find(([, u]) => u.apiTokenHash === hash);
}

// ---------------------------------------------------------------- buddy invites

export function putInvite(token: string, userId: string, ttlMs: number) {
  state.invites ??= {};
  const now = Date.now();
  for (const [t, v] of Object.entries(state.invites)) if (v.expires < now) delete state.invites[t];
  state.invites[token] = { userId, expires: now + ttlMs };
  persist();
}

/** The inviter, if the invite is still valid. Consumes it. */
export function takeInvite(token: string): string | undefined {
  const t = state.invites?.[token];
  if (!t || t.expires < Date.now()) return undefined;
  delete state.invites![token];
  persist();
  return t.userId;
}
