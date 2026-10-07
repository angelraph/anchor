/**
 * Dry run of the scheduled evening check-in (the code that fires at
 * CHECKIN_HOUR for every user), against the anchor:smoke: namespace.
 * Real Gemini + Walrus; Telegram sends are captured, not delivered.
 *
 *   npx tsx scripts/checkin-dryrun.ts
 */
process.env.MEMWAL_NAMESPACE_PREFIX = "anchor:smoke:";
process.env.DATA_DIR = "./data/smoke";

const { Api } = await import("grammy");
const { runCheckins } = await import("../src/checkins.js");
const { chatTurn, enqueue } = await import("../src/bot/conversation.js");
const { upsertUser, updateUser } = await import("../src/state.js");

const sent: Array<{ chat: number; text: string; buttons: number }> = [];
const api = new Api("0:dry-run");
api.config.use(async (_prev, method, payload) => {
  const p = payload as { chat_id: number; text?: string; reply_markup?: { inline_keyboard?: unknown[][] } };
  if (method === "sendMessage") sent.push({ chat: p.chat_id, text: p.text ?? "", buttons: p.reply_markup?.inline_keyboard?.flat().length ?? 0 });
  return { ok: true, result: { message_id: 1, date: 0, chat: { id: p.chat_id, type: "private" } } } as never;
});

// User A: has a promise due today -> should get a nudge + buttons.
const A = 940_000_000 + Math.floor(Math.random() * 1e6);
upsertUser(A, A, "Ada");
await chatTurn(A, "Ada", "I'm Ada. I'll go to the market today before 2pm and buy a phone charger.");
await enqueue(`write:${A}`, async () => undefined);

// User B: active yesterday, nothing due -> should get the general evening nudge.
const B = A + 1;
upsertUser(B, B, "Bayo");
updateUser(B, (u) => { u.lastSeen = new Date(Date.now() - 26 * 3600_000).toISOString(); });

const t = Date.now();
await runCheckins(api);
console.log(`runCheckins finished in ${Date.now() - t} ms`);

const toA = sent.filter((s) => s.chat === A), toB = sent.filter((s) => s.chat === B);
for (const s of sent.filter((s) => s.chat === A || s.chat === B)) console.log(`-> ${s.chat === A ? "Ada " : "Bayo"}: ${s.text.replace(/\n/g, " / ")}${s.buttons ? `  [${s.buttons} buttons]` : ""}`);

const failures: string[] = [];
if (!toA.some((s) => s.buttons === 4)) failures.push("Ada did not get a check-in with outcome buttons");
if (toB.length !== 1) failures.push(`Bayo should get exactly 1 general nudge, got ${toB.length}`);

// Running again the same evening must not message anyone twice.
const before = sent.length;
await runCheckins(api);
const again = sent.slice(before).filter((s) => s.chat === A || s.chat === B).length;
if (again) failures.push(`second run sent ${again} duplicate messages`);
else console.log("second run: no duplicates");

console.log(failures.length ? "FAILURES:\n - " + failures.join("\n - ") : "SCHEDULED CHECK-IN OK");
process.exit(failures.length ? 1 : 0);
