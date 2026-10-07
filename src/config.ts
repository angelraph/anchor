import { z } from "zod";

try {
  process.loadEnvFile();
} catch {
  // No .env file, rely on the real environment (e.g. Railway variables).
}

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN is required"),
  BOT_USERNAME: z.string().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(10, "GOOGLE_GENERATIVE_AI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.1-flash-lite,gemini-flash-latest,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash"),
  MEMWAL_PRIVATE_KEY: z.string().min(32, "MEMWAL_PRIVATE_KEY is required"),
  MEMWAL_ACCOUNT_ID: z.string().startsWith("0x", "MEMWAL_ACCOUNT_ID must be a 0x… object id"),
  MEMWAL_SERVER_URL: z.string().url().default("https://relayer.memory.walrus.xyz"),
  MEMWAL_NAMESPACE_PREFIX: z.string().default("anchor:tg:"),
  /** Comma-separated Telegram ids to leave out of stats and check-ins (e.g. test runs). */
  HIDDEN_USER_IDS: z.string().default(""),
  TIMEZONE: z.string().default("Africa/Lagos"),
  CHECKIN_HOUR: z.coerce.number().int().min(0).max(23).default(19),
  PORT: z.coerce.number().int().default(3000),
  DATA_DIR: z.string().default("./data"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  // Treat empty strings as "unset" so defaults apply.
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Anchor cannot start, fix your environment:\n${problems}\nSee .env.example.`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();
