import { describe, expect, it } from "vitest";

// reminders.ts reads config at import; give it harmless values so tests run anywhere.
process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";

const { dueNow, weekStats, formatWeek } = await import("../src/reminders.js");
const { commitmentStates, memoryHash, parse } = await import("../src/memory/types.js");

const mem = (raw: string) => ({ ...parse(raw), raw, blobId: `b-${memoryHash(raw)}`, distance: 0.3 });

describe("exact-time deadline reminders", () => {
  const timed = {
    insp: { text: "Site inspection", due: "2026-10-09", at: "15:00" },
    read: { text: "Read 15 minutes", due: "2026-10-10", at: "08:00" },
  };

  it("fires once the deadline time is reached, not before", () => {
    expect(dueNow(timed, "2026-10-09", "14:59", {}, {})).toHaveLength(0);
    expect(dueNow(timed, "2026-10-09", "15:00", {}, {}).map(([id]) => id)).toEqual(["insp"]);
  });

  it("never fires twice the same day, or for a promise already answered", () => {
    expect(dueNow(timed, "2026-10-09", "16:00", { insp: "2026-10-09" }, {})).toHaveLength(0);
    expect(dueNow(timed, "2026-10-09", "16:00", {}, { insp: "kept" })).toHaveLength(0);
  });

  it("waits for the right day", () => {
    expect(dueNow(timed, "2026-10-10", "08:00", {}, {}).map(([id]) => id)).toEqual(["read"]);
  });
});

describe("weekly follow-through summary", () => {
  const states = commitmentStates([
    mem("[commitment] 2026-10-05 id:a1 due:2026-10-06 | Send CV to two companies"),
    mem("[outcome] 2026-10-06 ref:a1 status:kept | Kept the promise"),
    mem("[commitment] 2026-10-06 id:b2 due:2026-10-07 | Go to the gym"),
    mem("[outcome] 2026-10-07 ref:b2 status:broken | Skipped, stayed up late"),
    mem("[commitment] 2026-09-20 id:c3 due:2026-09-21 | Old promise"),
    mem("[outcome] 2026-09-21 ref:c3 status:kept | Kept long ago"),
    mem("[commitment] 2026-10-08 id:d4 due:2026-10-11 | Finish the article"),
  ]);

  it("counts only outcomes from the last 7 days", () => {
    const w = weekStats(states, "2026-10-09");
    expect(w.kept).toHaveLength(1);
    expect(w.broken).toHaveLength(1);
    expect(w.open.map((s) => s.commitment.id)).toEqual(["d4"]);
  });

  it("reports follow-through and what is still open", () => {
    const text = formatWeek(weekStats(states, "2026-10-09"), "2026-10-09");
    expect(text).toContain("Kept 1");
    expect(text).toContain("Missed 1");
    expect(text).toContain("Follow-through: 50%");
    expect(text).toContain("Finish the article");
  });
});
