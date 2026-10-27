# Demo video: 2 min 45 s

Record a phone screen (Telegram) plus a browser. Use a real wallet with a few USDC and a little SUI. Do one dry run first: Walrus indexing takes about 30 s, and Walrus certifies a report in 1–2 minutes.

**Before recording:** link and verify the wallet, then make one money promise the day before, so a real early verdict ("payment landed") is ready to show.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:12 | Proof page hero → live numbers | "Anchor holds people to their word. It remembers every promise on Walrus Memory, checks in at the deadline and learns what works. It's live, with real users. For Total Recall it stopped taking your word for it." |
| 0:12–0:30 | Telegram: `/wallet you.sui` → link page → wallet signs → "✅ Wallet verified" | "Link a wallet by its SuiNS name. Anchor resolves it on Sui through Tatum. One signed message proves it's mine. Free, no transaction. Anchor can read it, never move it." |
| 0:30–0:55 | Type "I'll pay Tobi back 5 USDC by tonight" → reply + ⛓ confirmation | "I just talk. Gemini spots a money promise and Anchor stores it on Walrus with a chain check: pay, 5 USDC, Tobi, whose address it found in my memory. Nothing to report later: the chain will." |
| 0:55–1:15 | Send 5 USDC from the wallet → `/verify` → "⛓✅ Verified on Sui" → tap the Suiscan link | "I pay Tobi. Anchor reads my transfers through Tatum's Sui gateway, sees it land, and closes the promise. The transaction digest is saved in the outcome memory on Walrus as proof." |
| 1:15–1:45 | `/stake #id 2 friend.sui` → stake page → wallet approves → "🔒 Staked" + tx | "Want more pressure? Stake money on it. This is x402 on Sui: the server answers 402, my wallet signs a USDC transfer, Anchor simulates it through Tatum, settles it, and replies with the digest. Keep the promise and it comes back. Miss it and it goes to my friend. Anchor never keeps it." |
| 1:45–2:05 | `/report` → open the link → "✓ Signature valid", Walrus ids | "Every week becomes a signed report, published to Walrus mainnet through Tatum's Storage API. Anyone can fetch it from Walrus and verify Anchor's signature: portable proof of follow-through." |
| 2:05–2:20 | Terminal: `npx tsx scripts/agent-pay.ts …/x402/record/0x…` output | "And agents can pay for it. With my opt-in, an agent buys my signed record for one cent of USDC, per request, over x402 on Sui." |
| 2:20–2:35 | `/learning` timeline, then the proof page's learning-loop section | "Memory that changes behaviour, visibly: week by week what Anchor learned about me and how my follow-through moved, plus live counts of replies shaped by learned patterns, even money patterns it learned from my chain history." |
| 2:35–2:45 | Claude Code: the `anchor_recall` tool answering, then the Telegram "📌 New promise from Claude Code" | "And it's portable: the same memory in Claude Code over MCP. Promise something there and Anchor follows up here. Anchor: keep your word." |

**On-screen captions:** "Walrus Memory: encrypted, per-person", "Sui RPC: Tatum", "x402 exact · sui:mainnet", "Walrus Storage: Tatum".
