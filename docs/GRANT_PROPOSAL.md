# Anchor: Grant Proposal

October 29, 2026 · Shareable version (with the roadmap drawing): <https://claude.ai/artifact/FVHk6TRLL2Xm4bb1ApYEjP>

Anchor asks for USD 25,000 over four months to take a live, open-source accountability agent from 15 real users to 500, on Walrus memory, Sui verification and Tatum infrastructure.

## A promise, kept

Ada tells Anchor in Telegram: "I'll save 20,000 naira this month." Anchor stores the promise in her own encrypted Walrus Memory space, next to what derailed her last time and what helped. She links her Sui wallet and stakes 2 USDsui in an immutable Move escrow: kept, it comes back to her; missed, it goes to her sister.

Every morning at 08:00 Anchor sends her a brief. At the deadline it reads her wallet through Tatum, sees the savings, and the contract pays the stake back. The proof goes into her memory, her accountability buddy gets a ping, and next month Anchor plans with what it learned.

Nobody had to take her word for it. That is Anchor, and every step above runs on mainnet today.

- Bot: <https://t.me/Anchor_daBot>
- Website: <https://anchor-production-6bb4.up.railway.app>
- Code (MIT, open source): <https://github.com/angelraph/anchor>

## The problem

People don't fail for lack of goals. They fail because nothing remembers their promises with them.

- **Coaches work, but cost money.** Human accountability partners are effective and out of reach for most students and young workers.
- **Habit apps get abandoned.** They live in another app that nobody opens after week two, and they forget everything you told them.
- **Chatbots forget you.** A general AI assistant starts from zero every conversation, so it can't follow up, notice patterns, or remember what worked.
- **Money promises rest on someone's word.** "I'll pay you back Friday" or "I'll save this month" has no evidence behind it.

Anchor fixes all four in the app people already use every day, for free.

## What Anchor does today

Anchor is a Telegram accountability partner that remembers every promise, messages you first, and lets Sui judge the ones about money. All of it is live now.

| What it does | How a person uses it | Built on |
|-|-|-|
| Remembers you for months | Chat normally; promises, patterns and wins are stored as typed memories | Walrus Memory, one encrypted namespace per person |
| Comes to you | A morning brief at 08:00, a reminder at the time you asked, a check at the deadline, an evening check-in, a Sunday summary | Local clock per person, any country |
| Voice and photo proof | Send a voice note to make a promise; send a photo to prove one | Gemini; photos encrypted per person on Walrus via Tatum |
| Habits and streaks | "Gym 3x a week" becomes a streak it counts and settles | Walrus Memory records |
| Buddies and groups | Invite a buddy with /buddy; in a group, /promise and a weekly /board | Telegram, owner-only deadline checks |
| Money the chain can check | "I'll save 20,000 naira"; link a wallet and Anchor reads it | Sui via Tatum RPC, Tatum exchange rates |
| Stakes nobody can take | /stake locks USDC or USDsui until the verdict | Move escrow, published immutable |
| Proof you can carry | /report signs your week and publishes it | Walrus via Tatum Storage API |
| Agents can pay to read it | With consent, an AI agent pays 0.01 USDC for your signed record | x402 on Sui |
| Your memory, your account | /mymemory moves everything into your own Walrus Memory account; MCP brings it into Claude Code | Walrus Memory, MCP |
| The Anchor app | A dashboard inside Telegram with a memory on/off switch | Telegram mini app, signed sign-in |

It replies in the language people write in, from Nigerian Pidgin, Yoruba, Igbo and Hausa to French, Swahili and Arabic.

## Live proof on Sui mainnet

Every claim in this proposal is a transaction anyone can open. Links are written out in full so they stay clickable when this document is forwarded or pasted.

| Date | What happened | Proof |
|-|-|-|
| 2026-10-29 | An AI agent paid the live server 0.01 USDC over x402 and received a signed follow-through record | <https://suiscan.xyz/mainnet/tx/5C4q7TPojDmPzN6B7cgGj9ocDioG3kgtLytV737pMrHP> |
| 2026-10-29 | A signed report certified on Walrus through Tatum, downloaded and its signature verified | <https://suiscan.xyz/mainnet/tx/FfADmmZEnzXVfhZdriWo1Cqxa9kgn1iYBwyL7RHy2WfS> |
| 2026-10-28 | A stake locked in the escrow through the real stake page | <https://suiscan.xyz/mainnet/tx/CdYJhncUGuX2AyV2RbgDSBGQYK3QnhmMGDrsNuKse7Rw> |
| 2026-10-28 | That stake released by Anchor's verdict: the contract paid the payer back | <https://suiscan.xyz/mainnet/tx/4CCHxDkgnptSuHQnaTYLHAjon2WtDKfmEisEYhq9VBuA> |
| 2026-10-28 | The escrow package published and made immutable in one transaction | <https://suiscan.xyz/mainnet/tx/58462JNqhhhDP7wzzAbt4YnNPkv5edVGxzMpHo7x4ACb> |
| 2026-10-28 | The escrow package itself | <https://suiscan.xyz/mainnet/object/0x119c87d56bd17fc3c5713717c8cd50312b0ef181f555723ab3bc1facf9f48e2d> |
| 2026-10-27 | A person staked 1 USDC on a promise to save 1 USDsui | <https://suiscan.xyz/mainnet/tx/MusNBtgHF3KDMoNXMatgm1Lf2bQXJX9UnnRwV4AiAUM> |
| 2026-10-27 | A person proved wallet ownership with an exact transfer, detected through Tatum | <https://suiscan.xyz/mainnet/tx/9z5jWhjcwdME7w11u1WPcLz8DurANNncvQF4qrCZPbrn> |
| 2026-10-27 | The first signed weekly report certified on Walrus | <https://suiscan.xyz/mainnet/tx/5q3cfsPn1mC5JgX8nko3WyunFVvGwDnbMb1JYJNDEb8K> |

Always-on checks anyone can open:

- Health of Walrus Memory and Sui through Tatum: <https://anchor-production-6bb4.up.railway.app/health>
- Live user and memory counts: <https://anchor-production-6bb4.up.railway.app/proof.json>
- What agents can buy over x402: <https://anchor-production-6bb4.up.railway.app/.well-known/x402>
- The escrow's Move source and its 9 tests: <https://github.com/angelraph/anchor/tree/main/move/anchor_escrow>

## Why Sui, Walrus and Tatum win when Anchor grows

Anchor turns everyday intentions into recurring, meaningful activity on your stack, from people who would never open a DeFi app.

- **Walrus: memory is the product, not a feature.** Every person is a Walrus Memory namespace, recalled before every reply; photo proofs and signed reports are Walrus blobs. Anchor is a consumer proof that long-term agent memory changes behaviour. While building it we filed two reproducible bugs upstream: <https://github.com/MystenLabs/MemWal/issues/1131> and <https://github.com/MystenLabs/MemWal/issues/1132>.
- **Sui: the referee and the vault.** Money promises are judged from Sui data; stakes live in a Move object; USDC and USDsui are the unit. Each active saver creates repeat mainnet activity: stakes, settlements and the transfers they promised to make.
- **Tatum: the rails.** Every chain read and write goes through Tatum's Sui gateway, reports and proofs through Tatum's Storage API, and currency values through Tatum's exchange rates.
- **A front door to Sui.** People start by chatting about their goals in their own language. The wallet comes later, when they want the chain to vouch for them.

## Traction, honestly

Anchor has 15 real people and 184 memories on Walrus as of 2026-10-29, with 10 people past 10 memories each; small, organic, and exactly what this grant is for.

- **Recognition:** 3rd place in Walrus Session 8, "Chatbots That Remember". Entered in the Tatum and Walrus "Total Recall" hackathon.
- **Real use:** people use it for exam revision, job applications, the gym and side projects, found by word of mouth.
- **Quality:** 93 TypeScript unit tests, 9 Move tests, and a live end-to-end test that runs real Telegram updates through Gemini, Walrus Memory and Sui.
- **Security:** signed mini-app sign-in, rate and size limits, AES-256-GCM encryption at rest with per-person keys, and an escrow Anchor itself cannot drain.
- **Write-up:** <https://medium.com/@uzoechiraphael1/how-i-added-long-term-memory-to-a-telegram-chatbot-so-it-remembers-users-between-sessions-76a7579b20af>

The counts update live at <https://anchor-production-6bb4.up.railway.app/proof.json>.

## The plan

Four months, three milestones, and money released only when each gate is met.

| Milestone | Months | Deliverables | Gate (releases the next payment) |
|-|-|-|-|
| M1 · Reach | 1 to 2 | WhatsApp channel, public profile pages, campus pilots at 2 schools | 150 monthly users |
| M2 · Trust | 2 to 3 | Escrow review published, group stakes in one pot, habit streak stakes | 100 stakes settled |
| M3 · Grow | 3 to 4 | Monthly reflections, referrals through buddies, public impact dashboard | 500 monthly users and 10,000 memories |

Already shipped before this grant, so not in the budget: voice notes, photo proof, groups, own Walrus Memory, the mini app and the escrow. The grant funds reach, trust and growth, not features that exist.

## Budget

USD 25,000 in total, paid per milestone: 30% at the start, 30% when Trust is met, 40% when Grow is met.

| Item | Amount (USD) | What it pays for |
|-|-|-|
| Development, 4 months, full time | 14,000 | WhatsApp, group stakes, reflections, dashboard |
| Community pilots and incentives | 4,000 | Campus events, stake-matching for first-time savers |
| Independent escrow review | 4,000 | A published review of the Move contract |
| Infrastructure | 3,000 | Hosting, Tatum, Gemini, WhatsApp Business, Walrus storage |
| **Total** | **25,000** | |

## Team

Angel built Anchor end to end and ships in public: the TypeScript bot, the Walrus Memory integration, the Move escrow, x402 on Sui and the Telegram mini app.

- GitHub: <https://github.com/angelraph>
- Location, background and email: (to add before sending)

## Risks and how they're handled

| Risk | What Anchor does about it |
|-|-|
| People stop using it after a week | It messages first every day (morning brief, reminders, check-ins), and buddies and groups add social pressure |
| Stake funds at risk | The escrow is immutable, pays only the payer or the chosen recipient, and lets the payer reclaim a week after the deadline; a paid independent review is in the plan |
| Private data exposed | Per-person encrypted memory on Walrus, photos encrypted per person, users can move their memory to their own account or delete any of it |
| AI provider outages | Automatic fallback across Gemini models, and Walrus Memory's own extractor as a backup so nothing said is lost |

## What success looks like

A person who has never owned a wallet promises "I'll save 20,000 naira this month", stakes a little USDsui, and is reminded, encouraged and finally paid back by a contract on Sui, while Anchor remembers what helped them, on Walrus, for the next goal.

This grant turns that one story into thousands, each one a real reason for a new person to use Sui.
