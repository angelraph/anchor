# Launch posts

## X thread (submission post: reply under the Walrus Session 8 announcement)

**1/**
Most chatbots forget you the moment the chat ends.

I built Anchor ⚓, a Telegram bot that holds you to your word.

Tell it what you'll do and by when. It remembers, messages you first when it's due, and learns what actually makes you follow through.

@WalrusProtocol #WalrusMemory

**2/**
How it works:

🎯 "I'll send my CV to 2 companies by 6pm"
🧠 Stored as encrypted memory on Walrus, in your own namespace
⏰ That evening Anchor checks in first: ✅ Did it 🟡 Partly ❌ Didn't 📅 Move it
🔁 It learns your excuses and your wins

**3/**
Memory isn't decoration here. It's the product.

Without memory: "Tell me what exam you're preparing for."

With Walrus Memory: "You focus better at the library, your phone distracts you at home, and you promised 2 chapters by tomorrow evening."

Same model. One remembers.

**4/**
You can inspect it:

/why shows the exact memories behind a reply, with Walrus blob IDs
/compare answers with and without memory, side by side
/forget hides a memory forever

Live, anonymised numbers straight from Walrus: anchor-production-6bb4.up.railway.app

**5/**
Built with Gemini (not Claude or OpenAI) + Walrus Memory + grammY.

What broke and how I fixed it, including a "6am" promise the bot heard as "6 PM", is in the write-up 👇
[ARTICLE LINK]

Open source: github.com/angelraph/anchor

**6/**
Try it. No sign-up, no wallet:
👉 t.me/Anchor_daBot

Tell it one thing you keep putting off. It will remember.

---

## Single post (for sharing with friends and communities)

I built a Telegram bot that remembers your promises and holds you to them ⚓

Tell Anchor what you'll do and by when. It checks in when it's due and learns what actually works for you.

Free, no sign-up: t.me/Anchor_daBot

Built on @WalrusProtocol memory #WalrusMemory

---

## Message to send friends (WhatsApp / Telegram)

Hey! I built a bot for a hackathon and I need a few real people to try it for 3 days 🙏

It's called Anchor. You tell it something you keep putting off ("I'll go to the gym tomorrow at 6am"), and it remembers, checks in with you in the evening, and learns what helps you actually do it.

Just open t.me/Anchor_daBot, press Start, and chat with it normally a few times a day. Tap the buttons when it checks in. That's all. Thank you!

---

## Reddit post (for the Promo Prize: a community outside the Walrus/Sui ecosystem, e.g. r/SideProject)

**Title:** I built a Telegram accountability bot that actually remembers your promises between conversations

Most AI chatbots forget you when the chat ends, which makes them useless for accountability. So I built Anchor: you tell it what you'll do and by when, it stores that as long-term memory, messages you first when it's due, and records whether you kept it. After a few days it starts pointing out patterns ("you skip the gym when you stay up late on your phone") and reminding you what worked before.

Some details for builders:
- Memory: Walrus Memory (encrypted, per-user namespaces), recalled three ways on every message
- LLM: Gemini via the Vercel AI SDK, with model fallback
- /why shows exactly which memories shaped each reply; /compare shows the answer with and without memory

It's free and open source, and I'd love feedback from people who struggle with follow-through:
Bot: t.me/Anchor_daBot
Code: github.com/angelraph/anchor
Write-up: [ARTICLE LINK]


---

# Total Recall (Tatum × Walrus) launch

## X thread

**1/**
My accountability bot used to take your word for it.

Not anymore. ⚓ Anchor now verifies money promises on Sui.

"I'll pay Tobi back 20 USDC by Friday" → the chain reports it, not you.

Built for #TotalRecall with @Tatum_io + @WalrusFoundation 🧵

**2/**
How it works:

🔗 /wallet you.sui → resolved on Sui through Tatum, ownership proven with one signed message
🎯 Promise in plain words: save, keep, pay, or a spending cap in USDC/SUI/WAL
⛓ Anchor reads your wallet through Tatum's Sui RPC and closes the promise itself
🧠 The verdict + tx digest go into your Walrus Memory

**3/**
Want pressure? Stake on it.

/stake #id 5 friend.sui → pay with x402 on Sui.
Keep your word: the USDC comes back.
Miss it: it goes to your friend.

Anchor never keeps a cent. The chain is the referee.

**4/**
Your follow-through becomes portable proof:

🧾 Weekly reports signed by Anchor's Sui key and stored on Walrus via Tatum's Storage API
🤖 Agents can pay (x402, $0.01) to read your signed record, only if you opt in
🔌 Same memory in Claude Code via MCP

**5/**
Memory that visibly changes the product: /learning shows what Anchor learned about you each week and how your follow-through moved. It even learns money patterns from your on-chain history.

Try it: t.me/Anchor_daBot
Code: github.com/angelraph/anchor
Write-up: <blog link>

## LinkedIn

I rebuilt my accountability bot around one idea: for promises that involve money, your word shouldn't be the evidence. Your wallet should.

Anchor is a Telegram bot that holds you to your word. It remembers every promise on Walrus Memory, checks in at the deadline, and learns what derails you and what works. For the Total Recall hackathon by Tatum and Walrus Foundation, I made it verify money promises on the Sui blockchain:

• Link your wallet by name. Anchor can read it, never move it.
• Promise in plain words ("I'll save 50 USDC by Friday"). Anchor reads your wallet through Tatum's Sui RPC and closes the promise from on-chain evidence.
• Optionally stake money on it, paid with x402. Keep your word and it comes back. Miss it and it goes to someone you chose.
• Each week becomes a signed report stored on Walrus, portable proof of follow-through.
• The same memory works in Claude Code and other AI tools through MCP.

It's live, open source (MIT), and built with Walrus Memory, Tatum, Sui, x402 and Gemini.

Try it: t.me/Anchor_daBot · Code: github.com/angelraph/anchor

@Tatum @Walrus Foundation #TotalRecall #Sui #Walrus #AIagents

# Second angle: the life of one promise (post-submission)

Told by the promise itself. Same product, different door in: no feature list, one small life from "I'll save" to a contract paying it back.

## X thread

**1/**
I'm a promise.

"I'll save ₦20,000 by the 30th."

Most of us die the same night we're said. Nobody writes us down, nobody checks.

I got lucky. I was said to ⚓ Anchor. 🧵

**2/**
First, I was remembered.

Anchor wrote me into my person's own Walrus Memory: who, what, by when. Next to me sat the things that had killed my siblings: "phone distracts me at night". And the thing that saved one: "phone in another room".

**3/**
Then I was given a referee.

My person linked their Sui wallet. Now nobody had to take their word for me. Anchor reads the balance through @Tatum_io, priced in naira by Tatum's rates. The chain decides if I'm kept.

**4/**
Then I was given weight.

/stake: 2 USDsui locked in a Move escrow on Sui. Not in Anchor's wallet. In a contract that can only do two things:

kept → back to my person
missed → to their sister

Anchor can't touch it. Nobody can change the rules. It's immutable.

**5/**
On the 30th, the chain looked. The money was there.

Anchor gave its verdict, the contract paid my person back, and the receipt went into their memory on @WalrusFoundation: "kept, proof: <tx>".

Their buddy got a ping: ✅ kept. 🎉

**6/**
I'm finished now. But I'm not gone.

Next time my person promises something, Anchor will remember me, and what helped. That's the point. Every kept promise makes the next one easier.

Make one: t.me/Anchor_daBot
Code: github.com/angelraph/anchor
#TotalRecall #Sui #Walrus

## LinkedIn

**This is the life of one promise.**

"I'll save ₦20,000 by the 30th."

Most promises die the night they're made. Nobody writes them down and nobody checks. This one was made to Anchor, a Telegram accountability partner I've been building, and here's what happened to it:

1. **It was remembered.** Anchor stored it in the person's own Walrus Memory, next to what had derailed them before ("phone at night") and what had worked ("phone in another room"). When they planned, Anchor brought both up.
2. **It got a referee.** The person linked their Sui wallet. Anchor read the balance through Tatum, valued in naira with Tatum's exchange rates. Their word stopped being the only evidence.
3. **It got weight.** They staked 2 USDsui in a Move escrow on Sui. Not Anchor's wallet: an immutable contract that can only pay them back if they keep it, or pay their sister if they don't. Anchor can't keep the money, and if Anchor went silent, they'd take it back themselves.
4. **It was kept.** On the 30th the chain showed the savings. The contract paid the stake back, their accountability buddy got a "kept" notification, and the proof went into their memory.

That's what I mean by an AI that holds you to your word: memory that lasts (Walrus), evidence that can't be argued with (Sui), and stakes nobody, including me, can run off with (Move).

It's live and open source, with habits and streaks, buddies, your own timezone and currency, and signed reports on Walrus.

Make a promise: t.me/Anchor_daBot · Code: github.com/angelraph/anchor

Built for Total Recall with @Tatum and @Walrus Foundation. #TotalRecall #Sui #Walrus #AIagents