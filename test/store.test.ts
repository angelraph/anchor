import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A machine with an old state file, moving to Upstash for the first time.
const DIR = "./data/unit-store";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/state.json`, JSON.stringify({ users: { "42": { firstName: "Ada", chatId: 42, lastSeen: "", nudged: {}, awaitingOutcome: [], tombstones: [], tz: "Africa/Lagos" } }, stakes: { s1: { token: "s1" } } }));

process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = DIR;
process.env.UPSTASH_REDIS_REST_URL = "https://fake-upstash.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

// A tiny in-memory Upstash: GET and SET over its REST shape.
const kv = new Map<string, string>();
let calls = 0;
let down = false;
globalThis.fetch = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
  calls++;
  if (down) throw new Error("network down");
  if (init.headers.authorization !== "Bearer fake-token") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const [cmd, key, value] = JSON.parse(init.body) as [string, string, string?];
  if (cmd === "GET") return new Response(JSON.stringify({ result: kv.get(key) ?? null }));
  if (cmd === "SET") {
    kv.set(key, value!);
    return new Response(JSON.stringify({ result: "OK" }));
  }
  return new Response(JSON.stringify({ error: "unknown" }), { status: 400 });
}) as never;

const store = await import("../src/store.js");
const st = await import("../src/state.js");

describe("durable state in Upstash", () => {
  it("packs state small and unpacks it exactly", () => {
    const json = JSON.stringify({ users: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i), { firstName: "Person", nudged: {}, tz: "Africa/Lagos" }])) });
    const packed = store.pack(json);
    expect(store.unpack(packed)).toBe(json);
    expect(packed.length).toBeLessThan(json.length / 5);
  });

  it("first boot after a move: an empty Upstash gets this machine's state", async () => {
    expect(await st.initState()).toBe("upstash");
    const saved = JSON.parse(store.unpack(kv.get("anchor:state")!));
    expect(saved.users["42"].firstName).toBe("Ada");
    expect(saved.stakes.s1.token).toBe("s1");
    expect(st.stateBackend()).toBe("upstash");
  });

  it("changes are saved back (batched), and a flush saves at once", async () => {
    st.updateUser(42, (u) => (u.tz = "Europe/Berlin"));
    await st.flushDurable();
    expect(JSON.parse(store.unpack(kv.get("anchor:state")!)).users["42"].tz).toBe("Europe/Berlin");
  });

  it("a failed save is kept and retried, not lost", async () => {
    down = true;
    st.updateUser(42, (u) => (u.tz = "Asia/Tokyo"));
    await st.flushDurable();
    down = false;
    await st.flushDurable();
    expect(JSON.parse(store.unpack(kv.get("anchor:state")!)).users["42"].tz).toBe("Asia/Tokyo");
  });

  it("refuses to start on an empty state when Upstash can't be reached", async () => {
    const { loadDurable } = store;
    down = true;
    await expect(loadDurable()).rejects.toThrow();
    down = false;
    expect(calls).toBeGreaterThan(0);
  });
});
