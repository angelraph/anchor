/**
 * Sui mainnet access through Tatum's RPC gateway.
 *
 * Sui's public JSON-RPC is deprecated; Tatum's gateway serves Sui mainnet over
 * GraphQL (https://sui-mainnet.gateway.tatum.io/graphql). Every on-chain read
 * and write Anchor makes (balances, transfers, SuiNS names, x402 payment
 * simulation and settlement) goes through this one client.
 */
import type { SuiClientTypes } from "@mysten/sui/client";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { normalizeSuiAddress, isValidSuiAddress } from "@mysten/sui/utils";
import { config } from "../config.js";

/** Tatum plans have a per-second limit (5 rps on the free plan): back off on 429 instead of failing. */
async function politeFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= 4) return res;
    const wait = Number(res.headers.get("retry-after")) * 1000 || (config.TATUM_API_KEY ? 400 * 2 ** attempt : 61_000);
    // Keyless access is 5 requests per minute: waiting out the window beats failing.
    await new Promise((r) => setTimeout(r, Math.min(wait, config.TATUM_API_KEY ? 8_000 : 61_000)));
  }
}

/**
 * Tatum's Sui nodes are pruned, so the genesis checkpoint the SDK reads for
 * getChainIdentifier() comes back empty. Ask the gateway for the identifier
 * directly instead (same answer, from the same Tatum endpoint).
 */
const tatumFetch: typeof fetch = async (input, init) => {
  const body = typeof init?.body === "string" ? init.body : "";
  if (!body.includes("getChainIdentifier")) return politeFetch(input, init);
  const res = await politeFetch(input, { ...init, body: JSON.stringify({ query: "{ chainIdentifier }" }) });
  const json = (await res.json()) as { data?: { chainIdentifier?: string }; errors?: unknown };
  return new Response(JSON.stringify({ data: { checkpoint: { digest: json.data?.chainIdentifier ?? null } }, errors: json.errors }), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
};

export const sui = new SuiGraphQLClient({
  url: config.TATUM_SUI_GRAPHQL_URL,
  network: "mainnet",
  headers: config.TATUM_API_KEY ? { "x-api-key": config.TATUM_API_KEY } : undefined,
  fetch: tatumFetch,
});

export const SUI_NETWORK = "sui:mainnet";

/** Coins Anchor understands in promises. Decimals are fixed on-chain metadata. */
export const COINS = {
  SUI: { type: "0x2::sui::SUI", decimals: 9 },
  USDC: { type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", decimals: 6 },
  WAL: { type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL", decimals: 9 },
} as const;

export type CoinSymbol = keyof typeof COINS;

export function isCoin(s: string): s is CoinSymbol {
  return Object.hasOwn(COINS, s);
}

/** "50" or "12.5" → base units (bigint), using the coin's decimals. */
export function toUnits(amount: number | string, coin: CoinSymbol): bigint {
  const [whole, frac = ""] = String(amount).trim().split(".");
  const d = COINS[coin].decimals;
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac)) throw new Error(`bad amount: ${amount}`);
  return BigInt(whole || "0") * 10n ** BigInt(d) + BigInt((frac + "0".repeat(d)).slice(0, d) || "0");
}

/** Base units → human number string, trimmed ("52.1"). */
export function fromUnits(units: bigint | string, coin: CoinSymbol): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const d = BigInt(COINS[coin].decimals);
  const whole = abs / 10n ** d;
  const frac = (abs % 10n ** d).toString().padStart(Number(d), "0").replace(/0+$/, "").slice(0, 4);
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const explorerTx = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`;
export const explorerAddr = (address: string) => `https://suiscan.xyz/mainnet/account/${address}`;

/**
 * Turn what a user typed into a Sui address: a 0x address, or a SuiNS name
 * ("tobi.sui" or "@tobi"), resolved on-chain through Tatum.
 */
export async function resolveRecipient(input: string): Promise<{ address: string; name?: string } | undefined> {
  const s = input.trim();
  if (/^0x[0-9a-fA-F]{1,64}$/.test(s)) {
    const address = normalizeSuiAddress(s);
    return isValidSuiAddress(address) ? { address } : undefined;
  }
  const name = s.startsWith("@") ? `${s.slice(1)}.sui` : s.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.sui$/.test(name)) return undefined;
  const res = await sui.resolveNameServiceAddress({ name });
  return res.address ? { address: normalizeSuiAddress(res.address), name } : undefined;
}

/** Current balance of one coin, in base units. */
export async function balanceOf(owner: string, coin: CoinSymbol): Promise<bigint> {
  const { balance } = await sui.getBalance({ owner, coinType: COINS[coin].type });
  return BigInt(balance.balance);
}

export interface Transfer {
  digest: string;
  timestampMs: number;
  /** Positive amounts other addresses received from this transaction, by address. */
  received: Array<{ address: string; amount: bigint }>;
  /** How much the sender's own balance of the coin changed (negative = spent). */
  ownChange: bigint;
}

/**
 * Transactions sent by `owner` since `sinceMs`, with how much of `coin` moved.
 * Pages newest-first and stops at the window start, so cost stays small.
 */
export async function sentSince(owner: string, coin: CoinSymbol, sinceMs: number, maxPages = 4): Promise<Transfer[]> {
  const type = COINS[coin].type;
  const out: Transfer[] = [];
  let before: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res: SuiClientTypes.ListTransactionsResponse<{ balanceChanges: true }> = await sui.listTransactions({
      filter: { sender: owner },
      limit: 50,
      order: "descending",
      ...(before ? { before } : {}),
      include: { balanceChanges: true },
    });
    let older = false;
    for (const r of res.transactions) {
      const tx = r.Transaction ?? r.FailedTransaction;
      if (!tx || r.$kind !== "Transaction") continue;
      const ts = tx.timestampMs ?? Date.now();
      if (ts < sinceMs) {
        older = true;
        break;
      }
      const changes = (tx.balanceChanges ?? []).filter((c) => c.coinType === type || normType(c.coinType) === normType(type));
      const own = normalizeSuiAddress(owner);
      out.push({
        digest: tx.digest,
        timestampMs: ts,
        received: changes
          .filter((c) => normalizeSuiAddress(c.address) !== own && BigInt(c.amount) > 0n)
          .map((c) => ({ address: normalizeSuiAddress(c.address), amount: BigInt(c.amount) })),
        ownChange: changes.filter((c) => normalizeSuiAddress(c.address) === own).reduce((n, c) => n + BigInt(c.amount), 0n),
      });
    }
    if (older || !res.hasNextPage) break;
    before = res.endCursor;
    if (!before) break;
  }
  return out;
}

/** Coin types come back with or without leading zeros in the package id. */
function normType(t: string): string {
  const [pkg, ...rest] = t.split("::");
  return [normalizeSuiAddress(pkg!), ...rest].join("::");
}

/** Cheap liveness check for /health and the verify script. */
export async function chainHealth(): Promise<{ ok: boolean; chain?: string; error?: string }> {
  try {
    const { chainIdentifier } = await sui.getChainIdentifier();
    return { ok: true, chain: chainIdentifier };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
