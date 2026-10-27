/**
 * Web routes for the chain side:
 *
 *   GET  /link/:token                wallet ownership page (sign a message)
 *   GET/POST /api/link/:token        the message to sign / the signature to verify
 *   GET  /stake/:token               stake payment page
 *   GET  /api/stake/:token           stake details for the page
 *   POST /x402/stake/:token          x402 resource: pay the stake
 *   GET  /x402/record/:address       x402 resource: an agent reads a signed follow-through record
 *   POST /api/x402/build             build the unsigned payment transaction for a payer (via Tatum)
 *   GET  /.well-known/x402           what this server sells, for agents
 *   GET  /report/:jobId              fetch a report from Walrus and check its signature
 *   GET  /wallet.js                  browser bundle for the wallet pages
 */
import { join } from "node:path";
import type { Api } from "grammy";
import type { Context, Hono } from "hono";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { buildReport, fetchReport, reportsEnabled, signReport, uploadStatus, verifyReport } from "../chain/report.js";
import { anchorAddress } from "../chain/signer.js";
import { markStakePaid, stakeRequirements } from "../chain/stakes.js";
import { COINS, explorerAddr, explorerTx, shortAddr, toUnits } from "../chain/sui.js";
import {
  buildPaymentTransaction,
  decodeHeader,
  encodeHeader,
  requirements,
  sameRequirements,
  settlePayment,
  verifyPayment,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentRequired,
} from "../chain/x402.js";
import { config } from "../config.js";
import { clause } from "../memory/types.js";
import { allUsers, bump, consumeLinkToken, getStake, peekLinkToken, updateStake, updateUser } from "../state.js";
import { logoSvg } from "./logo.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const linkMessage = (token: string) => `Anchor: link this wallet to my Anchor account on Telegram. Code: ${token}`;

let bundle: Promise<string> | undefined;
/** Bundle the wallet page script once, on first request. */
function walletBundle(): Promise<string> {
  bundle ??= import("esbuild")
    .then((esbuild) =>
      esbuild.build({
        entryPoints: [join(process.cwd(), "src", "web", "client", "wallet.ts")],
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        minify: true,
        write: false,
        logLevel: "silent",
      }),
    )
    .then((r) => r.outputFiles[0]!.text)
    .catch((err) => {
      bundle = undefined;
      throw err;
    });
  return bundle;
}

function shell(title: string, body: string, data: Record<string, string> = {}): string {
  const attrs = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>
:root{--void:#000;--bone:#fff;--ash:#9a9a9a;--mist:#bdbdbd;--iris:#8052ff;--saffron:#ffb829;--verdant:#2fd3b5;--rose:#ff6b6b;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--void);color:var(--bone);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:620px;margin:0 auto;padding:48px 16px 80px}
.logo{display:flex;align-items:center;gap:10px;font-weight:600;margin-bottom:48px}.logo svg{width:28px;height:28px}
.label{font-family:var(--mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--saffron);margin-bottom:14px}
h1{font-size:clamp(32px,7vw,48px);font-weight:400;letter-spacing:-.03em;line-height:1.08;margin-bottom:18px}
p{font-weight:300;line-height:1.55;color:var(--mist);margin-bottom:14px}
a{color:var(--saffron)}
.card{border:1px solid #222;border-radius:18px;padding:18px;margin:22px 0;background:#07080c}
.row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;font-size:15px;border-bottom:1px solid #15161c}.row:last-child{border:0}
.row span:first-child{color:var(--ash)}.row span:last-child{text-align:right;word-break:break-all;font-family:var(--mono);font-size:13px}
#wallets{display:grid;gap:10px;margin-top:10px}
.wallet{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border-radius:14px;border:1px solid #2a2a35;background:#0e0f16;color:var(--bone);font-size:16px;cursor:pointer}
.wallet:hover{border-color:var(--iris)}.wallet img{width:28px;height:28px;border-radius:6px}
.status{margin-top:18px;font-size:15px;line-height:1.5;color:var(--mist)}.status.ok{color:var(--verdant)}.status.err{color:var(--rose)}
.ok{color:var(--verdant)}.bad{color:var(--rose)}
.muted{color:var(--ash);font-size:14px}
pre{white-space:pre-wrap;word-break:break-all;font-family:var(--mono);font-size:12px;color:var(--mist);background:#07080c;border:1px solid #222;border-radius:12px;padding:14px;max-height:320px;overflow:auto}
</style></head>
<body${attrs}><main>
<a class="logo" href="/" style="color:inherit;text-decoration:none">${logoSvg(28)}<span>Anchor</span></a>
${body}
</main></body></html>`;
}

function paymentRequired(c: Context, req: PaymentRequirements, description: string, error?: string) {
  const body: PaymentRequired = {
    x402Version: 2,
    error,
    resource: { url: new URL(c.req.url).pathname, description, mimeType: "application/json" },
    accepts: [req],
  };
  c.header("PAYMENT-REQUIRED", encodeHeader(body));
  return c.json(body, 402);
}

/** Read PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1 clients). */
function paymentHeader(c: Context): PaymentPayload | undefined {
  const raw = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
  if (!raw) return undefined;
  try {
    return decodeHeader<PaymentPayload>(raw);
  } catch {
    return undefined;
  }
}

/**
 * The x402 dance for one resource: no payment → 402; payment → verify,
 * settle on Sui, then run `deliver` and attach PAYMENT-RESPONSE.
 */
async function x402(
  c: Context,
  req: PaymentRequirements,
  description: string,
  deliver: (payer: string, digest: string) => Promise<Record<string, unknown>>,
) {
  const payment = paymentHeader(c);
  if (!payment) return paymentRequired(c, req, description);
  const v = await verifyPayment(payment, req).catch((err) => ({ isValid: false as const, invalidReason: err instanceof Error ? err.message.slice(0, 80) : "verify_failed" }));
  if (!v.isValid) return paymentRequired(c, req, description, v.invalidReason);
  const settled = await settlePayment(payment, v.digest);
  if (!settled.success) return paymentRequired(c, req, description, settled.errorReason ?? "settle_failed");
  c.header("PAYMENT-RESPONSE", encodeHeader(settled));
  return c.json({ ...(await deliver(settled.payer, settled.transaction)), payment: settled });
}

export function registerChainRoutes(app: Hono, getApi: () => Api | undefined) {
  app.use("/x402/*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  });
  app.options("/x402/*", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "PAYMENT-SIGNATURE, X-PAYMENT, content-type");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return c.body(null, 204);
  });

  app.get("/wallet.js", async (c) => {
    try {
      return c.body(await walletBundle(), 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
    } catch (err) {
      console.error("[web] wallet bundle failed:", err);
      return c.text("// wallet script unavailable", 500);
    }
  });

  // ------------------------------------------------------------ wallet link
  app.get("/link/:token", (c) => {
    const token = c.req.param("token");
    const ok = !!peekLinkToken(token);
    return c.html(
      shell(
        "Link your wallet · Anchor",
        ok
          ? `<div class="label">// prove it's yours</div><h1>Link your Sui wallet to Anchor.</h1>
<p>Sign one message with your wallet. It's free, sends no transaction, and lets Anchor verify your money promises and sign your reports for this address. Anchor can only read your wallet, never move your money.</p>
<div id="wallets"></div><div id="status" class="status"></div><script type="module" src="/wallet.js"></script>`
          : `<h1>This link has expired.</h1><p>Send /wallet in Telegram to get a fresh one.</p>`,
        ok ? { mode: "link", token } : {},
      ),
    );
  });
  app.get("/api/link/:token", (c) => {
    const token = c.req.param("token");
    return peekLinkToken(token) ? c.json({ message: linkMessage(token) }) : c.json({ error: "expired" }, 404);
  });
  app.post("/api/link/:token", async (c) => {
    const token = c.req.param("token");
    const userId = peekLinkToken(token);
    if (!userId) return c.json({ ok: false, error: "This link expired. Send /wallet in Telegram again." }, 404);
    const { address, signature } = (await c.req.json().catch(() => ({}))) as { address?: string; signature?: string };
    if (!address || !signature) return c.json({ ok: false, error: "missing signature" }, 400);
    const addr = normalizeSuiAddress(address);
    try {
      // zkLogin wallets (e.g. Slush with Google) are verified against Sui through Tatum.
      const { sui } = await import("../chain/sui.js");
      await verifyPersonalMessageSignature(new TextEncoder().encode(linkMessage(token)), signature, { address: addr, client: sui });
    } catch {
      return c.json({ ok: false, error: "The signature doesn't match that address." }, 400);
    }
    consumeLinkToken(token);
    let chatId: number | undefined;
    updateUser(userId, (u) => {
      const name = u.wallet?.address === addr ? u.wallet.name : undefined;
      u.wallet = { address: addr, name, verified: true, linkedAt: new Date().toISOString() };
      chatId = u.chatId;
    });
    const api = getApi();
    if (api && chatId) {
      await api.sendMessage(chatId, `✅ Wallet verified: ${shortAddr(addr)} is yours. Money promises on it now count for stakes and signed reports.`).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ stakes (x402)
  app.get("/stake/:token", (c) => {
    const s = getStake(c.req.param("token"));
    if (!s) return c.html(shell("Stake · Anchor", `<h1>Stake not found.</h1><p>Run /stake again in Telegram.</p>`), 404);
    const rows = [
      ["Promise", `#${s.commitmentId} · ${clause(s.text)}`],
      ["Deadline", `${s.due}${s.at ? ` ${s.at}` : ""} (${config.TIMEZONE})`],
      ["Stake", `${s.amount} USDC`],
      ["If kept", "back to the wallet that pays"],
      ["If missed", `to ${s.forfeitName ?? shortAddr(s.forfeitTo)}`],
      ["Status", s.status.replace("_", " ")],
    ];
    const body = `<div class="label">// put money on it</div><h1>Stake ${esc(s.amount)} USDC on your word.</h1>
<p>Paid with <b>x402</b> on Sui: your wallet signs a USDC transfer, Anchor verifies and settles it on Sui (through Tatum), and the chain decides the promise at the deadline. Anchor never keeps stake money.</p>
<div class="card">${rows.map(([k, v]) => `<div class="row"><span>${esc(k!)}</span><span>${esc(v!)}</span></div>`).join("")}</div>
${
  s.status === "awaiting_payment"
    ? `<div id="wallets"></div><div id="status" class="status"></div><script type="module" src="/wallet.js"></script>`
    : s.payDigest
      ? `<p>Paid: <a href="${explorerTx(s.payDigest)}">${esc(s.payDigest.slice(0, 12))}…</a>${s.payoutDigest ? ` · Paid out: <a href="${explorerTx(s.payoutDigest)}">${esc(s.payoutDigest.slice(0, 12))}…</a>` : ""}</p>`
      : ""
}`;
    return c.html(shell("Stake · Anchor", body, s.status === "awaiting_payment" ? { mode: "stake", token: s.token } : {}));
  });

  app.post("/x402/stake/:token", async (c) => {
    const s = getStake(c.req.param("token"));
    if (!s) return c.json({ error: "stake not found" }, 404);
    if (s.status !== "awaiting_payment") return c.json({ error: `stake is ${s.status.replace("_", " ")}` }, 409);
    return x402(c, stakeRequirements(s), `Stake ${s.amount} USDC on promise #${s.commitmentId}`, async (payer, digest) => {
      updateStake(s.token, (x) => delete x.payExact); // paid the plain amount through x402
      await markStakePaid(getApi(), s.token, payer, digest);
      return { staked: true, amount: s.amount, promise: s.commitmentId };
    });
  });

  // Build the payer's unsigned transfer (the spec's "query an RPC for coins" step), only for our own requirements.
  app.post("/api/x402/build", async (c) => {
    const { sender, accepted } = (await c.req.json().catch(() => ({}))) as { sender?: string; accepted?: PaymentRequirements };
    if (!sender || !accepted || !anchorAddress) return c.json({ error: "bad request" }, 400);
    const ours = requirements({ amount: BigInt(accepted.amount || "0"), asset: COINS.USDC.type, payTo: anchorAddress });
    if (!sameRequirements(accepted, ours) || BigInt(accepted.amount) > toUnits(String(config.STAKE_MAX_USDC), "USDC")) {
      return c.json({ error: "not a payment this server asked for" }, 400);
    }
    try {
      return c.json({ transaction: await buildPaymentTransaction(sender, ours) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: /insufficient|balance|coin/i.test(msg) ? "Not enough USDC (or SUI for gas) in this wallet." : msg.slice(0, 160) }, 400);
    }
  });

  // ------------------------------------------------------------ agents (x402)
  app.get("/x402/record/:address", async (c) => {
    if (!anchorAddress || !reportsEnabled()) return c.json({ error: "records are not enabled on this server" }, 503);
    let addr: string;
    try {
      addr = normalizeSuiAddress(c.req.param("address"));
    } catch {
      return c.json({ error: "bad address" }, 400);
    }
    const owner = allUsers().find(([, u]) => u.publicRecord && u.wallet?.verified && u.wallet.address === addr);
    if (!owner) return c.json({ error: "no public Anchor record for this address" }, 404);
    const [userId, user] = owner;
    const req = requirements({ amount: toUnits(String(config.AGENT_PRICE_USDC), "USDC"), asset: COINS.USDC.type, payTo: anchorAddress });
    return x402(c, req, `Signed follow-through record for ${shortAddr(addr)}`, async () => {
      const signed = await signReport(await buildReport(userId, { publicTexts: false }));
      bump((m) => {
        m.agentPayments++;
        m.agentRevenue = (BigInt(m.agentRevenue) + BigInt(req.amount)).toString();
      });
      return { address: addr, record: signed, walrus: user.lastReport ? { uploadJob: user.lastReport.blobId, week: user.lastReport.week } : null };
    });
  });

  app.get("/.well-known/x402", (c) =>
    c.json({
      x402Version: 2,
      payTo: anchorAddress ?? null,
      network: "sui:mainnet",
      resources: [
        {
          resource: "/x402/record/{suiAddress}",
          method: "GET",
          description: "A person's Anchor follow-through record, signed by Anchor's Sui key: kept / missed counts, follow-through %, Sui proofs. Only for people who opted in (/record on).",
          price: { amount: toUnits(String(config.AGENT_PRICE_USDC), "USDC").toString(), asset: COINS.USDC.type, display: `${config.AGENT_PRICE_USDC} USDC` },
        },
        {
          resource: "/x402/stake/{token}",
          method: "POST",
          description: "Pay a stake on a promise (created in Telegram with /stake). Returned if kept, sent to the chosen recipient if missed.",
        },
      ],
    }),
  );

  // ------------------------------------------------------------ report verifier
  app.get("/report/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    if (!config.TATUM_API_KEY) return c.html(shell("Report · Anchor", `<h1>Reports aren't enabled here.</h1>`), 503);
    let job;
    try {
      job = await uploadStatus(jobId);
    } catch {
      return c.html(shell("Report · Anchor", `<h1>Report not found.</h1>`), 404);
    }
    const walrusRows: string[][] = [
      ["Walrus status", job.status],
      ["Blob (quilt) id", job.blobId ?? "pending"],
      ...(job.quiltPatchId ? [["Quilt patch id", job.quiltPatchId]] : []),
      ...(job.suiObjectId ? [["Sui object", job.suiObjectId]] : []),
      ...(job.storageEvents ?? []).map((e) => [`Walrus ${e.type}`, e.txDigest]),
    ];
    const walrusCard = `<div class="card">${walrusRows.map(([k, v]) => `<div class="row"><span>${esc(k!)}</span><span>${/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v!) && k!.startsWith("Walrus ") ? `<a href="${explorerTx(v!)}">${esc(v!)}</a>` : esc(v!)}</span></div>`).join("")}</div>`;
    if (job.status !== "CERTIFIED") {
      return c.html(
        shell(
          "Report · Anchor",
          `<div class="label">// signed report</div><h1>Being certified on Walrus…</h1><p>Uploaded through Tatum's Storage API. Walrus certifies it on Sui in a minute or two, refresh then.</p>${walrusCard}`,
        ),
      );
    }
    const signed = await fetchReport(job).catch(() => undefined);
    if (!signed) return c.html(shell("Report · Anchor", `<h1>Couldn't download the report from Walrus.</h1>${walrusCard}`), 502);
    const v = await verifyReport(signed);
    const r = signed.report;
    const summary: string[][] = [
      ["Week", `${r.week.from} → ${r.week.to}`],
      ["Kept / partly / missed", `${r.kept} / ${r.partial} / ${r.missed}`],
      ["Follow-through", r.followThroughPct === null ? "nothing closed" : `${r.followThroughPct}%`],
      ["Verified on Sui", String(r.promises.filter((p) => p.verifiedOnSui).length)],
      ["Learned so far", `${r.learned.patterns} patterns · ${r.learned.wins} wins`],
      ["Subject", `${r.subject.id}${r.subject.wallet ? ` · ${shortAddr(r.subject.wallet)}` : ""}`],
      ["Issued by", r.issuer],
    ];
    const proofs = r.promises.filter((p) => p.proof);
    const body = `<div class="label">// signed report · walrus</div>
<h1>${v.ok ? `<span class="ok">✓ Signature valid.</span>` : `<span class="bad">✗ Signature invalid.</span>`}</h1>
<p>${v.ok ? `Signed by Anchor's Sui key ${esc(shortAddr(v.signer!))}, stored on Walrus mainnet, fetched just now from a Walrus aggregator.` : esc(v.reason ?? "")}</p>
<div class="card">${summary.map(([k, val]) => `<div class="row"><span>${esc(k!)}</span><span>${esc(val!)}</span></div>`).join("")}</div>
${proofs.length ? `<div class="card">${proofs.map((p) => `<div class="row"><span>${esc(p.status)}</span><span><a href="${explorerTx(p.proof!)}">${esc(p.proof!.slice(0, 16))}…</a></span></div>`).join("")}</div>` : ""}
${walrusCard}
<p class="muted">Verify it yourself: take <code>report</code>, serialise it with sorted keys, and check <code>signature</code> as a Sui personal-message signature by <code>report.issuer</code>. ${r.subject.wallet ? `<a href="${explorerAddr(r.subject.wallet)}">Subject wallet on Suiscan</a>.` : ""}</p>
<pre>${esc(JSON.stringify(signed, null, 2))}</pre>`;
    return c.html(shell("Signed report · Anchor", body));
  });

}
