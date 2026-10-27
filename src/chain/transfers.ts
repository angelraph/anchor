/**
 * Proof by transfer: for people whose wallet won't open Anchor's web pages
 * (wallet scanners block new "connect your wallet" domains), the same two
 * things work by sending an exact, slightly odd amount to Anchor's address:
 *
 *   /wallet verify   send exactly 0.001284 SUI  → only the owner can, so the wallet is verified
 *   /stake …         send exactly 1.0037 USDC   → the stake is held, same rules as the x402 page
 *
 * Anchor watches the linked wallet's outgoing transfers through Tatum's Sui
 * RPC and matches the exact amount, so no browser or wallet connection is needed.
 */
import type { Api } from "grammy";
import { allStakes, allUsers, getUser, updateUser } from "../state.js";
import { anchorAddress } from "./signer.js";
import { markStakePaid, stakeCoin } from "./stakes.js";
import { COINS, explorerTx, sentSince, shortAddr, toUnits, type CoinSymbol, type StakeCoin, type Transfer } from "./sui.js";

/** How long Anchor watches for a verification transfer. */
export const PROOF_TTL_MS = 2 * 60 * 60_000;

/** A base amount plus a random tail in `step` units, so the transfer is recognisable. */
export function exactAmount(base: bigint, step: bigint, maxSteps: number): bigint {
  return base + step * BigInt(1 + Math.floor(Math.random() * maxSteps));
}

/** Full-precision amount for people to type ("0.001284"), trailing zeros trimmed. */
export function exactUnits(units: bigint | string, coin: CoinSymbol): string {
  const v = BigInt(units);
  const d = BigInt(COINS[coin].decimals);
  const frac = (v % 10n ** d).toString().padStart(Number(d), "0").replace(/0+$/, "");
  return `${v / 10n ** d}${frac ? `.${frac}` : ""}`;
}

/** The transfer that sent exactly `amount` to `to`, if any. */
export function findExactTransfer(transfers: Transfer[], to: string, amount: bigint): Transfer | undefined {
  return transfers.find((t) => t.received.some((r) => r.address === to && r.amount === amount));
}

/** Verification amount: 0.001001 to 0.001999 SUI (six decimals, which every wallet accepts). */
export function newProofAmount(): bigint {
  return exactAmount(toUnits("0.001", "SUI"), 1_000n, 999);
}

/** Stake amount: the stake plus 0.0001 to 0.0099 (USDC and USDsui both have 6 decimals). */
export function stakeTransferAmount(amount: string, coin: StakeCoin = "USDC"): bigint {
  return exactAmount(toUnits(amount, coin), 100n, 99);
}

async function send(api: Api, chatId: number, text: string) {
  await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }).catch(() => undefined);
}

/** Runs every minute: match pending proofs and stakes against what linked wallets actually sent. */
export async function runTransferWatch(api: Api): Promise<void> {
  if (!anchorAddress) return;
  for (const [userId, u] of allUsers()) {
    const proof = u.walletProof;
    if (!proof || !u.wallet) continue;
    if (Date.now() - proof.since > PROOF_TTL_MS) {
      updateUser(userId, (x) => delete x.walletProof);
      continue;
    }
    try {
      const hit = findExactTransfer(await sentSince(u.wallet.address, "SUI", proof.since), anchorAddress, BigInt(proof.amount));
      if (!hit) continue;
      updateUser(userId, (x) => {
        if (x.wallet) x.wallet.verified = true;
        delete x.walletProof;
      });
      await send(api, u.chatId, `✅ Wallet verified: I saw ${exactUnits(proof.amount, "SUI")} SUI arrive from ${shortAddr(u.wallet.address)}, so it's yours.\n${explorerTx(hit.digest)}`);
    } catch (err) {
      console.warn(`[transfers] proof check for ${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  for (const s of allStakes()) {
    if (s.status !== "awaiting_payment" || !s.payExact) continue;
    const wallet = getUser(s.userId)?.wallet;
    if (!wallet) continue;
    try {
      const hit = findExactTransfer(await sentSince(wallet.address, stakeCoin(s), Date.parse(s.createdAt)), anchorAddress, BigInt(s.payExact));
      if (hit) await markStakePaid(api, s.token, wallet.address, hit.digest);
    } catch (err) {
      console.warn(`[transfers] stake check ${s.token} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
