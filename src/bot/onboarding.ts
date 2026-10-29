/**
 * First minutes with Anchor:
 *   /timezone <city>  so every deadline, check-in and summary is on the person's local clock
 *   /tour             a two-minute guided tour (also offered by /start), commands are tappable
 */
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { storeMemories } from "../memory/write.js";
import { getUser, tzOf, updateUser, upsertUser } from "../state.js";
import { describeZone, placeName, resolveTimezone } from "../timezone.js";
import { chatTurn, enqueue } from "./conversation.js";

function touch(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, ctx.chat?.id ?? from.id, from.first_name ?? "");
}

const DEMO_PROMISE = "I'll drink two glasses of water before 9pm today";

const TOUR: Array<{ title: string; body: string; demo?: boolean }> = [
  {
    title: "1/7 · It remembers you",
    body: `Tell me what you'll do and by when. I store it as encrypted memory on Walrus, in a namespace only you have, and I recall it before every reply. Next week I'll still know.\n\nTry it now, or tap below for an example promise.`,
    demo: true,
  },
  {
    title: "2/7 · I message you first",
    body: `A promise with a time ("by 3pm") gets a heads-up 30 minutes before and a check right at 3pm. Every evening at ${String(config.CHECKIN_HOUR).padStart(2, "0")}:00 I check what's still open, and on Sundays you get your week.\n\nAll of it runs on your local time: /timezone your city`,
  },
  {
    title: "3/7 · Memory you can inspect",
    body: `/why shows the exact memories behind my last reply, with Walrus blob IDs.\n/compare <message> answers with and without memory, side by side.\n/memory lists everything I know. /forget <topic> removes something.`,
  },
  {
    title: "4/7 · It learns what works for you",
    body: `Excuses become patterns, wins become strategy, and I use them when you plan.\n/learning shows what I learned each week and how your follow-through moved.\n/habit turns a routine ("gym 3x a week") into a streak.`,
  },
  {
    title: "5/7 · The chain can be the referee",
    body: `For money promises, your wallet is the evidence. /wallet yourname.sui links it (I can read it, never move it).\nThen say "I'll save 20 USDC by Friday" or "$50 this month": I read Sui through Tatum and close the promise myself.\n/money shows balances and progress.`,
  },
  {
    title: "6/7 · Put money on your word",
    body: `/stake #id 5 friend.sui: keep the promise and it comes back, miss it and your friend gets it. I never keep it.\n/report signs your week and stores it on Walrus. /record on lets AI agents pay a cent (x402) to read it.`,
  },
  {
    title: "7/7 · You're not alone",
    body: `/buddy invites a friend who sees your follow-through and nudges you when you slip.\n/connect takes this same memory into Claude Code or any MCP tool.\n\nThat's Anchor. What's one thing you'll do, and by when?`,
  },
];

function tourKeyboard(step: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (TOUR[step]?.demo) kb.text("✍️ Make the example promise", "tour:demo").row();
  if (step < TOUR.length - 1) kb.text("Next ›", `tour:${step + 1}`);
  return kb;
}

export async function sendTourStep(ctx: Context, step: number) {
  const s = TOUR[step]!;
  await ctx.reply(`${s.title}\n\n${s.body}`, { reply_markup: tourKeyboard(step), link_preview_options: { is_disabled: true } });
}

export function registerOnboarding(bot: Bot, withTyping: <T>(ctx: Context, work: () => Promise<T>) => Promise<T>) {
  bot.command("timezone", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const arg = ctx.match.trim();
    if (!arg) {
      const u = getUser(userId);
      await ctx.reply(
        `${u?.tz ? `Your timezone: ${describeZone(u.tz, new Date(), u.tzPlace)}.` : `I'm using ${describeZone(tzOf(userId))} until you tell me yours.`}\n\nSet it with /timezone <city>, for example /timezone Enugu, /timezone Berlin or /timezone UTC+1.`,
      );
      return;
    }
    await withTyping(ctx, async () => {
      const tz = await resolveTimezone(arg).catch(() => undefined);
      if (!tz) {
        await ctx.reply(`I couldn't place "${arg.slice(0, 40)}". Try a city ("/timezone Nairobi") or an offset ("/timezone UTC+3").`);
        return;
      }
      const place = placeName(arg);
      updateUser(userId, (u) => {
        u.tz = tz;
        u.tzPlace = place;
      });
      void enqueue(`write:${userId}`, () =>
        storeMemories(userId, [{ kind: "fact", date: todayIn(tz), text: `Lives in the ${tz} timezone (told Anchor: ${arg.slice(0, 40)})` }]),
      ).catch(() => undefined);
      const city = tz.split("/").pop()!.replace(/_/g, " ");
      const why = place && !place.toLowerCase().startsWith(city.toLowerCase()) ? `\n(The world timezone list names this zone after ${city}; ${place} keeps the same clock.)` : "";
      await ctx.reply(`🕰 Got it: ${describeZone(tz, new Date(), place)}. Deadlines, check-ins and your Sunday summary now run on your local time.${why}`);
    });
  });

  bot.command("tour", async (ctx) => {
    touch(ctx);
    await sendTourStep(ctx, 0);
  });

  bot.callbackQuery(/^tour:(\d+)$/, async (ctx) => {
    touch(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const step = Number((ctx.match as RegExpMatchArray)[1]);
    if (step >= 0 && step < TOUR.length) await sendTourStep(ctx, step);
  });

  bot.callbackQuery("tour:demo", async (ctx) => {
    const user = touch(ctx);
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    await ctx.reply(`You: "${DEMO_PROMISE}"`);
    await enqueue(`turn:${userId}`, () =>
      withTyping(ctx, async () => {
        const turn = await chatTurn(userId, user.firstName, DEMO_PROMISE, (text) => ctx.reply(text, { link_preview_options: { is_disabled: true } }));
        await ctx.reply(`${turn.reply}\n\n(That's a real promise now: I'll check in tonight. /why shows what I recalled.)`, {
          reply_markup: new InlineKeyboard().text("Next ›", "tour:1"),
        });
      }),
    ).catch(async () => {
      await ctx.reply("My AI brain is busy right now. Try the example again in a minute, or just tell me your own promise.");
    });
  });
}

export const ONBOARDING_COMMANDS = [
  { command: "tour", description: "Two-minute tour of Anchor" },
  { command: "timezone", description: "Set your timezone (city or UTC+1)" },
];
