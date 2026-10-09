<p align="center"><img src="docs/logo.svg" width="120" alt="Anchor logo"></p>

# Anchor, the bot that holds you to your word

**Anchor is a Telegram accountability partner that remembers you.** You tell it what you'll do and by when. It stores the promise in [Walrus Memory](https://github.com/MystenLabs/MemWal), reminds you before the deadline, checks in when it arrives, records whether you kept it, and gradually learns your patterns: what derails you and what actually works.

> "This is the third time the gym has moved to 'next Monday'. The week it stuck, you went at 7am with Tobi. Same plan this week?"

**Try it:** [t.me/Anchor_daBot](https://t.me/Anchor_daBot) · **Live proof page:** [anchor-production-6bb4.up.railway.app](https://anchor-production-6bb4.up.railway.app) · **Write-up:** [Medium](https://medium.com/@uzoechiraphael1/how-i-added-long-term-memory-to-a-telegram-chatbot-so-it-remembers-users-between-sessions-76a7579b20af) · **Launch post:** [X](https://x.com/RaphElevator/status/2107822561358696748)

- **LLM:** Google Gemini (`gemini-3.8-flash`, with automatic Gemini fallbacks) via the Vercel AI SDK
- **Memory:** Walrus Memory (`@mysten-incubation/memwal`, mainnet relayer). Every user has an isolated, encrypted namespace.
- **Channel:** Telegram (grammY), plus a public proof page
- **Built for:** Walrus Session 8, "Chatbots That Remember"

## The problem

People don't lack goals. They lack follow-through, and **nothing remembers their promises with them**.

- We make promises to ourselves every day ("I'll start tomorrow", "I'll send it by Friday") and quietly let them slide. Nobody notices, including us.
- Reminder apps fire once and get swiped away. They don't know whether you did it, why you didn't, or what helped last time.
- Every AI chat starts from zero. Tell a chatbot your goal today and tomorrow it has no idea you said it.
- Coaches and accountability partners work, but most people can't afford one, and friends forget.

Without memory, an accountability bot is just a motivational poster. With memory, it can catch the excuse you keep repeating and bring back the strategy that worked for *you*.

## Who it's for

- **Students:** "revise two chapters by tomorrow evening", and Anchor knows they focus better at the library.
- **Professionals:** a site inspection by 3pm, a deal to close by 8am, five job applications by Friday.
- **Personal goals:** the gym, saving money, reading, starting a farm by the end of the month.
- **Anyone breaking a habit loop:** Anchor names the pattern ("phone at night, skipped again") and reminds you what helped before.

## Vision

An accountability partner **anyone can afford**, inside the messaging app they already use, that **gets better the longer you use it**. It remembers every promise, notices which ones you keep, and learns *your* patterns instead of handing out generic advice. Your memory lives encrypted on Walrus, in your own namespace, not in a database we own, so in the long run it can travel with you to any app.

## Current status (October 9, 2026)

**Live and in daily use.** Running 24/7 on Railway since October 6.

| | |
|---|---|
| People using it | **11** |
| Memories on Walrus | **107** |
| People with 10+ memories | **8** |

Counts come live from Walrus Memory (`listNamespaces`) on the [proof page](https://anchor-production-6bb4.up.railway.app).

### Working today
- **Promises with real dates and times.** "By 6am" said at 23:59 becomes tomorrow 06:00; "remind me to buy a charger" becomes due today.
- **Deadline reminders.** A heads-up 30 minutes before a timed promise ("by 3pm" means 14:30), a check at the exact deadline (15:00) with ✅ 🟡 ❌ 📅 buttons, and an evening check-in at 19:00 for anything still open. Nobody is asked twice, and every reminder is a normal Telegram message, so it buzzes the phone.
- **Weekly follow-through summary.** Every Sunday evening (and `/week` any time): kept, partly kept, missed, follow-through %, what's still open, and one insight from memory.
- **Learning the person.** Patterns (what derails you) and wins (what works) are stored and used when you plan something new.
- **Memory you can inspect and control.** `/memory`, `/why` (with Walrus blob IDs), `/compare` (with vs without memory), `/forget`.
- **Reliability.** Survives Gemini overloads (ranks models by real speed, retries, falls back to Walrus `analyze()` so nothing is lost), Walrus outages (answers honestly, queues failed saves and retries them), the Walrus hourly request budget (caching), Telegram conflicts during redeploys, and network blips at startup.

### Evidence
- Real conversations, the next-day recall moment, and the bugs real users found: see the [Medium write-up](https://medium.com/@uzoechiraphael1/how-i-added-long-term-memory-to-a-telegram-chatbot-so-it-remembers-users-between-sessions-76a7579b20af) and the screenshots in [docs/img](docs/img).
- Two reproducible Walrus Memory bugs filed upstream: [MemWal#1131](https://github.com/MystenLabs/MemWal/issues/1131) (`analyze()` resolves weekdays to the wrong date) and [MemWal#1132](https://github.com/MystenLabs/MemWal/issues/1132) (unhelpful 401 when the account ID is a wallet address).

### Roadmap
1. **WhatsApp**, where most of our first users already live (needs a Meta Business account and number)
2. **Accountability buddies**: let a friend see your follow-through and nudge you, with your permission
3. **Streaks and monthly reflections** built from long-term memory
4. **Bring your own memory**: connect your own Walrus Memory account so your data is fully yours and portable to other apps
5. **Voice notes**: make a promise by talking; Anchor transcribes and remembers it

## What memory does in Anchor

| Moment | Recall | Store |
|---|---|---|
| You send a message | What you're talking about (semantic), your latest promises and outcomes (`sort: "recent"`), and your profile and habits (cached 10 min), plus anything learned in the last few minutes while Walrus finishes indexing | Gemini extracts typed memories from the exchange: `commitment`, `outcome`, `pattern`, `win`, `fact`, `preference` |
| 30 min before a timed deadline | (none: read from a local mirror of timed promises, no Walrus cost) | (none) |
| At the deadline, and at 19:00 for anything still open | Commitments + outcomes → due promises, plus memories related to each one | Your answer (button or text) becomes an `outcome` memory linked to the promise |
| You tap ✅ / 🟡 / ❌ / 📅 | (none) | `outcome` saved; Anchor asks *what made it work* / *what got in the way* → `win` / `pattern` |
| Sunday 19:00 or `/week` | The week's promises and outcomes, plus what helped and what got in the way | (none) |
| `/forget <topic>` | Finds candidate memories | Writes a tombstone (`retracted`); it's filtered out of every future recall |

Memories are stored as single readable lines with a typed header, so they embed well and parse back into structure after recall:

```
[commitment] 2026-10-07 id:33a6 due:2026-10-07 at:18:00 | Promised to send CV to two companies
[outcome] 2026-10-07 ref:33a6 status:kept | Kept the promise
[win] 2026-10-07 | Putting the phone in another room helps him finish tasks
```

### Commands
| | |
|---|---|
| `/promises` | Open and finished promises, plus your follow-through rate |
| `/memory` | Everything Anchor remembers, grouped by type, with your total memory count on Walrus |
| `/why` | The exact memories (with Walrus blob IDs) behind the last reply |
| `/compare <msg>` | The same message answered **without** and **with** memory, side by side |
| `/forget <topic>` | Pick a memory to forget |
| `/checkin` | Check in on promises that are due now |
| `/week` | Your follow-through this week |
| `/stats` | Users and memories across Anchor |

## Run it yourself (about 10 minutes)

**Requirements:** Node 20+ and three credentials.

1. **Walrus Memory:** sign in at <https://memory.walrus.xyz>, create a delegate key, and copy the **private key** and **account ID** (the account object ID, not your wallet address).
2. **Telegram:** message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token.
3. **Gemini:** create a key at <https://aistudio.google.com/apikey>.

```bash
git clone https://github.com/angelraph/anchor && cd anchor
npm install
cp .env.example .env        # paste the three credentials
npm run verify:memwal       # real remember → recall round trip on Walrus
npm start                   # bot + proof page on http://localhost:3000
```

Open your bot in Telegram and send `/start`.

```bash
npm test                          # 25 unit tests: memory format, deadlines, reminders, weekly stats, dedupe, tombstones
npm run typecheck
npx tsx scripts/e2e.ts            # every command and button through the real bot (real Gemini + Walrus)
npx tsx scripts/checkin-dryrun.ts # the scheduled evening check-in, with Telegram sends captured
npx tsx scripts/preview-web.ts    # the website only, no Telegram polling
```

The live scripts use a separate `anchor:smoke:` namespace, but they share your Walrus account's hourly request budget (1,000 weighted requests), so don't run them repeatedly against a production account.

### Deploy on Railway
1. Push this repo to GitHub, then in Railway choose **New Project → Deploy from GitHub repo**. The `Dockerfile` and `railway.json` are picked up automatically.
2. Under **Variables**, add everything from `.env.example`.
3. Add a **Volume** mounted at `/app/data`. This keeps reminder and check-in bookkeeping across redeploys; long-term memory lives on Walrus either way.
4. Under **Settings → Networking**, generate a domain. That URL is your public proof page.

Keep **one replica**: Telegram long polling allows only one consumer per bot token.

## Architecture

```
Telegram ──► grammY (per-chat ordering, concurrent across users)
               │
               ├─ recall ──► Walrus Memory relayer ──► Walrus (encrypted blobs)
               ├─ Gemini reply (fastest healthy model; memory injected as untrusted data)
               └─ background: Gemini extraction → dedupe → rememberBulkAndWait (outbox on failure)

every minute ──► heads-up 30 min before / check at the deadline (local mirror, no Walrus calls)
19:00 daily  ──► recall due promises → message users first
Sunday 19:00 ──► weekly follow-through summary
Hono         ──► / (site + proof) · /proof.json · /health
```

| File | Role |
|---|---|
| `src/memory/types.ts` | Memory format, parser, commitment/outcome pairing, deadline timing, tombstones (pure, unit-tested) |
| `src/memory/recall.ts` | Per-turn recall, caching, just-learned memories, commitment sweeps |
| `src/memory/write.ts` | Gemini structured extraction → dedupe → `rememberBulkAndWait`, outbox, `analyze()` fallback |
| `src/llm/model.ts` | Gemini model routing: fastest healthy model, cooldowns, retries |
| `src/bot/conversation.ts` | The memory loop for one chat turn |
| `src/bot/bot.ts` | Commands, outcome and forget buttons |
| `src/checkins.ts` | Evening check-ins |
| `src/reminders.ts` | 30-minute heads-up, deadline reminders, weekly summary |
| `src/web/server.ts`, `page.ts` | Website and live proof page backed by `listNamespaces` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and every Walrus Memory and Gemini friction point found while building.

## Privacy
Each Telegram user has their own namespace (`anchor:tg:<id>`), and recall never crosses namespaces. Memory contents are encrypted on Walrus. The proof page shows only anonymised hashes and counts. Walrus Memory is append-only, so `/forget` hides a memory from Anchor but does not erase the encrypted blob.

## License
MIT
