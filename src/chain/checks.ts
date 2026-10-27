/**
 * Promises the chain can verify.
 *
 * A money promise carries a small check in its Walrus memory header, e.g.
 *
 *   [commitment] 2026-10-27 id:k3f9 due:2026-10-31 chk:save~USDC~50~s=1761552000000~b=12500000 | Promised to save 50 USDC
 *   [commitment] 2026-10-27 id:p2x1 due:2026-10-29 chk:pay~USDC~20~n=tobi.sui~to=0x7a…~s=1761552000000 | Promised to pay Tobi back 20 USDC
 *
 * At (or before) the deadline Anchor reads the linked wallet through Tatum's
 * Sui RPC and the judge below turns that into kept / broken plus evidence.
 */
import { coinLabel, fromUnits, isCoin, toUnits, type CoinSymbol, type Transfer } from "./sui.js";

export const CHECK_KINDS = ["save", "hold", "pay", "cap"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export interface ChainCheck {
  /**
   * save: balance grows by `amount` from the baseline `base`
   * hold: balance is at least `amount` at the deadline
   * pay:  at least `amount` sent to `to` after `since`
   * cap:  at most `amount` spent (sent out) between `since` and the deadline
   */
  kind: CheckKind;
  coin: CoinSymbol;
  /** Human amount, e.g. "50" or "12.5". */
  amount: string;
  /** Recipient address (pay). */
  to?: string;
  /** What the user called the recipient ("Tobi", "tobi.sui"), for messages and later resolution. */
  toName?: string;
  /** Window start, ms since epoch (pay, cap, save). */
  since?: number;
  /** Baseline balance in base units when the promise was made (save). */
  base?: string;
}

export function serializeCheck(c: ChainCheck): string {
  const parts: string[] = [c.kind, c.coin, c.amount];
  if (c.toName) parts.push(`n=${encodeURIComponent(c.toName)}`);
  if (c.to) parts.push(`to=${c.to}`);
  if (c.since !== undefined) parts.push(`s=${c.since}`);
  if (c.base !== undefined) parts.push(`b=${c.base}`);
  return parts.join("~");
}

export function parseCheck(value: string): ChainCheck | undefined {
  const [kind, coin, amount, ...rest] = value.split("~");
  if (!kind || !(CHECK_KINDS as readonly string[]).includes(kind)) return undefined;
  if (!coin || !isCoin(coin) || !amount || !/^\d+(\.\d+)?$/.test(amount)) return undefined;
  const check: ChainCheck = { kind: kind as CheckKind, coin, amount };
  for (const part of rest) {
    const i = part.indexOf("=");
    const k = part.slice(0, i), v = part.slice(i + 1);
    if (k === "n") check.toName = safeDecode(v);
    else if (k === "to" && /^0x[0-9a-f]{64}$/.test(v)) check.to = v;
    else if (k === "s" && /^\d+$/.test(v)) check.since = Number(v);
    else if (k === "b" && /^\d+$/.test(v)) check.base = v;
  }
  return check;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Which chain data a check needs. */
export const needsBalance = (c: ChainCheck) => c.kind === "save" || c.kind === "hold";
export const needsTransfers = (c: ChainCheck) => c.kind === "pay" || c.kind === "cap";

export interface Verdict {
  /** pending: not decided yet (deadline not reached and nothing conclusive). */
  status: "kept" | "broken" | "pending";
  /** One plain sentence of evidence, shown to the user and stored in memory. */
  evidence: string;
  /** Transaction digest that proves it, when there is one. */
  digest?: string;
}

/** One-line description of what will be checked, for the confirmation message. */
export function describeCheck(c: ChainCheck): string {
  const amt = `${c.amount} ${coinLabel(c.coin)}`;
  switch (c.kind) {
    case "save":
      return `your ${coinLabel(c.coin)} balance grows by ${amt}${c.base !== undefined ? ` (from ${fromUnits(c.base, c.coin)} now)` : ""}`;
    case "hold":
      return `you hold at least ${amt} at the deadline`;
    case "pay":
      return `at least ${amt} goes to ${c.toName ?? "the recipient"}${c.to ? ` (${c.to.slice(0, 6)}…${c.to.slice(-4)})` : ""}`;
    case "cap":
      return `you send out no more than ${amt} before the deadline`;
  }
}

/**
 * Decide a check from chain data. `final` means the deadline has passed:
 * before that, only conclusive results (a payment that landed, a cap already
 * blown, savings already reached) close the promise early.
 */
export function judge(c: ChainCheck, data: { balance?: bigint; transfers?: Transfer[] }, final: boolean): Verdict {
  const target = toUnits(c.amount, c.coin);
  const fmt = (u: bigint) => `${fromUnits(u, c.coin)} ${coinLabel(c.coin)}`;
  switch (c.kind) {
    case "save": {
      if (data.balance === undefined || c.base === undefined) return { status: "pending", evidence: "No baseline balance recorded." };
      const gained = data.balance - BigInt(c.base);
      const evidence = `Balance went from ${fmt(BigInt(c.base))} to ${fmt(data.balance)} (${gained >= 0n ? "+" : ""}${fromUnits(gained, c.coin)}, needed +${c.amount}).`;
      if (gained >= target) return { status: "kept", evidence };
      return { status: final ? "broken" : "pending", evidence };
    }
    case "hold": {
      if (data.balance === undefined) return { status: "pending", evidence: "Balance unavailable." };
      const evidence = `Balance at the deadline: ${fmt(data.balance)} (needed at least ${c.amount}).`;
      if (!final) return { status: "pending", evidence };
      return { status: data.balance >= target ? "kept" : "broken", evidence };
    }
    case "pay": {
      if (!c.to) return { status: "pending", evidence: `I don't have ${c.toName ?? "the recipient"}'s Sui address yet.` };
      const hits = (data.transfers ?? []).flatMap((t) =>
        t.received.filter((r) => r.address === c.to).map((r) => ({ digest: t.digest, amount: r.amount })),
      );
      const sent = hits.reduce((n, h) => n + h.amount, 0n);
      const who = c.toName ?? `${c.to.slice(0, 6)}…`;
      if (sent >= target) {
        return { status: "kept", evidence: `Sent ${fmt(sent)} to ${who} on Sui.`, digest: hits.at(-1)?.digest };
      }
      const evidence = sent > 0n ? `Only ${fmt(sent)} of ${c.amount} ${coinLabel(c.coin)} reached ${who} so far.` : `No ${coinLabel(c.coin)} transfer to ${who} found on Sui yet.`;
      return { status: final ? "broken" : "pending", evidence, digest: hits.at(-1)?.digest };
    }
    case "cap": {
      const spent = (data.transfers ?? []).reduce((n, t) => n + (t.ownChange < 0n ? -t.ownChange : 0n), 0n);
      const evidence = `Sent out ${fmt(spent)} since the promise (cap ${c.amount} ${coinLabel(c.coin)}).`;
      if (spent > target) {
        const last = (data.transfers ?? []).filter((t) => t.ownChange < 0n).at(0);
        return { status: "broken", evidence, digest: last?.digest };
      }
      return { status: final ? "kept" : "pending", evidence };
    }
  }
}
