import { randomBytes } from "node:crypto";
import { sequentialize } from "@grammyjs/runner";
import { downloadFile, judgePhoto, transcribe } from "../media.js";
import { connectOwnMemory, disconnectOwnMemory } from "../memory/own.js";
import { MORNING_HOUR, morningBrief } from "../morning.js";
import { storeProof } from "../proof.js";
import { GROUP_COMMANDS, registerGroupCommands } from "./group-commands.js";
import { FOLLOW, recordOutcome, type Settled } from "./outcomes.js";
import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { checkInUser, dueCommitments, outcomeKeyboard } from "../checkins.js";
import { weeklySummary } from "../reminders.js";
import { config } from "../config.js";
import { relativeDay, timeIn, todayIn, weekdayOf } from "../dates.js";
import { MODEL_LABEL } from "../llm/model.js";
import { listUserNamespaces } from "../memory/client.js";
import { mergeAndFilter, pendingFor, recall, recallCommitments } from "../memory/recall.js";
import { clause, effectiveDue, isOpen, memoryHash, type MemoryKind, type RecalledMemory } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser, upsertUser } from "../state.js";
import { isOverloadError } from "../llm/model.js";
import { analyzeFallback } from "../memory/write.js";
import { chatTurn, enqueue, generateReply } from "./conversation.js";
import { CHAIN_COMMANDS, CHAIN_HELP, registerChainCommands } from "./chain-commands.js";
import { ONBOARDING_COMMANDS, registerOnboarding } from "./onboarding.js";
import { HABIT_COMMANDS, registerHabitCommands } from "./habit-commands.js";
import { BUDDY_COMMANDS, handleBuddyStart, registerBuddyCommands } from "./buddy-commands.js";
import { metrics } from "../state.js";

const WALRUSCAN = "https://walruscan.com/mainnet/blob/";
const TELEGRAM_LIMIT = 4000;

const HELP = `Here's how I work:

• Tell me what you're going to do and by when, like "I'll send 5 job applications by Friday".
• I remember it on Walrus, and when it's due I'll message you first and ask how it went.
• Over time I learn your patterns, what derails you and what actually works, and I use them.
• Money promises in USDC, USDsui, SUI or WAL can be verified on your Sui wallet, so the chain reports them, not you.
• Talk instead of typing: send a voice note. Done something? Send a photo as proof.

Commands
/app: your promises, streaks and what I've learned, in one place
/morning: your morning brief now (/morning off to stop the daily one)
/mymemory: move your memory into your own Walrus Memory account
/promises: your open and finished promises
/memory: everything I remember about you
/why: the exact memories behind my last reply
/compare <message>: see my answer with and without memory
/forget <topic>: make me forget something
/checkin: check in on due promises now
/week: your follow-through this week
/stats: how much Anchor remembers overall
/timezone <city>: run everything on your local time
/tour: a two-minute tour
/habit gym 3x a week: a habit with a streak (/habits lists them)
/buddy: invite a friend to hold you accountable
Groups: add me to a group chat, then /promise and /board there
${CHAIN_HELP}`;

async function sendLong(ctx: Context, text: string, extra?: Parameters<Context["reply"]>[1]) {
  for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) {
    await ctx.reply(text.slice(i, i + TELEGRAM_LIMIT), extra);
  }
}

/** Keep Telegram's "typing…" indicator alive while slow work runs. */
async function withTyping<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  const send = () => ctx.replyWithChatAction("typing").catch(() => undefined);
  void send();
  const timer = setInterval(send, 4500);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

function touch(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, ctx.chat?.id ?? from.id, from.first_name ?? "");
}

function shortBlob(blobId: string) {
  return blobId ? `blob ${blobId.slice(0, 8)}…` : "saving to Walrus (just learned)";
}

const KIND_LABEL: Record<MemoryKind | "note", string> = {
  commitment: "🎯 Promises",
  outcome: "📒 Outcomes",
  pattern: "🔁 Patterns",
  win: "🏆 What works",
  fact: "👤 About you",
  preference: "⚙️ Preferences",
  retracted: "🗑 Forgotten",
  report: "🧾 Signed reports",
  habit: "🔄 Habits",
  streak: "🔥 Streaks",
  note: "📝 Notes",
};

/** Candidates offered by /forget, keyed by user then memory hash. */
const forgetCandidates = new Map<string, Map<string, string>>();

/** The mini app's URL, when this server has a public https address. */
export const appUrl = () => (/^https:\/\//.test(config.PUBLIC_URL) ? `${config.PUBLIC_URL.replace(/\/$/, "")}/app` : "");

interface PendingPhoto {
  userId: number;
  bytes: Uint8Array;
  mediaType: string;
  description: string;
  shows: "done" | "partial" | "unclear";
}
/** Photos waiting for the person to say which promise they prove (in memory, 30 minutes). */
const pendingPhotos = new Map<string, PendingPhoto & { expires: number }>();

function putPendingPhoto(p: PendingPhoto): string {
  const now = Date.now();
  for (const [k, v] of pendingPhotos) if (v.expires < now || v.userId === p.userId) pendingPhotos.delete(k);
  const id = randomBytes(6).toString("hex");
  pendingPhotos.set(id, { ...p, expires: now + 30 * 60_000 });
  return id;
}

function takePendingPhoto(id: string, userId: number): PendingPhoto | undefined {
  const p = pendingPhotos.get(id);
  if (!p || p.userId !== userId || p.expires < Date.now()) return undefined;
  pendingPhotos.delete(id);
  return p;
}

/** Store the photo (encrypted, on Walrus) and record the outcome it proves. */
async function acceptPhoto(ctx: Context, promiseId: string, p: PendingPhoto) {
  const status: Settled = p.shows === "partial" ? "partial" : "kept";
  const proof = await storeProof(String(p.userId), promiseId, p.bytes, p.mediaType, p.description);
  const res = await recordOutcome(p.userId, promiseId, status, { pic: proof.id, note: `Photo proof: ${clause(p.description)}` });
  if ("error" in res) {
    await ctx.reply(res.error);
    return;
  }
  const stored = proof.jobId
    ? "The photo is encrypted and stored on Walrus: only you can open it again (in /app)."
    : "(I couldn't store the photo this time, but the outcome is recorded.)";
  await ctx.reply(`📸 Proof accepted: ${clause(p.description)}.\n#${promiseId} · ${res.text} is ${status === "kept" ? "kept ✅" : "partly kept 🟡"}\n${stored}\n\n${FOLLOW[status]}`);
}

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // A slow Walrus call for one person never blocks another, but each chat stays in order.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  // Groups get their own small command set (group-commands.ts); everything else is 1:1.
  registerGroupCommands(bot);
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    if (!ctx.from) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    if (await handleBuddyStart(ctx)) return; // t.me/<bot>?start=buddy_<token>
    const user = touch(ctx);
    await withTyping(ctx, async () => {
      const states = await recallCommitments(ctx.from!.id).catch(() => []);
      const open = states.filter(isOpen);
      if (states.length === 0) {
        await ctx.reply(
          `Hey${user.firstName ? ` ${user.firstName}` : ""}, I'm Anchor, the bot that holds you to your word.\n\nMost chatbots forget you when the chat ends. I don't: everything you tell me is stored as encrypted memory on Walrus, so I can follow up, notice patterns, and remember what actually works for you.\n\nLet's start: what's one thing you keep promising yourself you'll do? Tell me what, and by when.${user.tz ? "" : "\n\nWhere are you? /timezone your city, so reminders arrive on your local time."}`,
          { reply_markup: new InlineKeyboard().text("▶ Take the 2-minute tour", "tour:0") },
        );
      } else {
        await ctx.reply(
          `Welcome back${user.firstName ? `, ${user.firstName}` : ""}. I still remember ${states.length} promise${states.length === 1 ? "" : "s"}, ${open.length} still open. Want to go through them (/promises) or tell me what's new?`,
        );
      }
    });
  });

  bot.command("help", (ctx) => ctx.reply(HELP));

  bot.command("promises", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      const tz = tzOf(ctx.from!.id);
      const today = todayIn(tz);
      const states = await recallCommitments(ctx.from!.id);
      if (states.length === 0) {
        await ctx.reply("You haven't made me any promises yet. What's one thing you'll do, and by when?");
        return;
      }
      const open = states.filter(isOpen);
      const done = states.filter((s) => !isOpen(s));
      const lines: string[] = [];
      if (open.length) {
        lines.push("OPEN");
        for (const s of open) {
          const due = effectiveDue(s);
          const flag = due && due < today ? " ⚠️ overdue" : due === today ? " ⏰ today" : "";
          lines.push(`• #${s.commitment.id} ${clause(s.commitment.text)}${due ? ` (due ${weekdayOf(due)} ${due}, ${relativeDay(due, today)})${flag}` : ""}`);
        }
      }
      if (done.length) {
        const icon = { kept: "✅", partial: "🟡", broken: "❌", moved: "📅" } as const;
        lines.push("", "FINISHED");
        for (const s of done) lines.push(`${icon[s.outcome!.status ?? "kept"]} #${s.commitment.id} ${clause(s.commitment.text)}`);
        const kept = done.filter((s) => s.outcome!.status === "kept").length;
        lines.push("", `Follow-through: ${kept}/${done.length} kept`);
      }
      await sendLong(ctx, lines.join("\n"));
      const due = dueCommitments(open, today, timeIn(tz));
      for (const s of due) {
        await ctx.reply(`#${s.commitment.id} is due, how did it go?`, {
          reply_markup: outcomeKeyboard(s.commitment.id!),
        });
      }
    });
  });

  bot.command("memory", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      const userId = ctx.from!.id;
      const [sweeps, stats] = await Promise.all([
        Promise.all([
          recall(userId, "everything about this user: who they are, promises, outcomes, patterns, what works", { limit: 30, sort: "recent" }),
          recall(userId, "facts, preferences, patterns and wins about the user", { limit: 20 }),
        ]),
        listUserNamespaces().catch(() => []),
      ]);
      const memories = mergeAndFilter(userId, ...sweeps, pendingFor(userId)); // include what was just learned
      const total = stats.find((s) => s.userId === String(userId))?.memoryCount;
      if (memories.length === 0) {
        await ctx.reply("I don't remember anything about you yet. Tell me something you're working on!");
        return;
      }
      const groups = new Map<string, RecalledMemory[]>();
      for (const m of memories) groups.set(m.kind, [...(groups.get(m.kind) ?? []), m]);
      const order: Array<MemoryKind | "note"> = ["fact", "preference", "commitment", "outcome", "habit", "streak", "pattern", "win", "report", "note"];
      const lines = [`What I remember about you${total !== undefined ? ` (${total} memories stored on Walrus)` : ""}:`];
      for (const kind of order) {
        const items = groups.get(kind);
        if (!items?.length) continue;
        lines.push("", KIND_LABEL[kind]);
        for (const m of items) lines.push(`• ${m.text}${m.date ? ` (${m.date})` : ""}`);
      }
      lines.push("", "Each memory is encrypted and stored as a Walrus blob. /why shows blob IDs. /forget <topic> removes something.");
      await sendLong(ctx, lines.join("\n"));
    });
  });

  bot.command("why", async (ctx) => {
    touch(ctx);
    const trace = getUser(ctx.from!.id)?.lastTrace;
    if (!trace) {
      await ctx.reply("Send me a message first, then /why shows which memories shaped my reply.");
      return;
    }
    if (trace.items.length === 0) {
      await ctx.reply(`For your last message ("${trace.query.slice(0, 80)}") I didn't recall any memories, nothing relevant yet.`);
      return;
    }
    const lines = [`My last reply was shaped by ${trace.items.length} memories recalled from Walrus for "${trace.query.slice(0, 80)}":`, ""];
    trace.items.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.raw}`);
      lines.push(`   relevance ${(1 - m.distance).toFixed(2)} · ${shortBlob(m.blobId)}${m.blobId ? ` ${WALRUSCAN}${m.blobId}` : ""}`);
    });
    await sendLong(ctx, lines.join("\n"), { link_preview_options: { is_disabled: true } });
  });

  bot.command("compare", async (ctx) => {
    const user = touch(ctx);
    const message = ctx.match.trim();
    if (!message) {
      await ctx.reply('Usage: /compare <message>\nExample: /compare I want to start going to the gym again');
      return;
    }
    await withTyping(ctx, async () => {
      const args = { userId: ctx.from!.id, firstName: user.firstName, message, useHistory: false };
      const [r1, r2] = await Promise.allSettled([
        generateReply({ ...args, withMemory: false }),
        generateReply({ ...args, withMemory: true }),
      ]);
      if (r1.status === "rejected" || r2.status === "rejected") {
        const err = r1.status === "rejected" ? r1.reason : (r2 as PromiseRejectedResult).reason;
        if (!isOverloadError(err)) throw err;
        await ctx.reply("My AI brain (Google Gemini) is overloaded right now, so I can't run the comparison. Please try /compare again in a minute.");
        return;
      }
      const without = r1.value, withMem = r2.value;
      const n = withMem.context?.memories.length ?? 0;
      await sendLong(
        ctx,
        `🫥 WITHOUT memory:\n${without.reply}\n\n⚓ WITH Walrus Memory (${n} memories recalled):\n${withMem.reply}`,
      );
    });
  });

  bot.command("forget", async (ctx) => {
    touch(ctx);
    const topic = ctx.match.trim();
    if (!topic) {
      await ctx.reply("Usage: /forget <topic>\nExample: /forget my ex");
      return;
    }
    await withTyping(ctx, async () => {
      const userId = ctx.from!.id;
      // A one-word topic ("hospital") is a weak semantic query, so also look for the words themselves
      // in recent memories; exact-word matches come first.
      const [semantic, recent] = await Promise.all([
        recall(userId, topic, { limit: 8, maxDistance: 0.85 }),
        recall(userId, "everything about this user: promises, outcomes, facts, patterns, wins", { limit: 30, sort: "recent" }),
      ]);
      const words = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hasWord = (m: RecalledMemory) => words.some((w) => m.text.toLowerCase().includes(w));
      const all = mergeAndFilter(userId, semantic, recent.filter(hasWord));
      const hits = [...all.filter(hasWord), ...all.filter((m) => !hasWord(m) && m.distance < 0.7)].slice(0, 4);
      if (hits.length === 0) {
        await ctx.reply("I couldn't find anything I remember about that.");
        return;
      }
      const map = new Map<string, string>();
      const kb = new InlineKeyboard();
      for (const h of hits) {
        const hash = memoryHash(h.raw);
        map.set(hash, h.raw);
        kb.text(`🗑 ${h.text.slice(0, 40)}`, `f:${hash}`).row();
      }
      forgetCandidates.set(String(ctx.from!.id), map);
      await ctx.reply(`Which of these should I forget?\n\n${hits.map((h) => `• ${h.text}`).join("\n")}`, { reply_markup: kb });
    });
  });

  bot.command("checkin", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, () => checkInUser(ctx.api, String(ctx.from!.id), { force: true }));
  });

  bot.command("week", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      await sendLong(ctx, await weeklySummary(ctx.from!.id));
    });
  });

  bot.command("stats", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      const stats = await listUserNamespaces();
      const total = stats.reduce((n, s) => n + s.memoryCount, 0);
      const mine = stats.find((s) => s.userId === String(ctx.from!.id))?.memoryCount ?? 0;
      const m = metrics();
      const shaped = m.replies ? Math.round((m.repliesShapedByLearning / m.replies) * 100) : 0;
      await ctx.reply(
        `Anchor right now:\n• ${stats.length} people\n• ${total} memories on Walrus\n• ${mine} of them are yours\n• ${shaped}% of replies used a learned pattern or win\n• ${m.chainVerified.kept + m.chainVerified.broken} promises verified on Sui\n\nModel: ${MODEL_LABEL} · Memory: Walrus Memory (mainnet) · Chain: Sui via Tatum`,
      );
    });
  });

  // Outcome buttons: o:<commitmentId>:<status>
  bot.callbackQuery(/^o:([a-z0-9]+):(kept|partial|broken|moved)$/, async (ctx) => {
    const user = touch(ctx);
    const [, id, status] = ctx.match as RegExpMatchArray;
    const userId = ctx.from.id;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);

    if (status === "moved") {
      updateUser(userId, (u) => {
        u.awaitingOutcome = [...new Set([...u.awaitingOutcome, id!])];
      });
      await ctx.reply(`No problem, when will you do #${id} instead? (And what got in the way?)`);
      return;
    }

    const res = await recordOutcome(userId, id!, status as Settled);
    await ctx.reply("error" in res ? res.error : FOLLOW[status as Settled]);
  });

  // Photo proof chooser: pf:<pendingId>:<promiseId> | pf:<pendingId>:none
  bot.callbackQuery(/^pf:([\w]+):([a-z0-9]+)$/, async (ctx) => {
    touch(ctx);
    const [, pid, promiseId] = ctx.match as RegExpMatchArray;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const pending = takePendingPhoto(pid!, ctx.from.id);
    if (!pending) {
      await ctx.reply("That photo expired, send it again.");
      return;
    }
    if (promiseId === "none") {
      await ctx.reply("Okay, I won't count it as proof.");
      return;
    }
    await withTyping(ctx, () => acceptPhoto(ctx, promiseId!, pending));
  });

  bot.command("mymemory", async (ctx) => {
    touch(ctx);
    const userId = String(ctx.from!.id);
    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    const own = getUser(userId)?.ownMemory;
    if (parts[0]?.toLowerCase() === "off") {
      await ctx.reply(disconnectOwnMemory(userId) ? "Done. I'm back on Anchor's Walrus Memory account. Everything already in your own account stays yours." : "You're already on Anchor's account.");
      return;
    }
    if (parts.length >= 2) {
      // The message holds a secret key: take it out of the chat first.
      await ctx.deleteMessage().catch(() => undefined);
      const [accountId, key] = parts as [string, string];
      await withTyping(ctx, async () => {
        try {
          const copied = await connectOwnMemory(userId, accountId, key, { copy: true });
          await ctx.reply(`🗝 Connected. Your memory now lives in your own Walrus Memory account (${accountId.slice(0, 8)}…), in the "anchor" namespace.${copied ? ` I copied ${copied} memories over.` : ""}\n\nI deleted your message so the key isn't left in this chat. The key is stored encrypted, and you can revoke it any time on memory.walrus.xyz. /mymemory off switches back.`);
        } catch (err) {
          await ctx.reply(`${err instanceof Error ? err.message : "That didn't work."}\n\n(I deleted your message so the key isn't left in this chat.)`);
        }
      });
      return;
    }
    const kb = appUrl() ? new InlineKeyboard().webApp("🗝 Connect in the app", `${appUrl()}#memory`) : undefined;
    await ctx.reply(
      own
        ? `🗝 Your memory lives in your own Walrus Memory account (${own.accountId.slice(0, 8)}…) since ${own.since.slice(0, 10)}.\n/mymemory off switches back to Anchor's account.`
        : `🗝 Own your memory.\n\nRight now your memories are encrypted on Walrus in Anchor's account, in a space only you have. You can move them into your OWN Walrus Memory account, so they're yours outright and other apps you trust can use them too.\n\n1. Sign in at memory.walrus.xyz\n2. Create a delegate key, copy its private key and your account ID\n3. Connect in the app below (safest), or send:\n/mymemory <account ID> <delegate private key>\n(I delete that message right away.)`,
      { reply_markup: kb, link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("app", async (ctx) => {
    touch(ctx);
    const url = appUrl();
    if (!url) {
      await ctx.reply("The app isn't switched on for this Anchor yet (it needs a public https URL).");
      return;
    }
    await ctx.reply("📱 Your promises, streaks, what I've learned about you, and the memory switch, all in one place:", {
      reply_markup: new InlineKeyboard().webApp("Open Anchor", url),
    });
  });

  bot.command("morning", async (ctx) => {
    touch(ctx);
    const arg = ctx.match.trim().toLowerCase();
    if (arg === "off" || arg === "on") {
      updateUser(ctx.from!.id, (u) => (u.morning = arg === "on"));
      await ctx.reply(arg === "on" ? `☀️ Morning brief on: every day at ${MORNING_HOUR}:00 your time.` : "Morning brief off. /morning on brings it back.");
      return;
    }
    await withTyping(ctx, async () => {
      await ctx.reply(await morningBrief(ctx.from!.id), { link_preview_options: { is_disabled: true } });
    });
  });

  bot.command("promise", (ctx) => ctx.reply("Just tell me here what you'll do and by when. /promise is for groups: add me to a group chat and everyone can promise in front of each other."));

  // Forget buttons: f:<memoryHash>
  bot.callbackQuery(/^f:([a-z0-9]+)$/, async (ctx) => {
    touch(ctx);
    const hash = (ctx.match as RegExpMatchArray)[1]!;
    const userId = ctx.from.id;
    const raw = forgetCandidates.get(String(userId))?.get(hash);
    await ctx.answerCallbackQuery();
    if (!raw) {
      await ctx.reply("That list expired, run /forget again.");
      return;
    }
    updateUser(userId, (u) => {
      u.tombstones = [...new Set([...u.tombstones, hash])];
    });
    void enqueue(`write:${userId}`, () =>
      storeMemories(userId, [
        { kind: "retracted", date: todayIn(tzOf(userId)), ref: hash, text: `User asked Anchor to forget: ${raw}` },
      ]),
    ).catch((err) => console.error(`[memory] background write failed for ${userId}:`, err));
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("Done, I won't use that memory again.");
  });

  registerChainCommands(bot, withTyping);
  registerOnboarding(bot, withTyping);
  registerHabitCommands(bot, withTyping);
  registerBuddyCommands(bot);

  /** A normal message, typed or spoken: reply with memory, learn in the background. */
  async function converse(ctx: Context, text: string) {
    const user = touch(ctx);
    const userId = ctx.from!.id;
    let turn;
    try {
      turn = await chatTurn(userId, user.firstName, text, (t) => ctx.reply(t, { link_preview_options: { is_disabled: true } }));
    } catch (err) {
      if (!isOverloadError(err)) throw err;
      // Google's AI is overloaded: no reply possible, but don't lose what they said.
      console.error(`[bot] no model available for user ${userId}; saving the message via Walrus analyze`);
      void enqueue(`write:${userId}`, () =>
        analyzeFallback(userId, text, "").catch((e) =>
          console.error(`[memory] analyze fallback failed for user ${userId}:`, e instanceof Error ? e.message : e),
        ),
      );
      await ctx.reply(
        "Sorry, my AI brain (Google Gemini) is overloaded right now, so I can't reply properly. I did save what you just told me to memory. Please send me another message in a minute.",
      );
      return;
    }
    const n = turn.context?.memories.length ?? 0;
    const footer = n > 0 ? `\n\n⚓ ${n} memor${n === 1 ? "y" : "ies"} · /why` : "";
    await sendLong(ctx, turn.reply + footer);
  }

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      await ctx.reply("I don't know that command. /help lists what I can do.");
      return;
    }
    await enqueue(`turn:${ctx.from.id}`, () => withTyping(ctx, () => converse(ctx, ctx.message.text.slice(0, 4000))));
  });

  // Voice promises: "I'll finish two chapters tonight", said instead of typed.
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    touch(ctx);
    const media = ctx.message.voice ?? ctx.message.audio!;
    if ((media.duration ?? 0) > 300 || (media.file_size ?? 0) > 15 * 1024 * 1024) {
      await ctx.reply("That's a long one. Keep voice notes under 5 minutes and I'll listen.");
      return;
    }
    await enqueue(`turn:${ctx.from.id}`, () =>
      withTyping(ctx, async () => {
        let transcript: string;
        try {
          transcript = await transcribe(await downloadFile(ctx.api, media.file_id), media.mime_type ?? "audio/ogg");
        } catch (err) {
          console.error(`[voice] ${ctx.from.id}:`, err instanceof Error ? err.message : err);
          await ctx.reply("I couldn't hear that one properly. Try again, or type it.");
          return;
        }
        if (!transcript) {
          await ctx.reply("I couldn't make out any words in that. Try again, or type it.");
          return;
        }
        await ctx.reply(`🎙 I heard: "${transcript.slice(0, 600)}"`);
        await converse(ctx, transcript.slice(0, 4000));
      }),
    );
  });

  // Photo proof: a gym selfie, a screenshot of the sent email, the finished page.
  bot.on("message:photo", async (ctx) => {
    touch(ctx);
    const userId = ctx.from.id;
    await enqueue(`turn:${userId}`, () =>
      withTyping(ctx, async () => {
        const open = (await recallCommitments(userId)).filter(isOpen).filter((s) => s.commitment.id && !getUser(userId)?.closed?.[s.commitment.id]);
        if (!open.length) {
          await ctx.reply("Nice photo! I don't have an open promise it could prove, though. Tell me what you'll do and by when, then send the proof when it's done.");
          return;
        }
        const size = ctx.message.photo.at(-1)!;
        const bytes = await downloadFile(ctx.api, size.file_id);
        const list = open.slice(0, 15).map((s) => ({ id: s.commitment.id!, text: clause(s.commitment.text) }));
        let v;
        try {
          v = await judgePhoto(bytes, "image/jpeg", ctx.message.caption ?? "", list);
        } catch (err) {
          if (!isOverloadError(err)) throw err;
          await ctx.reply("My AI brain is overloaded right now, so I can't look at photos. Send it again in a minute.");
          return;
        }
        const pending = { userId, bytes, mediaType: "image/jpeg", description: v.description, shows: v.shows };
        if (v.promiseId && v.shows !== "unclear") {
          await acceptPhoto(ctx, v.promiseId, pending);
          return;
        }
        const pid = putPendingPhoto(pending);
        const kb = new InlineKeyboard();
        for (const p of list.slice(0, 6)) kb.text(`#${p.id} ${p.text.slice(0, 28)}`, `pf:${pid}:${p.id}`).row();
        kb.text("Not a proof", `pf:${pid}:none`);
        await ctx.reply(`📸 I see: ${v.description}\nWhich promise does this prove?`, { reply_markup: kb });
      }),
    );
  });

  bot.on("message", (ctx) => ctx.reply("I understand text, voice notes and photos (send a photo as proof that you kept a promise)."));

  bot.catch(async (err) => {
    console.error(
      `[bot] error handling update ${err.ctx.update.update_id}:`,
      String(err.error instanceof Error ? (err.error.stack ?? err.error.message) : err.error).split(config.TELEGRAM_BOT_TOKEN).join("<token>"),
    );
    if (err.error instanceof GrammyError && err.error.error_code === 403) return; // user blocked the bot
    await err.ctx
      .reply("Something went wrong on my side. Please send that again in a minute; your memories are safe.")
      .catch(() => undefined);
  });

  return bot;
}

export { GROUP_COMMANDS };

export const BOT_COMMANDS = [
  { command: "app", description: "Open your Anchor dashboard" },
  { command: "promises", description: "Your open and finished promises" },
  { command: "morning", description: "Your morning brief" },
  { command: "mymemory", description: "Own your memory (your Walrus account)" },
  { command: "memory", description: "Everything Anchor remembers about you" },
  { command: "why", description: "Memories behind the last reply" },
  { command: "compare", description: "Answer with vs without memory" },
  { command: "forget", description: "Make Anchor forget something" },
  { command: "checkin", description: "Check in on due promises now" },
  { command: "week", description: "Your follow-through this week" },
  { command: "stats", description: "How much Anchor remembers overall" },
  ...ONBOARDING_COMMANDS,
  ...HABIT_COMMANDS,
  ...BUDDY_COMMANDS,
  ...CHAIN_COMMANDS,
  { command: "help", description: "How Anchor works" },
];
