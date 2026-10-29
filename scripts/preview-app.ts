/**
 * Local preview of the mini app with the e2e test person (anchor:smoke: namespace),
 * signed in with a throwaway bot token so the link works only on this machine.
 *
 *   node --env-file=.env --import tsx scripts/preview-app.ts   → prints the preview URL
 */
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

process.env.TELEGRAM_BOT_TOKEN = "100000:local-preview-only";
process.env.MEMWAL_NAMESPACE_PREFIX = "anchor:smoke:";
process.env.DATA_DIR = "./data/smoke";
process.env.PORT = process.env.PORT || "3001";
process.env.PUBLIC_URL = `http://localhost:${process.env.PORT}`;

const { allUsers } = await import("../src/state.js");
const { startWebServer } = await import("../src/web/server.js");

// The richest test person: most habits and closed promises.
const [id, user] = allUsers().sort(([, a], [, b]) => Object.keys(b.habits ?? {}).length + Object.keys(b.closed ?? {}).length - Object.keys(a.habits ?? {}).length - Object.keys(a.closed ?? {}).length)[0]!;
const fields: Record<string, string> = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "preview", user: JSON.stringify({ id: Number(id), first_name: user.firstName }) };
const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
const initData = new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") }).toString();
const url = `${process.env.PUBLIC_URL}/app#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=8.0&tgWebAppPlatform=web`;
writeFileSync("./data/smoke/preview-url.txt", url);
startWebServer();
console.log(`[preview] mini app for test user ${id}: data/smoke/preview-url.txt`);
