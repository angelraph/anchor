import { sequentialize } from "@grammyjs/runner";
import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { checkInUser, outcomeKeyboard } from "../checkins.js";
import { config } from "../config.js";
import { relativeDay, todayIn, weekdayOf } from "../dates.js";
import { MODEL_LABEL } from "../llm/model.js";
import { listUserNamespaces } from "../memory/client.js";
import { mergeAndFilter, recall, recallCommitments } from "../memory/recall.js";
import { clause, effectiveDue, isOpen, memoryHash, type MemoryKind, type RecalledMemory } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { getUser, updateUser, upsertUser } from "../state.js";
import { isOverloadError } from "../llm/model.js";
import { analyzeFallback } from "../memory/write.js";
import { chatTurn, enqueue, generateReply } from "./conversation.js";

const WALRUSCAN = "https://walruscan.com/mainnet/blob/";
const TELEGRAM_LIMIT = 4000;

const HELP = `Here's how I work:

• Tell me what you're going to do and by when, like "I'll send 5 job applications by Friday".
• I remember it on Walrus, and when it's due I'll message you first and ask how it went.
• Over time I learn your patterns, what derails you and what actually works, and I use them.

Commands
/promises: your open and finished promises
/memory: everything I remember about you
/why: the exact memories behind my last reply
/compare <message>: see my answer with and without memory
/forget <topic>: make me forget something
/checkin: check in on due promises now
/stats: how much Anchor remembers overall`;

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
  return blobId ? `${blobId.slice(0, 8)}…` : "pending";
}

const KIND_LABEL: Record<MemoryKind | "note", string> = {
  commitment: "🎯 Promises",
  outcome: "📒 Outcomes",
  pattern: "🔁 Patterns",
  win: "🏆 What works",
  fact: "👤 About you",
  preference: "⚙️ Preferences",
  retracted: "🗑 Forgotten",
  note: "📝 Notes",
};

/** Candidates offered by /forget, keyed by user then memory hash. */
const forgetCandidates = new Map<string, Map<string, string>>();

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // A slow Walrus call for one person never blocks another, but each chat stays in order.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  // Anchor is a 1:1 accountability partner, ignore groups.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    if (!ctx.from) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    const user = touch(ctx);
    await withTyping(ctx, async () => {
      const states = await recallCommitments(ctx.from!.id).catch(() => []);
      const open = states.filter(isOpen);
      if (states.length === 0) {
        await ctx.reply(
          `Hey${user.firstName ? ` ${user.firstName}` : ""}, I'm Anchor, the bot that holds you to your word.\n\nMost chatbots forget you when the chat ends. I don't: everything you tell me is stored as encrypted memory on Walrus, so I can follow up, notice patterns, and remember what actually works for you.\n\nLet's start: what's one thing you keep promising yourself you'll do? Tell me what, and by when.`,
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
      const today = todayIn(config.TIMEZONE);
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
      const due = open.filter((s) => {
        const d = effectiveDue(s);
        return d && d <= today;
      });
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
      const memories = mergeAndFilter(userId, ...sweeps);
      const total = stats.find((s) => s.userId === String(userId))?.memoryCount;
      if (memories.length === 0) {
        await ctx.reply("I don't remember anything about you yet. Tell me something you're working on!");
        return;
      }
      const groups = new Map<string, RecalledMemory[]>();
      for (const m of memories) groups.set(m.kind, [...(groups.get(m.kind) ?? []), m]);
      const order: Array<MemoryKind | "note"> = ["fact", "preference", "commitment", "outcome", "pattern", "win", "note"];
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
      lines.push(`   relevance ${(1 - m.distance).toFixed(2)} · blob ${shortBlob(m.blobId)}${m.blobId ? ` ${WALRUSCAN}${m.blobId}` : ""}`);
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
      const hits = mergeAndFilter(ctx.from!.id, await recall(ctx.from!.id, topic, { limit: 5, maxDistance: 0.7 })).slice(0, 4);
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

  bot.command("stats", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      const stats = await listUserNamespaces();
      const total = stats.reduce((n, s) => n + s.memoryCount, 0);
      const mine = stats.find((s) => s.userId === String(ctx.from!.id))?.memoryCount ?? 0;
      await ctx.reply(
        `Anchor right now:\n• ${stats.length} people\n• ${total} memories on Walrus\n• ${mine} of them are yours\n\nModel: ${MODEL_LABEL} · Memory: Walrus Memory (mainnet)`,
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

    const states = await recallCommitments(userId);
    const state = states.find((s) => s.commitment.id === id);
    if (!state) {
      await ctx.reply(`I couldn't find promise #${id} anymore.`);
      return;
    }
    if (!isOpen(state) || getUser(userId)?.closed?.[id!]) {
      await ctx.reply(`#${id} is already marked as ${state.outcome?.status ?? getUser(userId)?.closed?.[id!]}.`);
      return;
    }
    const verb = { kept: "Kept the promise", partial: "Partly kept the promise", broken: "Did not keep the promise" }[status as "kept" | "partial" | "broken"];
    const promiseText = clause(state.commitment.text);
    const today = todayIn(config.TIMEZONE);
    void enqueue(`write:${userId}`, () =>
      storeMemories(userId, [
        { kind: "outcome", date: today, ref: id, status: status as "kept" | "partial" | "broken", text: `${verb}: ${promiseText}` },
      ]),
    ).catch((err) => console.error(`[memory] background write failed for ${userId}:`, err));
    updateUser(userId, (u) => {
      u.awaitingOutcome = u.awaitingOutcome.filter((x) => x !== id);
      (u.closed ??= {})[id!] = status!;
    });
    const follow = {
      kept: "Noted, that's a kept promise. 💪 What made it work this time? I'll remember it for next time.",
      partial: "Noted. Partial still counts for something. What did you get done, and what stopped the rest?",
      broken: "Thanks for being honest, I've noted it. What got in the way? Knowing that is how we fix it.",
    }[status as "kept" | "partial" | "broken"];
    await ctx.reply(follow);
  });

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
        { kind: "retracted", date: todayIn(config.TIMEZONE), ref: hash, text: `User asked Anchor to forget: ${raw}` },
      ]),
    ).catch((err) => console.error(`[memory] background write failed for ${userId}:`, err));
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("Done, I won't use that memory again.");
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      await ctx.reply("I don't know that command. /help lists what I can do.");
      return;
    }
    const user = touch(ctx);
    const userId = ctx.from.id;
    await enqueue(`turn:${userId}`, () =>
      withTyping(ctx, async () => {
        let turn;
        try {
          turn = await chatTurn(userId, user.firstName, ctx.message.text);
        } catch (err) {
          if (!isOverloadError(err)) throw err;
          // Google's AI is overloaded: no reply possible, but don't lose what they said.
          console.error(`[bot] no model available for user ${userId}; saving the message via Walrus analyze`);
          void enqueue(`write:${userId}`, () =>
            analyzeFallback(userId, ctx.message.text, "").catch((e) =>
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
      }),
    );
  });

  bot.on("message", (ctx) => ctx.reply("I only understand text for now, type it out and I'll remember it."));

  bot.catch(async (err) => {
    console.error(`[bot] error handling update ${err.ctx.update.update_id}:`, err.error);
    if (err.error instanceof GrammyError && err.error.error_code === 403) return; // user blocked the bot
    await err.ctx
      .reply("Something went wrong on my side. Please send that again in a minute; your memories are safe.")
      .catch(() => undefined);
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: "promises", description: "Your open and finished promises" },
  { command: "memory", description: "Everything Anchor remembers about you" },
  { command: "why", description: "Memories behind the last reply" },
  { command: "compare", description: "Answer with vs without memory" },
  { command: "forget", description: "Make Anchor forget something" },
  { command: "checkin", description: "Check in on due promises now" },
  { command: "stats", description: "How much Anchor remembers overall" },
  { command: "help", description: "How Anchor works" },
];
