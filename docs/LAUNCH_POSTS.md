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
## Single post (for sharing with friends and communities)

I built a Telegram bot that remembers your promises and holds you to them ⚓

Tell Anchor what you'll do and by when. It checks in when it's due and learns what actually works for you.

Free, no sign-up: t.me/Anchor_daBot

Built on @WalrusProtocol memory #WalrusMemory
## Message to send friends (WhatsApp / Telegram)

Hey! I built a bot for a hackathon and I need a few real people to try it for 3 days 🙏

It's called Anchor. You tell it something you keep putting off ("I'll go to the gym tomorrow at 6am"), and it remembers, checks in with you in the evening, and learns what helps you actually do it.

Just open t.me/Anchor_daBot, press Start, and chat with it normally a few times a day. Tap the buttons when it checks in. That's all. Thank you!
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
\#TotalRecall #Sui #Walrus

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

# A day with Anchor: everything it does today (post-submission, Oct 29)

The whole product told as one ordinary day, so a stranger understands it in a minute and a judge sees every Walrus, Sui and Tatum piece in use. Copy each block as it is.

## X post (X Premium, one long post)

```text
Most apps wait for you to open them.

Anchor ⚓ comes to you.

It's a free Telegram bot that remembers what you said you'd do, and holds you to it. Here's what one ordinary day with it looks like 👇

☀️ 08:00 · The morning brief
"Good morning, Angel. Today you promised: send 2 job applications, gym at 6pm. Habit: reading, 3/5 this week. 💡 Remember: you focus best with your phone in another room."
Every day, on your own clock, wherever you live.

🎙 09:12 · You're on a bus, hands full
You send a voice note: "I'll finish the pitch deck by 3pm, remind me at 2."
Anchor hears it, saves it, and at 2pm it really does remind you. At 3pm it asks: did you do it?

📸 15:04 · Done
You don't type "yes". You send a screenshot of the sent email.
Anchor looks at it, matches it to the promise, marks it kept ✅ and stores the photo encrypted on Walrus. Only you can ever open it again.

🤝 15:05 · Your buddy gets a ping
"🟢 Angel kept a promise (with photo proof)." One tap and they cheer you on.

👥 18:30 · Your study group
Someone types /promise finish chapter 3 by Friday. At the deadline the group sees a check only they can answer. Sunday, /board crowns the week. 🥇

💰 20:00 · Money, without the guilt trip
"I'll save ₦20,000 this month." Link your Sui wallet and Anchor reads the balance itself through Tatum, priced in naira. You never report it. The chain does.

Want real pressure? /stake puts money on it, locked in a Move contract on Sui that even I can't touch. Keep the promise, it comes back. Miss it, it goes to someone you chose.

🌙 21:00 · The check-in
Anything still open gets one honest question. Missed it? Anchor asks what got in the way, and remembers. Next time you plan, it brings that up before you fall into the same trap.

📱 Anytime · Open the app
Tap the Anchor button in the chat: your follow-through ring, a calendar of kept days, streaks, what Anchor has learned about you, and the memory switch. Ask one question and watch the answer change when memory turns on.

That memory is the whole point. It lives on Walrus, in a space only you have, and you can move it into your own Walrus Memory account any time with /mymemory. Your memory, not mine.

It speaks your language too: Pidgin, Yoruba, Igbo, Hausa, Swahili, French, Arabic, whatever you write in.

For the builders:
🧠 Walrus Memory: per-person encrypted memory, recalled before every reply
🗄 Walrus storage via Tatum: photo proofs and signed weekly reports
⛓ Sui via Tatum: money promises judged from on-chain evidence
🔒 Move escrow, published immutable: trustless stakes
🤖 x402 on Sui: AI agents pay $0.01 to read a signed follow-through record
🔌 MCP: the same memory inside Claude Code and other AI tools

Try it in 10 seconds: t.me/Anchor_daBot
Press Start and tell it one thing you keep putting off.

It will remember. Even if you don't. ⚓

Built for #TotalRecall with @Tatum_io and @WalrusFoundation on @SuiNetwork
Open source: github.com/angelraph/anchor
```

## LinkedIn

```text
Most apps wait for you to open them. I wanted to build one that comes to you.

Anchor is a free Telegram bot that remembers what you said you'd do, and holds you to it. The easiest way to explain it is one ordinary day:

08:00. A morning brief arrives: what you promised for today, how your habits are going, and one thing Anchor has learned that helps you. "You focus best with your phone in another room."

09:12. You're on a bus, so you send a voice note instead of typing: "I'll finish the pitch deck by 3pm, remind me at 2." At 2pm you get the reminder. At 3pm it asks how it went.

15:04. You don't type "done". You send a screenshot of the sent email. Anchor checks it, marks the promise kept, and stores the photo encrypted on Walrus, where only you can open it again. Your accountability buddy gets a ping and cheers you on.

18:30. In your study group, a friend types /promise finish chapter 3 by Friday. At the deadline the whole group sees the check, and only they can answer it. On Sunday, /board shows who kept their word.

20:00. Money goals work too. "I'll save ₦20,000 this month." With a linked Sui wallet, Anchor reads the balance itself, in naira, so nobody has to self-report. For extra pressure you can stake money on a promise, locked in a smart contract that even I can't touch: kept, it comes back; missed, it goes to someone you chose.

21:00. Anything still open gets one honest question, and if something got in the way, Anchor remembers it, so the next plan is better than the last.

Anytime, the Anchor app opens right inside Telegram: a follow-through ring, a calendar of kept days, your streaks, what Anchor has learned about you, and a memory switch that shows the same answer with and without your memory. That difference is the whole idea.

A few things I cared about:
• Your memory belongs to you. It's encrypted on Walrus, and you can move it into your own Walrus Memory account at any time.
• It works wherever you are: your own time zone, and it replies in your language, from Pidgin and Yoruba to French and Arabic.
• Nothing is a black box: you can see what it remembers, why it said what it said, and delete anything.

Under the hood it's built on Walrus (memory and file storage), Sui (on-chain verification and a Move escrow), Tatum (Sui RPC, Walrus Storage and exchange rates), Gemini, and x402 so AI agents can pay to read a signed follow-through record when a user opts in.

Try it: t.me/Anchor_daBot. Press Start and tell it one thing you keep putting off.

It will remember, even if you don't.

Open source: github.com/angelraph/anchor
Built for the Total Recall hackathon by Tatum and Walrus Foundation.

#Accountability #Productivity #AI #Walrus #Sui #TotalRecall
```

On LinkedIn, type @ and pick Tatum, Walrus Foundation and Sui from the suggestions so they're tagged.
