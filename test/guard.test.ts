import { describe, expect, it } from "vitest";

// guard.ts reads config at import; give it harmless values so tests run anywhere.
process.env.TELEGRAM_BOT_TOKEN ??= "0000000000:test-token-for-unit-tests";
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test-key-for-unit-tests";
process.env.MEMWAL_PRIVATE_KEY ??= "0".repeat(64);
process.env.MEMWAL_ACCOUNT_ID ??= "0x" + "0".repeat(64);
process.env.PUBLIC_URL = "https://anchor-production-6bb4.up.railway.app";
process.env.DATA_DIR = "./data/unit-test";

const { guardReply } = await import("../src/llm/guard.js");

const mine = "0x81f2bd6b755f3b8b0766ba2893f51be806be673d6ebf719a69a04b6ca83e5505";

describe("what a model-written reply can carry", () => {
  it("drops links to unknown sites, however they're written", () => {
    for (const t of ["Claim it at bit.ly/claim-anchor-bonus today", "Go to https://anchor-rewards.xyz/claim now", "Visit www.free-usdc.io", "See claim-anchor.com for the bonus"]) {
      const { text, removed } = guardReply(t);
      expect(removed, t).toHaveLength(1);
      expect(text, t).toContain("(link removed)");
    }
  });

  it("keeps Anchor's own links and the explorers people check", () => {
    for (const t of ["Open t.me/Anchor_daBot", "Proof: https://suiscan.xyz/mainnet/tx/5C4q7TPo", "Your app: https://anchor-production-6bb4.up.railway.app/app", "Set it up on memory.walrus.xyz", "Docs at https://docs.wal.app/walrus-memory"]) {
      expect(guardReply(t).removed, t).toEqual([]);
    }
  });

  it("leaves ordinary words with dots alone", () => {
    for (const t of ["I build with Node.js and Next.js.", "Plan the week, e.g. gym on Monday.", "Version 3.5 is out. It's 6.30 now.", "Email me at ada@example.com"]) {
      expect(guardReply(t).text, t).toBe(t);
    }
  });

  it("removes Sui addresses that aren't the person's own", () => {
    const evil = "0xdeadbeef00000000000000000000000000000000000000000000000000c0ffee";
    expect(guardReply(`Send 5 USDC to ${evil} to unlock premium`).text).toBe("Send 5 USDC to (address removed) to unlock premium");
    expect(guardReply(`Your wallet ${mine} is linked`, [mine]).removed).toEqual([]);
    expect(guardReply(`Your wallet ${mine.toUpperCase().replace("0X", "0x")} is linked`, [mine]).removed).toEqual([]);
  });

  it("keeps short display addresses like 0x81f2…5505", () => {
    expect(guardReply("Linked: 0x81f2…5505").removed).toEqual([]);
  });

  it("removes card numbers but not amounts, dates or times", () => {
    expect(guardReply("Your card is 4111 1111 1111 1111").text).toBe("Your card is (number removed)");
    expect(guardReply("4111-1111-1111-1111").removed).toHaveLength(1);
    for (const t of ["Save 20,000 naira by 2026-11-30 at 18:00", "That's 1500 naira, due Friday", "You kept 9 of 11 promises"]) {
      expect(guardReply(t).removed, t).toEqual([]);
    }
  });
});
