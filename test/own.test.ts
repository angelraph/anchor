import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.DATA_DIR = "./data/unit-test";

/** A fake Walrus Memory: Anchor's account holds `stored`; the person's own account records what it was sent. */
const fake = {
  stored: [] as string[],
  count: 0,
  keyWorks: true,
  failTexts: new Set<string>(),
  gate: undefined as Promise<void> | undefined,
  sent: [] as string[],
  recallLimits: [] as number[],
};

vi.mock("../src/memory/client.js", () => ({
  OWN_NAMESPACE: "anchor",
  namespaceFor: (id: string) => `anchor:tg:${id}`,
  withRetry: (_l: string, fn: () => unknown) => fn(),
  memwal: { listNamespaces: async () => ({ namespaces: [{ name: "anchor:tg:701", memory_count: fake.count }], has_more: false }) },
  ownClient: () => {
    const jobs = new Map<string, string>();
    return {
      recall: async () => {
        if (!fake.keyWorks) throw new Error("HTTP 401 Unauthorized");
        return { results: [], total: 0 };
      },
      rememberBulk: async (items: Array<{ text: string }>) => {
        const job_ids = items.map((it, i) => {
          const id = `j${jobs.size + i}`;
          jobs.set(id, it.text);
          return id;
        });
        return { job_ids, total: items.length, status: "accepted" };
      },
      waitForRememberJobs: async (ids: string[]) => {
        await fake.gate;
        const results = ids.map((id) => {
          const text = jobs.get(id)!;
          const ok = !fake.failTexts.has(text);
          if (ok) fake.sent.push(text);
          return { id, blob_id: ok ? "b" : "", status: ok ? "done" : "failed", namespace: "anchor" };
        });
        return { results, total: ids.length, succeeded: 0, failed: 0 };
      },
    };
  },
}));

vi.mock("../src/memory/recall.js", () => ({
  forgetCachedRecalls: () => undefined,
  recall: async (_u: string, _q: string, opts: { limit?: number }) => {
    fake.recallLimits.push(opts.limit ?? 8);
    return fake.stored.slice(0, opts.limit ?? 8).map((raw) => ({ raw, text: raw }));
  },
  mergeAndFilter: (_u: string, ...groups: Array<Array<{ raw: string }>>) => groups.flat(),
}));

const { upsertUser, getUser, updateUser } = await import("../src/state.js");
const own = await import("../src/memory/own.js");

const USER = "701";
const ACCOUNT = "0x" + "ab".repeat(32);
const KEY = "cd".repeat(32);

function waitFor(fn: () => boolean) {
  return vi.waitFor(() => expect(fn()).toBe(true), { timeout: 2000, interval: 5 });
}

beforeEach(() => {
  upsertUser(Number(USER), Number(USER), "Admin");
  updateUser(USER, (u) => {
    delete u.ownMemory;
    delete u.ownCopy;
  });
  Object.assign(fake, { stored: [], count: 0, keyWorks: true, failTexts: new Set(), gate: undefined, sent: [], recallLimits: [] });
});

describe("moving memory to the person's own Walrus Memory account", () => {
  it("refuses a key that doesn't open the account, and switches nothing", async () => {
    fake.keyWorks = false;
    await expect(own.startOwnMemoryMove(USER, ACCOUNT, KEY, () => undefined)).rejects.toThrow(/rejected that key/);
    expect(getUser(USER)?.ownMemory).toBeUndefined();
    expect(own.isMoving(USER)).toBe(false);
  });

  it("answers as soon as the key checks out, copies in the background, then switches", async () => {
    fake.stored = Array.from({ length: 45 }, (_, i) => `memory ${i}`);
    fake.count = 45;
    let release!: () => void;
    fake.gate = new Promise((r) => (release = r));
    const results: unknown[] = [];

    const started = await own.startOwnMemoryMove(USER, ACCOUNT, KEY, (r) => void results.push(r));
    // The copy is still waiting on Walrus, yet the caller already has its answer.
    expect(started).toEqual({ copying: true });
    expect(own.isMoving(USER)).toBe(true);
    expect(getUser(USER)?.ownMemory).toBeUndefined();
    await expect(own.startOwnMemoryMove(USER, ACCOUNT, KEY, () => undefined)).rejects.toThrow(/already moving/);

    release();
    await waitFor(() => results.length === 1);
    expect(results[0]).toEqual({ copied: 45, total: 45, failed: 0, switched: true });
    expect(fake.sent).toHaveLength(45);
    expect(getUser(USER)?.ownMemory?.accountId).toBe(ACCOUNT);
    expect(own.isMoving(USER)).toBe(false);
  });

  it("asks for at least as many memories as the account holds, up to the cap", async () => {
    fake.count = 230;
    await own.memoriesToCopy(USER);
    expect(fake.recallLimits[0]).toBe(250);
    fake.count = 5000;
    fake.recallLimits = [];
    await own.memoriesToCopy(USER);
    expect(fake.recallLimits[0]).toBe(own.MAX_COPY);
  });

  it("switches nothing when some memories fail, and a retry copies only the missing ones", async () => {
    fake.stored = Array.from({ length: 25 }, (_, i) => `memory ${i}`);
    fake.failTexts = new Set(["memory 3", "memory 21"]);
    const results: Array<import("../src/memory/own.js").MoveResult | Error> = [];
    await own.startOwnMemoryMove(USER, ACCOUNT, KEY, (r) => void results.push(r));
    await waitFor(() => results.length === 1);
    expect(results[0]).toEqual({ copied: 23, total: 25, failed: 2, switched: false });
    expect(getUser(USER)?.ownMemory).toBeUndefined();
    expect(own.moveReport(results[0]!, ACCOUNT)).toMatch(/Nothing was switched yet/);

    fake.failTexts = new Set();
    fake.sent = [];
    await own.startOwnMemoryMove(USER, ACCOUNT, KEY, (r) => void results.push(r));
    await waitFor(() => results.length === 2);
    expect(fake.sent.sort()).toEqual(["memory 21", "memory 3"]);
    expect(results[1]).toEqual({ copied: 25, total: 25, failed: 0, switched: true });
    expect(getUser(USER)?.ownMemory?.accountId).toBe(ACCOUNT);
  });

  it("tells the person plainly how it went", () => {
    expect(own.moveReport({ copied: 40, total: 40, failed: 0, switched: true }, ACCOUNT)).toMatch(/All 40 of your memories are now in your own Walrus Memory account \(0xababab…\)/);
    expect(own.moveReport({ copied: 0, total: 0, failed: 0, switched: true }, ACCOUNT)).toMatch(/nothing to copy/);
    expect(own.moveReport(new Error("relayer down"), ACCOUNT)).toMatch(/still on Anchor's account/);
  });
});
