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
| **Tests** | 20 new unit tests (45 total), including x402 verify and settle against real signed Sui transactions, replay protection, forged signatures and underpayment. | `test/chain.test.ts` |
| **Live check script** | `scripts/verify-tatum.ts` runs these checks through Tatum: chain id, USDC/WAL decimals, SuiNS, balances, transfers, Storage API. | `scripts/verify-tatum.ts` |

## Judging criteria → where to look

| Criterion | Weight | Evidence |
|---|---|---|
| Walrus and Tatum integration | 30% | Walrus Memory is the product (per-user namespaces, typed memories, outcomes with Sui proofs, money patterns, report pointers). Tatum carries every chain operation (`src/chain/sui.ts`) and Walrus file storage (`src/chain/report.ts`). |
| Technical quality (incl. "successful Tatum Sui RPC integration") | 30% | Typed TypeScript, pure judge and x402 logic with 45 unit tests, the live verification script, rate-limit and pruned-node handling, outbox and retry paths, no secrets in logs. |
| Creativity | 20% | An accountability agent where the chain is the referee: commitment contracts with x402 stakes that never enrich the app, signed and portable follow-through, and agents paying to read it. |
| Presentation | 20% | Live bot, proof page with live learning-loop numbers, README, this document, the blog post and the demo video. |

## Submission checklist

- [ ] `TATUM_API_KEY` (mainnet) set on Railway; `npx tsx scripts/verify-tatum.ts` all green
- [ ] `ANCHOR_SUI_PRIVATE_KEY` set, the address funded with a little SUI for gas; `PUBLIC_URL` set
- [ ] Deployed, and `/health` shows `memory.ok` and `chain.ok`
- [ ] Walrus Memory writing on mainnet: ✅ already live (107+ memories, 8 people with 10+)
- [ ] A real chain-verified promise, a real `/report` (certified on Walrus) and a real stake, captured for the video
- [ ] Blog post published: [BLOG_TOTAL_RECALL.md](BLOG_TOTAL_RECALL.md)
- [ ] 2–3 minute demo video: [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- [ ] X and LinkedIn posts tagging @Tatum_io and @WalrusFoundation: [LAUNCH_POSTS.md](LAUNCH_POSTS.md)
- [ ] Submission form: email, Discord, LinkedIn, Tatum ID (dashboard account ID), Sui address, Account ID (Sui), `MEMWAL_AGENT_ID` (the public key under Delegate keys on memory.walrus.xyz), description, video, repo, experience answers
- [ ] Submitted before **2026-11-10 17:00 UTC**
