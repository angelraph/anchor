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
import { allUsers, getUser, tzOf, updateUser } from "./state.js";
import { askHabits } from "./habits.js";
import { allowed, noteNudge, nudge } from "./attention.js";

export function outcomeKeyboard(commitmentId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Did it", `o:${commitmentId}:kept`)
    .text("🟡 Partly", `o:${commitmentId}:partial`)
    .row()
    .text("❌ Didn't", `o:${commitmentId}:broken`)
    .text("📅 Move it", `o:${commitmentId}:moved`);
}

/** At most this many promises in one check-in; the rest wait for /promises. */
const MAX_IN_ONE = 6;

/**
 * Several due promises in ONE message: a numbered list, and one row of buttons
 * per promise (✅ 1 · 🟡 1 · ❌ 1 · 📅 1). Pure, for tests.
 */
export function groupedCheckin(due: CommitmentState[], intro: string): { text: string; keyboard: InlineKeyboard } {
  const shown = due.slice(0, MAX_IN_ONE);
  if (shown.length === 1) {
    const s = shown[0]!;
    const d = effectiveDue(s)!;
    return { text: `${intro}\n\n#${s.commitment.id} · ${clause(s.commitment.text)}\n(due ${weekdayOf(d)} ${d})`, keyboard: outcomeKeyboard(s.commitment.id!) };
  }
  const kb = new InlineKeyboard();
  const lines = shown.map((s, i) => {
    const id = s.commitment.id!;
    const n = i + 1;
    if (i) kb.row();
    kb.text(`✅ ${n}`, `o:${id}:kept`).text(`🟡 ${n}`, `o:${id}:partial`).text(`❌ ${n}`, `o:${id}:broken`).text(`📅 ${n}`, `o:${id}:moved`);
    const d = effectiveDue(s)!;
    return `${n}. ${clause(s.commitment.text)} (due ${weekdayOf(d)})`;
  });
  const more = due.length > shown.length ? `\n…and ${due.length - shown.length} more in /promises` : "";
  return { text: `${intro}\n\n${lines.join("\n")}${more}\n\n✅ did it · 🟡 partly · ❌ didn't · 📅 move it`, keyboard: kb };
}

export function dueCommitments(states: CommitmentState[], today: string, now: string): CommitmentState[] {
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
  const tz = tzOf(userId);
  const today = todayIn(tz);
  const user = getUser(userId);
  const chatId = user?.chatId ?? Number(userId);
  const firstName = user?.firstName ?? "";
  // The scheduled check-in respects attention (away, quiet hours, daily cap); /checkin always answers.
  if (!opts.force && !allowed(userId, "checkin")) return 0;

  const states = await recallCommitments(userId);
  // Money promises still being watched on Sui are closed by the chain, not by asking.
  const due = dueCommitments(states, today, timeIn(tz)).filter(
    (s) => (opts.force || user?.nudged[s.commitment.id!] !== today) && !user?.chain?.[s.commitment.id!],
  );

  if (due.length === 0) {
    if (!opts.force) return maybeGeneralCheckin(api, userId, today, tz);
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
      system: checkinPrompt({ firstName, today, tz }),
      prompt: `Promises due:\n${formatCommitments(due, today)}\n\nRelated memories:\n${formatMemoryBlock(related)}`,
      temperature: 0.7,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    }),
  );
  // ONE message for everything due, not one per promise.
  const one = groupedCheckin(due, text.trim());
  await api.sendMessage(chatId, one.text, { reply_markup: one.keyboard });
  if (!opts.force) noteNudge(userId, today);

  updateUser(userId, (u) => {
    for (const s of due) u.nudged[s.commitment.id!] = today;
    u.awaitingOutcome = [...new Set([...u.awaitingOutcome, ...due.map((s) => s.commitment.id!)])];
  });
  return 1;
}

/** Once a day, nudge recently active users who have nothing due to set a promise. */
async function maybeGeneralCheckin(api: Api, userId: string, today: string, tz: string): Promise<number> {
  const user = getUser(userId);
  if (!user || user.lastGeneralCheckin === today) return 0;
  const lastSeen = Date.parse(user.lastSeen || "0");
  const activeRecently = Date.now() - lastSeen < 3 * 86_400_000;
  const seenToday = todayIn(tz, new Date(lastSeen)) === today;
  if (!activeRecently || seenToday) return 0;
  const sent = await nudge(
    api,
    userId,
    "checkin",
    `Evening check-in${user.firstName ? `, ${user.firstName}` : ""}. Nothing is due today, what's one thing you'll get done tomorrow? I'll hold you to it.`,
  );
  if (!sent) return 0;
  updateUser(userId, (u) => {
    u.lastGeneralCheckin = today;
  });
  return 1;
}

/** Everyone Anchor knows: local chats plus any namespace found on Walrus (cached for an hour). */
let namespaceIds: { at: number; ids: string[] } = { at: 0, ids: [] };
async function knownUserIds(): Promise<string[]> {
  const ids = new Set(allUsers().map(([id]) => id));
  if (Date.now() - namespaceIds.at > 60 * 60_000) {
    try {
      namespaceIds = { at: Date.now(), ids: (await listUserNamespaces()).map((n) => n.userId) };
    } catch (err) {
      console.warn("[checkin] listNamespaces failed, using local users only:", err instanceof Error ? err.message : err);
      namespaceIds.at = Date.now() - 50 * 60_000; // retry in 10 minutes
    }
  }
  for (const id of namespaceIds.ids) ids.add(id);
  return [...ids];
}

/** Users without local state still get their evening check-in once per local day. */
const eveningDone = new Map<string, string>();

/** Every minute: check in with each person whose local clock just reached CHECKIN_HOUR. */
export async function runCheckins(api: Api): Promise<void> {
  for (const id of await knownUserIds()) {
    const tz = tzOf(id);
    const today = todayIn(tz);
    if (hourIn(tz) !== config.CHECKIN_HOUR) continue;
    if ((getUser(id)?.lastEvening ?? eveningDone.get(id)) === today) continue;
    eveningDone.set(id, today);
    updateUser(id, (u) => {
      u.lastEvening = today;
    });
    try {
      await checkInUser(api, id);
      await askHabits(api, id);
    } catch (err) {
      console.error(`[checkin] user ${id} failed:`, err);
    }
  }
}

/** Check-ins run at CHECKIN_HOUR in each person's own timezone. */
export function startCheckinScheduler(api: Api): void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runCheckins(api)
      .catch((err) => console.error("[checkin] failed:", err))
      .finally(() => (running = false));
  };
  setInterval(tick, 60_000);
  tick();
  console.log(`[checkin] daily check-ins at ${config.CHECKIN_HOUR}:00 in each person's timezone (default ${config.TIMEZONE})`);
}
