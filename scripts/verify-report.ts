/**
 * Live round trip of a signed report on mainnet (no mocks):
 * sign with Anchor's Sui key → upload to Walrus via Tatum's Storage API →
 * wait for certification → download from a Walrus aggregator → verify the signature.
 * Uses a clearly labelled test report (Walrus files are public).
 *
 *   npx tsx scripts/verify-report.ts
 */
try {
  process.loadEnvFile();
} catch {}
process.env.TELEGRAM_BOT_TOKEN ||= "0000000000:verify-report";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= "verify-report-placeholder";
process.env.MEMWAL_PRIVATE_KEY ||= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ||= "0x" + "0".repeat(64);

const { anchorAddress } = await import("../src/chain/signer.js");
const { fetchReport, signReport, uploadStatus, uploadToWalrus, verifyReport } = await import("../src/chain/report.js");
const { explorerTx } = await import("../src/chain/sui.js");

if (!anchorAddress || !process.env.TATUM_API_KEY) {
  console.error("Set TATUM_API_KEY and ANCHOR_SUI_PRIVATE_KEY first.");
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const signed = await signReport({
  v: 1,
  type: "anchor.follow-through.weekly",
  issuer: anchorAddress,
  subject: { id: "anchor-verification-test" },
  week: { from: today, to: today },
  kept: 1,
  partial: 0,
  missed: 0,
  open: 0,
  followThroughPct: 100,
  promises: [{ promise: "test report from scripts/verify-report.ts", status: "kept", verifiedOnSui: false }],
  learned: { patterns: 0, wins: 0 },
  issuedAt: new Date().toISOString(),
});
console.log(`▶ signed by ${anchorAddress}`);
const job = await uploadToWalrus(`anchor-verification-${Date.now()}.json`, JSON.stringify(signed, null, 2));
console.log(`▶ uploaded via Tatum: job ${job.jobId}, blob ${job.blobId}, status ${job.status}`);

let status = job;
for (let i = 0; i < 40 && status.status !== "CERTIFIED" && status.status !== "FAILED"; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  status = await uploadStatus(job.jobId);
  console.log(`  … ${status.status}`);
}
if (status.status !== "CERTIFIED") {
  console.error(`❌ not certified: ${status.status} ${status.errorMessage ?? ""}`);
  process.exit(1);
}
for (const e of status.storageEvents ?? []) console.log(`▶ Walrus ${e.type} on Sui: ${explorerTx(e.txDigest)}`);
const back = await fetchReport(status);
if (!back) {
  console.error("❌ could not download the report from a Walrus aggregator");
  process.exit(1);
}
const v = await verifyReport(back);
console.log(v.ok ? `✅ downloaded from Walrus and the signature verifies (signer ${v.signer})` : `❌ signature check failed: ${v.reason}`);
console.log(`   ${status.downloadUrlByQuiltPatchId ?? status.downloadUrlByQuiltId}`);
process.exit(v.ok ? 0 : 1);
