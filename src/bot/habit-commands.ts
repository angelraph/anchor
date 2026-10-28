/**
 * /habit <what and how often>   start a habit ("gym 3x a week", "read 20 minutes daily")
 * /habits                       streaks, progress, one-tap "done today"
 * /habit stop <n>               stop one
 */
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { todayIn } from "../dates.js";
import { describeRep, habitKeyboard, habitRecord, markHabit, parseHabit, periodKey, doneIn, progress } from "../habits.js";
import { clause } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser, upsertUser } from "../state.js";
import { enqueue } from "./conversation.js";

function touch(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, ctx.chat?.id ?? from.id, from.first_name ?? "");
}

export function registerHabitCommands(bot: Bot, withTyping: <T>(ctx: Context, work: () => Promise<T>) => Promise<T>) {
  bot.command("habit", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const arg = ctx.match.trim();
    const stop = /^stop\s+(\d+)$/i.exec(arg);
    if (stop) {
      const list = Object.entries(getUser(userId)?.habits ?? {}).filter(([, h]) => h.active);
      const pick = list[Number(stop[1]) - 1];
      if (!pick) {
        await ctx.reply("No habit with that number. /habits lists them.");
        return;
      }
      updateUser(userId, (u) => {
        u.habits![pick[0]]!.active = false;
      });
      await ctx.reply(`Stopped: ${clause(pick[1].text)}. Best streak: ${pick[1].best}. I'll remember how it went.`);
      return;
    }
    if (!arg) {
      await ctx.reply("Start a habit with how often you'll do it:\n/habit gym 3x a week\n/habit read 20 minutes daily\n\nI'll ask each evening and keep your streak.");
      return;
    }
    await withTyping(ctx, async () => {
      const def = await parseHabit(arg).catch(() => null);
      if (!def) {
        await ctx.reply('I couldn\'t read that. Try "/habit gym 3x a week" or "/habit meditate daily".');
        return;
      }
      const record = habitRecord(userId, def);
      await enqueue(`write:${userId}`, () => storeMemories(userId, [record])).catch(() => undefined);
      await ctx.reply(`🔄 New habit: ${def.text}, ${describeRep(def)}.\nI'll ask each evening, and every ${def.per === "day" ? "day" : "week"} you hit it grows your streak. /habits shows them.`, {
        reply_markup: habitKeyboard(record.id!),
      });
    });
  });

  bot.command("habits", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const today = todayIn(tzOf(userId));
    const list = Object.entries(getUser(userId)?.habits ?? {}).filter(([, h]) => h.active);
    if (!list.length) {
      await ctx.reply("No habits yet. /habit gym 3x a week starts one.");
      return;
    }
    const kb = new InlineKeyboard();
    const lines = ["🔄 Your habits", ""];
    list.forEach(([id, h], i) => {
      const doneToday = h.done.includes(today);
      lines.push(`${i + 1}. ${clause(h.text)} (${describeRep(h)})\n   ${progress(h, today)}${h.best > 1 ? ` · best ${h.best}` : ""}${doneToday ? " ✅" : ""}`);
      if (!doneToday && doneIn(h, periodKey(h.per, today)) < h.times) kb.text(`✅ ${clause(h.text).slice(0, 24)}`, `h:${id}:done`).row();
    });
    lines.push("", "/habit stop <number> to stop one.");
    await ctx.reply(lines.join("\n"), { reply_markup: kb });
  });

  // h:<id>:done | h:<id>:skip
  bot.callbackQuery(/^h:([a-z0-9]+):(done|skip)$/, async (ctx) => {
    touch(ctx);
    const [, id, what] = ctx.match as RegExpMatchArray;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const userId = ctx.from.id;
    const h = markHabit(userId, id!, what as "done" | "skip");
    if (!h) {
      await ctx.reply("I couldn't find that habit anymore.");
      return;
    }
    const today = todayIn(tzOf(userId));
    if (what === "skip") {
      await ctx.reply(`Noted. ${progress(h, today)}. What got in the way today? I'll remember it.`);
      return;
    }
    const n = doneIn(h, periodKey(h.per, today));
    const hit = n === h.times;
    await ctx.reply(hit ? `🔥 ${clause(h.text)}: ${h.per === "day" ? "done for today" : `${n}/${h.times}, this week's target is hit`}. ${progress(h, today)}` : `✅ ${clause(h.text)}: ${progress(h, today)}`);
  });
}

export const HABIT_COMMANDS = [
  { command: "habit", description: "Start a habit (gym 3x a week)" },
  { command: "habits", description: "Your habits and streaks" },
];
