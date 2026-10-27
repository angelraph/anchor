/**
 * An AI agent buying a person's signed follow-through record from Anchor,
 * paying per request with x402 (scheme "exact") in USDC on Sui mainnet.
 *
 *   AGENT_SUI_PRIVATE_KEY=suiprivkey1… npx tsx scripts/agent-pay.ts https://<anchor>/x402/record/<suiAddress>
 *
 * Flow: GET → 402 + PAYMENT-REQUIRED → build and sign a USDC transfer (coins
 * read through Tatum's Sui RPC) → GET again with PAYMENT-SIGNATURE → 200 with
 * the record and PAYMENT-RESPONSE (the settled Sui transaction).
 * Spends real USDC (the price in the 402, 0.01 USDC by default) from the agent's key.
 */
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";

try {
  process.loadEnvFile();
} catch {}
process.env.TELEGRAM_BOT_TOKEN ||= "0000000000:agent-pay";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= "agent-pay-placeholder";
process.env.MEMWAL_PRIVATE_KEY ||= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ||= "0x" + "0".repeat(64);
const { sui, explorerTx } = await import("../src/chain/sui.js");

const url = process.argv[2];
const key = process.env.AGENT_SUI_PRIVATE_KEY;
if (!url || !key) {
  console.error("Usage: AGENT_SUI_PRIVATE_KEY=suiprivkey1… npx tsx scripts/agent-pay.ts <record url>");
  process.exit(1);
}
const agent = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const dec = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

console.log(`agent ${agent.toSuiAddress()}\n▶ GET ${url}`);
const first = await fetch(url);
if (first.status !== 402) {
  console.log(first.status, await first.text());
  process.exit(first.ok ? 0 : 1);
}
const required = dec(first.headers.get("PAYMENT-REQUIRED")!);
const accepted = required.accepts.find((a: { scheme: string; network: string }) => a.scheme === "exact" && a.network === "sui:mainnet");
console.log(`◀ 402: pay ${accepted.amount} of ${accepted.asset.split("::").pop()} to ${accepted.payTo} (${required.resource.description})`);

const tx = new Transaction();
tx.setSender(agent.toSuiAddress());
tx.transferObjects([coinWithBalance({ type: accepted.asset, balance: BigInt(accepted.amount) })], accepted.payTo);
const bytes = await tx.build({ client: sui });
const { signature } = await agent.signTransaction(bytes);

console.log("▶ GET with PAYMENT-SIGNATURE");
const paid = await fetch(url, {
  headers: { "PAYMENT-SIGNATURE": enc({ x402Version: 2, resource: required.resource, accepted, payload: { signature, transaction: toBase64(bytes) } }) },
});
const body = await paid.json();
if (!paid.ok) {
  console.error(`◀ ${paid.status}`, body);
  process.exit(1);
}
const receipt = dec(paid.headers.get("PAYMENT-RESPONSE")!);
console.log(`◀ 200, settled on Sui: ${explorerTx(receipt.transaction)}`);
const r = body.record.report;
console.log(`record for ${body.address}: kept ${r.kept}, partly ${r.partial}, missed ${r.missed}, follow-through ${r.followThroughPct ?? "n/a"}%, signed by ${r.issuer}`);
