# How I added long-term memory to a Telegram chatbot so it remembers users between sessions

*Building Anchor, an accountability bot, with Walrus Memory and Gemini. Including what broke.*

Most chatbots forget you the moment the chat ends. For an accountability bot that's fatal: a coach who can't remember what you promised yesterday can't hold you to anything.

So I built **Anchor**, a Telegram bot that holds you to your word. You tell it what you'll do and by when. It remembers, messages you first when the promise is due, records whether you kept it, and learns what derails you and what works.

Try it: [t.me/Anchor_daBot](https://t.me/Anchor_daBot) · Live proof page: [anchor-production-6bb4.up.railway.app](https://anchor-production-6bb4.up.railway.app) · Code: [github.com/angelraph/anchor](https://github.com/angelraph/anchor)

## How I wired in Walrus Memory

Walrus Memory stores text encrypted and recalls it by meaning. Each Telegram user gets their own namespace (`anchor:tg:<telegram id>`), so memories never cross between people.

**What gets stored.** After every message, Gemini extracts typed memories from the exchange: promises, outcomes, patterns, wins, facts and preferences. Each is one readable line with a small header, so it embeds well and I can parse structure back out:

```
[commitment] 2026-10-07 id:33a6 due:2026-10-07 at:18:00 | Promised to send CV to two companies
[outcome] 2026-10-07 ref:33a6 status:kept | Kept the promise
[win] 2026-10-07 | Putting the phone in another room helps him finish tasks
```

![/memory: what Anchor remembers, grouped by type](img/04-memory-list.png)

**When it is recalled.** Every message recalls what's relevant to it, the latest promises (`sort: "recent"`), and the person's profile and habits. Every evening at 19:00 a scheduler recalls promises that are due and messages people first, with ✅ 🟡 ❌ 📅 buttons. That's the part I'm proudest of: memory doesn't just shape replies, it makes the bot act.

**How it shapes replies.** Recalled memories go into the prompt as clearly marked untrusted data, next to a computed list of open, overdue and finished promises. `/why` shows the exact memories behind any reply, with their Walrus blob IDs.

## Before and after

Same message, same model. `/compare` answers without memory and with it, side by side:

![/compare: without memory vs with Walrus Memory](img/03-compare-with-without-memory.png)

> **Without memory:** "What specific day and time before the end of the week will you have the project finished?"
>
> **With Walrus Memory:** "Great job getting that clock build submitted this morning, Angel. Since you focus best in the morning, let's lock in a concrete plan for your project."

The first could be for anyone. The second knows I kept my last promise and when I work best.

## The moment it mattered

A tester who trades on City Index told Anchor on day one that he trades best at midnight, goes to the gym on Tuesdays and Thursdays at 16:00, and spends weekends on his art. He promised a 20x trading return by 18:00, and a deal sealed by 8am the next morning.

At 7:01 PM Anchor messaged him first and used what it knew. The next morning, in a new session, it remembered yesterday's win, his gym day, his weekends, and the deal due an hour earlier:

![Next day: the evening check-in, then Anchor recalling yesterday's win, his routine, and the deal due that morning](img/07-next-day-recall.jpeg)

He answered "Yes". Anchor closed the promise and, because it was Thursday, reminded him about the gym:

![The deal marked done, and the gym reminder](img/08-next-day-deal-done.jpeg)

My friend Joseph, an engineer in the UK, said chatting distracts him, music helps him focus on site, mornings are his strongest time, and his wife pushes him. Within minutes Anchor was using all of it:

![Joseph's chat: Anchor uses his morning energy and his wife's motivation in its advice](img/05-joseph-uses-what-he-said.jpeg)

## What broke

- **My first promise went wrong.** At 23:59 I said "by 6am" and Anchor replied "6 PM today". I'd only given the model the date, never the time. Now prompts carry the local clock, deadlines keep their time, and check-ins wait until a deadline has actually passed.

![The first real promise: "by 6am" heard as "6 PM", and /why showing the memories on Walrus](img/01-first-promise-6am-bug.png)

- **Real users found what tests didn't.** Joseph's chat caught Anchor saying "we've talked about this before" about something new, and filing "Today at 2pm" as a preference instead of a promise. Both fixed that afternoon.
- **A wallet address is not an account ID.** Pasting my Sui address gave a generic `401 AUTH_REJECTED`; I found the cause by looking the ID up on-chain. Reported as [MemWal#1132](https://github.com/MystenLabs/MemWal/issues/1132).
- **Walrus Memory is append-only.** There's no delete, so `/forget` writes a tombstone that hides a memory from every future recall.
- **Saves take about 30 seconds.** Anchor uses what it just learned immediately while Walrus finishes indexing, so it never misses something said a moment ago.
- **There's an hourly request budget.** My own tests used it up and the proof page went down. Anchor now caches slow-changing recalls and the page serves its last saved numbers.
- **Gemini kept moving.** `gemini-2.5-flash` and later `gemini-2.5-flash-lite` were closed to new keys, and newer models hit "high demand", quota limits and timeouts. Anchor ranks Gemini models by real response time, skips struggling ones, and if none can answer, saves the message through Walrus's own `analyze()` so nothing is lost.
- **A Walrus bug:** `analyze()` stored "by Sunday" as Friday 9 October. Reported as [MemWal#1131](https://github.com/MystenLabs/MemWal/issues/1131).

## Results

After two days, **11 people had stored 103 memories, and 7 had passed 10 each**, counted live from Walrus Memory on the [proof page](https://anchor-production-6bb4.up.railway.app). Telegram on a phone or a laptop reaches the same memory, so it follows people across devices.

## Stack

- **LLM:** Google Gemini (`gemini-3.8-flash` with Gemini fallbacks) via the Vercel AI SDK. Not Claude or OpenAI.
- **Memory:** Walrus Memory TypeScript SDK (`@mysten-incubation/memwal`), mainnet.
- **Bot:** grammY on Node.js, on Railway. The repo has setup steps and tests.

If you're adding memory to a chatbot, ask: *what would my bot do differently if it remembered?* If the answer is "say their name", keep going until memory changes what the bot actually does.
