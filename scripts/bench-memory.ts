/**
 * Memory benchmark: does what Anchor remembers change what it says?
 *
 * Ten people with the kind of memories real users build up (patterns, wins, open
 * promises, preferences). Each question is asked with memory OFF and ON through
 * the live bot's own system prompt and model chain. Memories are handed in as
 * recalled records instead of fetched from Walrus, so a run is repeatable and
 * spends no Walrus requests.
 *
 * A reply is "personal" when it uses something only memory could know: a
 * buddy's name, the time that works, the known weak spot. "Invented history" is
 * a memory-OFF reply that claims a past it can't have ("again", "last time").
 *
 *   npx tsx scripts/bench-memory.ts [reps=3]
 *   npx tsx scripts/bench-memory.ts 3 --rescore   (score the saved replies again, no model calls)
 */
process.loadEnvFile();
// Benchmarks spend the test key's quota, never the live bot's.
if (process.env.GEMINI_TEST_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_TEST_API_KEY;
else console.warn("[bench] GEMINI_TEST_API_KEY is not set: this run uses the live bot's Gemini quota");
process.env.GEMINI_BACKUP_API_KEYS = "";
process.env.DATA_DIR = "./data/bench";

const { mkdirSync, writeFileSync } = await import("node:fs");
const { generateText } = await import("ai");
const { config } = await import("../src/config.js");
const { addDays, todayIn } = await import("../src/dates.js");
const { LLM_TIMEOUT_MS, MODEL_LABEL, withModel } = await import("../src/llm/model.js");
const { systemPrompt } = await import("../src/llm/prompts.js");
const { commitmentStates, parse } = await import("../src/memory/types.js");
const { cleanReply } = await import("../src/bot/conversation.js");
type Recalled = import("../src/memory/types.js").RecalledMemory;

const REPS = Number(process.argv[2] ?? 3);
const today = todayIn(config.TIMEZONE);
const day = (ago: number) => addDays(today, -ago);
const mem = (raw: string): Recalled => ({ ...parse(raw), raw, blobId: "bench", distance: 0.3 });

interface Case {
  name: string;
  memories: string[];
  message: string;
  /** Any match means the reply used memory. Each is something a stranger couldn't know. */
  uses: RegExp[];
}

const CASES: Case[] = [
  {
    name: "Tunde",
    memories: [
      `[fact] ${day(20)} | Tunde works as a frontend developer in Lagos`,
      `[pattern] ${day(12)} | Tunde skips the gym when he stays up late on his phone`,
      `[win] ${day(9)} | Tunde went to the gym three times the week his friend Kemi came with him`,
    ],
    message: "I'll start going to the gym again tomorrow.",
    uses: [/kemi/i, /stay(ing|s)? up late|late night|scroll/i],
  },
  {
    name: "Ada",
    memories: [
      `[fact] ${day(30)} | Ada is a pharmacy student`,
      `[win] ${day(10)} | Ada finishes deep work best before noon`,
      `[win] ${day(6)} | Putting the phone in another room helped Ada revise two chapters`,
    ],
    message: "I have a pharmacology exam on Friday. Help me plan the week.",
    uses: [/noon/i, /another room/i],
  },
  {
    name: "Chidi",
    memories: [
      `[pattern] ${day(8)} | Chidi sends out most of his money on Saturdays (62% of outflows over four weeks)`,
      `[commitment] ${day(3)} id:sv01 due:${addDays(today, 20)} | Promised to save 20,000 naira this month`,
    ],
    message: "I want to stop wasting money this month.",
    uses: [/saturday/i, /20,?000/],
  },
  {
    name: "Zainab",
    memories: [
      `[fact] ${day(25)} | Zainab is looking for UX design roles`,
      `[win] ${day(7)} | Zainab sent two applications after blocking 30 minutes right after dinner`,
    ],
    message: "I keep putting off job applications. Any advice?",
    uses: [/dinner/i, /\bUX\b/],
  },
  {
    name: "Emeka",
    memories: [
      `[preference] ${day(40)} | Emeka wants blunt feedback, not soft encouragement`,
      `[commitment] ${day(21)} id:th01 due:${day(14)} | Promised to finish chapter 3 of the thesis`,
      `[outcome] ${day(14)} ref:th01 status:moved due:${day(7)} | Moved chapter 3 to next week, said work got busy`,
      `[outcome] ${day(7)} ref:th01 status:moved due:${addDays(today, 1)} | Moved chapter 3 again, said he was tired`,
    ],
    message: "Can I push chapter 3 to next week?",
    uses: [/twice|second time|third time|two times|moved it (already|before)|already moved/i],
  },
  {
    name: "Funmi",
    memories: [
      `[habit] ${day(30)} id:rd01 rep:5/week | Habit: read 20 pages`,
      `[streak] ${day(1)} ref:rd01 | Funmi kept the reading habit 3 weeks in a row`,
    ],
    message: "I don't feel like reading today.",
    uses: [/(3|three)\b[\w\s-]{0,12}\bweeks?\b/i],
  },
  {
    name: "Musa",
    memories: [
      `[fact] ${day(35)} | Musa is a nurse who works night shifts`,
      `[pattern] ${day(11)} | Musa misses early-morning promises after a night shift`,
    ],
    message: "I'll go for a run at 6am tomorrow.",
    uses: [/shift/i],
  },
  {
    name: "Ngozi",
    memories: [
      `[fact] ${day(18)} | Ngozi's accountability buddy is Tobi`,
      `[win] ${day(5)} | Ngozi keeps promises she tells Tobi about`,
    ],
    message: "I want to finish my landing page this week.",
    uses: [/tobi/i],
  },
  {
    name: "Sarah",
    memories: [`[commitment] ${day(4)} id:py01 due:${addDays(today, 2)} | Promised to pay Tobi back 20 USDC`],
    message: "Do I owe anyone anything this week?",
    uses: [/20 ?USDC/i, /tobi/i],
  },
  {
    name: "Bola",
    memories: [
      `[preference] ${day(30)} | Bola wants gentle encouragement, not pressure`,
      `[win] ${day(9)} | Splitting a big report into 15-minute steps got Bola started`,
    ],
    message: "I have a huge report due Monday and I'm overwhelmed.",
    uses: [/15[- ]?min/i],
  },
];

// A past a stranger can't know: "as you mentioned", "your streak", "you usually". Plain "again"
// isn't counted: the person's own message often says it ("the gym again").
const INVENTED = /\b(as you mentioned|last time|like before|as before|we('ve| have) (talked|discussed)|you (usually|always|tend to)|your (usual|streak)|streak (going|alive))\b/i;

async function reply(c: Case, withMemory: boolean): Promise<{ text: string; modelId: string }> {
  const memories = c.memories.map(mem);
  const system = systemPrompt({
    firstName: c.name,
    today,
    memories: withMemory ? memories : null,
    commitments: withMemory ? commitmentStates(memories) : [],
    awaiting: [],
    tz: config.TIMEZONE,
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await withModel((model) =>
        generateText({ model, system, messages: [{ role: "user", content: c.message }], temperature: 0.6, maxRetries: 0, abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS * 2) }),
      );
      return { text: cleanReply(res.text), modelId: res.response?.modelId ?? "?" };
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
}

interface Row { name: string; mode: "off" | "on"; rep: number; model: string; personal: boolean; invented: boolean; reply: string }
const rows: Row[] = [];
// --rescore: score the replies already saved with the current rules, without asking the model again.
const RESCORE = process.argv.includes("--rescore");
let savedRanAt: string | undefined;
if (RESCORE) {
  const saved = JSON.parse((await import("node:fs")).readFileSync("docs/benchmark/memory-results.json", "utf8")) as { summary: { ranAt: string; reps: number }; rows: Row[] };
  if (saved.summary.reps !== REPS) throw new Error(`the saved run used ${saved.summary.reps} reps; pass that number`);
  savedRanAt = saved.summary.ranAt;
  for (const r of saved.rows) {
    const c = CASES.find((x) => x.name === r.name)!;
    rows.push({ ...r, personal: c.uses.some((re) => re.test(r.reply)), invented: r.mode === "off" && INVENTED.test(r.reply) });
  }
}
for (const c of RESCORE ? [] : CASES) {
  for (let rep = 1; rep <= REPS; rep++) {
    for (const mode of ["off", "on"] as const) {
      const { text, modelId } = await reply(c, mode === "on");
      const personal = c.uses.some((re) => re.test(text));
      const invented = mode === "off" && INVENTED.test(text);
      rows.push({ name: c.name, mode, rep, model: modelId, personal, invented, reply: text });
      console.log(`${c.name.padEnd(7)} ${mode.padEnd(3)} #${rep} ${personal ? "PERSONAL" : "generic "}${invented ? " INVENTED" : ""} [${modelId}] | ${text.slice(0, 100).replace(/\s+/g, " ")}`);
    }
  }
}

const rate = (mode: "off" | "on", key: "personal" | "invented") => {
  const r = rows.filter((x) => x.mode === mode);
  return { n: r.filter((x) => x[key]).length, of: r.length };
};
const summary = {
  ranAt: savedRanAt ?? new Date().toISOString(),
  ...(RESCORE ? { rescoredAt: new Date().toISOString() } : {}),
  /** The first model Anchor tries; busy or over quota, it falls back to the next. */
  modelChainStartsWith: MODEL_LABEL,
  /** The models that actually answered in this run (each row says which). */
  modelsThatAnswered: [...new Set(rows.map((r) => r.model))],
  cases: CASES.length,
  reps: REPS,
  personalOff: rate("off", "personal"),
  personalOn: rate("on", "personal"),
  inventedOff: rate("off", "invented"),
  perCase: CASES.map((c) => ({
    name: c.name,
    message: c.message,
    off: rows.filter((r) => r.name === c.name && r.mode === "off" && r.personal).length,
    on: rows.filter((r) => r.name === c.name && r.mode === "on" && r.personal).length,
    of: REPS,
  })),
};
mkdirSync("docs/benchmark", { recursive: true });
writeFileSync("docs/benchmark/memory-results.json", JSON.stringify({ summary, cases: CASES.map((c) => ({ ...c, uses: c.uses.map(String) })), rows }, null, 2));
const pct = (x: { n: number; of: number }) => `${x.n}/${x.of} (${Math.round((x.n / x.of) * 100)}%)`;
console.log(`\nPersonal replies: memory OFF ${pct(summary.personalOff)}, memory ON ${pct(summary.personalOn)}`);
console.log(`Invented history with memory OFF: ${pct(summary.inventedOff)}`);
console.log("Saved docs/benchmark/memory-results.json");
