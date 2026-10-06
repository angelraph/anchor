/**
 * Live end-to-end smoke test of Anchor's memory loop with real Gemini, real
 * Walrus Memory, no Telegram. Uses a separate namespace prefix
 * (anchor:smoke:<id>) so test data never counts as a real user.
 *
 *   npx tsx scripts/smoke.ts
 */
process.env.MEMWAL_NAMESPACE_PREFIX = "anchor:smoke:";
process.env.DATA_DIR = "./data/smoke";
const { chatTurn, enqueue } = await import("../src/bot/conversation.js");
const { recallCommitments } = await import("../src/memory/recall.js");
const { isOpen } = await import("../src/memory/types.js");
const { upsertUser } = await import("../src/state.js");

const userId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
upsertUser(userId, userId, "Tester");
console.log(`smoke user ${userId}`);

async function turn(message: string) {
  const t = Date.now();
  const { reply, context } = await chatTurn(userId, "Tester", message);
  console.log(`\nYOU: ${message}\nANCHOR (${Date.now() - t} ms, ${context?.memories.length ?? 0} memories): ${reply}`);
  // Wait for this turn's memories to land on Walrus before the next turn.
  await enqueue(`write:${userId}`, async () => undefined);
}

await turn("Hi! I'm Ada, a nursing student. I keep saying I'll start revising for my pharmacology exam but I never do.");
await turn("Okay, I promise to revise two chapters of pharmacology by tomorrow evening.");
await turn("Honestly I always get distracted by my phone when I study at home. The library works better for me.");

const states = await recallCommitments(userId);
console.log(`\ncommitments on Walrus: ${states.map((s) => `#${s.commitment.id} ${s.commitment.text} (due ${s.commitment.due}, ${isOpen(s) ? "open" : s.outcome?.status})`).join("; ") || "NONE"}`);

await turn("What do you remember about me and my exam plan?");
process.exit(states.length > 0 ? 0 : 1);
