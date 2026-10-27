/**
 * Stake on a promise (a commitment contract, paid with x402 on Sui).
 *
 *   /stake #p2x1 5 tobi.sui
 *     → a stake page; the person pays 5 USDC from their wallet (x402 exact, settled via Tatum)
 *     → Anchor holds it until the deadline, and the chain decides the promise
 *     → kept: 5 USDC goes back to the wallet that paid
 *       missed: 5 USDC goes to tobi.sui (a friend, a charity, someone who'll enjoy it)
 *
 * Anchor never keeps stake money. Every payout is a Sui transaction signed by
 * Anchor's key and executed through Tatum, linked in the chat.
 */
import { randomBytes } from "node:crypto";
import type { Api } from "grammy";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { config } from "../config.js";
import { clause } from "../memory/types.js";
import { allStakes, bump, getStake, getUser, putStake, updateStake, updateUser, type Stake } from "../state.js";
import { anchorAddress, anchorKey } from "./signer.js";
import { coinLabel, COINS, explorerTx, shortAddr, sui, toUnits, type StakeCoin } from "./sui.js";
import { requirements, type PaymentRequirements } from "./x402.js";

export const stakesEnabled = () => !!anchorKey && !!config.PUBLIC_URL;

export function stakeUrl(token: string): string {
  return `${config.PUBLIC_URL.replace(/\/$/, "")}/stake/${token}`;
}

export function createStake(opts: Omit<Stake, "token" | "status" | "createdAt">): Stake {
  const stake: Stake = { ...opts, token: randomBytes(12).toString("base64url"), status: "awaiting_payment", createdAt: new Date().toISOString() };
  putStake(stake);
  return stake;
}

export const stakeCoin = (s: Stake): StakeCoin => s.coin ?? "USDC";

export function stakeRequirements(stake: Stake): PaymentRequirements {
  if (!anchorAddress) throw new Error("ANCHOR_SUI_PRIVATE_KEY is not set");
  const coin = stakeCoin(stake);
  return requirements({ amount: toUnits(stake.amount, coin), asset: COINS[coin].type, payTo: anchorAddress, timeoutSeconds: 300 });
}

/** The x402 payment settled: the stake is now held and tied to the promise. */
export async function markStakePaid(api: Api | undefined, token: string, payer: string, digest: string): Promise<void> {
  const stake = getStake(token);
  if (!stake) return;
  updateStake(token, (s) => {
    s.status = "held";
    s.payer = payer;
    s.payDigest = digest;
  });
  updateUser(stake.userId, (u) => {
    const p = u.chain?.[stake.commitmentId];
    if (p) p.stake = token;
  });
  bump((m) => m.stakes.held++);
  const { storeMemories } = await import("../memory/write.js");
  const { enqueue } = await import("../bot/conversation.js");
  const { todayIn } = await import("../dates.js");
  void enqueue(`write:${stake.userId}`, () =>
    storeMemories(stake.userId, [
      {
        kind: "fact",
        date: todayIn(config.TIMEZONE),
        proof: digest,
        text: `Staked ${stake.amount} ${coinLabel(stakeCoin(stake))} on promise #${stake.commitmentId} (${clause(stake.text)}); it goes to ${stake.forfeitName ?? shortAddr(stake.forfeitTo)} if missed`,
      },
    ]),
  ).catch((err) => console.error(`[stake] memory write failed:`, err));
  const chatId = getUser(stake.userId)?.chatId;
  if (api && chatId) {
    await api
      .sendMessage(
        chatId,
        `🔒 ${stake.amount} ${coinLabel(stakeCoin(stake))} staked on #${stake.commitmentId} · ${clause(stake.text)}.\nKeep it and it comes back to you. Miss it and it goes to ${stake.forfeitName ?? shortAddr(stake.forfeitTo)}. The chain decides.\n${explorerTx(digest)}`,
        { link_preview_options: { is_disabled: true } },
      )
      .catch(() => undefined);
  }
}

/** Send a stablecoin from Anchor's wallet (Tatum executes it). Returns the digest. */
async function payout(to: string, units: bigint, coin: StakeCoin): Promise<string> {
  if (!anchorKey || !anchorAddress) throw new Error("no Anchor key");
  const tx = new Transaction();
  tx.setSender(anchorAddress);
  tx.transferObjects([coinWithBalance({ type: COINS[coin].type, balance: units })], to);
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: anchorKey, include: { effects: true } });
  if (res.$kind !== "Transaction") throw new Error(`payout failed on-chain: ${res.FailedTransaction.digest}`);
  await sui.waitForTransaction({ digest: res.Transaction.digest, timeout: 30_000 }).catch(() => undefined);
  return res.Transaction.digest;
}

/** The chain decided the promise: return the stake, or send it on. */
export async function settleStake(api: Api | undefined, token: string, outcome: "kept" | "broken"): Promise<void> {
  const stake = getStake(token);
  if (!stake || stake.status !== "held" || !stake.payer) return;
  const to = outcome === "kept" ? stake.payer : stake.forfeitTo;
  const chatId = getUser(stake.userId)?.chatId;
  try {
    // Pay out exactly what was received (a direct transfer includes its small recognition tail).
    const coin = stakeCoin(stake);
    const digest = await payout(to, stake.payExact ? BigInt(stake.payExact) : toUnits(stake.amount, coin), coin);
    updateStake(token, (s) => {
      s.status = outcome === "kept" ? "refunded" : "forfeited";
      s.payoutDigest = digest;
    });
    bump((m) => (outcome === "kept" ? m.stakes.refunded++ : m.stakes.forfeited++));
    const text =
      outcome === "kept"
        ? `💸 Your ${stake.amount} ${coinLabel(coin)} stake is on its way back to you. Well earned.\n${explorerTx(digest)}`
        : `💸 As agreed, your ${stake.amount} ${coinLabel(coin)} stake went to ${stake.forfeitName ?? shortAddr(stake.forfeitTo)}. Next time it stays with you.\n${explorerTx(digest)}`;
    if (api && chatId) await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }).catch(() => undefined);
  } catch (err) {
    const note = err instanceof Error ? err.message.slice(0, 200) : String(err);
    console.error(`[stake] payout for ${token} failed: ${note}`);
    updateStake(token, (s) => {
      s.status = "payout_failed";
      s.note = `${outcome}: ${note}`;
    });
  }
}

/** Retry failed payouts and expire stakes nobody paid before the deadline (runs on a timer). */
export async function maintainStakes(api: Api | undefined, today: string): Promise<void> {
  for (const s of allStakes()) {
    if (s.status === "awaiting_payment" && s.due < today) updateStake(s.token, (x) => (x.status = "expired"));
    if (s.status === "payout_failed" && s.note) {
      const outcome = s.note.startsWith("kept") ? "kept" : "broken";
      updateStake(s.token, (x) => (x.status = "held"));
      await settleStake(api, s.token, outcome);
    }
  }
}
