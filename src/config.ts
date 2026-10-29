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
  /** Comma-separated backup Gemini keys, used when the main key's quota runs out. */
  GEMINI_BACKUP_API_KEYS: z.string().default(""),
  /** Demo mode: the website and app run on sample data with no keys at all (npm run demo). */
  DEMO_MODE: z
    .string()
    .default("")
    .transform((v) => /^(1|true|yes)$/i.test(v)),
  MEMWAL_PRIVATE_KEY: z.string().min(32, "MEMWAL_PRIVATE_KEY is required"),
  MEMWAL_ACCOUNT_ID: z.string().startsWith("0x", "MEMWAL_ACCOUNT_ID must be a 0x… object id"),
  MEMWAL_SERVER_URL: z.string().url().default("https://relayer.memory.walrus.xyz"),
  MEMWAL_NAMESPACE_PREFIX: z.string().default("anchor:tg:"),
  /** Comma-separated Telegram ids to leave out of stats and check-ins (e.g. test runs). */
  HIDDEN_USER_IDS: z.string().default(""),
  /** Tatum mainnet API key: Sui RPC (GraphQL) and the Walrus Storage API. */
  TATUM_API_KEY: z.string().default(""),
  TATUM_SUI_GRAPHQL_URL: z.string().url().default("https://sui-mainnet.gateway.tatum.io/graphql"),
  TATUM_API_URL: z.string().url().default("https://api.tatum.io"),
  /** Anchor's own Sui key (suiprivkey…): signs weekly reports, receives and returns stakes. */
  ANCHOR_SUI_PRIVATE_KEY: z.string().default(""),
  /** The anchor_escrow Move package (trustless stakes), published immutable on mainnet. Empty switches escrow off. */
  ESCROW_PACKAGE_ID: z.string().default("0x119c87d56bd17fc3c5713717c8cd50312b0ef181f555723ab3bc1facf9f48e2d"),
  /** Public base URL of this server, for wallet-link and stake pages. */
  PUBLIC_URL: z.string().default(""),
  /** Largest stake Anchor will hold on one promise, in USDC. */
  STAKE_MAX_USDC: z.coerce.number().positive().default(20),
  /** Price an agent pays (x402) to read one public follow-through record, in USDC. */
  AGENT_PRICE_USDC: z.coerce.number().positive().default(0.01),
  TIMEZONE: z.string().default("Africa/Lagos"),
  CHECKIN_HOUR: z.coerce.number().int().min(0).max(23).default(19),
  PORT: z.coerce.number().int().default(3000),
  DATA_DIR: z.string().default("./data"),
});

export type Config = z.infer<typeof schema>;

/** Placeholders that let demo mode start without real keys; nothing reaches a real service. */
const DEMO_PLACEHOLDERS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "0000000000:demo-mode-no-telegram",
  GOOGLE_GENERATIVE_AI_API_KEY: "demo-mode-no-gemini",
  MEMWAL_PRIVATE_KEY: "0".repeat(64),
  MEMWAL_ACCOUNT_ID: "0x" + "0".repeat(64),
  BOT_USERNAME: "Anchor_daBot",
};

function load(): Config {
  // Treat empty strings as "unset" so defaults apply.
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  if (/^(1|true|yes)$/i.test(env.DEMO_MODE ?? "")) {
    for (const [k, v] of Object.entries(DEMO_PLACEHOLDERS)) env[k] ??= v;
    // Demo state lives apart from real state, and talks to no wallet.
    env.DATA_DIR = "./data/demo";
    delete env.ANCHOR_SUI_PRIVATE_KEY;
    delete env.TATUM_API_KEY;
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Anchor cannot start, fix your environment:\n${problems}\nSee .env.example.`);
    process.exit(1);
  }
  // On Railway the service's own domain is always provided; use it when PUBLIC_URL isn't set.
  if (!parsed.data.PUBLIC_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
    parsed.data.PUBLIC_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  return parsed.data;
}

export const config = load();
