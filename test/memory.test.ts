import { describe, expect, it } from "vitest";
import { addDays, relativeDay, todayIn } from "../src/dates.js";
import {
  commitmentStates,
  effectiveDue,
  isOpen,
  memoryHash,
  mergeMemories,
  parse,
  serialize,
  type RecalledMemory,
} from "../src/memory/types.js";

const recalled = (raw: string, distance = 0.3, createdAt?: string): RecalledMemory => ({
  ...parse(raw),
  raw,
  blobId: `blob-${memoryHash(raw)}`,
  distance,
  createdAt,
});

describe("memory format", () => {
  it("round-trips a commitment", () => {
    const raw = serialize({ kind: "commitment", date: "2026-10-06", id: "k3f9", due: "2026-10-09", text: "Send 5 job applications" });
    expect(raw).toBe("[commitment] 2026-10-06 id:k3f9 due:2026-10-09 | Send 5 job applications");
    expect(parse(raw)).toEqual({ kind: "commitment", date: "2026-10-06", id: "k3f9", due: "2026-10-09", text: "Send 5 job applications" });
  });

  it("round-trips an outcome with status", () => {
    const raw = serialize({ kind: "outcome", date: "2026-10-09", ref: "k3f9", status: "broken", text: "Sent 2, got distracted" });
    expect(parse(raw)).toMatchObject({ kind: "outcome", ref: "k3f9", status: "broken", text: "Sent 2, got distracted" });
  });

  it("treats unknown text as a note instead of failing", () => {
    expect(parse("User likes jollof rice")).toEqual({ kind: "note", date: "", text: "User likes jollof rice" });
  });

  it("ignores invalid due dates and collapses whitespace", () => {
    const raw = serialize({ kind: "commitment", date: "2026-10-06", id: "a1", due: "friday", text: "  Run\n 5km " });
    expect(raw).toBe("[commitment] 2026-10-06 id:a1 | Run 5km");
  });
});

it("still parses legacy em-dash memories already stored on Walrus", () => {
  expect(parse(`[fact] 2026-10-01 ${String.fromCharCode(0x2014)} Works as a nurse`)).toMatchObject({ kind: "fact", text: "Works as a nurse" });
});

describe("commitment tracking", () => {
  const c1 = recalled("[commitment] 2026-10-01 id:aa11 due:2026-10-03 | Go to the gym 3 times");
  const c2 = recalled("[commitment] 2026-10-02 id:bb22 due:2026-10-05 | Finish the pitch deck");
  const o1 = recalled("[outcome] 2026-10-03 ref:aa11 status:moved due:2026-10-07 | Moved gym to next week", 0.3, "2026-10-03T10:00:00Z");
  const o2 = recalled("[outcome] 2026-10-05 ref:bb22 status:kept | Finished the deck", 0.3, "2026-10-05T10:00:00Z");

  it("pairs commitments with their latest outcome", () => {
    const states = commitmentStates([c1, c2, o1, o2]);
    expect(states).toHaveLength(2);
    const gym = states.find((s) => s.commitment.id === "aa11")!;
    const deck = states.find((s) => s.commitment.id === "bb22")!;
    expect(isOpen(gym)).toBe(true); // moved = still open
    expect(effectiveDue(gym)).toBe("2026-10-07");
    expect(isOpen(deck)).toBe(false);
  });

  it("uses the newest outcome when several exist", () => {
    const later = recalled("[outcome] 2026-10-07 ref:aa11 status:kept | Went 3 times", 0.3, "2026-10-07T20:00:00Z");
    const gym = commitmentStates([c1, o1, later]).find((s) => s.commitment.id === "aa11")!;
    expect(gym.outcome?.status).toBe("kept");
    expect(isOpen(gym)).toBe(false);
  });
});

describe("merge and tombstones", () => {
  it("dedupes identical text keeping the closest match", () => {
    const a = recalled("[fact] 2026-10-01 | Works as a nurse", 0.5);
    const b = recalled("[fact] 2026-10-01 | Works as a nurse", 0.2);
    const merged = mergeMemories([[a], [b]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.distance).toBe(0.2);
  });

  it("drops memories retracted by a recalled tombstone", () => {
    const secret = recalled("[fact] 2026-10-01 | Recently broke up with Ada");
    const tomb = recalled(`[retracted] 2026-10-02 ref:${memoryHash(secret.raw)} | User asked Anchor to forget: ${secret.raw}`);
    const keep = recalled("[win] 2026-10-01 | Studies best at the library at 7am");
    expect(mergeMemories([[secret, tomb, keep]]).map((m) => m.raw)).toEqual([keep.raw]);
  });

  it("drops memories retracted in the local cache", () => {
    const secret = recalled("[fact] 2026-10-01 | Owes Tunde money");
    expect(mergeMemories([[secret]], [memoryHash(secret.raw)])).toEqual([]);
  });
});

describe("dates", () => {
  it("computes today in a timezone", () => {
    // 23:30 UTC on Oct 6 is already Oct 7 in Lagos (UTC+1).
    expect(todayIn("Africa/Lagos", new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
  });
  it("describes relative days", () => {
    expect(relativeDay("2026-10-07", "2026-10-06")).toBe("tomorrow");
    expect(relativeDay(addDays("2026-10-06", -3), "2026-10-06")).toBe("3 days ago");
  });
});

describe("clock", () => {
  it("formats the local clock for prompts", async () => {
    const { clockIn } = await import("../src/dates.js");
    expect(clockIn("Africa/Lagos", new Date("2026-10-06T22:59:00Z"))).toBe("Tuesday 2026-10-06, 23:59 (Africa/Lagos)");
  });
});

describe("check-in timing", () => {
  it("round-trips a time of day", () => {
    const raw = serialize({ kind: "commitment", date: "2026-10-07", id: "cv01", due: "2026-10-07", at: "22:00", text: "Send CV to two companies" });
    expect(raw).toBe("[commitment] 2026-10-07 id:cv01 due:2026-10-07 at:22:00 | Send CV to two companies");
    expect(parse(raw)).toMatchObject({ due: "2026-10-07", at: "22:00" });
  });

  it("asks the next evening when the deadline is after check-in time", async () => {
    const { checkinDay } = await import("../src/memory/types.js");
    const late = commitmentStates([recalled("[commitment] 2026-10-07 id:cv01 due:2026-10-07 at:22:00 | Send CV")])[0]!;
    const early = commitmentStates([recalled("[commitment] 2026-10-07 id:gy01 due:2026-10-08 at:06:00 | Gym")])[0]!;
    const noTime = commitmentStates([recalled("[commitment] 2026-10-07 id:dk01 due:2026-10-09 | Deck")])[0]!;
    expect(checkinDay(late, 19)).toBe("2026-10-08");
    expect(checkinDay(early, 19)).toBe("2026-10-08");
    expect(checkinDay(noTime, 19)).toBe("2026-10-09");
  });
});

describe("duplicate detection without extra recalls", () => {
  it("treats rewordings of the same fact as duplicates", async () => {
    const { similarity } = await import("../src/memory/types.js");
    expect(similarity("The user's name is Tunde.", "User name is Tunde")).toBeGreaterThanOrEqual(0.7);
    expect(similarity("Angel codes best in the morning", "Angel prefers to code in the morning")).toBeGreaterThanOrEqual(0.5);
    expect(similarity("Tunde works as a frontend developer", "Tunde skips the gym when up late")).toBeLessThan(0.7);
  });
});

describe("asking at the right time", () => {
  it("waits until a same-day deadline time has passed", async () => {
    const { deadlinePassed } = await import("../src/memory/types.js");
    const insp = commitmentStates([recalled("[commitment] 2026-10-07 id:i7dz due:2026-10-07 at:15:00 | Site inspection")])[0]!;
    const noTime = commitmentStates([recalled("[commitment] 2026-10-07 id:ch01 due:2026-10-07 | Buy a charger")])[0]!;
    expect(deadlinePassed(insp, "2026-10-07", "12:53")).toBe(false);
    expect(deadlinePassed(insp, "2026-10-07", "15:00")).toBe(true);
    expect(deadlinePassed(insp, "2026-10-08", "09:00")).toBe(true);
    expect(deadlinePassed(noTime, "2026-10-07", "08:00")).toBe(true);
  });
});
