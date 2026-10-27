/**
 * x402 v2, scheme "exact" on Sui (specs/schemes/exact/scheme_exact_sui.md).
 *
 * Anchor is its own resource server and facilitator: it answers 402 with
 * PAYMENT-REQUIRED, takes the payer's signed transaction from
 * PAYMENT-SIGNATURE, verifies it (network, signature, simulation through
 * Tatum's Sui RPC, balance change to Anchor), executes it through Tatum, and
 * returns PAYMENT-RESPONSE with the transaction digest.
 *
 * Two things are paid this way:
 *  - stakes on promises (a person pays from their wallet on the stake page),
 *  - agent reads of a public follow-through record (machine-to-machine).
 */
import { coinWithBalance, Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { SUI_NETWORK, sui } from "./sui.js";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Base units, as a string. */
  amount: string;
  /** Coin type. */
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface Resource {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: Resource;
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: 2;
  resource?: Resource;
  accepted: PaymentRequirements;
  payload: { signature: string; transaction: string };
}

export interface SettlementResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
  errorReason?: string;
}

export const encodeHeader = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64");
export function decodeHeader<T>(v: string): T {
  return JSON.parse(Buffer.from(v, "base64").toString("utf8")) as T;
}

export function requirements(opts: { amount: bigint; asset: string; payTo: string; timeoutSeconds?: number }): PaymentRequirements {
  return {
    scheme: "exact",
    network: SUI_NETWORK,
    amount: opts.amount.toString(),
    asset: opts.asset,
    payTo: normalizeSuiAddress(opts.payTo),
    maxTimeoutSeconds: opts.timeoutSeconds ?? 120,
  };
}

/** Same requirement, field by field (the payload echoes what it accepted). */
export function sameRequirements(a: PaymentRequirements, b: PaymentRequirements): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.amount === b.amount &&
    sameType(a.asset, b.asset) &&
    normalizeSuiAddress(a.payTo) === normalizeSuiAddress(b.payTo)
  );
}

function sameType(a: string, b: string): boolean {
  const n = (t: string) => {
    const [pkg, ...rest] = t.split("::");
    return [normalizeSuiAddress(pkg!), ...rest].join("::");
  };
  return n(a) === n(b);
}

/** Did the simulated balance changes pay at least `amount` of `asset` to `payTo`? */
export function paysEnough(changes: Array<{ coinType: string; address: string; amount: string }>, req: PaymentRequirements): boolean {
  const to = normalizeSuiAddress(req.payTo);
  const received = changes
    .filter((c) => normalizeSuiAddress(c.address) === to && sameType(c.coinType, req.asset))
    .reduce((n, c) => n + BigInt(c.amount), 0n);
  return received >= BigInt(req.amount);
}

export type VerifyResult = { isValid: true; payer: string; digest: string } | { isValid: false; invalidReason: string; payer?: string };

/** Digests already settled (or being settled) by this server: a payment is accepted once. */
const seen = new Set<string>();

export async function verifyPayment(p: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
  if (p?.x402Version !== 2) return { isValid: false, invalidReason: "unsupported_x402_version" };
  if (!p.accepted || !sameRequirements(p.accepted, req)) return { isValid: false, invalidReason: "requirements_mismatch" };
  if (req.network !== SUI_NETWORK) return { isValid: false, invalidReason: "invalid_network" };
  let bytes: Uint8Array;
  let sender: string;
  try {
    bytes = fromBase64(p.payload.transaction);
    sender = normalizeSuiAddress(TransactionDataBuilder.fromBytes(bytes).sender ?? "");
  } catch {
    return { isValid: false, invalidReason: "invalid_transaction" };
  }
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  if (seen.has(digest)) return { isValid: false, invalidReason: "payment_already_used", payer: sender };
  try {
    await verifyTransactionSignature(bytes, p.payload.signature, { client: sui, address: sender });
  } catch {
    return { isValid: false, invalidReason: "invalid_signature", payer: sender };
  }
  const sim = await sui.simulateTransaction({ transaction: bytes, include: { balanceChanges: true, effects: true } });
  if (sim.$kind !== "Transaction") return { isValid: false, invalidReason: "simulation_failed", payer: sender };
  if (!paysEnough(sim.Transaction.balanceChanges ?? [], req)) return { isValid: false, invalidReason: "insufficient_payment", payer: sender };
  return { isValid: true, payer: sender, digest };
}

/** Execute the verified payment on Sui (through Tatum) and wait for it to land. */
export async function settlePayment(p: PaymentPayload, digest: string): Promise<SettlementResponse> {
  seen.add(digest);
  const bytes = fromBase64(p.payload.transaction);
  const payer = normalizeSuiAddress(TransactionDataBuilder.fromBytes(bytes).sender ?? "");
  try {
    const res = await sui.executeTransaction({ transaction: bytes, signatures: [p.payload.signature], include: { effects: true } });
    if (res.$kind !== "Transaction") {
      return { success: false, transaction: res.FailedTransaction.digest, network: SUI_NETWORK, payer, errorReason: "execution_failed" };
    }
    await sui.waitForTransaction({ digest: res.Transaction.digest, timeout: 30_000 }).catch(() => undefined);
    return { success: true, transaction: res.Transaction.digest, network: SUI_NETWORK, payer };
  } catch (err) {
    seen.delete(digest); // nothing landed; the payer may retry with the same transaction
    return { success: false, transaction: "", network: SUI_NETWORK, payer, errorReason: err instanceof Error ? err.message.slice(0, 120) : "settle_failed" };
  }
}

/**
 * Build the unsigned payment transaction for a payer: the "query an RPC for
 * your coins" step of the spec, done server-side so the browser needs no
 * RPC access. The payer's wallet still signs it, and verification checks the
 * result like any other payment.
 */
export async function buildPaymentTransaction(sender: string, req: PaymentRequirements): Promise<string> {
  const tx = new Transaction();
  tx.setSender(normalizeSuiAddress(sender));
  tx.transferObjects([coinWithBalance({ type: req.asset, balance: BigInt(req.amount) })], req.payTo);
  return toBase64(await tx.build({ client: sui }));
}
