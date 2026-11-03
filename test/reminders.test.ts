import { describe, expect, it } from "vitest";

// reminders.ts reads config at import; give it harmless values so tests run anywhere.
process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";

const { deadlineMessage, dueNow, headsUpAt, headsUpGroup, headsUpNow, headsUpText, minutesLeft, weekStats, formatWeek } = await import("../src/reminders.js");
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

describe("what a heads-up and a deadline say", () => {
  const a = { text: "Promised to drink beer by 18:04", due: "2026-11-02", at: "18:04" };
  const b = { text: "Promised to walk out by 18:04", due: "2026-11-02", at: "18:04" };

  it("counts the time really left, across midnight too", () => {
    expect(minutesLeft(a, "2026-11-02", "18:03")).toBe(1);
    expect(minutesLeft({ ...a, at: "00:10" }, "2026-11-01", "23:50")).toBe(20);
    expect(headsUpText("a1", a, 20)).toMatch(/^⏳ 20 minutes left/);
    expect(headsUpText("a1", a, 1)).toMatch(/^⏳ 1 minute left/);
  });

  it("puts several heads-ups in one message, each with its own time", () => {
    const text = headsUpGroup([["a1", a], ["b2", { ...b, at: "18:20" }]], "2026-11-02", "18:00");
    expect(text).toMatch(/#a1 .*4 minutes left/);
    expect(text).toMatch(/#b2 .*20 minutes left/);
  });

  it("asks about promises due together in one message", () => {
    const one = deadlineMessage([["a1", a], ["b2", b]]);
    expect(one.text).toMatch(/1\. Promised to drink beer[\s\S]*2\. Promised to walk out/);
    expect(one.keyboard.inline_keyboard).toHaveLength(2);
    expect(deadlineMessage([["a1", a]]).text).toMatch(/^⏰ It's 18:04, deadline time/);
  });
});

describe("30-minute heads-up", () => {
  const timed = { insp: { text: "Site inspection", due: "2026-10-09", at: "15:00" } };

  it("is due 30 minutes before the deadline", () => {
    expect(headsUpAt(timed.insp)).toEqual(["2026-10-09", "14:30"]);
    expect(headsUpNow(timed, "2026-10-09", "14:29", {}, {})).toHaveLength(0);
    expect(headsUpNow(timed, "2026-10-09", "14:30", {}, {}).map(([id]) => id)).toEqual(["insp"]);
  });

  it("is sent once, never after the deadline, never for answered promises", () => {
    expect(headsUpNow(timed, "2026-10-09", "14:40", { insp: "2026-10-09" }, {})).toHaveLength(0);
    expect(headsUpNow(timed, "2026-10-09", "15:00", {}, {})).toHaveLength(0);
    expect(headsUpNow(timed, "2026-10-09", "14:45", {}, { insp: "kept" })).toHaveLength(0);
  });

  it("goes out the evening before for a deadline just after midnight", () => {
    const late = { night: { text: "Submit", due: "2026-10-10", at: "00:15" } };
    expect(headsUpAt(late.night)).toEqual(["2026-10-09", "23:45"]);
    expect(headsUpNow(late, "2026-10-09", "23:45", {}, {}).map(([id]) => id)).toEqual(["night"]);
    expect(headsUpNow(late, "2026-10-10", "00:05", {}, {}).map(([id]) => id)).toEqual(["night"]);
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
