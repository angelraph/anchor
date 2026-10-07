# Anchor: design notes

## Why accountability?
Most chatbots treat memory as a nice extra: the bot remembers your name or your order number. In accountability, memory *is* the product. A coach who forgets what you promised last week can't hold you to anything. That gives us a clear test for whether memory works: did Anchor follow up on the right promise, on the right day, and use what it knew about you?

## Memory model
Walrus Memory stores text and recalls it by semantic similarity. It has no metadata columns or filters, so Anchor puts structure *inside* the text with a compact header:

```
[kind] YYYY-MM-DD key:value … | sentence
```

- The sentence dominates the embedding, so semantic recall still works.
- The header parses back into `kind`, `id`, `due`, `ref`, `status` after recall.
- Commitments get a short random `id`. Outcomes reference it with `ref:`. `status:moved` + `due:` reschedules a promise without rewriting the original memory, since storage is append-only.

## Recall strategy
Every turn runs three recalls in parallel against the user's namespace:

1. **Semantic**: the message itself (`limit 8`, `maxDistance 0.75`).
2. **Recent**: "promises, commitments, deadlines…" with `sort: "recent"`. This surfaces the latest state of promises even when the user is talking about something else. Without it, "hey, what's up" would recall nothing useful.
3. **Profile**: identity and coaching style (`limit 5`).

Results are merged and deduplicated, tombstones are applied, and commitments are paired with their newest outcome. The prompt then gets both a computed **promise list** (open, due today, overdue, kept, broken) and the raw memories as a nonce-delimited, JSON-encoded, explicitly *untrusted* block, the same prompt-injection defence the MemWal AI middleware uses.

## Write strategy
After the reply is sent (it never waits on writes), a per-user background queue:
1. Asks Gemini for structured output (`Output.object` + zod) with typed memories. Relative dates ("Friday") are resolved to absolute dates against the user's timezone.
2. Drops duplicates: exact text against this turn's recall, plus a near-duplicate recall (`distance < 0.2`, same kind) for facts, patterns, wins and preferences.
3. Stores the batch with `rememberBulkAndWait` and retries failed items once, so a transient relayer failure never silently drops a memory.

Why not `withMemWal` middleware or `analyze()`? Both are great defaults, but Anchor needs typed, linkable records (commitment ↔ outcome). It also needs to know *exactly* which memories shaped each reply, for `/why`.

## Proactive check-ins
A timer ticks every minute; at `CHECKIN_HOUR` in `TIMEZONE` it:
1. Enumerates users from local state **and** `listNamespaces()`, so a wiped disk still finds everyone.
2. Sweeps commitments + outcomes (`sort: "recent"`, limit 30 each) and finds open promises due today or earlier.
3. Recalls memories related to each due promise, so the nudge can mention a pattern.
4. Sends one Gemini-written message, plus a ✅ / 🟡 / ❌ / 📅 keyboard per promise.

## Operational state vs memory
`data/state.json` holds only bookkeeping: chat ids, "already nudged today", the `/why` trace, and a tombstone cache. Long-term memory lives only in Walrus.

## Walrus Memory friction found while building
1. **No delete / forget API.** Storage is append-only, so "forget this" needs app-level tombstones. A tombstone has to embed the forgotten text so it is recalled *next to* the memory it cancels. That's awkward for a privacy-motivated forget. A first-class `forget(blob_id)` that excludes the vector from recall would remove the workaround.
2. **No structured metadata or filtering.** Typed memories need text headers, and "all open commitments" has to be approximated with broad semantic sweeps (`limit 30`) instead of a filter like `kind = commitment`.
3. **`formatUntrustedMemories` isn't exported** from `@mysten-incubation/memwal/ai`. Apps that do their own recall have to copy the prompt-injection defence.
4. **Append-only + recall means duplicates are on you.** Remembering the same fact twice stores two entries, so dedupe costs an extra recall per candidate.
5. **`analyze()` resolves weekdays to the wrong date.** Reproduced on 2026-10-07 (a Wednesday) with `analyze("User: ... ship my first Sui contract by Sunday ...", { occurredAt: new Date() })`. The stored fact read "by Sunday, 8 October 2026 (2026-10-08)", but 2026-10-08 is a Thursday; the coming Sunday is 2026-10-11. Anchor only uses `analyze` as a fallback when Gemini extraction fails. Filed as [MystenLabs/MemWal#1131](https://github.com/MystenLabs/MemWal/issues/1131).
6. **The 401 does not say what is wrong.** Pasting a Sui wallet address as `MEMWAL_ACCOUNT_ID` returns the same generic `AUTH_REJECTED` as a wrong key. Checking that the ID is a `MemWalAccount` object (and saying so) would have saved an hour. Filed as [MystenLabs/MemWal#1132](https://github.com/MystenLabs/MemWal/issues/1132).

## Reliability decisions
- **Recall fails:** Anchor still answers, tells the user its memory is reconnecting, and never pretends to remember.
- **Save fails:** only jobs Walrus marks `failed` are re-sent (a `timeout` job usually finishes and re-sending would duplicate it). Anything still failing is parked in an on-disk outbox and retried every 10 minutes.
- **Gemini extraction fails** (quota, outage): Walrus Memory `analyze()` extracts facts from the exchange instead, so the conversation is still remembered.
- **Gemini model overloaded or connection dropped:** fail over to the next model and skip the failing one for 5 minutes.
- **Telegram 409 conflict** (two instances during a redeploy): polling restarts instead of silently stopping.
- **Deadlines:** prompts get the full local clock, so "by 6am" said at 23:59 resolves to the next morning.

