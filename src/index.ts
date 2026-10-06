import { run } from "@grammyjs/runner";
import { BOT_COMMANDS, createBot } from "./bot/bot.js";
import { startCheckinScheduler } from "./checkins.js";
import { config } from "./config.js";
import { MODEL_LABEL } from "./llm/model.js";
import { memwal } from "./memory/client.js";
import { flush } from "./state.js";
import { startWebServer } from "./web/server.js";

async function main() {
  const health = await memwal.health();
  console.log(`[memwal] relayer ${config.MEMWAL_SERVER_URL} is ${health.status ?? "up"}`);

  const bot = createBot();
  await bot.api.setMyCommands(BOT_COMMANDS);
  await bot.api.setMyDescription(
    "I'm Anchor — tell me what you'll do and by when. I remember it on Walrus, check in when it's due, and learn what makes you follow through.",
  );
  const me = await bot.api.getMe();
  console.log(`[bot] @${me.username} · ${MODEL_LABEL}`);

  startWebServer();
  startCheckinScheduler(bot.api);

  // Updates run concurrently across users; bot.ts keeps each chat in order.
  // grammY's runner stops silently on 409 Conflict (another instance polling
  // the same token, e.g. during a redeploy) — restart it instead of going deaf.
  let runner = run(bot);
  const watch = () => {
    void runner.task()?.catch(async (err: { error_code?: number; description?: string }) => {
      console.error(`[bot] polling stopped: ${err?.description ?? err}`);
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

process.on("unhandledRejection", (err) => console.error("[unhandled]", err));

main().catch((err) => {
  console.error("Anchor failed to start:", err);
  process.exit(1);
});
