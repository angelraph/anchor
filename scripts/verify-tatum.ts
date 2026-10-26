/**
 * Live check of everything Anchor does through Tatum (no mocks):
 * Sui chain id, SuiNS resolution, balances, transfer history and coin
 * decimals over Tatum's Sui GraphQL gateway, plus the Walrus Storage API.
 *
 *   npx tsx scripts/verify-tatum.ts [address-or-name.sui]
 */
try {
  process.loadEnvFile();
} catch {}
// Only the Sui and Tatum settings are needed here.
process.env.TELEGRAM_BOT_TOKEN ||= "0000000000:verify-tatum";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= "verify-tatum-placeholder";
process.env.MEMWAL_PRIVATE_KEY ||= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ||= "0x" + "0".repeat(64);

const { config } = await import("../src/config.js");
const { COINS, balanceOf, fromUnits, resolveRecipient, sentSince, sui } = await import("../src/chain/sui.js");

const step = (s: string) => console.log(`\n▶ ${s}`);
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) failures++;
};

step(`Tatum Sui gateway: ${config.TATUM_SUI_GRAPHQL_URL} (${config.TATUM_API_KEY ? "with API key" : "NO API KEY"})`);
const { chainIdentifier } = await sui.getChainIdentifier();
check(chainIdentifier === "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S", `chain identifier ${chainIdentifier} is Sui mainnet`);

step("coin decimals match Anchor's table");
for (const [symbol, coin] of Object.entries(COINS)) {
  const { coinMetadata } = await sui.getCoinMetadata({ coinType: coin.type });
  check(coinMetadata?.decimals === coin.decimals, `${symbol}: ${coinMetadata?.symbol} decimals ${coinMetadata?.decimals}`);
}

const who = process.argv[2] ?? "walrus.sui";
step(`resolve ${who}`);
const r = await resolveRecipient(who);
check(!!r, r ? `${who} → ${r.address}` : `${who} did not resolve`);

if (r) {
  step("balances");
  for (const symbol of Object.keys(COINS) as Array<keyof typeof COINS>) {
    console.log(`   ${symbol}: ${fromUnits(await balanceOf(r.address, symbol), symbol)}`);
  }
  step("transfers sent in the last 30 days (SUI)");
  const t = await sentSince(r.address, "SUI", Date.now() - 30 * 86_400_000, 1);
  console.log(`   ${t.length} transactions${t[0] ? `, latest ${t[0].digest} (${new Date(t[0].timestampMs).toISOString()})` : ""}`);
}

step(`Tatum Walrus Storage API: ${config.TATUM_API_URL}/v4/data/storage/uploads`);
if (!config.TATUM_API_KEY) {
  console.log("   skipped: set TATUM_API_KEY to check it");
} else {
  const res = await fetch(`${config.TATUM_API_URL}/v4/data/storage/uploads?limit=1`, { headers: { "x-api-key": config.TATUM_API_KEY } });
  check(res.ok, `HTTP ${res.status}`);
}

console.log(failures ? `\n❌ ${failures} check(s) failed.` : "\n✅ Tatum Sui RPC works for everything Anchor needs.");
process.exit(failures ? 1 : 0);
