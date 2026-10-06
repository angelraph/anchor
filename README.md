# ⚓ Anchor, the bot that holds you to your word

**Anchor is a Telegram accountability partner that remembers you.** You tell it what you'll do and by when. It stores the promise in [Walrus Memory](https://github.com/MystenLabs/MemWal), messages you first when the deadline arrives, records whether you kept it, and gradually learns your patterns: what derails you and what actually works.

> "This is the third time the gym has moved to 'next Monday'. The week it stuck, you went at 7am with Tobi. Same plan this week?"

Without memory, an accountability bot is just a motivational poster. With memory, it catches the excuses you repeat and reminds you of the strategies that worked.

- **LLM:** Google Gemini (`gemini-3.8-flash`) via the Vercel AI SDK
- **Memory:** Walrus Memory (`@mysten-incubation/memwal`, mainnet relayer). Every user has an isolated, encrypted namespace.
- **Channel:** Telegram (grammY), plus a public proof page
- **Built for:** Walrus Session 8, "Chatbots That Remember"


## What memory does in Anchor

| Moment | Recall | Store |
|---|---|---|
| You send a message | 3 parallel recalls: **semantic** (what you're talking about), **recent** (latest promises/outcomes, `sort: "recent"`), **profile** (who you are, how you like to be coached) | Gemini extracts typed memories from the exchange: `commitment`, `outcome`, `pattern`, `win`, `fact`, `preference` |
| A promise is due (daily, 19:00) | Commitments + outcomes → due/overdue promises, plus memories related to each one | Your answer (button or text) becomes an `outcome` memory linked to the promise |
| You tap ✅ / 🟡 / ❌ / 📅 | (none) | `outcome` saved; Anchor asks *what made it work* / *what got in the way* → `win` / `pattern` |
| `/forget <topic>` | Finds candidate memories | Writes a tombstone (`retracted`); it's filtered out of every future recall |

Memories are stored as single readable lines with a typed header, so they embed well and parse back into structure after recall:

```
[commitment] 2026-10-06 id:k3f9 due:2026-10-09 | Promised to send 5 job applications
[outcome] 2026-10-09 ref:k3f9 status:partial | Sent 2 applications; lost the evening to a family event
[win] 2026-10-10 | Applications get done when blocked out before work at 7am
```

### Commands
| | |
|---|---|
| `/promises` | Open and finished promises, plus your follow-through rate |
| `/memory` | Everything Anchor remembers, grouped by type, with your total memory count on Walrus |
| `/why` | The exact memories (with Walrus blob IDs) behind the last reply |
| `/compare <msg>` | The same message answered **without** and **with** memory, side by side |
| `/forget <topic>` | Pick a memory to forget |
| `/checkin` | Run the due-promise check-in now |
| `/stats` | Users and memories across Anchor |


## Run it yourself (about 10 minutes)

**Requirements:** Node 20+ and three credentials.

1. **Walrus Memory:** sign in at <https://memory.walrus.xyz>, create a delegate key, and copy the **private key** and **account ID**.
2. **Telegram:** message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token.
3. **Gemini:** create a free key at <https://aistudio.google.com/apikey>.

```bash
git clone <this repo> anchor && cd anchor
npm install
cp .env.example .env        # paste the three credentials
npm run verify:memwal       # real remember → recall round trip on Walrus
npm start                   # bot + proof page on http://localhost:3000
```

Open your bot in Telegram and send `/start`.

```bash
npm test          # unit tests: memory format, commitment tracking, tombstones, dates
npm run typecheck
npx tsx scripts/smoke.ts   # live end-to-end chat loop (real Gemini + Walrus, separate test namespace)
```

### Deploy on Railway
1. Push this repo to GitHub, then in Railway choose **New Project → Deploy from GitHub repo**. The `Dockerfile` and `railway.json` are picked up automatically.
2. Under **Variables**, add everything from `.env.example`.
3. Add a **Volume** mounted at `/app/data`. This keeps check-in bookkeeping across redeploys; long-term memory lives on Walrus either way.
4. Under **Settings → Networking**, generate a domain. That URL is your public proof page.

Keep **one replica**: Telegram long polling allows only one consumer per bot token.


## Architecture

```
Telegram ──► grammY (per-chat ordering, concurrent across users)
               │
               ├─ recall ×3 ──► Walrus Memory relayer ──► Walrus (encrypted blobs)
               ├─ Gemini reply (memory injected as nonce-delimited untrusted data)
               └─ background: Gemini extraction → dedupe → rememberBulkAndWait

hourly tick ──► at CHECKIN_HOUR: listNamespaces → recall due promises → message users first
Hono       ──► / (proof page) · /proof.json · /health
```

| File | Role |
|---|---|
| `src/memory/types.ts` | Memory format, parser, commitment/outcome pairing, tombstone filtering (pure, unit-tested) |
| `src/memory/recall.ts` | Per-turn triple recall and commitment sweeps |
| `src/memory/write.ts` | Gemini structured extraction → dedupe → `rememberBulkAndWait` with retries |
| `src/bot/conversation.ts` | The memory loop for one chat turn |
| `src/bot/bot.ts` | Commands, outcome and forget buttons |
| `src/checkins.ts` | Proactive daily check-ins |
| `src/web/server.ts` | Public proof page backed by `listNamespaces` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and the Walrus Memory friction points found while building.

## Privacy
Each Telegram user has their own namespace (`anchor:tg:<id>`), and recall never crosses namespaces. Memory contents are encrypted on Walrus. The proof page shows only anonymised hashes and counts. Walrus Memory is append-only, so `/forget` hides a memory from Anchor but does not erase the encrypted blob. See the docs.

## License
MIT
