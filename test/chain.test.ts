import { describe, expect, it, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";

// Modules read config at import; give them harmless values so tests run anywhere.
process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";
const anchorKey = Ed25519Keypair.generate();
process.env.ANCHOR_SUI_PRIVATE_KEY = anchorKey.getSecretKey();

// The only network calls x402 makes: simulate and execute through Tatum. Everything else is real.
const simulate = vi.fn();
const execute = vi.fn();
vi.mock("../src/chain/sui.js", async (orig) => {
  const real = await orig<typeof import("../src/chain/sui.js")>();
  return {
    ...real,
    sui: {
      simulateTransaction: (...a: unknown[]) => simulate(...a),
      executeTransaction: (...a: unknown[]) => execute(...a),
      waitForTransaction: async () => undefined,
    },
  };
});

const { judge, parseCheck, serializeCheck, describeCheck } = await import("../src/chain/checks.js");
const { COINS, fromUnits, toUnits } = await import("../src/chain/sui.js");
const { parse, serialize } = await import("../src/memory/types.js");
const { paysEnough, requirements, sameRequirements, settlePayment, verifyPayment } = await import("../src/chain/x402.js");
const { canonical, signReport, verifyReport } = await import("../src/chain/report.js");
const { spendingPattern, weekOf, weeklyLearning } = await import("../src/learning.js");
const { isFinal } = await import("../src/chain/promises.js");
const { exactUnits, findExactTransfer, newProofAmount, stakeTransferAmount } = await import("../src/chain/transfers.js");

const A = normalizeSuiAddress("0xa11ce");
const TOBI = normalizeSuiAddress("0x70b1");
const usdc = (n: string) => toUnits(n, "USDC");

describe("amounts", () => {
  it("converts to and from base units with the coin's decimals", () => {
    expect(toUnits("50", "USDC")).toBe(50_000_000n);
    expect(toUnits("12.5", "USDC")).toBe(12_500_000n);
    expect(toUnits("0.000001", "USDC")).toBe(1n);
    expect(toUnits("1", "SUI")).toBe(1_000_000_000n);
    expect(fromUnits(52_100_000n, "USDC")).toBe("52.1");
    expect(fromUnits(-3_000_000n, "USDC")).toBe("-3");
  });
  it("rejects garbage", () => {
    expect(() => toUnits("abc", "USDC")).toThrow();
  });
});

describe("chain checks in the memory header", () => {
  it("round-trips through the Walrus memory format", () => {
    const chk = serializeCheck({ kind: "pay", coin: "USDC", amount: "20", toName: "Tobi B", to: TOBI, since: 1761552000000 });
    const raw = serialize({ kind: "commitment", date: "2026-10-27", id: "p2x1", due: "2026-10-29", chk, text: "Promised to pay Tobi back 20 USDC" });
    const back = parse(raw);
    expect(back.chk).toBe(chk);
    expect(parseCheck(back.chk!)).toEqual({ kind: "pay", coin: "USDC", amount: "20", toName: "Tobi B", to: TOBI, since: 1761552000000 });
    expect(back.text).toBe("Promised to pay Tobi back 20 USDC");
  });
  it("keeps the proof digest on outcomes", () => {
    const raw = serialize({ kind: "outcome", date: "2026-10-28", ref: "p2x1", status: "kept", proof: "9xQeWvG816bUx9EP", text: "Verified on Sui" });
    expect(parse(raw)).toMatchObject({ ref: "p2x1", status: "kept", proof: "9xQeWvG816bUx9EP" });
  });
  it("ignores unknown coins and kinds", () => {
    expect(parseCheck("save~DOGE~5")).toBeUndefined();
    expect(parseCheck("steal~USDC~5")).toBeUndefined();
  });
});

describe("judging a promise from chain data", () => {
  const t = (digest: string, received: Array<[string, string]>, own = "0") => ({
    digest,
    timestampMs: 1,
    received: received.map(([address, amt]) => ({ address, amount: usdc(amt) })),
    ownChange: -usdc(own),
  });

  it("save: kept once the balance grew by the amount, even before the deadline", () => {
    const c = { kind: "save" as const, coin: "USDC" as const, amount: "50", base: usdc("12.5").toString() };
    expect(judge(c, { balance: usdc("40") }, false).status).toBe("pending");
    expect(judge(c, { balance: usdc("40") }, true).status).toBe("broken");
    const v = judge(c, { balance: usdc("62.5") }, false);
    expect(v.status).toBe("kept");
    expect(v.evidence).toContain("12.5 USDC to 62.5 USDC");
  });

  it("pay: kept as soon as enough reaches the recipient, with the digest as proof", () => {
    const c = { kind: "pay" as const, coin: "USDC" as const, amount: "20", to: TOBI, toName: "Tobi" };
    expect(judge(c, { transfers: [t("d1", [[TOBI, "5"]])] }, false).status).toBe("pending");
    const v = judge(c, { transfers: [t("d2", [[TOBI, "15"]]), t("d1", [[TOBI, "5"]])] }, false);
    expect(v).toMatchObject({ status: "kept", digest: "d1" });
    expect(judge(c, { transfers: [t("d3", [[A, "50"]])] }, true).status).toBe("broken");
  });

  it("pay: waits for an address it doesn't know yet", () => {
    expect(judge({ kind: "pay", coin: "USDC", amount: "20", toName: "Tobi" }, { transfers: [] }, true).status).toBe("pending");
  });

  it("cap: broken the moment spending passes the cap, kept at the deadline otherwise", () => {
    const c = { kind: "cap" as const, coin: "USDC" as const, amount: "30" };
    expect(judge(c, { transfers: [t("a", [], "10"), t("b", [], "15")] }, false).status).toBe("pending");
    expect(judge(c, { transfers: [t("a", [], "10"), t("b", [], "15")] }, true).status).toBe("kept");
    expect(judge(c, { transfers: [t("a", [], "20"), t("b", [], "15")] }, false)).toMatchObject({ status: "broken", digest: "a" });
  });

  it("hold: only decided at the deadline", () => {
    const c = { kind: "hold" as const, coin: "SUI" as const, amount: "100" };
    expect(judge(c, { balance: toUnits("150", "SUI") }, false).status).toBe("pending");
    expect(judge(c, { balance: toUnits("150", "SUI") }, true).status).toBe("kept");
    expect(judge(c, { balance: toUnits("99", "SUI") }, true).status).toBe("broken");
  });

  it("describes what will be checked", () => {
    expect(describeCheck({ kind: "save", coin: "USDC", amount: "50", base: usdc("12.5").toString() })).toBe("your USDC balance grows by 50 USDC (from 12.5 now)");
  });

  it("a promise without a time runs to the end of its due day", () => {
    expect(isFinal({ due: "2026-10-30" }, "2026-10-30", "23:00")).toBe(false);
    expect(isFinal({ due: "2026-10-30" }, "2026-10-31", "00:01")).toBe(true);
    expect(isFinal({ due: "2026-10-30", at: "15:00" }, "2026-10-30", "15:00")).toBe(true);
  });
});

describe("x402 exact on Sui", () => {
  const payer = Ed25519Keypair.generate();
  const req = requirements({ amount: usdc("5"), asset: COINS.USDC.type, payTo: anchorKey.toSuiAddress() });

  /** A real, signed Sui transaction, built offline (explicit gas so no RPC is needed). */
  let nonce = 7;
  async function signedPayment() {
    const tx = new Transaction();
    tx.setSender(payer.toSuiAddress());
    tx.setGasPrice(1000);
    tx.setGasBudget(10_000_000);
    tx.setGasPayment([{ objectId: normalizeSuiAddress("0x99"), version: String(nonce++), digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi" }]);
    tx.transferObjects([tx.splitCoins(tx.gas, [1])[0]!], req.payTo);
    const bytes = await tx.build();
    const { signature } = await payer.signTransaction(bytes);
    return { x402Version: 2 as const, accepted: req, payload: { signature, transaction: toBase64(bytes) } };
  }
  const simOk = (amount: bigint) => ({
    $kind: "Transaction",
    Transaction: { balanceChanges: [{ coinType: COINS.USDC.type, address: req.payTo, amount: amount.toString() }] },
  });

  it("matches requirements field by field, tolerant of address padding", () => {
    expect(sameRequirements(req, { ...req, payTo: req.payTo.replace(/^0x0+/, "0x") })).toBe(true);
    expect(sameRequirements(req, { ...req, amount: "1" })).toBe(false);
    expect(paysEnough([{ coinType: COINS.USDC.type, address: req.payTo, amount: usdc("5").toString() }], req)).toBe(true);
    expect(paysEnough([{ coinType: COINS.SUI.type, address: req.payTo, amount: usdc("5").toString() }], req)).toBe(false);
  });

  it("verifies the signature, simulates, and settles once", async () => {
    const p = await signedPayment();
    simulate.mockResolvedValueOnce(simOk(usdc("5")));
    const v = await verifyPayment(p, req);
    expect(v).toMatchObject({ isValid: true, payer: payer.toSuiAddress() });
    execute.mockResolvedValueOnce({ $kind: "Transaction", Transaction: { digest: "SETTLED1" } });
    const s = await settlePayment(p, (v as { digest: string }).digest);
    expect(s).toMatchObject({ success: true, transaction: "SETTLED1", network: "sui:mainnet" });
    // The same signed payment can't buy a second thing.
    expect(await verifyPayment(p, req)).toMatchObject({ isValid: false, invalidReason: "payment_already_used" });
  });

  it("rejects underpayment, tampering and a different offer", async () => {
    const p = await signedPayment();
    simulate.mockResolvedValueOnce(simOk(usdc("4.99")));
    expect(await verifyPayment(p, req)).toMatchObject({ isValid: false, invalidReason: "insufficient_payment" });
    const other = Ed25519Keypair.generate();
    const forged = { ...p, payload: { ...p.payload, signature: (await other.signTransaction(new Uint8Array([1, 2, 3]))).signature } };
    expect(await verifyPayment(forged, req)).toMatchObject({ isValid: false, invalidReason: "invalid_signature" });
    expect(await verifyPayment({ ...p, accepted: { ...req, amount: "1" } }, req)).toMatchObject({ isValid: false, invalidReason: "requirements_mismatch" });
    simulate.mockResolvedValueOnce({ $kind: "FailedTransaction", FailedTransaction: {} });
    expect(await verifyPayment(p, req)).toMatchObject({ isValid: false, invalidReason: "simulation_failed" });
  });
});

describe("signed reports", () => {
  const report = {
    v: 1 as const,
    type: "anchor.follow-through.weekly" as const,
    issuer: anchorKey.toSuiAddress(),
    subject: { id: "anchor-abc" },
    week: { from: "2026-10-20", to: "2026-10-26" },
    kept: 3,
    partial: 1,
    missed: 1,
    open: 2,
    followThroughPct: 70,
    promises: [{ promise: "deadbeef", status: "kept", verifiedOnSui: true, proof: "9xQe" }],
    learned: { patterns: 4, wins: 2 },
    issuedAt: "2026-10-26T18:00:00.000Z",
  };

  it("canonical JSON doesn't depend on key order", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  it("is verifiable by anyone, and tampering breaks it", async () => {
    const signed = await signReport(report);
    expect(await verifyReport(signed)).toMatchObject({ ok: true, signer: anchorKey.toSuiAddress() });
    expect((await verifyReport({ ...signed, report: { ...report, kept: 9 } })).ok).toBe(false);
  });
});

describe("learning loop", () => {
  const mem = (raw: string) => ({ ...parse(raw), raw, blobId: "", distance: 0.3 });

  it("weeks start on Monday", () => {
    expect(weekOf("2026-10-26")).toBe("2026-10-26"); // Monday
    expect(weekOf("2026-11-01")).toBe("2026-10-26"); // Sunday
  });

  it("groups follow-through and what was learned by week", () => {
    const rows = weeklyLearning([
      mem("[commitment] 2026-10-06 id:a1 due:2026-10-07 | Promised to revise two chapters"),
      mem("[outcome] 2026-10-07 ref:a1 status:broken | Did not revise, phone at night"),
      mem("[pattern] 2026-10-07 | Gets distracted by the phone when studying at home"),
      mem("[commitment] 2026-10-13 id:b2 due:2026-10-14 | Promised to revise at the library"),
      mem("[outcome] 2026-10-14 ref:b2 status:kept | Revised at the library at 7am"),
      mem("[win] 2026-10-14 | Focuses best at the library at 7am"),
    ]);
    expect(rows.map((r) => [r.week, r.kept, r.closed])).toEqual([
      ["2026-10-05", 0, 1],
      ["2026-10-12", 1, 1],
    ]);
    expect(rows[1]!.learned[0]).toContain("library at 7am");
  });

  it("finds the weekday most money leaves the wallet", () => {
    const sat = Date.parse("2026-10-24T15:00:00Z"), tue = Date.parse("2026-10-20T10:00:00Z");
    const tx = (ts: number, out: string) => ({ digest: "x", timestampMs: ts, received: [], ownChange: -usdc(out) });
    const p = spendingPattern([tx(sat, "30"), tx(sat + 3_600_000, "20"), tx(tue, "10")], "USDC", "Africa/Lagos");
    expect(p).toBe("Sends out most USDC on Saturdays: 83% of 60 USDC over the last 4 weeks (verified on Sui)");
    expect(spendingPattern([tx(sat, "30")], "USDC", "Africa/Lagos")).toBeUndefined(); // one transaction isn't a pattern
  });
});

describe("proof and stakes by exact transfer", () => {
  it("proof amounts are 0.001001 to 0.001999 SUI, six decimals", () => {
    for (let i = 0; i < 200; i++) {
      const a = newProofAmount();
      expect(a > toUnits("0.001", "SUI") && a < toUnits("0.002", "SUI")).toBe(true);
      expect(a % 1_000n).toBe(0n);
    }
  });

  it("stake amounts add a 0.0001 to 0.0099 USDC tail", () => {
    const a = stakeTransferAmount("1");
    expect(a > usdc("1") && a < usdc("1.01")).toBe(true);
    expect(a % 100n).toBe(0n);
  });

  it("shows the exact amount to type", () => {
    expect(exactUnits(1_284_000n, "SUI")).toBe("0.001284");
    expect(exactUnits(1_003_700n, "USDC")).toBe("1.0037");
  });

  it("matches only the exact amount to the right address", () => {
    const tx = (digest: string, address: string, amount: bigint) => ({ digest, timestampMs: 1, received: [{ address, amount }], ownChange: -amount });
    const ts = [tx("a", A, 1_284_000n), tx("b", TOBI, 1_285_000n), tx("c", TOBI, 1_284_000n)];
    expect(findExactTransfer(ts, TOBI, 1_284_000n)?.digest).toBe("c");
    expect(findExactTransfer(ts, TOBI, 1_283_000n)).toBeUndefined();
  });
});
