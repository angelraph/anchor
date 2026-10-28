/**
 * /buddy           invite link (and who your buddies are)
 * /buddy private   buddies see "a promise", not what it was (/buddy share to undo)
 * /buddy remove    stop sharing with everyone
 * /start buddy_x   (from the invite link) accept or decline
 */
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { acceptInvite, inviteLink, newInvite, removeBuddies, sendBuddyReaction } from "../buddies.js";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser, upsertUser } from "../state.js";
import { enqueue } from "./conversation.js";

function touch(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, ctx.chat?.id ?? from.id, from.first_name ?? "");
}

const botName = (ctx: Context) => config.BOT_USERNAME || ctx.me.username;

/** Handles /start buddy_<token>. Returns true when it did. */
export async function handleBuddyStart(ctx: Context): Promise<boolean> {
  const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const m = /^buddy_([\w-]+)$/.exec(payload);
  if (!m) return false;
  touch(ctx);
  await ctx.reply(
    "A friend invited you to be their accountability buddy on Anchor.\n\nYou'll get a message when they keep or miss a promise, and one tap lets you cheer them on or nudge them. You won't see their chats or memories.",
    { reply_markup: new InlineKeyboard().text("🤝 Accept", `bd:yes:${m[1]}`).text("Not now", "bd:no") },
  );
  return true;
}

export function registerBuddyCommands(bot: Bot) {
  bot.command("buddy", async (ctx) => {
    const me = touch(ctx);
    const userId = String(ctx.from!.id);
    const arg = ctx.match.trim().toLowerCase();
    if (arg === "remove") {
      const n = removeBuddies(userId);
      await ctx.reply(n ? `Done: ${n} buddy${n === 1 ? "" : "s"} removed. They won't hear about your promises anymore.` : "You don't have any buddies yet.");
      return;
    }
    if (arg === "private" || arg === "share") {
      updateUser(userId, (u) => (u.buddyShare = arg === "share"));
      await ctx.reply(arg === "share" ? "Buddies will see what each promise was." : "Buddies will only see that you kept or missed a promise, not what it was.");
      return;
    }
    const names = (me.buddies ?? []).map((id) => getUser(id)?.firstName || "a friend");
    const watching = (me.watching ?? []).map((id) => getUser(id)?.firstName || "a friend");
    const link = inviteLink(botName(ctx), newInvite(userId));
    await ctx.reply(
      `🤝 Accountability buddies\n\n${names.length ? `Your buddies: ${names.join(", ")}.` : "Promises are easier to keep when someone's watching."}${watching.length ? `\nYou're a buddy for: ${watching.join(", ")}.` : ""}\n\nSend this link to a friend (valid 7 days):\n${link}\n\nThey'll hear when you keep or miss a promise and can cheer or nudge you. ${me.buddyShare === false ? "They see outcomes only (/buddy share to show what each promise was)." : "They see what each promise was (/buddy private to hide that)."}\n/buddy remove stops sharing.`,
      { link_preview_options: { is_disabled: true } },
    );
  });

  bot.callbackQuery(/^bd:yes:([\w-]+)$/, async (ctx) => {
    const friend = touch(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const res = acceptInvite((ctx.match as RegExpMatchArray)[1]!, String(ctx.from.id));
    if ("error" in res) {
      await ctx.reply(res.error);
      return;
    }
    const owner = getUser(res.ownerId);
    await ctx.reply(`🤝 You're now ${owner?.firstName || "your friend"}'s accountability buddy. I'll let you know how their promises go.\n\nWant your own? Tell me one thing you'll do, and by when.`);
    if (owner) {
      await ctx.api.sendMessage(owner.chatId, `🤝 ${friend.firstName || "Your friend"} accepted: they're your accountability buddy now. They'll hear when you keep or miss a promise.`).catch(() => undefined);
      void enqueue(`write:${res.ownerId}`, () =>
        storeMemories(res.ownerId, [{ kind: "fact", date: todayIn(tzOf(res.ownerId)), text: `${friend.firstName || "A friend"} is an accountability buddy on Anchor` }]),
      ).catch(() => undefined);
    }
  });

  bot.callbackQuery("bd:no", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply("No problem. If you ever want help keeping your own promises, just tell me what you'll do and by when.");
  });

  // b:cheer:<ownerId> | b:nudge:<ownerId>
  bot.callbackQuery(/^b:(cheer|nudge):(\d+)$/, async (ctx) => {
    touch(ctx);
    const [, kind, ownerId] = ctx.match as RegExpMatchArray;
    const ok = await sendBuddyReaction(String(ctx.from.id), ownerId!, kind as "cheer" | "nudge");
    await ctx.answerCallbackQuery({ text: ok ? (kind === "cheer" ? "Cheer sent 👏" : "Nudge sent 💬") : "You're not their buddy anymore." });
    await ctx.editMessageReplyMarkup().catch(() => undefined);
  });
}

export const BUDDY_COMMANDS = [{ command: "buddy", description: "Invite an accountability buddy" }];
