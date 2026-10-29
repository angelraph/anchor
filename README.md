<p align="center"><img src="docs/logo.svg" width="120" alt="Anchor logo"></p>

# Anchor, the bot that holds you to your word

> 🥉 **3rd place, Walrus Session 8: "Chatbots That Remember"**

**Anchor is a Telegram accountability partner that remembers you.** You tell it what you'll do and by when. It stores the promise in [Walrus Memory](https://github.com/MystenLabs/MemWal), reminds you before the deadline, checks in when it arrives, records whether you kept it, and gradually learns your patterns: what derails you and what actually works.

**New for Total Recall: promises the chain can verify.** For money promises ("save 50 USDC by Friday", "pay Tobi back 20 USDC") your word isn't the evidence, your wallet is. Anchor reads Sui through **Tatum's RPC gateway**, closes the promise itself with the transaction digest as proof, lets you **stake USDC on your word with x402**, publishes **signed follow-through reports to Walrus through Tatum's Storage API**, and takes your memory into **Claude Code, Codex or any MCP client**. See [what was built during Total Recall](docs/TOTAL_RECALL.md).

> "This is the third time the gym has moved to 'next Monday'. The week it stuck, you went at 7am with Tobi. Same plan this week?"

**Try it:** [t.me/Anchor_daBot](https://t.me/Anchor_daBot) · **Live proof page:** [anchor-production-6bb4.up.railway.app](https://anchor-production-6bb4.up.railway.app) · **Write-up:** [Medium](https://medium.com/@uzoechiraphael1/how-i-added-long-term-memory-to-a-telegram-chatbot-so-it-remembers-users-between-sessions-76a7579b20af) · **Launch post:** [X](https://x.com/RaphElevator/status/2107822561358696748)

- **LLM:** Google Gemini (`gemini-3.8-flash`, with automatic Gemini fallbacks) via the Vercel AI SDK
- **Memory:** Walrus Memory (`@mysten-incubation/memwal`, mainnet relayer). Every user has an isolated, encrypted namespace.
- **Chain:** Sui mainnet through [Tatum's RPC gateway](https://docs.tatum.io/reference/rpc-sui) (GraphQL): balances, transfer history, SuiNS, transaction simulation and execution
- **Storage:** signed reports on Walrus mainnet through [Tatum's Storage API](https://docs.tatum.io/reference/storageupload)
- **Payments:** x402 v2, scheme `exact` on `sui:mainnet` (USDC), verified and settled by Anchor through Tatum; stakes in USDC or USDsui, by x402 or by exact transfer
- **Portable memory:** an MCP server (`scripts/anchor-mcp.ts`) and a personal API
- **Channel:** Telegram (grammY), plus a public proof page
- **Built for:** Walrus Session 8, "Chatbots That Remember" (🥉 3rd), and now **Total Recall** (Tatum × Walrus), track **Smart Agents for Real Life**. 🥉 **Won 3rd place.**

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

### Built during Total Recall (Oct 20 – Nov 10, 2026)
- **Chain-verified money promises** via Tatum's Sui RPC: `save`, `hold`, `pay` and spending-`cap` promises in SUI, USDC or WAL, closed from on-chain evidence, with the transaction digest stored in the outcome memory on Walrus.
- **Wallet linking** by address or SuiNS name, with proof of ownership by signed message (zkLogin wallets included).
- **Trustless stakes in a Move escrow** ([`move/anchor_escrow`](move/anchor_escrow), package [`0x119c…8e2d`](https://suiscan.xyz/mainnet/object/0x119c87d56bd17fc3c5713717c8cd50312b0ef181f555723ab3bc1facf9f48e2d), published **immutable**): your stake sits in a Sui object, not Anchor's wallet. The contract can only send it back to you (kept) or to the person you chose (missed), and if Anchor ever went silent you reclaim it a week after the deadline. Paying Anchor with x402 is still there as the alternative.
- **Per-user timezones** (`/timezone Berlin`, or just tell Anchor your city): every reminder, check-in, deadline and weekly summary runs on your own clock.
- **Habits and streaks**: "gym 3 times a week", "read every day". Anchor asks at check-in, counts the streak, settles each day or week, and stores streaks on Walrus.
- **Accountability buddies**: `/buddy` gives you an invite link; your buddy sees what you kept and missed (only what you allow) and can cheer or nudge you with one tap.
- **Real money values through Tatum's Data API**: `/money NGN` shows your wallet in your currency, and promises can be in it too ("save ₦50,000 by December", "spend under $30 this week").
- **Guided tour** (`/tour`): seven steps from first promise to stakes, for people who've never used a crypto wallet.
- **The Anchor app inside Telegram** (menu button or `/app`): a follow-through ring, a five-week calendar of kept and missed days, open promises, habit streaks, what Anchor has learned about you, weekly bars, your photo proofs, and **the memory switch**: ask one question and flip between the answer without memory and the answer with it. A **share card** (`/c/<code>`) shows only your first name and your numbers.
- **Photo proof for any promise**: send a gym selfie, the screenshot of the sent email, the finished page. Gemini matches it to the open promise, the outcome is recorded, and the photo is **encrypted and stored on Walrus through Tatum's Storage API**, readable only by you.
- **Voice promises**: send a voice note instead of typing; Anchor transcribes it and treats it like any message.
- **Group mode**: add Anchor to a study group, team or family chat. `/promise` in front of everyone, a deadline check only the promiser can answer, kept or missed announced however it was answered (in private, by photo, or by the chain), and a weekly `/board`. Groups never see anyone's memories.
- **Bring your own Walrus Memory** (`/mymemory`): move your memory into your own Walrus Memory account; Anchor checks the delegate key, copies your memories over, and from then on reads and writes only there. The key is stored encrypted and the message holding it is deleted.
- **The morning brief**: at 08:00 your time, what's due today, your habits and streaks, how the week is going, and one thing Anchor learned that helps today (`/morning off` stops it).
- **Hardened**: mini app sign-in verified against Telegram's signature on every call (constant time, 24 hour expiry), per-person and per-IP rate limits, request size limits, a strict Content Security Policy, AES-256-GCM encryption at rest with per-person keys, and owner-only access to proofs and group checks.
- **Signed weekly reports** published to Walrus via Tatum's Storage API, verifiable by anyone at `/report/<jobId>`.
- **Agent payments**: AI agents pay per read (x402) for the signed follow-through record of people who opt in. Discovery at `/.well-known/x402`, a reference client in `scripts/agent-pay.ts`.
- **Money patterns learned from the chain** ("sends out most USDC on Saturdays") and stored on Walrus as patterns that shape later advice.
- **A visible learning loop**: `/learning` timeline per person, and live counters on the proof page (replies shaped by learned patterns, outcomes, chain verdicts).
- **Portable memory**: `/connect` + MCP server, so promises made in Claude Code are followed up in Telegram.

Full list with file pointers: [docs/TOTAL_RECALL.md](docs/TOTAL_RECALL.md).

**Escrow live on Sui mainnet (2026-10-28):** the package was published and frozen in one transaction ([tx](https://suiscan.xyz/mainnet/tx/58462JNqhhhDP7wzzAbt4YnNPkv5edVGxzMpHo7x4ACb)), then a stake was locked in it ([tx](https://suiscan.xyz/mainnet/tx/HnFow8MAZrQ2KbDwY6h7NsfFjjUeDBozuABB8YK1n3Tv)) and released back by Anchor's "kept" verdict ([tx](https://suiscan.xyz/mainnet/tx/Cy2h7dYErBWnLCC6APkCHVtGfw7nCTh7qd1jTo3rbq7S)).

**Live on Sui mainnet (2026-10-27):** a wallet proven by exact transfer ([tx](https://suiscan.xyz/mainnet/tx/9z5jWhjcwdME7w11u1WPcLz8DurANNncvQF4qrCZPbrn)), a 1 USDC stake on "save 1 USDsui by Friday" ([tx](https://suiscan.xyz/mainnet/tx/MusNBtgHF3KDMoNXMatgm1Lf2bQXJX9UnnRwV4AiAUM)), an AI agent paying 0.01 USDC over x402 for a signed record ([tx](https://suiscan.xyz/mainnet/tx/5kE6mngkpmvSAEo7azBMHBKduGqmNw2scUfY9N8VD5s6)), and a signed report certified on Walrus via Tatum ([tx](https://suiscan.xyz/mainnet/tx/5q3cfsPn1mC5JgX8nko3WyunFVvGwDnbMb1JYJNDEb8K)). Details in [Live evidence](docs/TOTAL_RECALL.md#live-evidence-on-sui-mainnet-2026-10-27).

### Roadmap
1. **WhatsApp**, where most of our first users already live (needs a Meta Business account and number)
2. **Monthly reflections** built from long-term memory
3. **Group stakes**: a team staking into one shared escrow pot

## What memory does in Anchor

| Moment | Recall | Store |
|---|---|---|
| You send a message | What you're talking about (semantic), your latest promises and outcomes (`sort: "recent"`), and your profile and habits (cached 10 min), plus anything learned in the last few minutes while Walrus finishes indexing | Gemini extracts typed memories from the exchange: `commitment`, `outcome`, `pattern`, `win`, `fact`, `preference` |
| 30 min before a timed deadline | (none: read from a local mirror of timed promises, no Walrus cost) | (none) |
| At the deadline, and at 19:00 for anything still open | Commitments + outcomes → due promises, plus memories related to each one | Your answer (button or text) becomes an `outcome` memory linked to the promise |
| You tap ✅ / 🟡 / ❌ / 📅 | (none) | `outcome` saved; Anchor asks *what made it work* / *what got in the way* → `win` / `pattern` |
| Sunday 19:00 or `/week` | The week's promises and outcomes, plus what helped and what got in the way | (none) |
| `/forget <topic>` | Finds candidate memories | Writes a tombstone (`retracted`); it's filtered out of every future recall |
| You promise money ("save 50 USDC by Friday") | (none) | `commitment` with a chain check (`chk:`) and the baseline balance read from Sui via Tatum |
| A payment lands, or the deadline passes | Sui via Tatum (balance or transfers), not Walrus | `outcome` with `proof:<tx digest>`; a missed staked promise sends the stake on |
| Sunday or `/money` | Your last 4 weeks of transfers on Sui via Tatum | A money `pattern` when one weekday dominates your spending |
| `/report` | The week's promises and outcomes, patterns and wins | A `report` memory pointing at the signed file on Walrus |

Memories are stored as single readable lines with a typed header, so they embed well and parse back into structure after recall:

```
[commitment] 2026-10-07 id:33a6 due:2026-10-07 at:18:00 | Promised to send CV to two companies
[outcome] 2026-10-07 ref:33a6 status:kept | Kept the promise
[win] 2026-10-07 | Putting the phone in another room helps him finish tasks
[commitment] 2026-10-27 id:p2x1 due:2026-10-29 chk:pay~USDC~20~n=Tobi~to=0x7a…~s=1761552000000 | Promised to pay Tobi back 20 USDC
[outcome] 2026-10-28 ref:p2x1 status:kept proof:9xQe… | Kept the promise, verified on Sui: Sent 20 USDC to Tobi on Sui.
```

### Commands
| | |
|---|---|
| `/app` | The Anchor app: calendar, streaks, what Anchor learned, the memory switch, photo proofs |
| `/promises` | Open and finished promises, plus your follow-through rate |
| `/morning [on\|off]` | Your morning brief now, or switch the daily one |
| `/mymemory` | Move your memory into your own Walrus Memory account (`/mymemory off` to switch back) |
| 🎙 voice note · 📸 photo | Promise by talking; prove a promise with a photo |
| In a group: `/promise`, `/board`, `/open` | Promise in front of the group, the week's board, what's still open |
| `/memory` | Everything Anchor remembers, grouped by type, with your total memory count on Walrus |
| `/why` | The exact memories (with Walrus blob IDs) behind the last reply |
| `/compare <msg>` | The same message answered **without** and **with** memory, side by side |
| `/forget <topic>` | Pick a memory to forget |
| `/checkin` | Check in on promises that are due now |
| `/week` | Your follow-through this week |
| `/stats` | Users and memories across Anchor |
| `/wallet <address or name.sui>` | Link a Sui wallet (resolved via Tatum), then prove it's yours by signing a message |
| `/money [NGN\|EUR\|…]` | Balances and their value in your currency (Tatum Data API), money promises in progress, money patterns learned |
| `/verify` | Check money promises on Sui right now |
| `/stake #id <amount> [usdc\|usdsui] <name.sui>` | Put money on a promise, locked in the escrow contract on Sui (or paid by x402) |
| `/habit <text>` · `/habits` | Start a habit, see streaks |
| `/buddy [remove\|private\|share]` | Invite an accountability buddy, or change what they see |
| `/timezone <city or zone>` | Set your own clock |
| `/tour` | A guided tour |
| `/report [public\|auto\|off]` | Publish a signed follow-through report to Walrus (via Tatum) |
| `/record on\|off` | Let AI agents buy your signed record (x402) |
| `/learning` | How Anchor learned you, week by week |
| `/connect` | A token for the MCP server / API, to use your Anchor memory in other tools |

## Run it yourself (about 10 minutes)

**Requirements:** Node 20+ and three credentials (five for the on-chain features).

1. **Walrus Memory:** sign in at <https://memory.walrus.xyz>, create a delegate key, and copy the **private key** and **account ID** (the account object ID, not your wallet address).
2. **Telegram:** message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token.
3. **Gemini:** create a key at <https://aistudio.google.com/apikey>.
4. **Tatum** (on-chain features): a free mainnet API key at <https://dashboard.tatum.io>. Without a key Tatum allows 5 requests a minute, which isn't enough.
5. **Anchor's Sui key** (reports, stakes, agent payments): `sui keytool generate ed25519`, put the `suiprivkey1…` in `ANCHOR_SUI_PRIVATE_KEY`, and send that address a little SUI for gas. Set `PUBLIC_URL` to your deployment's URL.

```bash
git clone https://github.com/angelraph/anchor && cd anchor
npm install
cp .env.example .env        # paste the three credentials
npm run verify:memwal       # real remember → recall round trip on Walrus
npx tsx scripts/verify-tatum.ts   # chain id, coin decimals, SuiNS, balances, transfers, Storage API, all via Tatum
npx tsx scripts/verify-report.ts  # sign → upload to Walrus via Tatum → certified → download → signature verified
npm start                   # bot + proof page on http://localhost:3000
```

Open your bot in Telegram and send `/start`.

```bash
npm test                          # 45 unit tests: memory format, deadlines, reminders, weekly stats, dedupe, tombstones,
                                  # chain checks, x402 verify/settle with real signed Sui transactions, signed reports, learning loop
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
every minute ──► money promises: early verdicts every 15 min, final ones at the deadline
               └─ Sui mainnet via Tatum (GraphQL gateway) ──► outcome + tx digest ──► Walrus Memory
Hono         ──► / (site + proof) · /proof.json · /health
               ├─ /link/:token        wallet ownership (signed personal message)
               ├─ /x402/stake/:token  x402 exact on Sui: verify (simulate via Tatum) → settle (execute via Tatum)
               ├─ /x402/record/:addr  agents pay per read for a signed follow-through record
               ├─ /report/:jobId      signed report, fetched back from Walrus, signature checked
               └─ /api/me/*           portable memory for the MCP server (scripts/anchor-mcp.ts)
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
| `src/chain/sui.ts` | Tatum Sui gateway client (GraphQL): balances, transfers, SuiNS, coin units |
| `src/chain/checks.ts` | Chain checks in the memory header and the judge that turns chain data into kept / broken (pure, unit-tested) |
| `src/chain/promises.ts` | Preparing checks, the verifier loop, verdicts written to Walrus with proof |
| `src/chain/x402.ts` | x402 v2 `exact` on Sui: requirements, verification (signature, simulation, balance change), settlement |
| `src/chain/stakes.ts` | Stake lifecycle and payouts signed by Anchor's key |
| `src/web/app-routes.ts`, `src/web/app-page.ts`, `src/web/guard.ts` | The mini app, its API, the share card, and request protection |
| `src/proof.ts`, `src/media.ts`, `src/secrets.ts` | Photo proof (encrypted on Walrus via Tatum), voice transcription, encryption at rest |
| `src/groups.ts`, `src/bot/group-commands.ts` | Group mode |
| `src/memory/own.ts`, `src/memory/client.ts` | Bring your own Walrus Memory |
| `src/morning.ts` | The daily morning brief |
| `move/anchor_escrow`, `src/chain/escrow.ts` | The Move escrow (9 Move tests) and its TypeScript side: build, check-then-execute, settle |
| `src/chain/report.ts` | Signed reports, Tatum Storage API upload, verification |
| `src/learning.ts` | Learning-loop counters, `/learning` timeline, money patterns from the chain |
| `src/web/chain-routes.ts`, `client/wallet.ts` | Wallet-link and stake pages (Wallet Standard), x402 endpoints, report verifier |
| `src/web/me-routes.ts`, `scripts/anchor-mcp.ts` | Portable memory API and the MCP server |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and every Walrus Memory and Gemini friction point found while building.

## Privacy
Each Telegram user has their own namespace (`anchor:tg:<id>`), and recall never crosses namespaces. Memory contents are encrypted on Walrus. The proof page shows only anonymised hashes and counts. Walrus Memory is append-only, so `/forget` hides a memory from Anchor but does not erase the encrypted blob.

A linked wallet is only read, never controlled: ownership is proven by signing a message, not a transaction. Signed reports are public Walrus files, so promise texts are replaced by SHA-256 hashes unless you ask for `/report public`. Agents can buy your record only after `/record on`, and they get counts and on-chain proofs, never your messages. The `/connect` token is stored hashed and revoked with `/connect off`.

## License
MIT
