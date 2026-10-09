import { run } from "@grammyjs/runner";
import { BOT_COMMANDS, createBot } from "./bot/bot.js";
import { startCheckinScheduler } from "./checkins.js";
import { config } from "./config.js";
import { MODEL_LABEL } from "./llm/model.js";
import { memwal } from "./memory/client.js";
import { drainOutbox } from "./memory/write.js";
import { runDeadlineReminders, runWeekly } from "./reminders.js";
import { hourIn, todayIn } from "./dates.js";
import { flush } from "./state.js";
import { startWebServer } from "./web/server.js";

/** Never print the bot token, even inside third-party error messages. */
const redact = (v: unknown) => String(v instanceof Error ? (v.stack ?? v.message) : v).split(config.TELEGRAM_BOT_TOKEN).join("<token>");

/** Retry a startup call through brief network blips (ECONNRESET and friends). */
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`[startup] ${label} failed (attempt ${i}/${attempts}), retrying: ${redact(err).split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}

async function main() {
  // Walrus being slow at boot must not keep the bot offline; recall/save handle outages themselves.
  await retry("memwal health", () => memwal.health(), 3).then(
    (h) => console.log(`[memwal] relayer ${config.MEMWAL_SERVER_URL} is ${h.status ?? "up"}`),
    (err) => console.warn(`[memwal] health check failed at startup, continuing: ${redact(err).split("\n")[0]}`),
  );

  const bot = createBot();
  // Command menu and description are cosmetic: retry, but never fail startup over them.
  await retry("setMyCommands", () => bot.api.setMyCommands(BOT_COMMANDS)).catch((err) =>
    console.warn(`[startup] setMyCommands skipped: ${redact(err).split("\n")[0]}`),
  );
  await retry("setMyDescription", () =>
    bot.api.setMyDescription(
      "I'm Anchor, tell me what you'll do and by when. I remember it on Walrus, check in when it's due, and learn what makes you follow through.",
    ),
  ).catch((err) => console.warn(`[startup] setMyDescription skipped: ${redact(err).split("\n")[0]}`));
  const me = await retry("getMe", () => bot.api.getMe());
  bot.botInfo = me; // the runner reuses this instead of calling getMe again
  console.log(`[bot] @${me.username} · ${MODEL_LABEL}`);

  startWebServer();
  startCheckinScheduler(bot.api);
  setInterval(() => void drainOutbox().catch((err) => console.error("[memwal] outbox drain failed:", err)), 10 * 60_000);

  // Exact-time deadline reminders (local state only) and the Sunday weekly summary.
  let weeklyRan = "";
  setInterval(() => {
    void runDeadlineReminders(bot.api).catch((err) => console.error("[remind] failed:", err));
    const today = todayIn(config.TIMEZONE);
    const isSunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
    if (isSunday && hourIn(config.TIMEZONE) === config.CHECKIN_HOUR && weeklyRan !== today) {
      weeklyRan = today;
      void runWeekly(bot.api).catch((err) => console.error("[weekly] failed:", err));
    }
  }, 60_000);

  // Updates run concurrently across users; bot.ts keeps each chat in order.
  // grammY's runner stops silently on 409 Conflict (another instance polling
  // the same token, e.g. during a redeploy), restart it instead of going deaf.
  let runner = run(bot);
  const watch = () => {
    void runner.task()?.catch(async (err: { error_code?: number; description?: string }) => {
      console.error(`[bot] polling stopped: ${redact(err?.description ?? err)}`);
      if (err?.error_code !== 409) process.exit(1); // let the platform restart us
      await new Promise((r) => setTimeout(r, 15_000));
      console.log("[bot] restarting polling after conflict");
      runner = run(bot);
      watch();
    });
  };
  watch();

  const stop = async () => {
    console.log("Shutting down…");
    flush();
    if (runner.isRunning()) await runner.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

process.on("unhandledRejection", (err) => console.error("[unhandled]", redact(err)));

main().catch((err) => {
  console.error("Anchor failed to start:", redact(err));
  process.exit(1);
});
