/** Serve only the landing/proof page (no Telegram polling) — for local UI work. */
const { startWebServer } = await import("../src/web/server.js");
startWebServer();
