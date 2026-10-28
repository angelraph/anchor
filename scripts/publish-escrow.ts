/**
 * Publish the stake escrow (move/anchor_escrow) to Sui mainnet from Anchor's
 * key, through Tatum, and make the package immutable in the same transaction
 * so its rules can never be changed (no "drain" function can ever be added).
 *
 *   sui move build --dump-bytecode-as-base64 > escrow-bytecode.json   (in move/anchor_escrow)
 *   npx tsx scripts/publish-escrow.ts escrow-bytecode.json [--dry-run]
 *
 * Prints the package id to set as ESCROW_PACKAGE_ID.
 */
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";

try {
  process.loadEnvFile();
} catch {}
process.env.TELEGRAM_BOT_TOKEN ||= "0000000000:publish-escrow";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= "publish-escrow-placeholder";
process.env.MEMWAL_PRIVATE_KEY ||= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ||= "0x" + "0".repeat(64);
const { anchorKey, anchorAddress } = await import("../src/chain/signer.js");
const { sui, explorerTx } = await import("../src/chain/sui.js");

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file || !anchorKey || !anchorAddress) {
  console.error("Usage: npx tsx scripts/publish-escrow.ts escrow-bytecode.json [--dry-run]  (needs ANCHOR_SUI_PRIVATE_KEY)");
  process.exit(1);
}
const { modules, dependencies } = JSON.parse(readFileSync(file, "utf8")) as { modules: string[]; dependencies: string[] };

const tx = new Transaction();
tx.setSender(anchorAddress);
const [cap] = tx.publish({ modules, dependencies });
tx.moveCall({ target: "0x2::package::make_immutable", arguments: [cap!] });

if (dryRun) {
  const sim = await sui.simulateTransaction({ transaction: tx, include: { effects: true } });
  const ok = sim.$kind === "Transaction";
  const gas = ok ? sim.Transaction.effects!.gasUsed : undefined;
  console.log(ok ? `dry run OK · gas ≈ ${gas ? (Number(gas.computationCost) + Number(gas.storageCost) - Number(gas.storageRebate)) / 1e9 : "?"} SUI` : "dry run FAILED");
  process.exit(ok ? 0 : 1);
}

const res = await sui.signAndExecuteTransaction({ transaction: tx, signer: anchorKey, include: { effects: true } });
if (res.$kind !== "Transaction") {
  console.error("publish failed", res.FailedTransaction.digest);
  process.exit(1);
}
await sui.waitForTransaction({ digest: res.Transaction.digest, timeout: 60_000 }).catch(() => undefined);
const pkg = res.Transaction.effects!.changedObjects.find((o) => o.outputState === "PackageWrite")?.objectId;
console.log(`published: ${explorerTx(res.Transaction.digest)}`);
console.log(`ESCROW_PACKAGE_ID=${pkg}`);
process.exit(0);
