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
