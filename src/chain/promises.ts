/**
 * Chain-verified promises: the loop that closes money promises from evidence
 * on Sui instead of the user's word.
 *
 *   promise made  → check prepared (baseline balance, recipient resolved via SuiNS or memory)
 *   every 15 min  → conclusive early results close it (payment landed, cap blown, savings reached)
 *   deadline      → final verdict from the chain, stored on Walrus with the tx digest as proof
 *
 * All chain reads go through Tatum's Sui RPC (chain/sui.ts). Open checks are
 * mirrored in local state, so this loop costs no Walrus Memory requests.
 */
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { allowed, noteNudge } from "../attention.js";
import { outcomeKeyboard } from "../checkins.js";
import { config } from "../config.js";
import { addDays, timeIn, todayIn } from "../dates.js";
import { recall } from "../memory/recall.js";
import { clause, type MemoryRecord } from "../memory/types.js";
import { allUsers, bump, getUser, tzOf, updateUser, type ChainPromise } from "../state.js";
import { describeCheck, isFiat, judge, needsBalance, parseCheck, serializeCheck, type ChainCheck, type Verdict } from "./checks.js";
import { outflowCents, walletValue } from "./prices.js";
import { settleStake } from "./stakes.js";
import { balanceOf, explorerTx, resolveRecipient, sentSince, type CoinSymbol } from "./sui.js";

/** A check that could not be fully prepared, explained in one sentence for the user. */
export interface CheckNote {
  id: string;
  text: string;
  check: ChainCheck;
  problem?: string;
}

const ADDRESS = /0x[0-9a-fA-F]{64}/;
const SUINS = /\b[a-z0-9-]+\.sui\b|@[a-z0-9-]+\b/i;

/** Look for "Tobi's Sui address is 0x…" (or tobi.sui) in what Anchor remembers. */
async function recipientFromMemory(userId: number | string, name: string): Promise<{ address: string; name?: string } | undefined> {
  const hits = await recall(userId, `${name}'s Sui wallet address or .sui name`, { limit: 5, maxDistance: 0.7 }).catch(() => []);
  for (const h of hits) {
    if (!h.text.toLowerCase().includes(name.toLowerCase().split(" ")[0]!)) continue;
    const found = h.text.match(ADDRESS)?.[0] ?? h.text.match(SUINS)?.[0];
    if (found) {
      const r = await resolveRecipient(found).catch(() => undefined);
      if (r) return r;
    }
  }
  return undefined;
}

/**
 * Fill in what a new money promise needs before it is stored: the window
 * start, the baseline balance (save) and the recipient's address (pay).
 * Mutates the records' `chk` and returns notes for the confirmation message.
 */
export async function prepareChecks(userId: number | string, records: MemoryRecord[]): Promise<CheckNote[]> {
  const wallet = getUser(userId)?.wallet;
  const notes: CheckNote[] = [];
  for (const r of records) {
    if (r.kind !== "commitment" || !r.chk || !r.id) continue;
    const check = parseCheck(r.chk);
    if (!check) {
      delete r.chk;
      continue;
    }
    check.since = Date.now();
    let problem: string | undefined;
    if (!wallet) problem = "Link your Sui wallet with /wallet so I can verify it on-chain.";
    else if (needsBalance(check) && check.kind === "save") {
      try {
        check.base = (await currentAmount(wallet.address, check)).toString();
      } catch {
        problem = "I couldn't read your balance on Sui just now, so I can't measure savings from today.";
      }
    }
    if (check.kind === "pay" && !check.to && check.toName) {
      const direct = ADDRESS.test(check.toName) || SUINS.test(check.toName);
      const r2 = direct ? await resolveRecipient(check.toName).catch(() => undefined) : await recipientFromMemory(userId, check.toName);
      if (r2) {
        check.to = r2.address;
        if (r2.name && !direct) check.toName = `${check.toName} (${r2.name})`;
      } else {
        problem ??= `What's ${check.toName}'s Sui address or .sui name? Tell me and I'll watch for the payment.`;
      }
    }
    r.chk = serializeCheck(check);
    notes.push({ id: r.id, text: r.text, check, problem });
  }
  return notes;
}

/** Mirror chain-checked commitments (and their outcomes) into local state as they are stored. */
export function trackChainRecords(userId: number | string, records: MemoryRecord[]): void {
  const relevant = records.filter((r) => (r.kind === "commitment" && r.id && r.chk && r.due) || (r.kind === "outcome" && r.ref));
  if (!relevant.length || !getUser(userId)) return;
  updateUser(userId, (u) => {
    for (const r of relevant) {
      if (r.kind === "commitment") (u.chain ??= {})[r.id!] = { text: r.text, due: r.due!, at: r.at, chk: r.chk! };
      else if (u.chain?.[r.ref!]) {
        if (r.status === "moved" && r.due) u.chain[r.ref!] = { ...u.chain[r.ref!]!, due: r.due, at: r.at };
        else delete u.chain[r.ref!];
      }
    }
  });
}

/** One-line confirmation shown after a money promise is stored. */
export function confirmation(notes: CheckNote[]): string | undefined {
  if (!notes.length) return undefined;
  return notes
    .map((n) =>
      n.problem
        ? `⛓ #${n.id} can be verified on Sui. ${n.problem}`
        : `⛓ #${n.id} will be verified on Sui (read through Tatum): I'll check that ${describeCheck(n.check)}. No need to report it, the chain will.`,
    )
    .join("\n");
}

/** Has the deadline passed? A promise without a time runs to the end of its due day. */
export function isFinal(p: Pick<ChainPromise, "due" | "at">, today: string, now: string): boolean {
  if (p.due < today) return true;
  return p.due === today && !!p.at && p.at <= now;
}

/** Read the chain and judge one promise. */
export async function evaluate(userId: number | string, p: ChainPromise, final: boolean): Promise<Verdict & { check?: ChainCheck }> {
  const check = parseCheck(p.chk);
  const wallet = getUser(userId)?.wallet;
  if (!check) return { status: "pending", evidence: "Unreadable check." };
  if (!wallet) return { status: "pending", evidence: "No wallet linked (/wallet).", check };
  if (check.kind === "pay" && !check.to && check.toName) {
    const r = await recipientFromMemory(userId, check.toName);
    if (r) {
      check.to = r.address;
      updateUser(userId, (u) => {
        const cp = Object.values(u.chain ?? {}).find((x) => x.chk === p.chk);
        if (cp) cp.chk = serializeCheck(check);
      });
    }
  }
  const since = check.since ?? Date.now() - 7 * 86_400_000;
  let data: Parameters<typeof judge>[1];
  if (needsBalance(check)) data = { balance: await currentAmount(wallet.address, check) };
  else if (isFiat(check)) {
    const out = await outflowCents(wallet.address, check.coin, since); // cap in a currency: everything sent out, priced via Tatum
    data = { spent: out.cents, transfers: out.transfers };
  } else data = { transfers: await sentSince(wallet.address, check.coin as CoinSymbol, since) };
  return { ...judge(check, data, final), check };
}

/** Balance of the coin, or the wallet's value in the check's currency (hundredths), via Tatum. */
async function currentAmount(address: string, check: ChainCheck): Promise<bigint> {
  return isFiat(check) ? (await walletValue(address, check.coin)).cents : balanceOf(address, check.coin as CoinSymbol);
}

/** Store the verdict on Walrus (with the tx digest as proof) and close the promise locally. */
async function record(userId: string, id: string, p: ChainPromise, v: Verdict, status: "kept" | "broken"): Promise<void> {
  const { storeMemories } = await import("../memory/write.js");
  const { enqueue } = await import("../bot/conversation.js");
  const today = todayIn(tzOf(userId));
  void enqueue(`write:${userId}`, () =>
    storeMemories(userId, [
      {
        kind: "outcome",
        date: today,
        ref: id,
        status,
        proof: v.digest,
        text: `${status === "kept" ? "Kept" : "Did not keep"} the promise, verified on Sui: ${clause(p.text)}. ${v.evidence}`,
      },
    ]),
  ).catch((err) => console.error(`[chain] storing verdict for ${userId} #${id} failed:`, err));
  updateUser(userId, (u) => {
    delete u.chain?.[id];
    (u.closed ??= {})[id] = status;
    u.nudged[id] = today;
    u.awaitingOutcome = u.awaitingOutcome.filter((x) => x !== id);
  });
  bump((m) => m.chainVerified[status]++);
}

const lastPendingCheck = new Map<string, number>();
const PENDING_EVERY_MS = 15 * 60_000;

/**
 * The verifier loop (runs every minute, reads Sui only when something can be
 * decided): final checks at the deadline, early checks every 15 minutes.
 */
export async function runChainChecks(api: Api, opts: { userId?: string; force?: boolean } = {}): Promise<string[]> {
  const report: string[] = [];
  for (const [userId, user] of allUsers()) {
    if (opts.userId && userId !== opts.userId) continue;
    const tz = tzOf(userId);
    const today = todayIn(tz);
    const now = timeIn(tz);
    if (!user.wallet || !user.chain) continue;
    for (const [id, p] of Object.entries(user.chain)) {
      const final = isFinal(p, today, now);
      const key = `${userId}:${id}`;
      if (!final && !opts.force && Date.now() - (lastPendingCheck.get(key) ?? 0) < PENDING_EVERY_MS) continue;
      if (!final && !opts.force && parseCheck(p.chk)?.kind === "hold") continue; // only the deadline can decide a hold
      lastPendingCheck.set(key, Date.now());
      let v: Awaited<ReturnType<typeof evaluate>>;
      try {
        v = await evaluate(userId, p, final);
      } catch (err) {
        console.warn(`[chain] verify ${userId} #${id} failed:`, err instanceof Error ? err.message : err);
        report.push(`#${id} · ${clause(p.text)}: couldn't reach Sui just now, I'll retry.`);
        continue;
      }
      const link = v.digest ? `\n${explorerTx(v.digest)}` : "";
      if (v.status === "kept") {
        await record(userId, id, p, v, "kept");
        await send(api, user.chatId, `⛓✅ Verified on Sui: ${v.evidence}\n#${id} · ${clause(p.text)} is a kept promise.${link}\n\nWhat made it work this time? I'll remember it.`);
        if (p.stake) await settleStake(api, p.stake, "kept");
        report.push(`✅ #${id} · ${clause(p.text)}: ${v.evidence}`);
      } else if (v.status === "broken" && (p.stake || v.check?.kind === "cap")) {
        // With money staked (or a spending cap already blown) the chain is the referee.
        await record(userId, id, p, v, "broken");
        await send(api, user.chatId, `⛓❌ Sui shows #${id} · ${clause(p.text)} wasn't kept. ${v.evidence}${link}\n\nWhat got in the way? Knowing that is how we fix it.`);
        if (p.stake) await settleStake(api, p.stake, "broken");
        report.push(`❌ #${id} · ${clause(p.text)}: ${v.evidence}`);
      } else if (v.status === "broken") {
        // No stake: show the evidence, but let them tell me if they did it another way.
        updateUser(userId, (u) => {
          delete u.chain?.[id];
          u.nudged[id] = today;
          u.awaitingOutcome = [...new Set([...u.awaitingOutcome, id])];
        });
        // A question, not a verdict: it waits for the welcome-back card while they're away.
        if (allowed(userId, "deadline")) {
          await send(api, user.chatId, `⏰ Deadline for #${id} · ${clause(p.text)}.\nSui shows: ${v.evidence}\nDid you do it another way?`, outcomeKeyboard(id));
          noteNudge(userId, today);
        }
        report.push(`⏰ #${id} · ${clause(p.text)}: ${v.evidence}`);
      } else {
        report.push(`⏳ #${id} · ${clause(p.text)}: ${v.evidence}`);
      }
    }
    // Promises whose day is long gone and never resolved are handed to the evening check-in.
    const stale = Object.entries(user.chain ?? {}).filter(([, p]) => p.due < addDays(today, -2) && !p.stake);
    if (stale.length) updateUser(userId, (u) => stale.forEach(([id]) => delete u.chain![id]));
  }
  return report;
}

async function send(api: Api, chatId: number, text: string, keyboard?: InlineKeyboard) {
  await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true }, reply_markup: keyboard }).catch((err) => {
    console.warn(`[chain] message to ${chatId} failed:`, err instanceof Error ? err.message : err);
  });
}
