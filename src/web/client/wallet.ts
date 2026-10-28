/**
 * Browser side of the wallet pages (bundled by esbuild at server start).
 *
 *  /link/:token   prove a wallet is yours: sign a personal message (free, no transaction)
 *  /stake/:token  lock a stake in the escrow contract (build → wallet signs → Anchor checks and executes),
 *                 or pay it with x402: 402 → build → wallet signs → PAYMENT-SIGNATURE → settled on Sui
 *
 * Wallets are found through the Wallet Standard (Slush, Suiet, Phantom, …),
 * implemented here directly so the page needs no wallet SDK.
 */
import { Transaction } from "@mysten/sui/transactions";

interface WalletAccount {
  address: string;
  chains: readonly string[];
}
interface Wallet {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly WalletAccount[];
  features: Record<string, any>;
}

const CHAIN = "sui:mainnet";
const wallets: Wallet[] = [];

// Wallet Standard discovery: wallets register themselves on these events.
const register = (...ws: Wallet[]) => {
  for (const w of ws) if (!wallets.includes(w) && w.chains.some((c) => c.startsWith("sui:"))) wallets.push(w);
  render();
  return () => undefined;
};
window.addEventListener("wallet-standard:register-wallet", (e: any) => e.detail?.({ register }));
window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));

const $ = (id: string) => document.getElementById(id)!;
const mode = document.body.dataset.mode as "link" | "stake";
const token = document.body.dataset.token!;

function status(html: string, kind: "info" | "ok" | "err" = "info") {
  const el = $("status");
  el.className = `status ${kind}`;
  el.innerHTML = html;
}

const toB64Json = (v: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(v))));
const fromB64Json = (s: string) => JSON.parse(decodeURIComponent(escape(atob(s))));

function render() {
  const list = $("wallets");
  if (!wallets.length) {
    list.innerHTML = `<p class="muted">No Sui wallet found in this browser. Install <a href="https://slush.app" target="_blank" rel="noopener">Slush</a> (or any Sui wallet), then reload. On a phone, open this link inside your wallet app's browser.</p>`;
    return;
  }
  list.innerHTML = "";
  for (const w of wallets) {
    const b = document.createElement("button");
    b.className = "wallet";
    b.innerHTML = `<img src="${w.icon}" alt=""><span>${w.name}</span>`;
    b.onclick = () => void run(w).catch((e) => status(`Something went wrong: ${(e?.message ?? String(e)).slice(0, 200)}`, "err"));
    list.appendChild(b);
  }
}

async function connect(w: Wallet): Promise<WalletAccount> {
  const res = await w.features["standard:connect"].connect();
  const accounts: readonly WalletAccount[] = res?.accounts ?? w.accounts;
  const acc = accounts.find((a) => a.chains.includes(CHAIN)) ?? accounts[0];
  if (!acc) throw new Error("the wallet didn't share an account");
  return acc;
}

async function run(w: Wallet) {
  status(`Connecting to ${w.name}…`);
  const account = await connect(w);
  if (mode === "link") await link(w, account);
  else if ((document.getElementById("escrow") as HTMLInputElement | null)?.checked) await escrowStake(w, account);
  else await stake(w, account);
}

async function escrowStake(w: Wallet, account: WalletAccount) {
  // 1. The server builds create<T> for this wallet: your coins go into a shared Stake object.
  status("Preparing the escrow…");
  const built = await fetch(`/api/escrow/build/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sender: account.address }),
  }).then((r) => r.json());
  if (!built.transaction) throw new Error(built.error ?? "couldn't build the stake (enough stablecoin and a little SUI for gas?)");
  // 2. Your wallet signs it.
  status(`Approve the stake in ${w.name}. It goes into the escrow contract, not to Anchor.`);
  const sign = w.features["sui:signTransaction"];
  if (!sign) throw new Error(`${w.name} can't sign transactions`);
  const signed = await sign.signTransaction({ transaction: Transaction.from(built.transaction), account, chain: CHAIN });
  // 3. Anchor checks it locks exactly this stake, then executes it on Sui.
  status("Locking it on Sui…");
  const res = await fetch(`/api/escrow/lock/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: signed.bytes, signature: signed.signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `stake failed (${res.status})`);
  status(
    `🔒 Locked in escrow on Sui: <a href="https://suiscan.xyz/mainnet/tx/${body.digest}" target="_blank" rel="noopener">${String(body.digest).slice(0, 10)}…</a><br>Only the contract holds it now. Go back to Telegram.`,
    "ok",
  );
}

async function link(w: Wallet, account: WalletAccount) {
  const info = await fetch(`/api/link/${token}`).then((r) => r.json());
  if (!info.message) throw new Error(info.error ?? "this link expired, run /wallet again in Telegram");
  status("Sign the message in your wallet. It's free and doesn't send a transaction.");
  const sign = w.features["sui:signPersonalMessage"];
  if (!sign) throw new Error(`${w.name} can't sign messages`);
  const { signature } = await sign.signPersonalMessage({ message: new TextEncoder().encode(info.message), account, chain: CHAIN });
  const res = await fetch(`/api/link/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address, signature }),
  }).then((r) => r.json());
  if (!res.ok) throw new Error(res.error ?? "verification failed");
  status(`✅ Verified. ${account.address.slice(0, 8)}… is linked to your Anchor. You can close this page and go back to Telegram.`, "ok");
}

async function stake(w: Wallet, account: WalletAccount) {
  const url = `/x402/stake/${token}`;
  // 1. Ask for the resource: the server answers 402 with what it accepts.
  const first = await fetch(url, { method: "POST" });
  if (first.status !== 402) {
    const body = await first.json().catch(() => ({}));
    throw new Error(body.error ?? `unexpected ${first.status}`);
  }
  const required = fromB64Json(first.headers.get("PAYMENT-REQUIRED")!);
  const accepted = required.accepts[0];
  // 2. Build the transfer for this wallet (the server reads your coins on Sui through Tatum).
  status("Preparing the payment…");
  const built = await fetch("/api/x402/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sender: account.address, accepted }),
  }).then((r) => r.json());
  if (!built.transaction) throw new Error(built.error ?? "couldn't build the payment (enough stablecoin and a little SUI for gas?)");
  // 3. Your wallet signs it. Nothing is sent until Anchor verifies and settles it.
  const symbol = String(accepted.asset).split("::").pop() === "USDSUI" ? "USDsui" : "USDC";
  status(`Approve ${Number(accepted.amount) / 1e6} ${symbol} in ${w.name}…`);
  const sign = w.features["sui:signTransaction"];
  if (!sign) throw new Error(`${w.name} can't sign transactions`);
  const signed = await sign.signTransaction({ transaction: Transaction.from(built.transaction), account, chain: CHAIN });
  // 4. Retry with PAYMENT-SIGNATURE: verified (simulated) and settled on Sui by Anchor.
  status("Verifying and settling on Sui…");
  const payload = { x402Version: 2, resource: required.resource, accepted, payload: { signature: signed.signature, transaction: signed.bytes } };
  const paid = await fetch(url, { method: "POST", headers: { "PAYMENT-SIGNATURE": toB64Json(payload) } });
  const body = await paid.json().catch(() => ({}));
  if (!paid.ok) throw new Error(body.error ?? `payment failed (${paid.status})`);
  const receipt = paid.headers.get("PAYMENT-RESPONSE") ? fromB64Json(paid.headers.get("PAYMENT-RESPONSE")!) : body.payment;
  status(
    `🔒 Staked. Settled on Sui: <a href="https://suiscan.xyz/mainnet/tx/${receipt.transaction}" target="_blank" rel="noopener">${receipt.transaction.slice(0, 10)}…</a><br>Go back to Telegram, Anchor has it from here.`,
    "ok",
  );
}

render();
setTimeout(render, 600); // late-registering extensions
