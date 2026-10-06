/**
 * End-to-end check against the real Walrus Memory relayer (no mocks):
 * health → remember (wait for Walrus upload + indexing) → recall.
 *
 *   npm run verify:memwal
 */
import { MemWal } from "@mysten-incubation/memwal";

try {
  process.loadEnvFile();
} catch {}

const key = process.env.MEMWAL_PRIVATE_KEY;
const accountId = process.env.MEMWAL_ACCOUNT_ID;
const serverUrl = process.env.MEMWAL_SERVER_URL || "https://relayer.memory.walrus.xyz";
if (!key || !accountId) {
  console.error("Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in .env first (see .env.example).");
  process.exit(1);
}

const namespace = `${process.env.MEMWAL_NAMESPACE_PREFIX || "anchor:tg:"}verify`;
const memwal = MemWal.create({ key, accountId, serverUrl, namespace });

const step = (s: string) => console.log(`\n▶ ${s}`);

step(`health (${serverUrl})`);
console.log(await memwal.health());

const marker = `verify-${Date.now()}`;
const text = `[fact] ${new Date().toISOString().slice(0, 10)} | Anchor verification run ${marker}: the user's favourite study spot is the library at 7am.`;
step("rememberAndWait");
let t = Date.now();
const stored = await memwal.rememberAndWait(text);
console.log(`stored in ${Date.now() - t} ms → blob ${stored.blob_id}`);

step("recall");
t = Date.now();
const res = await memwal.recall({ query: "where does the user like to study?", limit: 5 });
console.log(`recalled ${res.results.length} in ${Date.now() - t} ms`);
for (const r of res.results) console.log(`  ${(1 - r.distance).toFixed(2)}  ${r.text}`);

const found = res.results.some((r) => r.text.includes(marker));
console.log(found ? "\n✅ Walrus Memory round trip works." : "\n❌ Stored memory was not recalled.");
process.exit(found ? 0 : 1);
