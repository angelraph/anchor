import { describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";

const { ianaZone, offsetZone } = await import("../src/timezone.js");
const { judge, parseCheck, serializeCheck, describeCheck, isFiat } = await import("../src/chain/checks.js");
const { money, toCents, isCurrency } = await import("../src/chain/prices.js");
const { settleHabit, parseRepQuick, habitsToAsk, doneIn, periodKey, describeRep } = await import("../src/habits.js");
const { buddyMessage } = await import("../src/buddies.js");
const { parse, serialize } = await import("../src/memory/types.js");

describe("per-user timezones", () => {
  it("accepts IANA names in any case", () => {
    expect(ianaZone("europe/berlin")).toBe("Europe/Berlin");
    expect(ianaZone("Africa/Lagos")).toBe("Africa/Lagos");
    expect(ianaZone("Lagos")).toBeUndefined();
  });
  it("maps UTC/GMT offsets to Etc zones (signs inverted, as IANA defines them)", () => {
    expect(offsetZone("UTC+1")).toBe("Etc/GMT-1");
    expect(offsetZone("gmt -5")).toBe("Etc/GMT+5");
    expect(offsetZone("UTC+0")).toBe("UTC");
    expect(offsetZone("UTC+20")).toBeUndefined();
  });
});

describe("promises in a currency (wallet value via Tatum prices)", () => {
  it("parses currency checks for save/hold/cap, never pay", () => {
    expect(parseCheck("save~NGN~20000")).toMatchObject({ kind: "save", coin: "NGN", amount: "20000" });
    expect(isFiat(parseCheck("hold~USD~100")!)).toBe(true);
    expect(parseCheck("pay~USD~20")).toBeUndefined();
    expect(parseCheck("save~XYZQ~5")).toBeUndefined();
    expect(isCurrency("NGN") && isCurrency("EUR") && !isCurrency("ABC1")).toBe(true);
  });

  it("judges wallet value in hundredths of the currency", () => {
    const c = { ...parseCheck("save~NGN~20000")!, base: toCents(150000).toString() };
    expect(judge(c, { balance: toCents(160000) }, false).status).toBe("pending");
    const kept = judge(c, { balance: toCents(171000) }, false);
    expect(kept.status).toBe("kept");
    expect(kept.evidence).toContain("Wallet value went from");
    expect(judge(c, { balance: toCents(160000) }, true).status).toBe("broken");
  });

  it("caps total spending across coins", () => {
    const c = { ...parseCheck("cap~USD~30")!, since: 1 };
    expect(judge(c, { spent: toCents(25) }, true).status).toBe("kept");
    expect(judge(c, { spent: toCents(31) }, false).status).toBe("broken");
  });

  it("describes currency checks and formats money", () => {
    expect(describeCheck({ kind: "hold", coin: "USD", amount: "100" })).toContain("at least $100.00");
    expect(money(2_000_000n, "NGN")).toMatch(/20,000\.00/);
    const raw = serialize({ kind: "commitment", date: "2026-10-28", id: "m9q2", due: "2026-10-31", chk: serializeCheck({ kind: "save", coin: "NGN", amount: "20000", base: "1234500" }), text: "Promised to save ₦20,000 in the wallet" });
    expect(parseCheck(parse(raw).chk!)).toMatchObject({ coin: "NGN", base: "1234500" });
  });
});

describe("habits and streaks", () => {
  const habit = (over = {}) => ({ text: "Go to the gym", per: "week" as const, times: 3, done: [] as string[], skipped: [] as string[], streak: 0, best: 0, createdAt: "2026-10-05T10:00:00Z", active: true, ...over });

  it("reads quick habit phrases", () => {
    expect(parseRepQuick("gym 3x a week")).toEqual({ text: "gym", per: "week", times: 3 });
    expect(parseRepQuick("read 20 minutes daily")).toEqual({ text: "read 20 minutes", per: "day", times: 1 });
    expect(parseRepQuick("meditate")).toBeNull();
  });

  it("weeks start Monday and count distinct days", () => {
    const h = habit({ done: ["2026-10-26", "2026-10-26", "2026-10-28", "2026-11-01"] });
    expect(periodKey("week", "2026-11-01")).toBe("2026-10-26");
    expect(doneIn(h, "2026-10-26")).toBe(3);
  });

  it("settles finished weeks into a streak, resets on a miss, never settles the current week", () => {
    const h = habit({ done: ["2026-10-06", "2026-10-07", "2026-10-09", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-21"] });
    const out = settleHabit(h, "2026-10-28"); // weeks of Oct 5, 12, 19 are finished; Oct 26 is current
    expect(out.map((s) => [s.key, s.count, s.met, s.streak])).toEqual([
      ["2026-10-05", 3, true, 1],
      ["2026-10-12", 3, true, 2],
      ["2026-10-19", 1, false, 0],
    ]);
    expect(h.best).toBe(2);
    expect(settleHabit(h, "2026-10-29")).toEqual([]); // nothing new to settle
  });

  it("asks only when not answered today and the target isn't reached", () => {
    const today = "2026-10-28";
    const habits = {
      a: habit({ done: ["2026-10-26", "2026-10-27", "2026-10-28"] }), // target hit this week
      b: habit({ done: [] }),
      c: habit({ skipped: [today] }),
      d: habit({ active: false }),
    };
    expect(habitsToAsk(habits, today).map(([id]) => id)).toEqual(["b"]);
    expect(describeRep({ per: "day", times: 1 })).toBe("every day");
  });

  it("habit records round-trip through the memory header", () => {
    const raw = serialize({ kind: "habit", date: "2026-10-28", id: "h7k2", rep: "3/week", text: "Habit: Go to the gym" });
    expect(parse(raw)).toMatchObject({ kind: "habit", id: "h7k2", rep: "3/week" });
  });
});

describe("accountability buddies", () => {
  it("tells buddies about outcomes, with or without details", () => {
    const kept = { kind: "outcome" as const, date: "2026-10-28", ref: "p1", status: "kept" as const, proof: "abc", text: "Kept the promise, verified on Sui: Angel promised to save 1 USDsui." };
    expect(buddyMessage("Angel", kept, true)).toEqual({ text: "🟢 Angel kept a promise: Angel promised to save 1 USDsui (verified on Sui)", good: true });
    expect(buddyMessage("Angel", kept, false)?.text).toBe("🟢 Angel kept a promise (verified on Sui)");
    const missed = { kind: "outcome" as const, date: "2026-10-28", ref: "p2", status: "broken" as const, text: "Did not keep the promise: Go to the gym" };
    expect(buddyMessage("Angel", missed, true)).toMatchObject({ good: false });
    expect(buddyMessage("Angel", { kind: "fact", date: "2026-10-28", text: "x" }, true)).toBeUndefined();
  });
});
