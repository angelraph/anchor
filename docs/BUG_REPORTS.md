# Bug reports filed with Walrus Memory

Two issues found while building Anchor, filed on the MemWal repo on 2026-10-07:

1. [analyze() resolves weekday deadlines to the wrong date, even with occurredAt set](https://github.com/MystenLabs/MemWal/issues/1131)
   With `occurredAt` pinned to Wednesday 2026-10-07, "by Sunday" was stored as 2026-10-09 (a Friday) and "by Friday" as 2026-10-07 (the Wednesday itself). The wrong date ends up inside the encrypted fact text and embedding, so it can't be corrected later.

2. [401 AUTH_REJECTED doesn't say when accountId isn't a MemWal account](https://github.com/MystenLabs/MemWal/issues/1132)
   Pasting a Sui wallet address as `accountId` gives the same generic 401 as a wrong private key. The cause only showed up after looking the ID up on-chain.

More detail and the other friction points are in [ARCHITECTURE.md](ARCHITECTURE.md).
