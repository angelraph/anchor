# Anchor: grant proposal

**An accountability partner in Telegram that remembers every promise on Walrus and lets Sui be the referee.**

- Bot: [t.me/Anchor_daBot](https://t.me/Anchor_daBot) · Code (open source): [github.com/angelraph/anchor](https://github.com/angelraph/anchor)
- Proof page: [anchor-production-6bb4.up.railway.app](https://anchor-production-6bb4.up.railway.app)
- Escrow package on Sui mainnet (immutable): [`0x119c87d5…f48e2d`](https://suiscan.xyz/mainnet/object/0x119c87d56bd17fc3c5713717c8cd50312b0ef181f555723ab3bc1facf9f48e2d)
- Track record: 3rd place, Walrus Session 8. Entered Tatum × Walrus "Total Recall" (2026).

## The problem

People don't lack goals. They lack follow-through. Coaches and accountability partners work, but they cost money and they forget. Habit apps live in yet another app nobody opens after week two. And when money is involved ("I'll save 50,000 naira by December", "I'll pay you back on Friday"), the only evidence is somebody's word.

## What Anchor does today (live on mainnet)

You talk to Anchor in Telegram like you would to a friend. It turns what you say into promises, and it does four things no ordinary chatbot does:

1. **It remembers, for months.** Every promise, outcome, pattern ("phone distracts me when I code at night") and win ("putting the phone in another room works") is a typed memory in your own encrypted Walrus Memory namespace. It recalls them when you plan something new, and you can inspect (`/memory`, `/why` with blob IDs) or retract (`/forget`) any of them.
2. **It follows up on your clock.** A heads-up before a timed deadline, a check at the deadline, an evening check-in, weekly follow-through, all in your own timezone. Habits ("gym 3 times a week") become streaks it counts and settles.
3. **It lets the chain judge money promises.** Link a Sui wallet (proved by signature or by an exact transfer), and promises to save, hold, pay someone or stay under a spending cap are closed from Sui evidence read through Tatum, in SUI, USDC, USDsui or your own currency (Tatum Data API rates). The transaction digest is stored on Walrus as proof.
4. **It lets you put money on your word, without trusting Anchor.** `/stake` locks USDC or USDsui in an immutable Move escrow. The contract can only pay the person back (kept) or the recipient they chose (missed), and if Anchor ever stopped settling, the payer reclaims it a week after the deadline.

Plus: accountability buddies who see what you kept and can cheer or nudge with one tap; signed weekly follow-through reports stored on Walrus; an x402 endpoint where AI agents pay per read for a person's opt-in follow-through record; and an MCP server, so a promise made in Claude Code or Codex is followed up in Telegram.

### Evidence

| What | Proof |
|---|---|
| Escrow published and frozen | [tx 58462JNq…](https://suiscan.xyz/mainnet/tx/58462JNqhhhDP7wzzAbt4YnNPkv5edVGxzMpHo7x4ACb) |
| Stake locked in escrow, then released by Anchor's verdict | [lock](https://suiscan.xyz/mainnet/tx/HnFow8MAZrQ2KbDwY6h7NsfFjjUeDBozuABB8YK1n3Tv) · [settle](https://suiscan.xyz/mainnet/tx/Cy2h7dYErBWnLCC6APkCHVtGfw7nCTh7qd1jTo3rbq7S) |
| AI agent paid 0.01 USDC over x402 for a signed record | [tx 5kE6mngk…](https://suiscan.xyz/mainnet/tx/5kE6mngkpmvSAEo7azBMHBKduGqmNw2scUfY9N8VD5s6) |
| Signed weekly report certified on Walrus via Tatum | [tx 5q3cfsPn…](https://suiscan.xyz/mainnet/tx/5q3cfsPn1mC5JgX8nko3WyunFVvGwDnbMb1JYJNDEb8K) |
| Usage (live counter, 2026-10-28) | 15 people, 176 memories on Walrus, 10 people with 10+ memories |
| Quality | 67 TypeScript unit tests, 9 Move tests, open source, no custodial keys for user funds |

The usage is small and honest: these are real people (revising for exams, job hunting, shipping side projects), found by word of mouth. That is exactly what this grant is for.

## Why Sui, Walrus and Tatum (and why it matters to them)

- **Walrus Memory is the product, not a feature.** Every user is a namespace; every promise, outcome and lesson is a memory. Anchor is a working, consumer-facing proof that long-term agent memory on Walrus changes behaviour, and it already filed two reproducible bugs upstream (MemWal#1131, MemWal#1132).
- **Sui is the referee and the vault.** Money promises are judged from Sui data, stakes live in a Move object, and stablecoins (USDC, USDsui) are the unit. Each active user creates recurring, meaningful mainnet activity: stakes, settlements, transfers they promised to make.
- **Tatum is the infrastructure.** Every chain read and write goes through Tatum's Sui gateway; reports go through Tatum's Storage API; currency values through Tatum's Data API.
- **It onboards people who don't know crypto.** Anchor starts as a chat about goals. The wallet comes later, when the person wants the chain to vouch for them. That is a path into Sui for people no DeFi app reaches.

## The plan: 4 months, 3 milestones

| Milestone | Deliverables | Done when |
|---|---|---|
| **M1 · Reach** (month 1–2) | WhatsApp channel (where most of our users already chat); bring-your-own Walrus Memory account so people own their data outright; a shareable public follow-through page backed by the signed Walrus reports | WhatsApp live; a user can point Anchor at their own MemWal account; 150 monthly active users |
| **M2 · Trust** (month 2–3) | Independent review of the escrow; group commitments (a study group or team stakes on a shared goal, settled per member); escrow for habit streaks ("miss 2 gym days and 2 USDsui goes to my sister") | Review published; group escrow on mainnet; 100 stakes settled through the escrow |
| **M3 · Grow** (month 3–4) | Campus pilots with student communities; a referral loop through buddies; a monthly reflection built from long-term memory; public dashboard of Walrus memories, Sui settlements and follow-through rates | 500 monthly active users, 10,000 memories on Walrus, monthly report of the numbers |

### Budget (proposed, in USD)

| Item | Amount |
|---|---|
| Development, 4 months (solo builder, full time) | 14,000 |
| Escrow security review | 4,000 |
| Infrastructure (hosting, Tatum and Gemini usage, WhatsApp Business API, Walrus storage) | 3,000 |
| Community pilots and user incentives (stake-matching for first-time savers, campus events) | 4,000 |
| **Total** | **25,000** |

Paid per milestone: 30% / 30% / 40%.

## Team

Angel (GitHub [@angelraph](https://github.com/angelraph)): built Anchor end to end (TypeScript bot, Walrus Memory integration, Move escrow, x402 on Sui) and ships in public. *(Add location, background and contact here.)*

## What success looks like

A person who has never owned a wallet tells Anchor "I'll save ₦20,000 this month", stakes a little USDsui on it, and is reminded, encouraged and finally paid back by a contract on Sui, while Anchor remembers what helped them, on Walrus, for the next goal. We want thousands of those stories, each one a real reason for a new person to use Sui.
