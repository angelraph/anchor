# Anchor × Total Recall (Tatum × Walrus)

**Track:** Smart Agents for Real Life: "agents that monitor … habits … Portable memory means they pick up where they left off across tools and sessions."
**Also eligible for:** Best Walrus Memory, Best Use of Agent Payments (x402 on Sui).

Anchor existed before the hackathon: it was built for Walrus Session 8 and placed 3rd. The rules allow existing projects "if the submitted work is new progress during the build window." The last commit before the window is `1af7fbc` (2026-10-09). **Everything below was built from 2026-10-26, inside the build window (Oct 20 – Nov 10).** `git log 1af7fbc..HEAD` shows exactly what's new.

## The idea: promises the chain can verify

Anchor already held people to their word: it remembered every promise on Walrus Memory, checked in at the deadline and learned what derails each person and what works. But it had to take their word for the outcome.

For money promises it doesn't anymore. "Save 50 USDC by Friday", "pay Tobi back 20 USDC", "spend no more than 30 USDC this week": Anchor reads the person's Sui wallet through Tatum's RPC gateway and closes the promise from the evidence, with the transaction digest stored on Walrus as proof. People can put money on their word (x402 on Sui). Each week's follow-through can be signed and published to Walrus, and AI agents can pay to read it. The memory goes with the person into their other tools too: Claude Code, Codex, any MCP client.

## What was built

| Feature | What it does | Where |
|---|---|---|
| **Tatum Sui RPC client** | Every on-chain read and write goes through `sui-mainnet.gateway.tatum.io`: balances, transfer history, SuiNS, coin metadata, transaction simulation, execution. Sui's public JSON-RPC is deprecated, so this uses Tatum's GraphQL interface with the Sui SDK. Adapters cover Tatum's pruned genesis checkpoint and 429s. | `src/chain/sui.ts` |
| **Wallet linking** | `/wallet name.sui` resolves SuiNS on-chain. A one-time page proves ownership with a signed personal message (zkLogin wallets supported). Wallets are found through the Wallet Standard. | `src/bot/chain-commands.ts`, `src/web/chain-routes.ts`, `src/web/client/wallet.ts` |
| **Chain-verified promises** | Gemini spots money promises (`save` / `hold` / `pay` / `cap`) in SUI, USDC or WAL. Anchor records the baseline balance, finds the recipient in memory or SuiNS, and judges from chain data: early when conclusive (a payment landed, a cap blown), final at the deadline. The verdict goes to Walrus with `proof:<digest>`. | `src/chain/checks.ts`, `src/chain/promises.ts` |
| **Stakes (x402 on Sui)** | `/stake #id 5 friend.sui`. Pay on a web page: 402 → your wallet signs a USDC transfer → PAYMENT-SIGNATURE → Anchor verifies (signature, Tatum simulation, balance change) and settles (Tatum execute). Kept: the money comes back. Missed: it goes to the person you named. | `src/chain/x402.ts`, `src/chain/stakes.ts` |
| **Agent payments** | `GET /x402/record/{address}`: an agent pays 0.01 USDC per read for a signed follow-through record (opt-in with `/record on`). Discovery at `/.well-known/x402`, reference client in `scripts/agent-pay.ts`. | `src/web/chain-routes.ts`, `scripts/agent-pay.ts` |
| **Signed reports on Walrus** | `/report` builds the week (kept / partial / missed, follow-through %, Sui proofs, what was learned), signs it with Anchor's Sui key and uploads it to Walrus through Tatum's Storage API. `/report/<jobId>` fetches it back from a Walrus aggregator and checks the signature. `/report auto` publishes one every Sunday. | `src/chain/report.ts` |
| **Learning from the chain** | Four weeks of outflows read through Tatum become a money pattern ("sends out most USDC on Saturdays: 62%…"), stored on Walrus as a `pattern` and used in advice like any other memory. | `src/learning.ts` |
| **Visible learning loop** | `/learning` shows, week by week, what Anchor learned about you and how your follow-through moved. The proof page shows live counters: % of replies shaped by a learned pattern or win, patterns and wins learned, outcomes, chain verdicts, reports, stakes. | `src/learning.ts`, `src/web/page.ts` |
| **Portable memory (MCP)** | `/connect` issues a personal token. `scripts/anchor-mcp.ts` is a dependency-free MCP server with four tools: recall, list promises, make a promise, report an outcome. A promise made in Claude Code gets followed up in Telegram. | `src/web/me-routes.ts`, `scripts/anchor-mcp.ts` |
| **Tests** | 42 new unit tests (67 total) plus 9 Move tests, including x402 verify and settle against real signed Sui transactions, replay protection, forged signatures and underpayment. | `test/chain.test.ts` |
| **Live check script** | `scripts/verify-tatum.ts` runs these checks through Tatum: chain id, USDC/WAL decimals, SuiNS, balances, transfers, Storage API. | `scripts/verify-tatum.ts` |

| **Proof by exact transfer** | Wallet scanners block brand-new "connect your wallet" pages on shared hosting domains, so `/wallet verify` and `/stake` also work with no website: send an exact odd amount from the wallet app, and Anchor matches it on Sui through Tatum. | `src/chain/transfers.ts` |
| **USDsui** | Sui's native dollar stablecoin (issued by Bridge, a Stripe company) works for money promises and stakes alongside USDC. | `src/chain/sui.ts` |
| **Trustless escrow (Move)** | Stakes no longer have to trust Anchor. `anchor_escrow::stake` locks the coins in a shared object with the payer, the beneficiary and Anchor as arbiter fixed at creation. `settle` (arbiter only) can pay only the payer (kept) or the beneficiary (missed); `reclaim` returns it to the payer a week after the deadline if Anchor never acts. Before executing the payer's signed transaction, Anchor simulates it through Tatum and checks the `Staked` event (amount, coin, beneficiary, arbiter, deadline, promise fingerprint). Published immutable: [`0x119c…8e2d`](https://suiscan.xyz/mainnet/object/0x119c87d56bd17fc3c5713717c8cd50312b0ef181f555723ab3bc1facf9f48e2d). | `move/anchor_escrow`, `src/chain/escrow.ts` |
| **Tatum Data API** | Exchange rates for SUI, USDC and USDsui in any fiat currency: `/money NGN` values the wallet, and promises can be in a currency ("save ₦50,000", "spend under $30"), judged from chain balances and outflows priced through Tatum. | `src/chain/prices.ts` |
| **Per-user timezones** | Each person's own clock for check-ins, deadlines, weekly summaries and habit settlement; set by city in plain words, resolved and validated as an IANA zone. | `src/timezone.ts`, `src/bot/onboarding.ts` |
| **Habits and streaks** | Recurring promises (daily or N times a week), asked about at check-in, settled per period, with `[habit]` and `[streak]` memories on Walrus. | `src/habits.ts`, `src/bot/habit-commands.ts` |
| **Accountability buddies** | Invite links, kept/missed notifications to a buddy (with the owner's permission), one-tap cheer and nudge back. | `src/buddies.ts`, `src/bot/buddy-commands.ts` |
| **Guided tour** | `/tour`: seven steps, with a live demo of a promise and its check. | `src/bot/onboarding.ts` |
| **Anchor mini app** | Inside Telegram: follow-through ring, kept/missed calendar, habit streaks, what Anchor learned, weekly bars, photo proofs, and the memory switch (one question, answered without and with Walrus Memory). Public share card with first name and numbers only. | `src/web/app-routes.ts`, `src/web/app-page.ts` |
| **Photo proof on Walrus** | Any promise can be proved with a photo. Gemini matches it to the open promise; the photo is encrypted per person (AES-256-GCM) and stored on Walrus through Tatum's Storage API; the outcome memory carries `pic:<id>`. | `src/proof.ts`, `src/media.ts` |
| **Voice promises** | Voice notes are transcribed by Gemini and handled like typed messages. | `src/media.ts` |
| **Group mode** | `/promise` in a group, deadline checks only the promiser can answer, outcomes announced from any door, a weekly `/board`. | `src/groups.ts`, `src/bot/group-commands.ts` |
| **Bring your own Walrus Memory** | `/mymemory` or the app: the delegate key is verified against the account, memories are copied over, and every recall and save goes to the person's own account. | `src/memory/own.ts` |
| **Morning brief** | 08:00 local: due today, habits, the week so far, one lesson from memory. | `src/morning.ts` |
| **Security** | Telegram initData verification, rate and size limits, strict CSP, encryption at rest, owner-only proofs and group checks. | `src/web/guard.ts`, `src/secrets.ts` |

## Live evidence on Sui mainnet (2026-10-27)

Every link below is a real transaction from the live bot ([t.me/Anchor_daBot](https://t.me/Anchor_daBot)), read and settled through Tatum:

| What happened | Transaction |
|---|---|
| A signed weekly report uploaded through Tatum's Storage API and **registered on Walrus** | [2FYRCTCB…](https://suiscan.xyz/mainnet/tx/2FYRCTCBkFF7SxWJwiZQPqaq5SsSLv8ESxkkAxau2frJ) |
| …and **certified on Walrus**, then downloaded back and its signature verified | [5q3cfsPn…](https://suiscan.xyz/mainnet/tx/5q3cfsPn1mC5JgX8nko3WyunFVvGwDnbMb1JYJNDEb8K) |
| A user **proved wallet ownership** by exact transfer (0.001639 SUI), detected through Tatum | [9z5jWhjc…](https://suiscan.xyz/mainnet/tx/9z5jWhjcwdME7w11u1WPcLz8DurANNncvQF4qrCZPbrn) |
| The **escrow package published and made immutable** in one transaction | [58462JNq…](https://suiscan.xyz/mainnet/tx/58462JNqhhhDP7wzzAbt4YnNPkv5edVGxzMpHo7x4ACb) |
| A stake **locked in the escrow** (a shared `Stake<USDC>` object, not Anchor's wallet)… | [HnFow8MA…](https://suiscan.xyz/mainnet/tx/HnFow8MAZrQ2KbDwY6h7NsfFjjUeDBozuABB8YK1n3Tv) |
| …and **released by Anchor's verdict**: the contract paid it back to the payer | [Cy2h7dYE…](https://suiscan.xyz/mainnet/tx/Cy2h7dYErBWnLCC6APkCHVtGfw7nCTh7qd1jTo3rbq7S) |
| A user **staked 1 USDC** on "save 1 USDsui by Friday" (#prc2); Anchor holds it until the chain decides | [MusNBtgH…](https://suiscan.xyz/mainnet/tx/MusNBtgHF3KDMoNXMatgm1Lf2bQXJX9UnnRwV4AiAUM) |
| An **AI agent paid 0.01 USDC over x402** for that user's signed follow-through record: 402 → PAYMENT-SIGNATURE → verified (simulated via Tatum) → settled (executed via Tatum) → 200 + PAYMENT-RESPONSE | [5kE6mngk…](https://suiscan.xyz/mainnet/tx/5kE6mngkpmvSAEo7azBMHBKduGqmNw2scUfY9N8VD5s6) |

Live endpoints: [/health](https://anchor-production-6bb4.up.railway.app/health) (Walrus Memory + Sui via Tatum), [/.well-known/x402](https://anchor-production-6bb4.up.railway.app/.well-known/x402), [proof page](https://anchor-production-6bb4.up.railway.app).

## Judging criteria → where to look

| Criterion | Weight | Evidence |
|---|---|---|
| Walrus and Tatum integration | 30% | Walrus Memory is the product (per-user namespaces, typed memories, outcomes with Sui proofs, money patterns, report pointers). Tatum carries every chain operation (`src/chain/sui.ts`) and Walrus file storage (`src/chain/report.ts`). |
| Technical quality (incl. "successful Tatum Sui RPC integration") | 30% | Typed TypeScript, pure judge, x402 and escrow-check logic with 67 unit tests and 9 Move tests, the live verification script, rate-limit and pruned-node handling, outbox and retry paths, no secrets in logs. |
| Creativity | 20% | An accountability agent where the chain is the referee: commitment contracts whose stakes sit in an immutable Move escrow the app can't touch, signed and portable follow-through, and agents paying to read it. |
| Presentation | 20% | Live bot, proof page with live learning-loop numbers, README, this document, the blog post and the demo video. |

## Submission checklist

- [x] `TATUM_API_KEY` (mainnet) set on Railway; `npx tsx scripts/verify-tatum.ts` all green
- [x] `ANCHOR_SUI_PRIVATE_KEY` set, the address funded with a little SUI for gas; `PUBLIC_URL` set
- [x] Deployed, and `/health` shows `memory.ok` and `chain.ok`
- [x] Walrus Memory writing on mainnet (169+ memories, 15 people)
- [x] Live on mainnet: wallet proof, a real stake, an x402 agent payment and a certified Walrus report (see Live evidence)
- [ ] Screen-record those flows for the video
- [ ] Blog post published: [BLOG_TOTAL_RECALL.md](BLOG_TOTAL_RECALL.md)
- [ ] 2–3 minute demo video: [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- [ ] X and LinkedIn posts tagging @Tatum_io and @WalrusFoundation: [LAUNCH_POSTS.md](LAUNCH_POSTS.md)
- [ ] Submission form: email, Discord, LinkedIn, Tatum ID (dashboard account ID), Sui address, Account ID (Sui), `MEMWAL_AGENT_ID` (the public key under Delegate keys on memory.walrus.xyz), description, video, repo, experience answers
- [ ] Submitted before **2026-11-10 17:00 UTC**
