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
// Stake links need a public URL; the escrow part calls the web app in-process, not this host.
process.env.PUBLIC_URL ||= "https://anchor-production-6bb4.up.railway.app";

const { createBot } = await import("../src/bot/bot.js");
const { enqueue } = await import("../src/bot/conversation.js");
const { flush } = await import("../src/state.js");

type Sent = { method: string; chatId?: number; text?: string; buttons?: string[] };
const sent: Sent[] = [];
const bot = createBot();
(await import("../src/buddies.js")).setBuddyApi(bot.api);
bot.botInfo = {
  id: 1, is_bot: true, first_name: "Anchor", username: "Anchor_test_bot",
  can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
} as typeof bot.botInfo;
let msgId = 1000;
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as { chat_id?: number; text?: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] } };
  const buttons = p.reply_markup?.inline_keyboard?.flat().map((b) => `${b.text}=>${b.callback_data}`);
  if (method !== "sendChatAction") sent.push({ method, chatId: p.chat_id, text: p.text, buttons });
  return { ok: true, result: method === "sendMessage" ? { message_id: ++msgId, date: 0, chat: { id: USER, type: "private" }, text: p.text } : true } as never;
});

const USER = 910_000_000 + Math.floor(Math.random() * 1_000_000);
const from = { id: USER, is_bot: false, first_name: "Judge" };
const chat = { id: USER, type: "private" as const, first_name: "Judge" };
// A second person, for buddies.
const FRIEND = USER + 1;
const friend = { from: { id: FRIEND, is_bot: false, first_name: "Kemi" }, chat: { id: FRIEND, type: "private" as const, first_name: "Kemi" } };
type Who = { from: typeof from; chat: { id: number; type: "private"; first_name: string } | { id: number; type: "supergroup"; title: string } };
const judge: Who = { from, chat };
let updateId = 1;

async function say(text: string, who: Who = judge) {
  const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]!.length }] : undefined;
  const before = sent.length;
  const t = Date.now();
  await bot.handleUpdate({ update_id: updateId++, message: { message_id: ++msgId, date: Math.floor(Date.now() / 1000), chat: who.chat, from: who.from, text, entities } });
  report(`${who === judge ? "" : `(${who.from.first_name}) `}> ${text}`, before, t);
}

async function tap(data: string, who: Who = judge) {
  const before = sent.length;
  const t = Date.now();
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: { id: String(updateId), from: who.from, chat_instance: "x", data, message: { message_id: msgId, date: 0, chat: who.chat, text: "" } },
  } as never);
  report(`${who === judge ? "" : `(${who.from.first_name}) `}[tap ${data}]`, before, t);
}

const failures: string[] = [];
function report(label: string, before: number, t: number) {
  const out = sent.slice(before).filter((s) => s.method === "sendMessage");
  console.log(`\n${label}   (${Date.now() - t} ms)`);
  if (out.length === 0) console.log("   (no reply)");
  for (const s of out) {
    const to = s.chatId === FRIEND ? "→ Kemi: " : s.chatId && s.chatId !== USER ? `→ ${s.chatId}: ` : "";
    console.log("   " + to + (s.text ?? "").replace(/\n/g, "\n   "));
    if (s.buttons?.length) console.log("   buttons: " + s.buttons.join(" | "));
    if (/Something went wrong/.test(s.text ?? "")) failures.push(`${label}: error reply`);
    if (/[\u2014]/.test(s.text ?? "")) failures.push(`${label}: em dash in reply`);
  }
  if (out.length === 0 && !label.includes("[tap")) failures.push(`${label}: no reply`);
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
// No time of day, so the deadline has passed whatever time the test runs.
await say("Also I will send my CV to two companies today.");
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
// On-chain: real Tatum Sui mainnet reads. Keyless Tatum allows 5 requests a minute, so pace it.
const pace = () => (process.env.TATUM_API_KEY ? Promise.resolve() : new Promise((r) => setTimeout(r, 65_000)));
await say("/wallet walrus.sui");
if (!/Linked walrus\.sui/.test(sent.filter((s) => s.method === "sendMessage").at(-1)?.text ?? "")) failures.push("/wallet: walrus.sui did not resolve via Tatum");
await pace();
await say("I'll save 5 USDC by Friday");
await settle();
const chainNote = sent.filter((s) => s.method === "sendMessage").find((s) => /^⛓ #/.test(s.text ?? ""));
if (!chainNote) failures.push("money promise: Gemini did not produce a chain check (no ⛓ confirmation)");
else console.log(`\n   chain confirmation: ${chainNote.text}`);
await pace();
await say("/money");
await pace();
await say("/verify");
await say("/learning");
await say("/stake");
await say("/report");
await say("/connect");

// Newer features
const lastText = () => sent.filter((s) => s.method === "sendMessage").at(-1)?.text ?? "";
const toChat = (id: number, since: number) => sent.slice(since).filter((s) => s.method === "sendMessage" && s.chatId === id);

// Timezones: Gemini resolves a city, validated as an IANA zone.
await say("/timezone Berlin");
if (!/Europe\/Berlin|Berlin/.test(lastText())) failures.push("/timezone: Berlin not resolved");
await say("/timezone Lagos");
if (!/Lagos/.test(lastText())) failures.push("/timezone: Lagos not resolved");

// Guided tour.
await say("/tour");
const tourNext = lastButtons().find((b) => /=>tour:\d+$/.test(b));
if (!tourNext) failures.push("/tour: no next button");
else await tap(tourNext.split("=>")[1]!);

// Habits and streaks.
await say("/habit gym 3x a week");
const habitDone = lastButtons().find((b) => /=>h:[a-z0-9]+:done$/.test(b));
if (!habitDone) failures.push("/habit: no done button");
else {
  await tap(habitDone.split("=>")[1]!);
  await settle();
}
await say("/habits");
if (!/gym/i.test(lastText()) || !/1\/3|1 of 3/.test(lastText())) failures.push("/habits: gym habit or its 1/3 progress missing");

// Prices through Tatum's Data API.
await say("/money NGN");
if (!/₦/.test(sent.filter((s) => s.method === "sendMessage").slice(-3).map((s) => s.text).join(" "))) failures.push("/money NGN: no naira values");
const chainBefore = sent.filter((s) => /^⛓ #/.test(s.text ?? "")).length;
await say("I'll keep at least ₦2,000 worth of crypto in my wallet until Sunday");
await settle();
if (sent.filter((s) => /^⛓ #/.test(s.text ?? "")).length <= chainBefore) failures.push("currency promise: no chain check for a naira amount");

// Accountability buddies: invite, accept, outcome notification, cheer back.
await say("/buddy");
const invite = /start=buddy_([\w-]+)/.exec(lastText())?.[1];
if (!invite) failures.push("/buddy: no invite link");
else {
  await say(`/start buddy_${invite}`, friend);
  const accept = lastButtons().find((b) => b.includes(`bd:yes:${invite}`));
  if (!accept) failures.push("buddy: no accept button");
  else {
    let mark = sent.length;
    await tap(accept.split("=>")[1]!, friend);
    if (!toChat(USER, mark).some((s) => /accepted/.test(s.text ?? ""))) failures.push("buddy: owner not told the invite was accepted");
    await settle();
    await say("I'll drink two litres of water today.");
    await settle();
    await say("/checkin");
    const water = lastButtons().find((b) => b.includes(":kept"));
    if (!water) failures.push("buddy: no outcome buttons for the water promise");
    else {
      mark = sent.length;
      await tap(water.split("=>")[1]!);
      await settle();
      const note = toChat(FRIEND, mark).find((s) => s.buttons?.some((b) => b.includes("b:cheer:")));
      if (!note) failures.push("buddy: friend not told about the kept promise");
      else {
        console.log(`\n   buddy saw: ${note.text}`);
        mark = sent.length;
        await tap(note.buttons!.find((b) => b.includes("b:cheer:"))!.split("=>")[1]!, friend);
        if (!toChat(USER, mark).length) failures.push("buddy: cheer did not reach the owner");
      }
    }
  }
}

// Trustless stake: /stake → stake page → escrow build → payer signs → lock on mainnet → Anchor settles "kept".
const agentKey = process.env.AGENT_SUI_PRIVATE_KEY;
const savePromise = chainNote ? /^⛓ #(\w+)/.exec(chainNote.text ?? "")?.[1] : undefined;
if (!agentKey || !savePromise) console.log("\n(escrow stake skipped: needs AGENT_SUI_PRIVATE_KEY and the USDC promise)");
else {
  await say(`/stake #${savePromise} 0.01 usdc 0x81f2bd6b755f3b8b0766ba2893f51be806be673d6ebf719a69a04b6ca83e5505`);
  const token = /\/stake\/([\w-]+)/.exec(lastText())?.[1];
  if (!token) failures.push("/stake: no stake link");
  else {
    const { createWebApp } = await import("../src/web/server.js");
    const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
    const { settleStake } = await import("../src/chain/stakes.js");
    const { getStake } = await import("../src/state.js");
    const app = createWebApp(bot.api);
    const page = await (await app.request(`/stake/${token}`)).text();
    if (!page.includes('id="escrow"')) failures.push("stake page: no escrow option");
    const payer = Ed25519Keypair.fromSecretKey(agentKey);
    const built = (await (await app.request(`/api/escrow/build/${token}`, { method: "POST", body: JSON.stringify({ sender: payer.toSuiAddress() }), headers: { "content-type": "application/json" } })).json()) as { transaction?: string; error?: string };
    if (!built.transaction) failures.push(`escrow build: ${built.error}`);
    else {
      const signed = await payer.signTransaction(Uint8Array.from(Buffer.from(built.transaction, "base64")));
      const mark = sent.length;
      const lock = (await (await app.request(`/api/escrow/lock/${token}`, { method: "POST", body: JSON.stringify({ transaction: signed.bytes, signature: signed.signature }), headers: { "content-type": "application/json" } })).json()) as { digest?: string; escrowId?: string; error?: string };
      if (!lock.escrowId) failures.push(`escrow lock: ${lock.error}`);
      else {
        console.log(`\n   escrow locked: https://suiscan.xyz/mainnet/tx/${lock.digest}`);
        if (!toChat(USER, mark).some((s) => /escrow contract/.test(s.text ?? ""))) failures.push("escrow: no 'staked' message in chat");
        await settleStake(bot.api, token, "kept");
        const s = getStake(token);
        if (s?.status !== "refunded" || !s.payoutDigest) failures.push(`escrow settle: stake is ${s?.status} (${s?.note ?? ""})`);
        else console.log(`   escrow settled (kept): https://suiscan.xyz/mainnet/tx/${s.payoutDigest}`);
      }
    }
  }
}

// Daily-use features
const { readFileSync } = await import("node:fs");
const { createHmac } = await import("node:crypto");
const { setFileFetcher } = await import("../src/media.js");
const { readProof } = await import("../src/proof.js");
const { runGroupNudges, setGroupApi } = await import("../src/groups.js");
const st = await import("../src/state.js");
const web = (await import("../src/web/server.js")).createWebApp(bot.api);
setGroupApi(bot.api);
const fixtures: Record<string, string> = { voice: "test/fixtures/voice-promise.wav", photo: "test/fixtures/cv-sent.jpg" };
setFileFetcher(async (_api, fileId) => new Uint8Array(readFileSync(fixtures[fileId]!)));

async function sendMsg(extra: Record<string, unknown>, label: string, who: Who = judge) {
  const before = sent.length;
  const t = Date.now();
  await bot.handleUpdate({ update_id: updateId++, message: { message_id: ++msgId, date: Math.floor(Date.now() / 1000), chat: who.chat, from: who.from, ...extra } } as never);
  report(label, before, t);
}

// Voice promise: a spoken note becomes a promise.
await sendMsg({ voice: { file_id: "voice", file_unique_id: "v1", duration: 4, mime_type: "audio/wav" } }, "[voice note]");
await settle();
if (!sent.some((s) => /🎙 I heard: .*chapters/i.test(s.text ?? ""))) failures.push("voice: not transcribed");

// Photo proof: promise, then a screenshot of the sent emails.
await say("I'll send my CV to two more companies today.");
await settle();
let mark = sent.length;
await sendMsg({ photo: [{ file_id: "photo", file_unique_id: "p1", width: 375, height: 812 }], caption: "done!" }, "[photo proof]");
const chooser = sent.slice(mark).find((s) => s.buttons?.some((b) => b.includes("=>pf:")));
if (chooser) {
  const pick = chooser.buttons!.find((b) => /CV/i.test(b) && !b.endsWith(":none")) ?? chooser.buttons![0]!;
  await tap(pick.split("=>")[1]!);
}
await settle();
const proof = st.proofsOf(String(USER)).at(-1);
if (!sent.slice(mark).some((s) => /Proof accepted/.test(s.text ?? ""))) failures.push("photo: proof not accepted");
else if (!proof?.jobId) failures.push("photo: not stored on Walrus");
else {
  // Read it back from Walrus once certified, decrypted for its owner only.
  let back: Awaited<ReturnType<typeof readProof>>;
  for (let i = 0; i < 12 && !back; i++) {
    back = await readProof(proof.id, String(USER)).catch(() => undefined);
    if (!back) await new Promise((r) => setTimeout(r, 10_000));
  }
  if (!back) failures.push("photo: not readable from Walrus within 2 minutes");
  else if (!Buffer.from(back.bytes).equals(readFileSync(fixtures.photo!))) failures.push("photo: Walrus copy doesn't match");
  else console.log(`\n   photo proof round trip: encrypted on Walrus (job ${proof.jobId}), decrypted back byte for byte`);
  if (await readProof(proof.id, String(FRIEND)).catch(() => undefined)) failures.push("photo: someone else could read the proof");
}

// Morning brief.
await say("/morning");
if (!/Good morning/.test(lastText())) failures.push("/morning: no brief");

// Own memory: bad input is refused, and the message holding a key is deleted.
mark = sent.length;
await say(`/mymemory ${process.env.MEMWAL_ACCOUNT_ID} ${"ab".repeat(32)}`);
if (!sent.slice(mark).some((s) => s.method === "deleteMessage")) failures.push("/mymemory: message with the key not deleted");
if (!/rejected|Couldn't reach/.test(lastText())) failures.push("/mymemory: a wrong key was not refused");
if (st.getUser(USER)?.ownMemory) failures.push("/mymemory: switched to an account with a wrong key");

// Group mode: added to a group, a promise in front of everyone, the deadline check, the board.
const GROUP = -1_000_000_000_000 - Math.floor(Math.random() * 1_000_000);
const groupChat = { id: GROUP, type: "supergroup" as const, title: "Study Squad" };
const inGroup = { from, chat: groupChat };
const kemiInGroup = { from: friend.from, chat: groupChat };
const botUser = { id: 1, is_bot: true, first_name: "Anchor" };
mark = sent.length;
await bot.handleUpdate({ update_id: updateId++, my_chat_member: { chat: groupChat, from, date: 0, old_chat_member: { user: botUser, status: "left" }, new_chat_member: { user: botUser, status: "member" } } } as never);
if (!toChat(GROUP, mark).some((s) => /\/promise/.test(s.text ?? ""))) failures.push("group: no welcome");
mark = sent.length;
await sendMsg({ text: "hello everyone", entities: undefined }, "[tap] (group chatter, no reply expected)", inGroup);
if (toChat(GROUP, mark).length) failures.push("group: replied to ordinary chatter");
await say("/promise finish chapter 3 of my thesis today", inGroup);
const gp = Object.entries(st.getGroup(GROUP)?.promises ?? {})[0];
if (!toChat(GROUP, mark).some((s) => /📌/.test(s.text ?? "")) || !gp) failures.push("group: /promise not recorded");
else {
  const { addDays, todayIn } = await import("../src/dates.js");
  st.updateGroup(GROUP, (g) => (g.promises[gp[0]]!.due = addDays(todayIn("Africa/Lagos"), -1))); // pretend the deadline passed yesterday
  mark = sent.length;
  await runGroupNudges(bot.api);
  const nudge = toChat(GROUP, mark).find((s) => s.buttons?.some((b) => b.includes("=>g:")));
  if (!nudge) failures.push("group: no deadline check");
  else {
    const kept = nudge.buttons!.find((b) => b.endsWith(":kept"))!.split("=>")[1]!;
    mark = sent.length;
    await tap(kept, kemiInGroup);
    if (!sent.slice(mark).some((s) => s.method === "answerCallbackQuery" && /Only/.test(s.text ?? ""))) failures.push("group: someone else could answer my check");
    mark = sent.length;
    await tap(kept, inGroup);
    await settle();
    if (!toChat(GROUP, mark).some((s) => /✅ .* kept:/.test(s.text ?? ""))) failures.push("group: kept not announced");
  }
}
await say("/board", inGroup);
if (!/🥇/.test(lastText())) failures.push("group: /board empty");

// Mini app API: signed initData opens the dashboard; anything else is refused.
const initData = (() => {
  const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: USER, first_name: "Judge" }) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
})();
const me = await web.request("/api/app/me", { headers: { "x-telegram-init-data": initData } });
const dash = (await me.json()) as { open?: unknown[]; done?: Array<{ pic: string | null }>; proofs?: unknown[]; summary?: { closed30: number }; groups?: string[] };
if (me.status !== 200 || !dash.summary) failures.push(`app: dashboard ${me.status}`);
else {
  console.log(`\n   app dashboard: ${dash.open?.length} open, ${dash.done?.length} finished, ${dash.proofs?.length} photo proofs, groups ${JSON.stringify(dash.groups)}`);
  if (!dash.proofs?.length || !dash.done?.some((d) => d.pic)) failures.push("app: photo proof missing from the dashboard");
  if (!dash.groups?.includes("Study Squad")) failures.push("app: group missing from the dashboard");
}
if ((await web.request("/api/app/me", { headers: { "x-telegram-init-data": initData.replace(/hash=\w/, "hash=0") } })).status !== 401) failures.push("app: a forged sign-in got in");

// The full sweep: every surface a person touches, checked for what the answer SAYS.
const { runDeadlineReminders } = await import("../src/reminders.js");
const { runMorning } = await import("../src/morning.js");
const { runCheckins } = await import("../src/checkins.js");
const { hourIn, timeIn, todayIn: today } = await import("../src/dates.js");
const savesClaim = /locked in|i've noted|i have noted|noted that|i'll check in|i will check in|heads-up|i'll remind|i will remind|scheduled|on your list/i;
/** A zone where it is `hour` o'clock right now, to run time-of-day jobs without waiting. */
const zoneAt = (hour: number) => [...Array(27).keys()].map((i) => i - 12).map((o) => (o === 0 ? "UTC" : `Etc/GMT${o > 0 ? "-" : "+"}${Math.abs(o)}`)).find((z) => hourIn(z) === hour);
const msgsTo = (id: number, since: number) => sent.slice(since).filter((s) => s.method === "sendMessage" && s.chatId === id).map((s) => s.text ?? "");

// Previews never claim to save: /compare and the app's memory switch.
mark = sent.length;
await say("/compare I have a meeting around 4pm today");
const withPart = (lastText().split("WITH Walrus Memory")[1] ?? "");
if (!withPart) failures.push("/compare: no with-memory answer");
else if (savesClaim.test(withPart)) failures.push(`/compare: preview claims it saved something: "${savesClaim.exec(withPart)![0]}"`);
const cmp = await web.request("/api/app/compare", { method: "POST", body: JSON.stringify({ q: "I'll call my mum at 9pm" }), headers: { "x-telegram-init-data": initData, "content-type": "application/json" } });
const cmpBody = (await cmp.json()) as { on?: string; off?: string; recalled?: number };
if (cmp.status !== 200 || !cmpBody.on || !cmpBody.off) failures.push(`app compare: ${cmp.status}`);
else if (savesClaim.test(cmpBody.on)) failures.push(`app compare: preview claims it saved something: "${savesClaim.exec(cmpBody.on)![0]}"`);
else console.log(`\n   app memory switch: off and on answers, ${cmpBody.recalled} memories recalled, no false save claims`);

// Answers agree with the real promise list: closed promises are never called open.
await say("What promises do I still have open right now?");
const openAnswer = lastText();
if (/\b(cv|water|chapter 3)\b[^.]*\b(still|open|overdue|haven't|pending)\b|\b(still|open|overdue|pending)\b[^.]*\b(cv|water|chapter 3)\b/i.test(openAnswer)) failures.push(`consistency: a kept promise was called open: "${openAnswer.slice(0, 160)}"`);

// Reminders: a reminder time separate from the deadline, then the check at the event.
await say("I have a call with the bank at 11pm tonight, remind me at 10pm");
await settle();
const remId = Object.entries(st.getUser(USER)?.timed ?? {}).find(([, p]) => p.rem)?.[0];
if (!remId) failures.push("reminder: 'remind me at 10pm' did not record a reminder time");
else {
  const tz = st.tzOf(USER), now = timeIn(tz), later = (m: number) => { const d = new Date(Date.now() + m * 60_000); return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d); };
  st.updateUser(USER, (u) => { u.timed![remId] = { ...u.timed![remId]!, due: today(tz), rem: now, at: later(2) }; });
  mark = sent.length;
  await runDeadlineReminders(bot.api);
  if (!msgsTo(USER, mark).some((t) => /^🔔 Your reminder/.test(t))) failures.push("reminder: no 🔔 reminder at the asked time");
  st.updateUser(USER, (u) => { u.timed![remId]!.at = now; });
  mark = sent.length;
  await runDeadlineReminders(bot.api);
  if (!msgsTo(USER, mark).some((t) => /Did you make it\?/.test(t))) failures.push("reminder: no check at the event time");
}
// The plain 30-minute heads-up for a promise without a reminder time.
st.updateUser(USER, (u) => { (u.timed ??= {}).hu01 = { text: "Promised to submit the form", due: today(st.tzOf(USER)), at: (() => { const d = new Date(Date.now() + 20 * 60_000); return new Intl.DateTimeFormat("en-GB", { timeZone: st.tzOf(USER), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d); })() }; });
mark = sent.length;
await runDeadlineReminders(bot.api);
if (!msgsTo(USER, mark).some((t) => /^⏳ 30 minutes left/.test(t))) failures.push("reminder: no 30-minute heads-up");
st.updateUser(USER, (u) => { delete u.timed!.hu01; (u.closed ??= {}).hu01 = "kept"; });

// Outcome buttons beyond "Did it": partly and move it.
await say("I'll tidy my desk today.");
await settle();
await say("/checkin");
const partly = lastButtons().find((b) => b.includes(":partial"));
if (!partly) failures.push("/checkin: no Partly button");
else {
  mark = sent.length;
  await tap(partly.split("=>")[1]!);
  if (!msgsTo(USER, mark).some((t) => /Partial still counts/.test(t))) failures.push("Partly: wrong follow-up");
}
await say("I'll read one article today.");
await settle();
await say("/checkin");
const moveIt = lastButtons().find((b) => b.includes(":moved"));
if (!moveIt) failures.push("/checkin: no Move it button");
else {
  await tap(moveIt.split("=>")[1]!);
  if (!/when will you do/i.test(lastText())) failures.push("Move it: did not ask for a new time");
}

// Time-of-day jobs, run now by moving the person into a zone where it's that hour.
const z8 = zoneAt(8), z19 = zoneAt(19);
if (z8) {
  st.updateUser(USER, (u) => { u.tz = z8; delete u.lastMorning; u.morning = true; });
  mark = sent.length;
  await runMorning(bot.api);
  if (!msgsTo(USER, mark).some((t) => /Good morning/.test(t))) failures.push("morning brief: not sent at 08:00 local");
  await say("/morning off");
  st.updateUser(USER, (u) => delete u.lastMorning);
  mark = sent.length;
  await runMorning(bot.api);
  if (msgsTo(USER, mark).some((t) => /Good morning/.test(t))) failures.push("morning brief: sent after /morning off");
  await say("/morning on");
}
if (z19) {
  st.updateUser(USER, (u) => { u.tz = z19; delete u.lastEvening; });
  mark = sent.length;
  await runCheckins(bot.api);
  console.log(`\n   evening check-in at 19:00 local sent ${msgsTo(USER, mark).length} message(s)`);
}
st.updateUser(USER, (u) => { u.tz = "Africa/Lagos"; });
await say("/week");
if (!/follow-through|kept/i.test(lastText())) failures.push("/week: no summary");

// The photo chooser: a photo that proves nothing gets a "which promise?" question, and "Not a proof" works.
fixtures.logo = "docs/img/bot-photo.jpg";
await say("I'll stretch for 10 minutes today.");
await settle();
mark = sent.length;
await sendMsg({ photo: [{ file_id: "logo", file_unique_id: "p2", width: 640, height: 640 }] }, "[photo that proves nothing]");
const ask = sent.slice(mark).find((s) => s.buttons?.some((b) => b.endsWith(":none")));
const accepted = sent.slice(mark).some((s) => /Proof accepted/.test(s.text ?? ""));
if (accepted) failures.push("photo: a logo was accepted as proof");
else if (!ask) failures.push("photo: no 'which promise?' chooser for an unclear photo");
else {
  await tap(ask.buttons!.find((b) => b.endsWith(":none"))!.split("=>")[1]!);
  if (!/won't count it/.test(lastText())) failures.push("photo chooser: 'Not a proof' did nothing");
}

// The rest of the tour, habits, buddies, and the small commands.
for (let step = 2; step <= 6; step++) await tap(`tour:${step}`);
mark = sent.length;
await tap("tour:demo");
if (!sent.slice(mark).some((s) => /real promise now/.test(s.text ?? ""))) failures.push("tour demo: no demo promise");
await say("/habit stop 1");
if (!/Stopped/.test(lastText())) failures.push("/habit stop: did not stop");
await say("/buddy private");
if (!/only see that you kept or missed/.test(lastText())) failures.push("/buddy private: wrong reply");
await say("/buddy share");
await say("/mymemory");
if (!/Own your memory|own Walrus Memory account/.test(lastText())) failures.push("/mymemory: no explanation");
await say("/app");
if (!sent.at(-1)?.buttons?.length) failures.push("/app: no button to open the app");
await say("/wallet verify");
await say("/record on");
await say("/record off");

// The app's buttons: share and the public card, morning toggle, memory disconnect, a photo proof.
const auth = { "x-telegram-init-data": initData, "content-type": "application/json" };
const share = (await (await web.request("/api/app/share", { method: "POST", headers: auth })).json()) as { url?: string };
const code = share.url?.split("/c/")[1];
if (!code) failures.push("app share: no card link");
else {
  const card = await web.request(`/c/${code}`);
  const html = await card.text();
  if (card.status !== 200 || !/in the last 30 days|keeping their promises/.test(html) || /<script/.test(html)) failures.push(`share card: ${card.status}`);
  await web.request("/api/app/share", { method: "DELETE", headers: auth });
  if ((await web.request(`/c/${code}`)).status !== 404) failures.push("share card: still public after Stop sharing");
}
await web.request("/api/app/morning", { method: "POST", headers: auth, body: JSON.stringify({ on: false }) });
if (st.getUser(USER)?.morning !== false) failures.push("app: morning toggle did not switch off");
await web.request("/api/app/morning", { method: "POST", headers: auth, body: JSON.stringify({ on: true }) });
if ((await web.request("/api/app/memory", { method: "DELETE", headers: auth })).status !== 200) failures.push("app: memory disconnect failed");
const pic = st.proofsOf(String(USER)).find((p) => p.jobId);
if (pic) {
  const img = await web.request(`/api/app/proof/${pic.id}`, { headers: auth });
  if (img.status !== 200 || !Buffer.from(await img.arrayBuffer()).equals(readFileSync(fixtures.photo!))) failures.push(`app: photo proof ${img.status}`);
  else console.log("   app photo proof: decrypted from Walrus through the route, byte for byte");
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
