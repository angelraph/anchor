# My accountability bot stopped taking my word for it

*How Anchor uses Walrus Memory to remember your promises and Tatum's Sui RPC to check the ones that involve money. Built for Total Recall (Tatum × Walrus).*

> ✍️ Before publishing: replace each `[SCREENSHOT: …]` with a real capture from the live bot, and update the numbers in "How it learned" from the proof page on the day you publish.

Three weeks ago I shipped **Anchor**, a Telegram bot that holds you to your word. You tell it what you'll do and by when. It remembers on Walrus Memory, messages you first at the deadline, and learns what derails you and what works. Real people started using it, it placed 3rd in Walrus Session 8, and one gap kept bothering me.

Anchor had to take your word for it. "Did you save the money?" "Yes." Fine. For most promises, like going to the gym or sending the CV, that's the best anyone can do. But a whole class of promises leaves evidence: money promises. For those, the evidence is on-chain.

So for Total Recall I made Anchor check.

Try it: [t.me/Anchor_daBot](https://t.me/Anchor_daBot) · Proof page: [anchor-production-6bb4.up.railway.app](https://anchor-production-6bb4.up.railway.app) · Code: [github.com/angelraph/anchor](https://github.com/angelraph/anchor)

## What it does now

You link a wallet by name: `/wallet raph.sui`. Anchor resolves the SuiNS name on-chain and offers a one-time page where you sign a message (free, no transaction) to prove the wallet is yours. From then on Anchor can read it, never move it.

Then you just talk:

> **You:** I'll save 50 USDC by Friday
> **Anchor:** Friday it is. Last time saving stuck because you moved money right after payday, so do it Thursday.
> ⛓ #k3f9 will be verified on Sui (read through Tatum): I'll check that your USDC balance grows by 50 USDC (from 12.5 now).

[SCREENSHOT: a money promise and the ⛓ confirmation]

No button to tap and nothing to report. A payment that lands closes the promise early ("⛓✅ Verified on Sui: Sent 20 USDC to Tobi"). At the deadline Anchor reads your balance or transfers and records the verdict on Walrus with the transaction digest as proof.

If you want more than a nudge, put money on it: `/stake #k3f9 5 tobi.sui`. You pay 5 USDC with x402. Keep the promise and the money comes back to you. Miss it and it goes to Tobi. Anchor never keeps it. That's a commitment contract, and the chain is the referee.

## How it uses Walrus

Walrus Memory is still the product. Every person has their own encrypted namespace, and every memory is one typed line that embeds well and parses back into structure:

```
[commitment] 2026-10-27 id:p2x1 due:2026-10-29 chk:pay~USDC~20~n=Tobi~to=0x7a… | Promised to pay Tobi back 20 USDC
[outcome] 2026-10-28 ref:p2x1 status:kept proof:9xQe… | Kept the promise, verified on Sui: Sent 20 USDC to Tobi
[pattern] 2026-11-02 | Sends out most USDC on Saturdays: 62% of 140 USDC over the last 4 weeks (verified on Sui)
```

The chain check lives inside the memory, so the promise and how to verify it travel together. The proof lives inside the outcome, so a memory can be checked rather than just trusted.

Walrus also holds the **signed weekly report**. `/report` builds your week (kept, partial, missed, follow-through %, the Sui proofs), signs it with Anchor's Sui key and publishes it to Walrus mainnet. Anyone can fetch it from a Walrus aggregator and verify the signature. Promise texts are hashed unless you ask for a public report, because Walrus blobs are public.

## How it uses Tatum

Every chain operation goes through Tatum's Sui gateway: balances, transfer history, SuiNS, transaction simulation and execution. Walrus file uploads go through Tatum's Storage API.

Two things I learned the hard way:

1. **Sui's public JSON-RPC is deprecated**, and Tatum's Sui gateway now speaks **GraphQL** (`/graphql`; its `/_methods` endpoint lists the interfaces). The Sui TypeScript SDK's GraphQL client works with it directly.
2. **Tatum's nodes are pruned.** The SDK's `getChainIdentifier()` reads the genesis checkpoint, which comes back empty, so a small fetch adapter asks Tatum for `chainIdentifier` directly. Without a key the gateway allows 5 requests a minute, so get the free key before you start.

x402 runs on Tatum too. When you pay a stake, your wallet signs a USDC transfer and sends it in the `PAYMENT-SIGNATURE` header. Anchor checks the signature, **simulates the transaction through Tatum** to confirm Anchor's address receives exactly the stake, then **executes it through Tatum** and answers with `PAYMENT-RESPONSE` and the digest. Payouts are transactions Anchor signs and executes the same way.

[SCREENSHOT: the stake page and the settled transaction on Suiscan]

## Agents can pay for your track record

Opt in with `/record on` and AI agents can buy your signed follow-through record over x402, 0.01 USDC per read, settled on Sui. Think of a lender's agent, a coach, or a hiring tool you point at it. It gets counts and on-chain proofs, never your messages. The repo includes an agent client (`scripts/agent-pay.ts`) that does the whole 402 → sign → retry dance.

## Your memory in your other tools

The Smart Agents track talks about memory that picks up "across tools and sessions," so I took that literally. `/connect` gives you a token. `scripts/anchor-mcp.ts` is a small MCP server: add it to Claude Code and the assistant can recall your patterns before planning, record a promise ("ship the refactor by Friday 5pm"), and report outcomes. Anchor then follows up in Telegram at 17:00 on Friday. One memory, every tool.

## How it learned over time

The point of memory is that it changes what the bot does. Anchor now makes that visible:

- **`/learning`** shows each person, week by week, what Anchor learned (patterns, wins) and how their follow-through moved.
- **The proof page** counts, on the live bot, how many replies were shaped by a learned pattern or win, how many patterns and wins were learned, and how many promises the chain closed.
- **The chain teaches it too.** Four weeks of your outflows become a pattern like "sends out most USDC on Saturdays", stored on Walrus and used the next time you promise to save.

[NUMBERS: from the proof page on publish day: people, memories, % of replies shaped by learning, promises verified on Sui]

One early user's chat produced the memory "putting the phone in another room helps finish tasks." Anchor recalls wins like that every time that person plans something new, so the advice they get is theirs, not generic. Now that loop has a second source of truth: the chain.

## What's next

WhatsApp, accountability buddies, and bring-your-own Walrus Memory account so your history is fully yours.

*Built with Walrus Memory, Tatum's Sui RPC and Storage API, Sui, x402 and Gemini. Code is MIT on [GitHub](https://github.com/angelraph/anchor).* @Tatum_io @WalrusFoundation
