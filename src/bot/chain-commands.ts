/**
 * Commands for the chain side of Anchor:
 *   /wallet   link a Sui wallet (address or .sui name), prove it's yours
 *   /money    balances, money promises in progress, money patterns learned (all via Tatum)
 *   /verify   check money promises on Sui right now
 *   /stake    put USDC on a promise (x402 on Sui)
 *   /report   publish a signed follow-through report to Walrus (via Tatum)
 *   /record   let AI agents read your signed record (they pay per read, x402)
 *   /learning how Anchor's picture of you changed, week by week
 */
import { randomBytes } from "node:crypto";
import { hashToken } from "../web/me-routes.js";
import type { Bot, Context } from "grammy";
import { describeCheck, parseCheck } from "../chain/checks.js";
import { evaluate, runChainChecks } from "../chain/promises.js";
import { publishReport, reportPageUrl, reportsEnabled } from "../chain/report.js";
import { anchorAddress } from "../chain/signer.js";
import { createStake, stakesEnabled, stakeUrl } from "../chain/stakes.js";
import { exactUnits, newProofAmount, stakeTransferAmount } from "../chain/transfers.js";
import { isCurrency, money, UNPRICED, valueCents } from "../chain/prices.js";
import { balanceOf, coinLabel, COINS, explorerAddr, fromUnits, isStakeCoin, resolveRecipient, shortAddr, type StakeCoin } from "../chain/sui.js";
import { config } from "../config.js";
import { todayIn } from "../dates.js";
import { learnMoneyPattern, learningTimeline } from "../learning.js";
import { clause } from "../memory/types.js";
import { storeMemories } from "../memory/write.js";
import { allStakes, getUser, putLinkToken, tzOf, updateUser, upsertUser } from "../state.js";
import { enqueue } from "./conversation.js";

const base = () => config.PUBLIC_URL.replace(/\/$/, "");
const noPreview = { link_preview_options: { is_disabled: true } } as const;

function touch(ctx: Context) {
  const from = ctx.from!;
  return upsertUser(from.id, ctx.chat?.id ?? from.id, from.first_name ?? "");
}

function linkUrl(userId: number): string | undefined {
  if (!config.PUBLIC_URL) return undefined;
  const token = randomBytes(16).toString("base64url");
  putLinkToken(token, String(userId));
  return `${base()}/link/${token}`;
}

export function registerChainCommands(bot: Bot, withTyping: <T>(ctx: Context, work: () => Promise<T>) => Promise<T>) {
  bot.command("wallet", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const arg = ctx.match.trim();
    const current = getUser(userId)?.wallet;
    if (!arg) {
      if (!current) {
        await ctx.reply(
          "Link your Sui wallet and I can verify money promises on-chain (\"save 50 USDC by Friday\", \"pay Tobi back 20 USDC\") instead of taking your word for it.\n\nSend /wallet <your address or name.sui>. I only read it; I can never move your money.",
        );
        return;
      }
      const url = current.verified ? undefined : linkUrl(userId);
      await ctx.reply(
        `Linked: ${current.name ?? shortAddr(current.address)} · ${current.verified ? "verified ✅" : "watch-only"}\n${explorerAddr(current.address)}${url ? `\n\nProve it's yours (sign a message, free, no transaction): ${url}\nWallet blocks that page? Send /wallet verify and prove it with a tiny transfer instead.` : ""}\n\n/wallet off unlinks it.`,
        noPreview,
      );
      return;
    }
    if (arg === "verify") {
      if (!current) {
        await ctx.reply("Link a wallet first: /wallet <your address or name.sui>");
        return;
      }
      if (current.verified) {
        await ctx.reply(`${current.name ?? shortAddr(current.address)} is already verified ✅`);
        return;
      }
      if (!anchorAddress) {
        await ctx.reply("Verification by transfer isn't switched on for this Anchor yet (it needs its own Sui wallet).");
        return;
      }
      const amount = newProofAmount();
      updateUser(userId, (u) => {
        u.walletProof = { amount: amount.toString(), since: Date.now() };
      });
      await ctx.reply(
        `Prove ${shortAddr(current.address)} is yours with a tiny transfer, no website needed.\n\nFrom that wallet, send exactly:\n${exactUnits(amount, "SUI")} SUI\n\nto Anchor's address:\n${anchorAddress}\n\nThe odd amount is how I recognise it's you. I'm watching Sui (through Tatum) for the next 2 hours and will confirm here within a minute of it landing.`,
        noPreview,
      );
      return;
    }
    if (arg === "off") {
      updateUser(userId, (u) => {
        delete u.wallet;
        delete u.chain;
        u.publicRecord = false;
      });
      await ctx.reply("Unlinked. Money promises will go back to asking you how they went.");
      return;
    }
    await withTyping(ctx, async () => {
      const r = await resolveRecipient(arg).catch(() => undefined);
      if (!r) {
        await ctx.reply("That isn't a Sui address or a .sui name I can resolve. Try /wallet 0x… or /wallet yourname.sui");
        return;
      }
      updateUser(userId, (u) => {
        u.wallet = { address: r.address, name: r.name, verified: false, linkedAt: new Date().toISOString() };
      });
      void enqueue(`write:${userId}`, () =>
        storeMemories(userId, [
          { kind: "fact", date: todayIn(tzOf(userId)), text: `Linked Sui wallet ${r.name ? `${r.name} (${r.address})` : r.address} to Anchor for verified money promises` },
        ]),
      ).catch(() => undefined);
      const usdc = await balanceOf(r.address, "USDC").catch(() => undefined);
      const url = linkUrl(userId);
      await ctx.reply(
        `⛓ Linked ${r.name ?? shortAddr(r.address)}${usdc !== undefined ? ` (${fromUnits(usdc, "USDC")} USDC right now, read via Tatum)` : ""}.\n\nI'll verify money promises on it. ${url ? `To make it count for public reports, prove it's yours: ${url}\n(or /wallet verify to prove it with a tiny transfer instead)` : ""}\n\nTry: "I'll save 20 USDC by Friday".`,
        noPreview,
      );
    });
  });

  bot.command("money", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const user = getUser(userId);
    if (!user?.wallet) {
      await ctx.reply("No wallet linked yet. /wallet <address or name.sui> and I'll start reading it.");
      return;
    }
    // /money NGN shows values in naira (and remembers it); default USD.
    const asked = ctx.match.trim().toUpperCase();
    if (asked && !isCurrency(asked)) {
      await ctx.reply("Use a currency code, e.g. /money USD, /money NGN or /money EUR.");
      return;
    }
    if (asked) updateUser(userId, (u) => (u.currency = asked));
    const cur = asked || user.currency || "USD";
    await withTyping(ctx, async () => {
      const w = user.wallet!;
      const lines = [`💰 ${w.name ?? shortAddr(w.address)} on Sui (balances via Tatum's Sui RPC, prices via Tatum's Data API)`];
      let total = 0n;
      for (const coin of Object.keys(COINS) as Array<keyof typeof COINS>) {
        const b = await balanceOf(w.address, coin).catch(() => undefined);
        const v = b !== undefined && !UNPRICED.includes(coin) ? await valueCents(coin, b, cur).catch(() => undefined) : undefined;
        if (v !== undefined) total += v;
        lines.push(`  ${coinLabel(coin)}: ${b === undefined ? "unavailable" : fromUnits(b, coin)}${v !== undefined ? `  ≈ ${money(v, cur)}` : UNPRICED.includes(coin) ? "  (not priced)" : ""}`);
      }
      lines.push(`  Total: ≈ ${money(total, cur)}${cur === "USD" ? "  (/money NGN for naira, /money EUR…)" : ""}`);
      const open = Object.entries(user.chain ?? {});
      if (open.length) {
        lines.push("", "Money promises I'm watching:");
        for (const [id, p] of open) {
          const v = await evaluate(userId, p, false).catch(() => undefined);
          const stake = p.stake ? allStakes().find((s) => s.token === p.stake && s.status === "held") : undefined;
          lines.push(`  #${id} ${clause(p.text)} (due ${p.due}${p.at ? ` ${p.at}` : ""})${stake ? ` 🔒 ${stake.amount} ${coinLabel(stake.coin ?? "USDC")} staked` : ""}`);
          if (v) lines.push(`     ${v.status === "kept" ? "✅ " : ""}${v.evidence}`);
        }
      }
      const pattern = await learnMoneyPattern(userId).catch(() => undefined);
      if (pattern) lines.push("", `🔁 What I've learned from your wallet: ${pattern}.`);
      lines.push("", explorerAddr(w.address));
      await ctx.reply(lines.join("\n"), noPreview);
    });
  });

  bot.command("verify", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      const lines = await runChainChecks(ctx.api, { userId: String(ctx.from!.id), force: true });
      await ctx.reply(lines.length ? `Checked Sui just now:\n${lines.join("\n")}` : "No money promises being watched. Link a wallet (/wallet) and promise something in USDC, USDsui, SUI or WAL.");
    });
  });

  bot.command("stake", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const user = getUser(userId);
    const chain = Object.entries(user?.chain ?? {});
    const [rawId, rawAmount, ...afterAmount] = ctx.match.trim().split(/\s+/).filter(Boolean);
    // Optional coin after the amount: /stake #id 5 usdsui friend.sui
    const named = afterAmount[0]?.toUpperCase();
    const rest = named && isStakeCoin(named) ? afterAmount.slice(1) : afterAmount;
    if (!stakesEnabled()) {
      await ctx.reply("Stakes aren't switched on for this Anchor yet (it needs its own Sui wallet and a public URL).");
      return;
    }
    if (!rawId || !rawAmount || rest.length === 0) {
      const list = chain.map(([id, p]) => `  #${id} ${clause(p.text)}`).join("\n");
      await ctx.reply(
        `Put money on a promise. Keep it and the money comes back to you. Miss it and it goes to someone you choose: a friend, a charity, the person you'd least like to pay.\n\nUsage: /stake #id <amount, max ${config.STAKE_MAX_USDC}> [usdc|usdsui] <who gets it if you miss: name.sui or 0x…>\nExample: /stake #${chain[0]?.[0] ?? "k3f9"} 5 tobi.sui (USDC)\nor: /stake #${chain[0]?.[0] ?? "k3f9"} 5 usdsui tobi.sui\n\n${list ? `Promises the chain can judge:\n${list}` : "First make a money promise the chain can check (link a wallet with /wallet)."}`,
      );
      return;
    }
    const id = rawId.replace(/^#/, "");
    const p = user?.chain?.[id];
    if (!p) {
      await ctx.reply(`#${id} isn't a money promise I'm verifying on Sui. Stakes only work when the chain can judge the outcome.`);
      return;
    }
    if (p.stake) {
      await ctx.reply(`#${id} already has a stake.`);
      return;
    }
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > config.STAKE_MAX_USDC || !/^\d+(\.\d{1,6})?$/.test(rawAmount)) {
      await ctx.reply(`The stake has to be between 0 and ${config.STAKE_MAX_USDC} (USDC or USDsui).`);
      return;
    }
    if (p.due < todayIn(tzOf(userId))) {
      await ctx.reply(`#${id} is already past its deadline.`);
      return;
    }
    await withTyping(ctx, async () => {
      const who = rest.join(" ");
      const r = await resolveRecipient(who).catch(() => undefined);
      if (!r) {
        await ctx.reply(`I couldn't resolve "${who}" to a Sui address. Use a name.sui or a 0x address.`);
        return;
      }
      if (r.address === user?.wallet?.address || r.address === anchorAddress) {
        await ctx.reply("The money has to go to someone else if you miss, otherwise it isn't at stake.");
        return;
      }
      // Coin: named in the command, else the promise's own stablecoin, else USDC.
      const promised = parseCheck(p.chk)?.coin;
      const coin: StakeCoin = named && isStakeCoin(named) ? named : promised && isStakeCoin(promised) ? promised : "USDC";
      const stake = createStake({
        userId: String(userId),
        commitmentId: id,
        text: p.text,
        due: p.due,
        at: p.at,
        amount: rawAmount,
        forfeitTo: r.address,
        forfeitName: r.name ?? who,
        coin,
        payExact: user?.wallet ? stakeTransferAmount(rawAmount, coin).toString() : undefined,
      });
      const check = parseCheck(p.chk);
      const direct = stake.payExact
        ? `\n\nOr pay straight from your wallet app, no website: send exactly\n${exactUnits(stake.payExact, coin)} ${coinLabel(coin)}\nfrom ${shortAddr(user!.wallet!.address)} to Anchor's address:\n${anchorAddress}\nPay one way only. I'll see it on Sui within a minute.`
        : "";
      await ctx.reply(
        `🔒 Stake ${rawAmount} ${coinLabel(coin)} on #${id} · ${clause(p.text)}\n\nThe chain decides${check ? `: I'll check that ${describeCheck(check)}` : ""}.\n• Kept: it comes back to the wallet that paid.\n• Missed: it goes to ${r.name ?? shortAddr(r.address)}.\nAnchor never keeps it.\n\nPay from your Sui wallet (x402, settled on Sui): ${stakeUrl(stake.token)}${direct}`,
        noPreview,
      );
    });
  });

  bot.command("report", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const arg = ctx.match.trim().toLowerCase();
    if (!reportsEnabled()) {
      await ctx.reply("Signed reports aren't switched on for this Anchor yet (it needs a Tatum API key and its own Sui key).");
      return;
    }
    if (arg === "auto" || arg === "off") {
      updateUser(userId, (u) => {
        u.reportAuto = arg === "auto";
      });
      await ctx.reply(arg === "auto" ? "Every Sunday I'll publish your signed weekly report to Walrus and send you the link." : "Weekly reports are off.");
      return;
    }
    await withTyping(ctx, async () => {
      const { signed, job } = await publishReport(userId, { publicTexts: arg === "public" });
      const r = signed.report;
      await ctx.reply(
        `🧾 Signed and published to Walrus (through Tatum's Storage API).\n\nWeek ${r.week.from} to ${r.week.to}: ✅ ${r.kept} 🟡 ${r.partial} ❌ ${r.missed}${r.followThroughPct !== null ? ` · ${r.followThroughPct}% follow-through` : ""}\n${r.promises.filter((x) => x.verifiedOnSui).length} verified on Sui · signed by Anchor (${shortAddr(r.issuer)})\n\nCheck it: ${reportPageUrl(job.jobId)}\n${arg === "public" ? "Promise texts are included (you asked for public)." : "Promise texts are hashed; /report public includes them."}\n/report auto publishes one every Sunday.`,
        noPreview,
      );
    });
  });

  bot.command("record", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    const arg = ctx.match.trim().toLowerCase();
    const w = getUser(userId)?.wallet;
    if (arg === "on") {
      if (!w?.verified) {
        await ctx.reply("Verify your wallet first (/wallet), so agents know the record really belongs to that address.");
        return;
      }
      updateUser(userId, (u) => {
        u.publicRecord = true;
      });
      await ctx.reply(
        `Your signed follow-through record is now readable by AI agents, for example a lender's or a hiring agent's, if you send them there. They pay ${config.AGENT_PRICE_USDC} USDC per read via x402 on Sui. It contains only counts and on-chain proofs, never your messages.\n\n${base()}/x402/record/${w.address}\n\n/record off hides it again.`,
        noPreview,
      );
      return;
    }
    if (arg === "off") {
      updateUser(userId, (u) => {
        u.publicRecord = false;
      });
      await ctx.reply("Your record is private again.");
      return;
    }
    await ctx.reply(`Your record is ${getUser(userId)?.publicRecord ? "readable by agents (x402)" : "private"}. /record on or /record off.`);
  });

  bot.command("connect", async (ctx) => {
    touch(ctx);
    const userId = ctx.from!.id;
    if (ctx.match.trim() === "off") {
      updateUser(userId, (u) => {
        delete u.apiTokenHash;
      });
      await ctx.reply("Disconnected. That token no longer works anywhere.");
      return;
    }
    if (!config.PUBLIC_URL) {
      await ctx.reply("Portable memory isn't switched on for this Anchor yet (it needs a public URL).");
      return;
    }
    const token = `anc_${randomBytes(24).toString("base64url")}`;
    updateUser(userId, (u) => {
      u.apiTokenHash = hashToken(token);
    });
    await ctx.reply(
      `🔌 Take your Anchor memory into other tools: Claude Code, Codex, Cursor, any MCP client. Promises you make there, I follow up on here.

Your personal token (shown once, keep it private):
${token}

Claude Code:
claude mcp add anchor -e ANCHOR_URL=${base()} -e ANCHOR_TOKEN=${token} -e ANCHOR_SOURCE="Claude Code" -- npx tsx scripts/anchor-mcp.ts

Or call the API directly: ${base()}/api/me/memory?q=… with "Authorization: Bearer <token>".
/connect again makes a new token, /connect off revokes it.`,
      noPreview,
    );
  });

  bot.command("learning", async (ctx) => {
    touch(ctx);
    await withTyping(ctx, async () => {
      await ctx.reply(await learningTimeline(ctx.from!.id));
    });
  });
}

export const CHAIN_COMMANDS = [
  { command: "wallet", description: "Link your Sui wallet" },
  { command: "money", description: "Balances and money promises (on Sui)" },
  { command: "verify", description: "Check money promises on Sui now" },
  { command: "stake", description: "Put USDC or USDsui on a promise" },
  { command: "report", description: "Publish a signed report to Walrus" },
  { command: "record", description: "Let agents read your record (x402)" },
  { command: "learning", description: "How Anchor has learned you" },
  { command: "connect", description: "Use your Anchor memory in other tools (MCP)" },
];

export const CHAIN_HELP = `
On-chain (Sui, read through Tatum)
/wallet <address or name.sui>: link your wallet so money promises verify themselves
/wallet verify: prove it's yours with a tiny transfer (no website)
/money: balances, money promises in progress, money patterns I've learned
/verify: check money promises on Sui right now
/stake #id <amount> [usdsui] <name.sui>: money back if you keep it, theirs if you don't
/report: publish a signed follow-through report to Walrus
/record on: let AI agents read your signed record (they pay per read)
/learning: how I've learned you, week by week

Portable memory
/connect: use your Anchor memory in Claude Code, Codex or any MCP client`;
