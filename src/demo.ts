/**
 * Demo mode: Anchor's website and app on sample data, with no keys at all.
 *
 *   npm run demo   → http://localhost:3000 (landing page) and /app (the Anchor app)
 *
 * Nothing here reaches Telegram, Gemini, Walrus or Sui. The sample person, Ada,
 * has a month of promises dated relative to today, so the calendar, streaks and
 * charts always look current. The live product is the bot: t.me/Anchor_daBot.
 */
import { addDays, todayIn } from "./dates.js";
import { config } from "./config.js";
import type { NamespaceStat } from "./memory/client.js";
import type { CommitmentState, OutcomeStatus, RecalledMemory } from "./memory/types.js";
import { getUser, updateUser, upsertUser } from "./state.js";

export const DEMO_USER = 1_000_001;

const mem = (kind: RecalledMemory["kind"], date: string, text: string, extra: Partial<RecalledMemory> = {}): RecalledMemory => ({ kind, date, text, raw: "", blobId: "", distance: 0, ...extra });

/** Ada's promises over the last month: mostly kept, one missed, one partly, three still open. */
export function demoStates(today = todayIn(config.TIMEZONE)): CommitmentState[] {
  const done: Array<[string, number, string, OutcomeStatus]> = [
    ["d01", -1, "Send the pitch deck to Tobi", "kept"],
    ["d02", -2, "Revise two chapters of pharmacology", "kept"],
    ["d03", -4, "Go to the gym at 6pm", "kept"],
    ["d04", -6, "Pay Tobi back 20 USDC", "kept"],
    ["d05", -8, "Finish the landing page", "broken"],
    ["d06", -9, "Call the bank about the card", "kept"],
    ["d07", -11, "Read 30 pages", "partial"],
    ["d08", -13, "Submit the scholarship form", "kept"],
    ["d09", -16, "Go to the gym at 6pm", "kept"],
    ["d10", -20, "Send two job applications", "kept"],
    ["d11", -24, "Meal prep for the week", "kept"],
  ];
  const states: CommitmentState[] = done.map(([id, d, text, status]) => {
    const date = addDays(today, d);
    return {
      commitment: mem("commitment", addDays(date, -1), text, { id, due: date }),
      outcome: mem("outcome", date, `${status === "kept" ? "Kept" : status === "partial" ? "Partly kept" : "Did not keep"} the promise: ${text}`, { ref: id, status, ...(id === "d04" ? { proof: "demo" } : {}), ...(id === "d01" ? { pic: "demo" } : {}) }),
    };
  });
  states.push(
    { commitment: mem("commitment", today, "Send two job applications", { id: "o01", due: today, at: "17:00", rem: "16:00" }) },
    { commitment: mem("commitment", today, "Go to the gym at 6pm", { id: "o02", due: today, at: "18:00" }) },
    { commitment: mem("commitment", addDays(today, -3), "Save 20,000 naira this month", { id: "o03", due: addDays(today, 9) }) },
  );
  return states;
}

/** The dashboard the app shows for Ada (same shape as the real one in app-routes.ts). */
export function demoDashboard<S extends { keptRun: number }>(summarize: (s: CommitmentState[], closed: Record<string, string>, today: string) => S) {
  const today = todayIn(config.TIMEZONE);
  const states = demoStates(today);
  const summary = summarize(states, {}, today);
  const days = (n: number, every: number) => Array.from({ length: n }, (_, i) => addDays(today, -i * every));
  return {
    name: "Ada",
    today,
    tz: config.TIMEZONE,
    tzLabel: `Lagos (${config.TIMEZONE})`,
    morning: true,
    ownMemory: null,
    wallet: "ada.sui",
    sharing: !!getUser(DEMO_USER)?.cardCode,
    summary,
    bestStreak: Math.max(summary.keptRun, 6),
    open: states.filter((s) => !s.outcome).map((s) => ({ id: s.commitment.id, text: s.commitment.text, due: s.commitment.due ?? null, at: s.commitment.at ?? null })),
    done: states
      .filter((s) => s.outcome)
      .map((s) => ({ id: s.commitment.id, text: s.commitment.text, status: s.outcome!.status, date: s.outcome!.date, chain: !!s.outcome!.proof, pic: s.outcome!.pic ?? null })),
    habits: [
      { text: "Read before bed", per: "day", times: 1, streak: 6, best: 9, progress: "done today · 🔥 6 days", done: days(6, 1) },
      { text: "Gym", per: "week", times: 3, streak: 4, best: 4, progress: "2/3 this week · 🔥 4 weeks", done: days(10, 3) },
    ],
    learned: {
      wins: ["Ada finishes deep work best before noon", "Putting the phone in another room helps Ada start", "Ada goes to the gym when Kemi comes too"],
      patterns: ["Ada pushes the gym to Monday when work runs late", "Late-night scrolling makes Ada skip the 6am plan"],
    },
    proofs: [],
    buddies: ["Kemi"],
    groups: ["Study Squad"],
  };
}

/** The memory switch, answered the way the live bot answers Ada. */
export function demoCompare(): { off: string; on: string; recalled: number } {
  return {
    off: "That depends on your goals. Running is great for fitness and stress. Start with two or three short runs a week and build up slowly. What made you think about it?",
    on: "Ada, you're keeping the gym three times a week (four weeks in a row now), and the one thing that derails you is late nights. Add one short run on Saturday morning, when you focus best, rather than another evening. If you send it to me in the chat, I'll hold you to it.",
    recalled: 7,
  };
}

/** Landing-page numbers in demo mode (the real page reads them live from Walrus Memory). */
export function demoStats(): NamespaceStat[] {
  const now = new Date().toISOString();
  return [27, 25, 18, 16, 16, 16, 14, 14, 12, 12, 5, 4, 3, 1, 1].map((memoryCount, i) => ({ userId: String(DEMO_USER + i), memoryCount, updatedAt: now }));
}

/** Make Ada a known person so the app's routes accept her. */
export function seedDemo() {
  upsertUser(DEMO_USER, DEMO_USER, "Ada");
  updateUser(DEMO_USER, (u) => (u.tz = config.TIMEZONE));
}
