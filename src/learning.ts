/**
 * The learning loop, made visible.
 *
 *  - Counters: how many replies were shaped by a learned pattern or win, what
 *    kinds of memories Anchor is writing, how many promises the chain closed.
 *  - /learning: one person's timeline, week by week: what Anchor learned about
 *    them and how their follow-through moved.
 *  - Money patterns: learned from the person's own Sui history (via Tatum),
 *    stored on Walrus as a pattern, and used in later advice like any other.
 */
import { config } from "./config.js";
import { addDays, todayIn, weekdayOf } from "./dates.js";
import { mergeAndFilter, recall } from "./memory/recall.js";
import { clause, commitmentStates, type MemoryRecord, type RecalledMemory } from "./memory/types.js";
import { bump, getUser, updateUser } from "./state.js";
import { fromUnits, sentSince, type CoinSymbol, type Transfer } from "./chain/sui.js";

export function noteReply(memories: RecalledMemory[]): void {
  const shaped = memories.some((m) => m.kind === "pattern" || m.kind === "win");
  bump((m) => {
    m.replies++;
    if (shaped) m.repliesShapedByLearning++;
  });
}

export function noteStored(records: MemoryRecord[]): void {
  if (!records.length) return;
  bump((m) => {
    for (const r of records) m.memoriesByKind[r.kind] = (m.memoriesByKind[r.kind] ?? 0) + 1;
  });
}

/** Monday of the week containing `iso` (weeks start Monday). */
export function weekOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -back);
}

export interface WeekRow {
  week: string;
  kept: number;
  closed: number;
  learned: string[];
}

/** Group outcomes and learned patterns/wins by week, oldest first. */
export function weeklyLearning(memories: RecalledMemory[]): WeekRow[] {
  const rows = new Map<string, WeekRow>();
  const row = (iso: string) => {
    const w = weekOf(iso);
    if (!rows.has(w)) rows.set(w, { week: w, kept: 0, closed: 0, learned: [] });
    return rows.get(w)!;
  };
  for (const s of commitmentStates(memories)) {
    const o = s.outcome;
    if (!o?.date || !o.status || o.status === "moved") continue;
    const r = row(o.date);
    r.closed++;
    if (o.status === "kept") r.kept++;
    else if (o.status === "partial") r.kept += 0.5;
  }
  for (const m of memories) {
    if ((m.kind === "pattern" || m.kind === "win") && m.date) row(m.date).learned.push(`${m.kind === "win" ? "🏆" : "🔁"} ${clause(m.text)}`);
  }
  return [...rows.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/** /learning: how Anchor's picture of this person (and their follow-through) changed over time. */
export async function learningTimeline(userId: number | string): Promise<string> {
  const [a, b, c] = await Promise.all([
    recall(userId, "patterns and wins: what derails the user and what helps them follow through", { limit: 25 }),
    recall(userId, "[outcome] whether a promise was kept, broken, partly done or moved", { limit: 30, sort: "recent" }),
    recall(userId, "[commitment] a promise to do something by a due date", { limit: 30, sort: "recent" }),
  ]);
  const memories = mergeAndFilter(userId, a, b, c);
  const rows = weeklyLearning(memories);
  if (rows.length === 0) return "Nothing to show yet. Make me a promise, tell me how it went, and I'll start learning what works for you.";
  const lines = ["🧠 How I've learned you, week by week", ""];
  for (const r of rows.slice(-6)) {
    const rate = r.closed ? `${Math.round((r.kept / r.closed) * 100)}% kept (${r.kept}/${r.closed})` : "no promises closed";
    lines.push(`Week of ${weekdayOf(r.week).slice(0, 3)} ${r.week}: ${rate}`);
    for (const l of r.learned.slice(0, 3)) lines.push(`   learned ${l}`);
  }
  const patterns = memories.filter((m) => m.kind === "pattern").length;
  const wins = memories.filter((m) => m.kind === "win").length;
  const trace = getUser(userId)?.lastTrace;
  const used = trace?.items.filter((i) => /^\[(pattern|win)\]/.test(i.raw)) ?? [];
  lines.push("", `I now plan with ${patterns} pattern${patterns === 1 ? "" : "s"} and ${wins} win${wins === 1 ? "" : "s"} from your history.`);
  if (used.length) lines.push(`My last reply used: ${used.map((u) => `"${clause(u.raw.split("|").slice(1).join("|").trim())}"`).join(", ")}`);
  lines.push("", "/compare <message> shows the difference memory makes.");
  return lines.join("\n");
}

/**
 * Outflow by weekday from on-chain transfers. Returns a pattern sentence when
 * one day clearly dominates (at least 40% of outflow, at least 2 transactions).
 */
export function spendingPattern(transfers: Transfer[], coin: CoinSymbol, timeZone: string): string | undefined {
  const byDay = new Map<string, { units: bigint; n: number }>();
  let total = 0n;
  for (const t of transfers) {
    if (t.ownChange >= 0n) continue;
    const out = -t.ownChange;
    const day = new Date(t.timestampMs).toLocaleDateString("en-US", { weekday: "long", timeZone });
    const cur = byDay.get(day) ?? { units: 0n, n: 0 };
    byDay.set(day, { units: cur.units + out, n: cur.n + 1 });
    total += out;
  }
  if (total === 0n) return undefined;
  const [day, top] = [...byDay.entries()].sort((a, b) => (b[1].units > a[1].units ? 1 : -1))[0]!;
  const share = Number((top.units * 1000n) / total) / 10;
  if (share < 40 || top.n < 2) return undefined;
  return `Sends out most ${coin} on ${day}s: ${share.toFixed(0)}% of ${fromUnits(total, coin)} ${coin} over the last 4 weeks (verified on Sui)`;
}

/**
 * Learn a money pattern from the linked wallet and store it on Walrus when it
 * is new. Runs weekly and on /money. Returns the pattern, if any.
 */
export async function learnMoneyPattern(userId: number | string): Promise<string | undefined> {
  const user = getUser(userId);
  if (!user?.wallet) return undefined;
  const since = Date.now() - 28 * 86_400_000;
  for (const coin of ["USDC", "SUI"] as const) {
    const transfers = await sentSince(user.wallet.address, coin, since);
    const pattern = spendingPattern(transfers, coin, config.TIMEZONE);
    if (!pattern) continue;
    const key = pattern.replace(/:.*$/, "");
    if (user.moneyPattern === key) return pattern; // already known, don't store it again
    updateUser(userId, (u) => {
      u.moneyPattern = key;
    });
    const { storeMemories } = await import("./memory/write.js");
    const { enqueue } = await import("./bot/conversation.js");
    void enqueue(`write:${userId}`, () => storeMemories(userId, [{ kind: "pattern", date: todayIn(config.TIMEZONE), text: pattern }])).catch(
      (err) => console.error("[learning] money pattern write failed:", err),
    );
    return pattern;
  }
  return undefined;
}
