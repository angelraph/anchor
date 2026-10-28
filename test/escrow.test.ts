import { describe, expect, it } from "vitest";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";
process.env.ANCHOR_SUI_PRIVATE_KEY = Ed25519Keypair.generate().getSecretKey();
process.env.TIMEZONE = "Africa/Lagos";

const { zonedEpochMs, deadlineMs, matchesStake, promiseHash, sameCoin } = await import("../src/chain/escrow.js");
const { anchorAddress } = await import("../src/chain/signer.js");
const { config } = await import("../src/config.js");
type Stake = import("../src/state.js").Stake;

const PKG = config.ESCROW_PACKAGE_ID;
const FRIEND = "0x" + "b".repeat(64);
const USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

const stake: Stake = {
  token: "tok123",
  userId: "nobody-in-state",
  commitmentId: "k3f9",
  text: "save 5 USDC",
  due: "2026-11-02",
  at: "18:00",
  amount: "5",
  forfeitTo: FRIEND,
  status: "awaiting_payment",
  createdAt: "2026-10-28T00:00:00Z",
};

const Staked = bcs.struct("Staked", {
  stake_id: bcs.Address,
  payer: bcs.Address,
  beneficiary: bcs.Address,
  arbiter: bcs.Address,
  amount: bcs.u64(),
  deadline_ms: bcs.u64(),
  promise: bcs.vector(bcs.u8()),
});
const event = (over: Partial<Parameters<typeof Staked.serialize>[0]> = {}, packageId = PKG) => ({
  packageId,
  eventType: `${PKG}::stake::Staked`,
  bcs: Staked.serialize({
    stake_id: "0x" + "1".repeat(64),
    payer: "0x" + "a".repeat(64),
    beneficiary: FRIEND,
    arbiter: anchorAddress!,
    amount: 5_000_000n,
    deadline_ms: BigInt(deadlineMs(stake)),
    promise: [...promiseHash(stake.token)],
    ...over,
  }).toBytes(),
});

describe("escrow deadlines", () => {
  it("turns a local wall-clock time into epoch ms in that zone", () => {
    expect(zonedEpochMs("2026-11-02", "18:00", "Africa/Lagos")).toBe(Date.parse("2026-11-02T17:00:00Z"));
    expect(zonedEpochMs("2026-07-01", "09:30", "America/New_York")).toBe(Date.parse("2026-07-01T13:30:00Z"));
    expect(zonedEpochMs("2026-01-15", "23:59", "UTC")).toBe(Date.parse("2026-01-15T23:59:00Z"));
  });
  it("uses the promise's time, or the end of its day, in the person's zone", () => {
    expect(deadlineMs(stake)).toBe(Date.parse("2026-11-02T17:00:00Z"));
    expect(deadlineMs({ ...stake, at: undefined })).toBe(Date.parse("2026-11-02T22:59:00Z"));
  });
});

describe("escrow lock check", () => {
  it("accepts the Staked event that locks exactly this stake", () => {
    expect(matchesStake(event(), stake)).toBeTruthy();
  });
  it("rejects anything that differs from the stake", () => {
    expect(matchesStake(event({ amount: 4_999_999n }), stake)).toBeUndefined();
    expect(matchesStake(event({ beneficiary: "0x" + "c".repeat(64) }), stake)).toBeUndefined();
    expect(matchesStake(event({ arbiter: "0x" + "d".repeat(64) }), stake)).toBeUndefined();
    expect(matchesStake(event({ deadline_ms: BigInt(deadlineMs(stake) + 1) }), stake)).toBeUndefined();
    expect(matchesStake(event({ promise: [...promiseHash("another")] }), stake)).toBeUndefined();
    expect(matchesStake(event({}, "0x" + "e".repeat(64)), stake)).toBeUndefined();
  });
  it("checks the Stake object is ours and holds the stake's coin", () => {
    expect(sameCoin(`${PKG}::stake::Stake<${USDC}>`, USDC)).toBe(true);
    expect(sameCoin(`${PKG}::stake::Stake<0x2::sui::SUI>`, USDC)).toBe(false);
    expect(sameCoin(`0x${"e".repeat(64)}::stake::Stake<${USDC}>`, USDC)).toBe(false);
  });
});
