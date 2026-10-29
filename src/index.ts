import { run } from "@grammyjs/runner";
import { appUrl, BOT_ABOUT, BOT_COMMANDS, BOT_DESCRIPTION, createBot, GROUP_COMMANDS } from "./bot/bot.js";
import { runGroupNudges, setGroupApi } from "./groups.js";
import { runMorning } from "./morning.js";
import { runChainChecks } from "./chain/promises.js";
import { anchorAddress } from "./chain/signer.js";
import { maintainStakes } from "./chain/stakes.js";
import { runTransferWatch } from "./chain/transfers.js";
import { chainHealth } from "./chain/sui.js";
import { startCheckinScheduler } from "./checkins.js";
import { runHabitSettlement } from "./habits.js";
import { setBuddyApi } from "./buddies.js";
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
  // DEMO_MODE=1: the website and app on sample data, no bot and no keys (also: npm run demo).
  if (config.DEMO_MODE) {
    const { seedDemo } = await import("./demo.js");
    seedDemo();
    startWebServer();
    console.log("[demo] demo mode: website and app on sample data; Telegram, Gemini, Walrus and Sui are not contacted");
    return;
  }
  // Walrus being slow at boot must not keep the bot offline; recall/save handle outages themselves.
  await retry("memwal health", () => memwal.health(), 3).then(
    (h) => console.log(`[memwal] relayer ${config.MEMWAL_SERVER_URL} is ${h.status ?? "up"}`),
    (err) => console.warn(`[memwal] health check failed at startup, continuing: ${redact(err).split("\n")[0]}`),
  );

  // Sui (through Tatum) being down must not keep the bot offline either; chain checks retry on their own.
  void chainHealth().then((h) =>
    h.ok
      ? console.log(`[sui] Tatum gateway ${config.TATUM_SUI_GRAPHQL_URL} ok (${config.TATUM_API_KEY ? "API key set" : "no API key: heavily rate-limited"})`)
      : console.warn(`[sui] Tatum gateway check failed at startup, continuing: ${h.error}`),
  );
  if (!anchorAddress) console.warn("[sui] ANCHOR_SUI_PRIVATE_KEY not set: signed reports, stakes and agent payments are off");

  const bot = createBot();
  // Command menu and description are cosmetic: retry, but never fail startup over them.
  await retry("setMyCommands", () => bot.api.setMyCommands(BOT_COMMANDS)).catch((err) =>
    console.warn(`[startup] setMyCommands skipped: ${redact(err).split("\n")[0]}`),
  );
  await retry("setMyCommands groups", () => bot.api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } })).catch((err) =>
    console.warn(`[startup] group commands skipped: ${redact(err).split("\n")[0]}`),
  );
  // The menu button beside the message box opens the mini app.
  if (appUrl()) {
    await retry("setChatMenuButton", () => bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Anchor", web_app: { url: appUrl() } } })).catch((err) =>
      console.warn(`[startup] menu button skipped: ${redact(err).split("\n")[0]}`),
    );
  }
  // What a new person sees in the empty chat (max 512) and on the bot's profile (max 120).
  await retry("setMyDescription", () => bot.api.setMyDescription(BOT_DESCRIPTION)).catch((err) =>
    console.warn(`[startup] setMyDescription skipped: ${redact(err).split("\n")[0]}`),
  );
  await retry("setMyShortDescription", () => bot.api.setMyShortDescription(BOT_ABOUT)).catch((err) =>
    console.warn(`[startup] setMyShortDescription skipped: ${redact(err).split("\n")[0]}`),
  );
  const me = await retry("getMe", () => bot.api.getMe());
  bot.botInfo = me; // the runner reuses this instead of calling getMe again
  console.log(`[bot] @${me.username} · ${MODEL_LABEL}`);

  startWebServer(bot.api);
  setBuddyApi(bot.api);
  setGroupApi(bot.api);
  startCheckinScheduler(bot.api);
  setInterval(() => void maintainStakes(bot.api, todayIn(config.TIMEZONE)).catch((err) => console.error("[stake] maintenance failed:", err)), 30 * 60_000);
  setInterval(() => void drainOutbox().catch((err) => console.error("[memwal] outbox drain failed:", err)), 10 * 60_000);

  // Exact-time deadline reminders (local state only) and the Sunday weekly summary, both in each person's timezone.
  setInterval(() => {
    void runDeadlineReminders(bot.api).catch((err) => console.error("[remind] failed:", err));
    // Money promises: early verdicts every 15 min, final ones at the deadline (reads Sui via Tatum).
    void runChainChecks(bot.api).catch((err) => console.error("[chain] failed:", err));
    // Proofs and stakes paid by direct transfer (no browser needed).
    void runTransferWatch(bot.api).catch((err) => console.error("[transfers] failed:", err));
    void runWeekly(bot.api).catch((err) => console.error("[weekly] failed:", err));
    // Habits: settle finished days/weeks into streaks (mornings, local time).
    void runHabitSettlement(bot.api).catch((err) => console.error("[habits] failed:", err));
    // Group deadline checks, and each person's 08:00 morning brief.
    void runGroupNudges(bot.api).catch((err) => console.error("[groups] failed:", err));
    void runMorning(bot.api).catch((err) => console.error("[morning] failed:", err));
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
