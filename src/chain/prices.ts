/**
 * Wallet value in any currency, priced through Tatum's Data API
 * (GET /v4/data/rate/symbol, 165+ fiat currencies), so promises can be made
 * in the money people actually think in: "save ₦20,000 this month", "$50".
 *
 * Priced: SUI and USDC directly, USDsui at the USDC rate (it is a dollar
 * stablecoin). WAL needs a paid Tatum plan, so it is listed but not counted.
 */
import { config } from "../config.js";
import { balanceOf, sentSince, type CoinSymbol, type Transfer } from "./sui.js";

/** Coins counted in a wallet's value, and the Tatum symbol each is priced by. */
const PRICED: Array<{ coin: CoinSymbol; symbol: string }> = [
  { coin: "SUI", symbol: "SUI" },
  { coin: "USDC", symbol: "USDC" },
  { coin: "USDSUI", symbol: "USDC" }, // pegged dollar stablecoin
];
export const UNPRICED: CoinSymbol[] = ["WAL"];

const cache = new Map<string, { at: number; rate: number }>();
const TTL = 5 * 60_000;

/** One unit of `symbol` in `currency` (e.g. SUI in NGN), cached for 5 minutes. */
export async function rate(symbol: string, currency: string): Promise<number> {
  const key = `${symbol}/${currency}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rate;
  if (symbol === currency) return 1;
  const res = await fetch(`${config.TATUM_API_URL}/v4/data/rate/symbol?symbol=${encodeURIComponent(symbol)}&basePair=${encodeURIComponent(currency)}`, {
    headers: config.TATUM_API_KEY ? { "x-api-key": config.TATUM_API_KEY } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tatum rate ${symbol}/${currency}: HTTP ${res.status}`);
  const value = Number(((await res.json()) as { value?: string }).value);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Tatum rate ${symbol}/${currency}: no value`);
  cache.set(key, { at: Date.now(), rate: value });
  return value;
}

/** Fiat amounts are kept in hundredths (cents, kobo) as bigint, like coin base units. */
export const toCents = (amount: number | string) => BigInt(Math.round(Number(amount) * 100));

/** Value of `units` of a coin in hundredths of `currency`. */
export async function valueCents(coin: CoinSymbol, units: bigint, currency: string): Promise<bigint> {
  const p = PRICED.find((x) => x.coin === coin);
  if (!p) return 0n;
  const r = await rate(p.symbol, currency);
  const decimals = coin === "SUI" ? 9 : 6;
  // units / 10^decimals * rate * 100, kept in integer math with 6 extra digits of rate precision
  return (units * BigInt(Math.round(r * 1e6)) * 100n) / (10n ** BigInt(decimals) * 1_000_000n);
}

export interface WalletValue {
  currency: string;
  cents: bigint;
  parts: Array<{ coin: CoinSymbol; units: bigint; cents: bigint }>;
}

/** Total value of the priced coins in a wallet, in hundredths of `currency`. */
export async function walletValue(address: string, currency: string): Promise<WalletValue> {
  const parts = await Promise.all(
    PRICED.map(async ({ coin }) => {
      const units = await balanceOf(address, coin);
      return { coin, units, cents: units ? await valueCents(coin, units, currency) : 0n };
    }),
  );
  return { currency, cents: parts.reduce((n, p) => n + p.cents, 0n), parts };
}

/** Value of everything a wallet sent out since `sinceMs`, in hundredths of `currency` (for spending caps). */
export async function outflowCents(address: string, currency: string, sinceMs: number): Promise<{ cents: bigint; transfers: Transfer[] }> {
  let cents = 0n;
  const all: Transfer[] = [];
  for (const { coin } of PRICED) {
    const transfers = await sentSince(address, coin, sinceMs);
    for (const t of transfers) if (t.ownChange < 0n) cents += await valueCents(coin, -t.ownChange, currency);
    all.push(...transfers);
  }
  return { cents, transfers: all.sort((a, b) => b.timestampMs - a.timestampMs) };
}

/** "₦20,000.00", "$50.00", "€12.30" */
export function money(cents: bigint, currency: string): string {
  const n = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** ISO 4217 code check (three letters, and Intl knows it). */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

