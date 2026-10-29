/**
 * Anchor in group chats (see groups.ts). Privacy: replies in a group never use
 * anyone's memories; a promise made here is extracted and stored, nothing else.
 */
import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { relativeDay, todayIn, weekdayOf } from "../dates.js";
import { boardLines } from "../groups.js";
import { recallCommitments } from "../memory/recall.js";
import { clause } from "../memory/types.js";
import { extractMemories, storeMemories } from "../memory/write.js";
import { getGroup, getUser, removeGroup, tzOf, updateGroup, upsertGroup, upsertUser } from "../state.js";
import { enqueue } from "./conversation.js";
import { recordOutcome } from "./outcomes.js";

/** Group messages must never overwrite a member's private chat id. */
function touchMember(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, getUser(from.id)?.chatId ?? from.id, from.first_name ?? "");
}

const groupTitle = (ctx: Context) => (ctx.chat && "title" in ctx.chat ? ctx.chat.title : "this group") ?? "this group";
const botName = (ctx: Context) => config.BOT_USERNAME || ctx.me.username;

const GROUP_HELP = (bot: string) =>
  `⚓ Anchor holds this group to its word.\n\n/promise <what, by when>: promise something in front of everyone, e.g. /promise finish chapter 3 by Friday 6pm\n/board: this week's follow-through, member by member\n/open: promises still open here\n\nAt the deadline I'll ask here, and only the person who promised can answer. Kept or missed, the group hears about it. Nobody here ever sees anyone's private chats or memories.\n\nFor reminders, habits and your own memory, start a private chat: t.me/${bot}`;

/** Simple per-person cooldown so one member can't flood the AI from a group. */
const lastPromise = new Map<string, number>();

export function registerGroupCommands(bot: Bot) {
  const groups = bot.chatType(["group", "supergroup"]);

  groups.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "member" || status === "administrator") {
      upsertGroup(ctx.chat.id, groupTitle(ctx));
      await ctx.reply(GROUP_HELP(botName(ctx)), { link_preview_options: { is_disabled: true } }).catch(() => undefined);
    } else if (status === "left" || status === "kicked") removeGroup(ctx.chat.id);
  });

  groups.command(["start", "help"], (ctx) => ctx.reply(GROUP_HELP(botName(ctx)), { link_preview_options: { is_disabled: true } }));

  groups.command("promise", async (ctx) => {
    if (!ctx.from || ctx.from.is_bot) return;
    const user = touchMember(ctx);
    const uid = String(ctx.from.id);
    const text = ctx.match.trim().slice(0, 300);
    if (!text) {
      await ctx.reply("Tell the group what you'll do and by when, e.g.\n/promise finish chapter 3 by Friday 6pm");
      return;
    }
    if (Date.now() - (lastPromise.get(uid) ?? 0) < 10_000) {
      await ctx.reply("One promise at a time, give me a few seconds.");
      return;
    }
    lastPromise.set(uid, Date.now());
    const tz = tzOf(uid);
    const commitments = await recallCommitments(uid).catch(() => []);
    const records = (
      await extractMemories({ userMessage: `${user.firstName || "I"}: ${text}`, assistantReply: "", commitments, tz }).catch(() => [])
    ).filter((r) => r.kind === "commitment" && r.id);
    if (!records.length) {
      await ctx.reply("I couldn't find a promise in that. Say what you'll do and by when, e.g. /promise send 5 applications by Friday");
      return;
    }
    const g = upsertGroup(ctx.chat.id, groupTitle(ctx));
    updateGroup(ctx.chat.id, (x) => {
      x.members = [...new Set([...g.members, uid])];
      for (const r of records) x.promises[r.id!] = { userId: uid, text: r.text, due: r.due, at: r.at, createdAt: new Date().toISOString() };
    });
    void enqueue(`write:${uid}`, () => storeMemories(uid, records)).catch((err) => console.error(`[group] storing promise for ${uid} failed:`, err));
    const today = todayIn(tz);
    const lines = records.map((r) => `📌 ${user.firstName || "Someone"} promised: ${clause(r.text)}${r.due ? ` (${weekdayOf(r.due)} ${r.due}${r.at ? ` ${r.at}` : ""}, ${relativeDay(r.due, today)})` : ""}`);
    await ctx.reply(`${lines.join("\n")}\n\nI'll check in here at the deadline. Everyone's watching 👀`, { reply_parameters: { message_id: ctx.msg.message_id } });
  });

  groups.command("board", async (ctx) => {
    const g = getGroup(ctx.chat.id);
    const lines = g ? boardLines(g, todayIn(config.TIMEZONE)) : [];
    await ctx.reply(lines.length ? `🏆 This week in ${groupTitle(ctx)}\n\n${lines.join("\n")}` : "No promises here yet. Be the first: /promise <what, by when>");
  });

  groups.command("open", async (ctx) => {
    const g = getGroup(ctx.chat.id);
    const open = Object.values(g?.promises ?? {}).filter((p) => !p.status);
    await ctx.reply(
      open.length
        ? `Still open in ${groupTitle(ctx)}:\n\n${open.map((p) => `• ${getUser(p.userId)?.firstName || "Someone"}: ${clause(p.text)}${p.due ? ` (due ${p.due}${p.at ? ` ${p.at}` : ""})` : ""}`).join("\n")}`
        : "Nothing open here right now. /promise <what, by when> to start.",
    );
  });

  // Deadline check in the group: g:<ownerId>:<promiseId>:<status>, only the owner may answer.
  groups.callbackQuery(/^g:(\d+):([a-z0-9]+):(kept|partial|broken)$/, async (ctx) => {
    const [, owner, id, status] = ctx.match as RegExpMatchArray;
    if (String(ctx.from.id) !== owner) {
      await ctx.answerCallbackQuery({ text: `Only ${getUser(owner!)?.firstName || "the person who promised"} can answer this one.` });
      return;
    }
    touchMember(ctx);
    const res = await recordOutcome(Number(owner), id!, status as "kept" | "partial" | "broken");
    await ctx.answerCallbackQuery({ text: "error" in res ? res.error : "Recorded ✔" });
    if (!("error" in res)) await ctx.editMessageReplyMarkup().catch(() => undefined);
  });
}

export const GROUP_COMMANDS = [
  { command: "promise", description: "Promise something in front of the group" },
  { command: "board", description: "This week's follow-through, member by member" },
  { command: "open", description: "Promises still open here" },
  { command: "help", description: "How Anchor works in a group" },
];
