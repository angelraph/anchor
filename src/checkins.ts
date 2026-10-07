/**
 * Proactive follow-up: Anchor messages people first when a promise is due.
 * This is where memory drives an action, not just a reply.
 */
import { generateText } from "ai";
import { InlineKeyboard, type Api } from "grammy";
import { config } from "./config.js";
import { hourIn, timeIn, todayIn, weekdayOf } from "./dates.js";
import { LLM_TIMEOUT_MS, withModel } from "./llm/model.js";
import { checkinPrompt, formatCommitments, formatMemoryBlock } from "./llm/prompts.js";
import { listUserNamespaces } from "./memory/client.js";
import { mergeAndFilter, recall, recallCommitments } from "./memory/recall.js";
import { checkinDay, clause, deadlinePassed, effectiveDue, isOpen, type CommitmentState } from "./memory/types.js";
import { allUsers, getUser, updateUser } from "./state.js";

export function outcomeKeyboard(commitmentId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Did it", `o:${commitmentId}:kept`)
    .text("🟡 Partly", `o:${commitmentId}:partial`)
    .row()
    .text("❌ Didn't", `o:${commitmentId}:broken`)
    .text("📅 Move it", `o:${commitmentId}:moved`);
}

export function dueCommitments(states: CommitmentState[], today: string, now = timeIn(config.TIMEZONE)): CommitmentState[] {
  return states.filter((s) => {
    const day = checkinDay(s, config.CHECKIN_HOUR);
    return isOpen(s) && !!day && day <= today && deadlinePassed(s, today, now);
  });
}

/**
 * Check in with one user. Returns how many messages were sent.
 * `force` (from /checkin) ignores the once-a-day guard.
 */
export async function checkInUser(api: Api, userId: string, opts: { force?: boolean } = {}): Promise<number> {
  const today = todayIn(config.TIMEZONE);
  const user = getUser(userId);
  const chatId = user?.chatId ?? Number(userId);
  const firstName = user?.firstName ?? "";

  const states = await recallCommitments(userId);
  const due = dueCommitments(states, today).filter((s) => opts.force || user?.nudged[s.commitment.id!] !== today);

  if (due.length === 0) {
    if (!opts.force) return maybeGeneralCheckin(api, userId, today);
    await api.sendMessage(chatId, "Nothing is due right now. What's one thing you'll commit to for tomorrow?");
    return 1;
  }

  // Pull memories related to the due promises so the nudge can reference patterns.
  const related = mergeAndFilter(
    userId,
    ...(await Promise.all([
      ...due.slice(0, 3).map((s) => recall(userId, s.commitment.text, { limit: 5, maxDistance: 0.7 })),
      recall(userId, "the user's name and who they are", { limit: 3, maxDistance: 0.8 }),
    ])),
  );

  const { text } = await withModel((model) =>
    generateText({
      model,
      system: checkinPrompt({ firstName, today }),
      prompt: `Promises due:\n${formatCommitments(due, today)}\n\nRelated memories:\n${formatMemoryBlock(related)}`,
      temperature: 0.7,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }),
  );
  await api.sendMessage(chatId, text.trim());

  for (const s of due) {
    const dueDate = effectiveDue(s)!;
    await api.sendMessage(chatId, `#${s.commitment.id} · ${clause(s.commitment.text)}\n(due ${weekdayOf(dueDate)} ${dueDate})`, {
      reply_markup: outcomeKeyboard(s.commitment.id!),
    });
  }

  updateUser(userId, (u) => {
    for (const s of due) u.nudged[s.commitment.id!] = today;
    u.awaitingOutcome = [...new Set([...u.awaitingOutcome, ...due.map((s) => s.commitment.id!)])];
  });
  return 1 + due.length;
}

/** Once a day, nudge recently active users who have nothing due to set a promise. */
async function maybeGeneralCheckin(api: Api, userId: string, today: string): Promise<number> {
  const user = getUser(userId);
  if (!user || user.lastGeneralCheckin === today) return 0;
  const lastSeen = Date.parse(user.lastSeen || "0");
  const activeRecently = Date.now() - lastSeen < 3 * 86_400_000;
  const seenToday = todayIn(config.TIMEZONE, new Date(lastSeen)) === today;
  if (!activeRecently || seenToday) return 0;
  await api.sendMessage(
    user.chatId,
    `Evening check-in${user.firstName ? `, ${user.firstName}` : ""}. Nothing is due today, what's one thing you'll get done tomorrow? I'll hold you to it.`,
  );
  updateUser(userId, (u) => {
    u.lastGeneralCheckin = today;
  });
  return 1;
}

/** Everyone Anchor knows: local chats plus any namespace found on Walrus. */
async function knownUserIds(): Promise<string[]> {
  const ids = new Set(allUsers().map(([id]) => id));
  try {
    for (const ns of await listUserNamespaces()) ids.add(ns.userId);
  } catch (err) {
    console.warn("[checkin] listNamespaces failed, using local users only:", err);
  }
  return [...ids];
}

export async function runCheckins(api: Api): Promise<void> {
  const ids = await knownUserIds();
  console.log(`[checkin] running for ${ids.length} users`);
  for (const id of ids) {
    try {
      await checkInUser(api, id);
    } catch (err) {
      console.error(`[checkin] user ${id} failed:`, err);
    }
  }
}

/** Fire check-ins once per day at CHECKIN_HOUR (in TIMEZONE). */
export function startCheckinScheduler(api: Api): void {
  let lastRun = "";
  const tick = () => {
    const today = todayIn(config.TIMEZONE);
    if (hourIn(config.TIMEZONE) === config.CHECKIN_HOUR && lastRun !== today) {
      lastRun = today;
      void runCheckins(api);
    }
  };
  setInterval(tick, 60_000);
  tick();
  console.log(`[checkin] daily check-ins at ${config.CHECKIN_HOUR}:00 ${config.TIMEZONE}`);
}
