/**
 * Judge's-eye end-to-end test: feeds real Telegram updates through the real
 * bot (real Gemini, real Walrus Memory) and captures what the bot would send.
 * Only the outgoing Telegram HTTP call is intercepted. Uses the separate
 * anchor:smoke: namespace so test users never appear on the proof page.
 *
 *   npx tsx scripts/e2e.ts
 */
process.env.MEMWAL_NAMESPACE_PREFIX = "anchor:smoke:";
process.env.DATA_DIR = "./data/smoke";

const { createBot } = await import("../src/bot/bot.js");
const { enqueue } = await import("../src/bot/conversation.js");
const { flush } = await import("../src/state.js");

type Sent = { method: string; text?: string; buttons?: string[] };
const sent: Sent[] = [];
const bot = createBot();
bot.botInfo = {
  id: 1, is_bot: true, first_name: "Anchor", username: "Anchor_test_bot",
  can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
} as typeof bot.botInfo;
let msgId = 1000;
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as { text?: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] } };
  const buttons = p.reply_markup?.inline_keyboard?.flat().map((b) => `${b.text}=>${b.callback_data}`);
  if (method !== "sendChatAction") sent.push({ method, text: p.text, buttons });
  return { ok: true, result: method === "sendMessage" ? { message_id: ++msgId, date: 0, chat: { id: USER, type: "private" }, text: p.text } : true } as never;
});

const USER = 910_000_000 + Math.floor(Math.random() * 1_000_000);
const from = { id: USER, is_bot: false, first_name: "Judge" };
const chat = { id: USER, type: "private" as const, first_name: "Judge" };
let updateId = 1;

async function say(text: string) {
  const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]!.length }] : undefined;
  const before = sent.length;
  const t = Date.now();
  await bot.handleUpdate({ update_id: updateId++, message: { message_id: ++msgId, date: Math.floor(Date.now() / 1000), chat, from, text, entities } });
  report(`> ${text}`, before, t);
}

async function tap(data: string) {
  const before = sent.length;
  const t = Date.now();
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: { id: String(updateId), from, chat_instance: "x", data, message: { message_id: msgId, date: 0, chat, text: "" } },
  } as never);
  report(`[tap ${data}]`, before, t);
}

const failures: string[] = [];
function report(label: string, before: number, t: number) {
  const out = sent.slice(before).filter((s) => s.method === "sendMessage");
  console.log(`\n${label}   (${Date.now() - t} ms)`);
  if (out.length === 0) console.log("   (no reply)");
  for (const s of out) {
    console.log("   " + (s.text ?? "").replace(/\n/g, "\n   "));
    if (s.buttons?.length) console.log("   buttons: " + s.buttons.join(" | "));
    if (/Something went wrong/.test(s.text ?? "")) failures.push(`${label}: error reply`);
    if (/[—]/.test(s.text ?? "")) failures.push(`${label}: em dash in reply`);
  }
  if (out.length === 0 && !label.startsWith("[tap")) failures.push(`${label}: no reply`);
}

const settle = () => enqueue(`write:${USER}`, async () => undefined);
const lastButtons = () => [...sent].reverse().find((s) => s.buttons?.length)?.buttons ?? [];

console.log(`e2e user ${USER}`);
await say("/start");
await say("hey! I'm Tunde, I work as a frontend dev in Lagos");
await settle();
await say("I keep saying I'll go to the gym but I never go. I'll go tomorrow at 6am, for real.");
await settle();
await say("Honestly I always skip when I stay up late on my phone. When my friend Kemi comes with me I actually go.");
await settle();
await say("/promises");
await say("/why");
await say("/memory");
await say("/compare should I start running too?");
await say("/checkin");
const outcome = lastButtons().find((b) => b.includes(":kept"));
if (outcome) {
  await tap(outcome.split("=>")[1]!);
  await say("Kemi came over and we went together at 6, it worked");
  await settle();
} else console.log("\n(no due promise yet, so no outcome buttons: expected unless due today)");
// A promise due today, so the check-in has something to ask about.
await say("Also I will send my CV to two companies today before 6pm.");
await settle();
await say("/checkin");
const kept = lastButtons().find((b) => b.includes(":kept"));
if (!kept) failures.push("/checkin: no outcome buttons for a promise due today");
else {
  await tap(kept.split("=>")[1]!);
  await settle();
  await say("I did it right after dinner, blocking 30 minutes with my phone in another room helped");
  await settle();
  await say("/promises");
  const promises = sent.filter((s) => s.method === "sendMessage").at(-1)?.text ?? "";
  if (!/FINISHED/.test(promises)) failures.push("/promises: kept promise not shown as finished");
}

await say("/forget Kemi");
const forget = lastButtons()[0];
if (forget) {
  await tap(forget.split("=>")[1]!);
  await settle();
  const forgotten = forget.split("=>")[0]!.replace("🗑 ", "");
  await say("/memory");
  const mem = sent.filter((s) => s.method === "sendMessage").at(-1)?.text ?? "";
  if (mem.includes(forgotten)) failures.push(`/forget: "${forgotten}" still shown in /memory`);
}
await say("/stats");
await say("/help");
await say("/nonsense");
await bot.handleUpdate({ update_id: updateId++, message: { message_id: ++msgId, date: 0, chat, from, sticker: { file_id: "x" } } } as never);
report("[sticker]", sent.length - 1, Date.now());
await settle();
flush();

console.log(`\n${failures.length ? "FAILURES:\n - " + failures.join("\n - ") : "ALL CHECKS PASSED"}`);
process.exit(failures.length ? 1 : 0);
