/**
 * Anchor in demo mode: the website and the Anchor app on sample data, no keys needed.
 *
 *   npm run demo   → http://localhost:3000 and http://localhost:3000/app
 */
process.env.DEMO_MODE = "1";
process.env.PUBLIC_URL ||= `http://localhost:${process.env.PORT || 3000}`;

const { seedDemo } = await import("../src/demo.js");
const { startWebServer } = await import("../src/web/server.js");
seedDemo();
startWebServer();
console.log(`[demo] Anchor demo running: ${process.env.PUBLIC_URL} (website) and ${process.env.PUBLIC_URL}/app (the Anchor app, sample person "Ada").`);
console.log("[demo] Nothing here talks to Telegram, Gemini, Walrus or Sui. The live bot is https://t.me/Anchor_daBot");
