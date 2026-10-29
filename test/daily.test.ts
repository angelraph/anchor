import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";

const { verifyInitData, rateLimit } = await import("../src/web/guard.js");
const { seal, open, sealText, openText } = await import("../src/secrets.js");
const { summarize } = await import("../src/web/app-routes.js");
const { boardLines, groupPromiseDue } = await import("../src/groups.js");
const { weekScore } = await import("../src/morning.js");
const { serialize, parse } = await import("../src/memory/types.js");
const { buddyMessage } = await import("../src/buddies.js");
const { looksLikeKey, looksLikeAccount } = await import("../src/memory/own.js");
const { cardPage } = await import("../src/web/app-page.js");

const TOKEN = "123456:ABC-test-bot-token";

/** Build initData exactly as Telegram signs it. */
function signed(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const now = Date.parse("2026-10-29T10:00:00Z");
const fresh = { auth_date: String(now / 1000 - 60), query_id: "AAE", user: JSON.stringify({ id: 4242, first_name: "Tunde" }) };

describe("mini app sign-in (Telegram initData)", () => {
  it("accepts data signed with the bot token", () => {
    expect(verifyInitData(signed(fresh), TOKEN, { now })).toEqual({ id: 4242, firstName: "Tunde" });
  });
  it("rejects a wrong bot token, a changed user and a missing hash", () => {
    expect(verifyInitData(signed(fresh, "999:other"), TOKEN, { now })).toBeUndefined();
    const tampered = signed(fresh).replace(encodeURIComponent('"id":4242'), encodeURIComponent('"id":1'));
    expect(verifyInitData(tampered, TOKEN, { now })).toBeUndefined();
    expect(verifyInitData(new URLSearchParams(fresh).toString(), TOKEN, { now })).toBeUndefined();
    expect(verifyInitData("", TOKEN, { now })).toBeUndefined();
  });
  it("rejects old sign-ins (replay) and ones from the future", () => {
    expect(verifyInitData(signed({ ...fresh, auth_date: String(now / 1000 - 2 * 86_400) }), TOKEN, { now })).toBeUndefined();
    expect(verifyInitData(signed({ ...fresh, auth_date: String(now / 1000 + 3600) }), TOKEN, { now })).toBeUndefined();
  });
  it("rejects a signed payload whose user id isn't a number", () => {
    expect(verifyInitData(signed({ ...fresh, user: JSON.stringify({ id: "4242" }) }), TOKEN, { now })).toBeUndefined();
  });
});

describe("encryption at rest", () => {
  it("round-trips, and one person's key never opens another's data", () => {
    const box = seal("proof", "1", Buffer.from("photo bytes"));
    expect(open("proof", "1", box).toString()).toBe("photo bytes");
    expect(() => open("proof", "2", box)).toThrow();
    expect(() => open("memwal-key", "1", box)).toThrow();
    expect(openText("memwal-key", "7", sealText("memwal-key", "7", "secret"))).toBe("secret");
  });
  it("detects tampering", () => {
    const box = seal("proof", "1", Buffer.from("photo bytes"));
    box.writeUInt8(box.readUInt8(box.length - 1) ^ 1, box.length - 1);
    expect(() => open("proof", "1", box)).toThrow();
  });
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then refuses until it resets", () => {
    const k = `t:${Math.random()}`;
    expect([1, 2, 3].map(() => rateLimit(k, 2, 1000, 0))).toEqual([true, true, false]);
    expect(rateLimit(k, 2, 1000, 1000)).toBe(true);
  });
});

describe("own memory input checks", () => {
  it("knows a delegate key and an account id when it sees one", () => {
    expect(looksLikeKey("a".repeat(64))).toBe(true);
    expect(looksLikeKey("0x" + "b".repeat(64))).toBe(true);
    expect(looksLikeKey("hello")).toBe(false);
    expect(looksLikeAccount("0xf4d14b5c77619e999d5f3c830edaf03857155861b5e91b91ea04e89e524fa4b7")).toBe(true);
    expect(looksLikeAccount("f4d1")).toBe(false);
  });
});

const c = (id: string, date: string, status?: "kept" | "broken" | "partial") => ({
  commitment: { kind: "commitment" as const, id, date, text: `promise ${id}`, raw: "", blobId: "", distance: 0 },
  outcome: status ? { kind: "outcome" as const, ref: id, date, status, text: "x", raw: "", blobId: "", distance: 0 } : undefined,
});

describe("dashboard numbers", () => {
  it("counts the last 30 days, 8 weeks and the calendar days", () => {
    const states = [c("a", "2026-10-28", "kept"), c("b", "2026-10-27", "broken"), c("d", "2026-10-27", "kept"), c("e", "2026-08-01", "kept"), c("f", "2026-10-29")];
    const s = summarize(states, {}, "2026-10-29");
    expect([s.kept30, s.closed30]).toEqual([2, 3]);
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks.at(-1)).toEqual({ week: "2026-10-26", kept: 2, closed: 3 });
    expect(s.days["2026-10-27"]).toEqual({ kept: 1, missed: 1 });
    expect(s.days["2026-08-01"]).toBeUndefined();
  });
  it("counts outcomes just recorded with a button before Walrus has them", () => {
    expect(summarize([c("a", "2026-10-29")], { a: "kept" }, "2026-10-29").kept30).toBe(1);
  });
  it("the morning brief's week score", () => {
    expect(weekScore([c("a", "2026-10-28", "kept"), c("b", "2026-10-20", "kept"), c("d", "2026-10-29", "broken")], "2026-10-29")).toEqual({ kept: 1, closed: 2 });
  });
});

describe("group mode", () => {
  it("knows when a group promise is due", () => {
    const p = { userId: "1", text: "x", createdAt: "2026-10-29T00:00:00Z" };
    expect(groupPromiseDue({ ...p, due: "2026-10-29", at: "15:00" }, "2026-10-29", "14:59")).toBe(false);
    expect(groupPromiseDue({ ...p, due: "2026-10-29", at: "15:00" }, "2026-10-29", "15:00")).toBe(true);
    expect(groupPromiseDue({ ...p, due: "2026-10-29" }, "2026-10-29", "18:00")).toBe(false);
    expect(groupPromiseDue({ ...p, due: "2026-10-29" }, "2026-10-29", "19:00")).toBe(true);
    expect(groupPromiseDue({ ...p, due: "2026-10-28", status: "kept" }, "2026-10-29", "09:00")).toBe(false);
    expect(groupPromiseDue({ ...p }, "2026-10-29", "23:00")).toBe(false);
  });
  it("never cleans up a promise nobody has answered yet, however old", async () => {
    const st = await import("../src/state.js");
    const { runGroupNudges } = await import("../src/groups.js");
    const chat = -99_000_000 - Math.floor(Math.random() * 1000);
    st.upsertGroup(chat, "Old");
    st.updateGroup(chat, (g) => {
      g.promises.open1 = { userId: "1", text: "x", due: "2020-01-01", createdAt: "2020-01-01T00:00:00Z", nudged: true };
      g.promises.done1 = { userId: "1", text: "y", due: "2020-01-01", status: "kept", createdAt: "2020-01-01T00:00:00Z", nudged: true };
    });
    await runGroupNudges({ sendMessage: async () => ({}) } as never);
    expect(Object.keys(st.getGroup(chat)!.promises)).toEqual(["open1"]);
    st.removeGroup(chat);
  });
  it("ranks the week's board by follow-through", () => {
    const g = {
      title: "Study",
      members: ["1", "2"],
      promises: {
        a: { userId: "1", text: "x", due: "2026-10-28", status: "kept", createdAt: "2026-10-27T00:00:00Z" },
        b: { userId: "1", text: "y", due: "2026-10-28", status: "broken", createdAt: "2026-10-27T00:00:00Z" },
        d: { userId: "2", text: "z", due: "2026-10-28", status: "kept", createdAt: "2026-10-27T00:00:00Z" },
        e: { userId: "2", text: "w", due: "2026-10-31", createdAt: "2026-10-29T00:00:00Z" },
      },
    };
    const lines = boardLines(g, "2026-10-29");
    expect(lines[0]).toMatch(/^🥇 .*1\/1 kept \(100%\) · 1 open$/);
    expect(lines[1]).toMatch(/^🥈 .*1\/2 kept \(50%\)$/);
  });
});

describe("photo proof in memory", () => {
  it("round-trips the pic field and tells buddies it was a photo, not the chain", () => {
    const r = { kind: "outcome" as const, date: "2026-10-29", ref: "k3f9", status: "kept" as const, pic: "abc123", text: "Kept the promise: gym" };
    expect(parse(serialize(r)).pic).toBe("abc123");
    expect(buddyMessage("Tunde", r, true)?.text).toMatch(/with photo proof/);
    expect(buddyMessage("Tunde", r, true)?.text).not.toMatch(/Sui/);
  });
});

describe("remind me at 9, it starts at 10", () => {
  const p = { text: "Promised to attend the real estate program at 10:00", due: "2026-10-29", at: "10:00", rem: "09:00" };
  it("reminds at the asked time and checks at the event, not before", async () => {
    const { headsUpAt, headsUpNow, dueNow, headsUpText } = await import("../src/reminders.js");
    expect(headsUpAt(p)).toEqual(["2026-10-29", "09:00"]);
    expect(headsUpNow({ j563: p }, "2026-10-29", "08:59", {}, {})).toHaveLength(0);
    expect(headsUpNow({ j563: p }, "2026-10-29", "09:00", {}, {})).toHaveLength(1);
    expect(dueNow({ j563: p }, "2026-10-29", "09:00", {}, {})).toHaveLength(0);
    expect(dueNow({ j563: p }, "2026-10-29", "10:00", {}, {})).toHaveLength(1);
    expect(headsUpText("j563", p)).toMatch(/^🔔 Your reminder: .* at 10:00 \(1 hour from now\)/);
  });
  it("without a reminder it still warns 30 minutes before", async () => {
    const { headsUpAt, headsUpText } = await import("../src/reminders.js");
    const q = { ...p, rem: undefined };
    expect(headsUpAt(q)).toEqual(["2026-10-29", "09:30"]);
    expect(headsUpText("j563", q)).toMatch(/^⏳ 30 minutes left/);
  });
  it("keeps the reminder time in memory, and ignores one after the deadline", () => {
    const r = { kind: "commitment" as const, date: "2026-10-29", id: "j563", due: "2026-10-29", at: "10:00", rem: "09:00", text: p.text };
    expect(serialize(r)).toContain("at:10:00 rem:09:00");
    expect(parse(serialize(r)).rem).toBe("09:00");
  });
  it("mirrors the reminder for exact-time sends, and drops it when the promise moves", async () => {
    const st = await import("../src/state.js");
    const { trackRecords } = await import("../src/reminders.js");
    st.upsertUser(777001, 777001, "Angel");
    trackRecords(777001, [{ kind: "commitment", date: "2026-10-29", id: "j563", due: "2026-10-29", at: "10:00", rem: "09:00", text: p.text }]);
    expect(st.getUser(777001)?.timed?.j563?.rem).toBe("09:00");
    trackRecords(777001, [{ kind: "commitment", date: "2026-10-29", id: "late", due: "2026-10-29", at: "10:00", rem: "11:00", text: "x" }]);
    expect(st.getUser(777001)?.timed?.late?.rem).toBeUndefined();
    trackRecords(777001, [{ kind: "outcome", date: "2026-10-29", ref: "j563", status: "moved", due: "2026-10-30", at: "14:00", text: "moved" }]);
    expect(st.getUser(777001)?.timed?.j563).toEqual({ text: p.text, due: "2026-10-30", at: "14:00" });
  });
});

describe("timezone shown as the place the person gave", () => {
  it("keeps Enugu, explains it's on West Africa time, and leaves zone names alone", async () => {
    const { placeName, describeZone } = await import("../src/timezone.js");
    expect(placeName("enugu nigeria")).toBe("Enugu Nigeria");
    expect(placeName("Africa/Lagos")).toBeUndefined();
    expect(placeName("UTC+1")).toBeUndefined();
    expect(placeName("WAT")).toBeUndefined();
    const at = new Date("2026-10-29T06:53:00Z");
    expect(describeZone("Africa/Lagos", at, "Enugu Nigeria")).toMatch(/^Enugu Nigeria · West Africa (Standard )?Time \(Africa\/Lagos, now 07:53\)$/);
    expect(describeZone("Africa/Lagos", at, "Lagos")).toMatch(/^West Africa (Standard )?Time \(Africa\/Lagos, now 07:53\)$/);
    expect(describeZone("Etc/GMT-3", at)).toBe("Etc/GMT-3 (now 09:53)");
  });
});

describe("kept in a row", () => {
  it("counts back from the latest outcome until a miss", () => {
    const states = [c("a", "2026-10-20", "broken"), c("b", "2026-10-25", "kept"), c("d", "2026-10-28", "kept"), c("e", "2026-10-29", "kept")];
    expect(summarize(states, {}, "2026-10-29").keptRun).toBe(3);
    expect(summarize([...states, c("f", "2026-10-29", "broken")], {}, "2026-10-29").keptRun).toBe(0);
  });
});

describe("bot profile texts", () => {
  it("fit Telegram's limits", async () => {
    const { BOT_ABOUT, BOT_DESCRIPTION } = await import("../src/bot/bot.js");
    expect(BOT_ABOUT.length).toBeLessThanOrEqual(120);
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
  });
});

describe("share card", () => {
  it("escapes the name and never includes promise texts", () => {
    const html = cardPage({ name: "<script>x</script>", kept: 3, closed: 4, streak: 2, weeks: [], bot: "Anchor_daBot" });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("kept 3 of 4 promises in the last 30 days");
    expect(html).not.toContain("this month");
  });
  it("draws no empty caps on the bars", () => {
    const html = cardPage({ name: "Angel", kept: 6, closed: 6, streak: 6, weeks: [{ week: "2026-10-05", kept: 3, closed: 3 }, { week: "2026-10-12", kept: 0, closed: 0 }, { week: "2026-10-19", kept: 1, closed: 2 }], bot: "Anchor_daBot" });
    const bars = html.match(/<div class="b">.*?<\/div>/g)!;
    expect(bars[0]).toContain('class="k"');
    expect(bars[0]).not.toContain('class="m"');
    expect(bars[1]).toBe('<div class="b"></div>');
    expect(bars[2]).toContain('class="m"');
  });
});
