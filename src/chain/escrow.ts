/**
 * Trustless stakes: the anchor_escrow Move package (move/anchor_escrow), published
 * immutable on Sui mainnet.
 *
 * Instead of paying Anchor, the person locks the stake in a shared `Stake`
 * object. Anchor (the arbiter) can only release it to one of two addresses
 * fixed at creation: back to the payer if kept, to the beneficiary if missed.
 * If Anchor never settles, the payer can reclaim it a week after the deadline.
 *
 *   build    the unsigned create<T> transaction for the payer's wallet (via Tatum)
 *   lock     check the signed transaction's simulated Staked event matches the
 *            stake exactly, then execute it through Tatum
 *   release  the arbiter's verdict (settle<T>), signed by Anchor's key
 */
import { createHash } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";
import { coinWithBalance, Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { config } from "../config.js";
import { tzOf, type Stake } from "../state.js";
import { anchorAddress, anchorKey } from "./signer.js";
import { COINS, sui, toUnits } from "./sui.js";

export const escrowEnabled = () => !!config.ESCROW_PACKAGE_ID && !!anchorKey;
const pkg = () => normalizeSuiAddress(config.ESCROW_PACKAGE_ID);
const coinType = (s: Stake) => COINS[s.coin ?? "USDC"].type;

/** The promise fingerprint stored on-chain: sha256 of the stake token (the token itself stays private). */
export const promiseHash = (token: string) => createHash("sha256").update(token).digest();

/** Wall-clock time in `timeZone` → epoch ms. */
export function zonedEpochMs(date: string, time: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  return guess - (shown - guess);
}

/** The on-chain deadline: the promise's time on its due day (end of day when it has none), in the person's zone. */
export const deadlineMs = (s: Stake) => zonedEpochMs(s.due, s.at ?? "23:59", tzOf(s.userId));

const StakedEvent = bcs.struct("Staked", {
  stake_id: bcs.Address,
  payer: bcs.Address,
  beneficiary: bcs.Address,
  arbiter: bcs.Address,
  amount: bcs.u64(),
  deadline_ms: bcs.u64(),
  promise: bcs.vector(bcs.u8()),
});

/** Unsigned create<T> for the payer: their coins go into a new shared Stake, not to Anchor. */
export async function buildEscrowStake(stake: Stake, sender: string): Promise<string> {
  if (!anchorAddress) throw new Error("no Anchor key");
  const tx = new Transaction();
  tx.setSender(normalizeSuiAddress(sender));
  tx.moveCall({
    target: `${pkg()}::stake::create`,
    typeArguments: [coinType(stake)],
    arguments: [
      coinWithBalance({ type: coinType(stake), balance: toUnits(stake.amount, stake.coin ?? "USDC") }),
      tx.pure.address(stake.forfeitTo),
      tx.pure.address(anchorAddress),
      tx.pure.u64(deadlineMs(stake)),
      tx.pure.vector("u8", [...promiseHash(stake.token)]),
      tx.object.clock(),
    ],
  });
  return toBase64(await tx.build({ client: sui }));
}

type StakedJson = ReturnType<typeof StakedEvent.parse>;

/** Does a Staked event lock exactly this stake (amount, coin, beneficiary, arbiter, deadline, fingerprint)? */
export function matchesStake(ev: { packageId: string; eventType: string; bcs: Uint8Array }, stake: Stake): StakedJson | undefined {
  if (normalizeSuiAddress(ev.packageId) !== pkg() || !ev.eventType.endsWith("::stake::Staked")) return undefined;
  const e = StakedEvent.parse(ev.bcs);
  const ok =
    normalizeSuiAddress(e.beneficiary) === normalizeSuiAddress(stake.forfeitTo) &&
    normalizeSuiAddress(e.arbiter) === normalizeSuiAddress(anchorAddress ?? "") &&
    BigInt(e.amount) === toUnits(stake.amount, stake.coin ?? "USDC") &&
    BigInt(e.deadline_ms) === BigInt(deadlineMs(stake)) &&
    Buffer.from(e.promise).equals(promiseHash(stake.token));
  return ok ? e : undefined;
}

/**
 * Take the payer's signed create transaction: verify the signature, simulate it
 * through Tatum, check the Staked event and the coin type, then execute it.
 */
export async function lockEscrowStake(stake: Stake, txB64: string, signature: string): Promise<{ payer: string; digest: string; escrowId: string }> {
  const bytes = fromBase64(txB64);
  const payer = normalizeSuiAddress(TransactionDataBuilder.fromBytes(bytes).sender ?? "");
  await verifyTransactionSignature(bytes, signature, { client: sui, address: payer });
  const sim = await sui.simulateTransaction({ transaction: bytes, include: { events: true, objectTypes: true, effects: true } });
  if (sim.$kind !== "Transaction") throw new Error("the stake transaction would fail on Sui");
  const ev = (sim.Transaction.events ?? []).map((e) => matchesStake(e, stake)).find(Boolean);
  if (!ev) throw new Error("that transaction doesn't lock this stake");
  const created = Object.entries(sim.Transaction.objectTypes ?? {}).find(([id]) => normalizeSuiAddress(id) === normalizeSuiAddress(ev.stake_id))?.[1];
  if (!created || !sameCoin(created, coinType(stake))) throw new Error("wrong coin for this stake");
  const res = await sui.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true } });
  if (res.$kind !== "Transaction") throw new Error(`the stake failed on-chain: ${res.FailedTransaction.digest}`);
  await sui.waitForTransaction({ digest: res.Transaction.digest, timeout: 30_000 }).catch(() => undefined);
  return { payer, digest: res.Transaction.digest, escrowId: normalizeSuiAddress(ev.stake_id) };
}

/** Is `stakeType` our Stake<coin>? Package ids may come back zero-padded or trimmed. */
export function sameCoin(stakeType: string, coin: string): boolean {
  const lt = stakeType.indexOf("<");
  if (lt < 0 || !stakeType.endsWith(">")) return false;
  const norm = (t: string) => {
    const [p, ...rest] = t.split("::");
    return [normalizeSuiAddress(p!), ...rest].join("::");
  };
  return norm(stakeType.slice(0, lt)) === `${pkg()}::stake::Stake` && norm(stakeType.slice(lt + 1, -1)) === norm(coin);
}

/** Anchor's verdict on an escrowed stake: the contract pays the payer (kept) or the beneficiary (missed). */
export async function releaseEscrowStake(stake: Stake, kept: boolean): Promise<string> {
  if (!anchorKey || !anchorAddress || !stake.escrowId) throw new Error("not an escrowed stake");
  const tx = new Transaction();
  tx.setSender(anchorAddress);
  tx.moveCall({ target: `${pkg()}::stake::settle`, typeArguments: [coinType(stake)], arguments: [tx.object(stake.escrowId), tx.pure.bool(kept)] });
  const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: anchorKey, include: { effects: true } });
  if (res.$kind !== "Transaction") throw new Error(`settle failed on-chain: ${res.FailedTransaction.digest}`);
  await sui.waitForTransaction({ digest: res.Transaction.digest, timeout: 30_000 }).catch(() => undefined);
  return res.Transaction.digest;
}
