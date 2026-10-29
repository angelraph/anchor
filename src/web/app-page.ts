/**
 * HTML for the mini app and the public share card. The app renders every piece
 * of user text with textContent (never innerHTML), so nothing a person typed
 * can run as code.
 */
import { logoSvg } from "./logo.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const BASE_CSS = `
:root{--void:#000;--ink:#07080c;--line:#1b1c24;--bone:#fff;--ash:#9a9a9a;--mist:#c4c4c4;--iris:#8052ff;--saffron:#ffb829;--verdant:#2fd3b5;--rose:#ff6b6b;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
html,body{background:var(--void);color:var(--bone);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
`;

export function appPage(opts: { demo?: boolean } = {}): string {
  const demoBanner = opts.demo
    ? `<div class="demo">Demo with a sample person, Ada. Nothing here is real or saved. The live Anchor is <a href="https://t.me/Anchor_daBot">t.me/Anchor_daBot</a>.</div>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Anchor</title><link rel="icon" href="/logo.svg" type="image/svg+xml">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>${BASE_CSS}
main{max-width:560px;margin:0 auto;padding:18px 16px 60px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600}.brand svg{width:24px;height:24px}
.badge{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--verdant);border:1px solid #1f3b36;border-radius:999px;padding:4px 9px}
.card{background:var(--ink);border:1px solid var(--line);border-radius:20px;padding:18px;margin-bottom:14px}
.label{font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--saffron);margin-bottom:12px}
h1{font-size:26px;font-weight:500;letter-spacing:-.02em;line-height:1.15}
.muted{color:var(--ash);font-size:14px;line-height:1.5}
.hero{display:flex;gap:18px;align-items:center}
.ring{width:112px;height:112px;flex:none}
.ring text{font-family:inherit}
.stats{display:flex;gap:10px;margin-top:14px}
.stat{flex:1;background:#0d0e14;border:1px solid var(--line);border-radius:14px;padding:10px 12px}
.stat b{display:block;font-size:20px;font-weight:600}.stat span{font-size:12px;color:var(--ash)}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.cal div{aspect-ratio:1;border-radius:6px;background:#12131a}
.cal .k{background:var(--verdant)}.cal .m{background:var(--rose)}.cal .x{background:var(--saffron)}.cal .t{outline:2px solid var(--iris);outline-offset:1px}
.dow{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:5px;font-size:10px;color:var(--ash);text-align:center;font-family:var(--mono)}
.bars{display:flex;align-items:flex-end;gap:8px;height:90px;margin-top:6px}
.bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;gap:2px;border-bottom:2px solid #1a1b23}
.bar i{display:block;border-radius:5px 5px 2px 2px;background:var(--rose)}
.bar i.kept{background:var(--verdant)}
.bar small{font-size:9px;color:var(--ash);text-align:center;font-family:var(--mono)}
ul.list{list-style:none;display:grid;gap:8px}
ul.list li{display:flex;justify-content:space-between;gap:12px;padding:11px 12px;background:#0d0e14;border:1px solid var(--line);border-radius:12px;font-size:15px;line-height:1.35}
.chip{flex:none;font-family:var(--mono);font-size:11px;color:var(--ash);align-self:center}
.chip.due{color:var(--saffron)}.chip.over{color:var(--rose)}
.pill{display:inline-block;font-size:13px;line-height:1.4;padding:8px 11px;border-radius:12px;margin:0 6px 8px 0;background:#0d0e14;border:1px solid var(--line)}
.pill.win{border-color:#1f3b36}.pill.pat{border-color:#3b2a1a}
.habit{padding:12px;background:#0d0e14;border:1px solid var(--line);border-radius:12px;margin-bottom:8px}
.habit .top{display:flex;justify-content:space-between;font-size:15px;margin-bottom:8px}
.dots{display:flex;gap:3px;flex-wrap:wrap}.dots i{width:9px;height:9px;border-radius:3px;background:#1a1b23}.dots i.on{background:var(--verdant)}
.switch{display:flex;background:#0d0e14;border:1px solid var(--line);border-radius:999px;padding:4px;margin:12px 0}
.switch button{flex:1;border:0;background:none;color:var(--ash);padding:9px;border-radius:999px;font-size:14px;font-weight:600}
.switch button.on{background:var(--iris);color:#fff}
.switch button.off.on{background:#2a2b33}
.qbox{position:relative;margin-top:12px}.qbox input{padding-right:44px}
.qclear{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px;border:0;border-radius:999px;background:#1a1b23;color:var(--mist);font-size:14px}
.anslabel{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ash);margin:0 0 8px;min-height:14px}
.anslabel.on{color:var(--verdant)}
.answer{min-height:70px;font-size:15px;line-height:1.5;color:var(--mist);padding:12px;border-radius:12px;background:#0d0e14;border:1px solid var(--line);transition:opacity .2s}
input,textarea{width:100%;background:#0d0e14;border:1px solid var(--line);color:var(--bone);border-radius:12px;padding:12px;font-size:15px;font-family:inherit}
input:focus,textarea:focus{outline:none;border-color:var(--iris)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:12px;padding:12px 16px;font-size:15px;font-weight:600;background:var(--iris);color:#fff;cursor:pointer;width:100%;margin-top:10px}
.btn.ghost{background:#15161d;color:var(--mist);border:1px solid var(--line)}
.btn:disabled{opacity:.5}
.row{display:flex;gap:10px}.row>*{flex:1}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.gallery figure{background:#0d0e14;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.gallery img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#12131a}
.gallery figcaption{font-size:11px;color:var(--ash);padding:6px 8px;line-height:1.3}
.toggle{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:15px}
.toggle input{width:auto;accent-color:var(--iris);transform:scale(1.3)}
.empty{color:var(--ash);font-size:14px}
.err{color:var(--rose);font-size:14px;margin-top:8px}.ok{color:var(--verdant);font-size:14px;margin-top:8px}
#gate{display:none;text-align:center;padding:80px 16px}
.demo{font-size:13px;line-height:1.45;color:var(--saffron);border:1px solid #3b2a1a;background:#140f06;border-radius:14px;padding:10px 12px;margin-bottom:14px}.demo a{color:var(--saffron)}
.skeleton{height:110px;border-radius:20px;background:linear-gradient(90deg,#0b0c11,#13141b,#0b0c11);background-size:200% 100%;animation:sh 1.2s infinite;margin-bottom:14px}
@keyframes sh{to{background-position:-200% 0}}
</style></head>
<body data-demo="${opts.demo ? "1" : ""}"><main>
<header><div class="brand">${logoSvg(24)}<span>Anchor</span></div><span class="badge" id="memBadge">Walrus Memory</span></header>
${demoBanner}
<div id="gate"><h1>Open Anchor inside Telegram</h1><p class="muted" style="margin-top:12px">This dashboard opens from the bot: <a style="color:var(--saffron)" href="https://t.me/Anchor_daBot">t.me/Anchor_daBot</a>, then tap the Anchor button.</p></div>
<div id="loading"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
<div id="app" hidden>
  <section class="card"><div class="hero"><svg class="ring" viewBox="0 0 120 120" id="ring"></svg><div><div class="label">last 30 days</div><h1 id="heroLine"></h1><p class="muted" id="heroSub"></p></div></div>
    <div class="stats"><div class="stat"><b id="sOpen">0</b><span>open now</span></div><div class="stat"><b id="sStreak">0</b><span>in a row 🔥</span></div><div class="stat"><b id="sWeek">0</b><span>kept this week</span></div></div>
    <button class="btn ghost" id="shareBtn">Share my follow-through</button></section>
  <section class="card"><div class="label">your last 5 weeks</div><div class="dow"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="cal" id="cal"></div>
    <p class="muted" style="margin-top:10px;font-size:12px">🟩 kept · 🟥 missed · 🟨 both</p></section>
  <section class="card"><div class="label">open promises</div><ul class="list" id="open"></ul></section>
  <section class="card" id="habitsCard"><div class="label">habits & streaks</div><div id="habits"></div></section>
  <section class="card"><div class="label">what I've learned about you</div><div id="learned"></div></section>
  <section class="card"><div class="label">the memory switch</div><p class="muted">Ask anything. You'll see a stranger's answer first, then it flips to mine, the one that remembers you. Tap either side to compare. Just a preview: nothing here is saved.</p>
    <div class="qbox"><input id="q" maxlength="300" enterkeyhint="send" placeholder="Should I start running too?"><button id="qClear" class="qclear" aria-label="Clear the question" hidden>✕</button></div>
    <button class="btn" id="ask">Ask both ways</button>
    <div class="switch"><button class="off" id="swOff">Memory OFF</button><button id="swOn" class="on">Memory ON ⚓</button></div>
    <div class="anslabel" id="ansLabel"></div>
    <div class="answer" id="answer"><span class="empty">Your answer appears here.</span></div></section>
  <section class="card"><div class="label">weekly follow-through</div><div class="bars" id="bars"></div></section>
  <section class="card" id="proofCard"><div class="label">photo proof · encrypted on walrus</div><div class="gallery" id="gallery"></div></section>
  <section class="card"><div class="label">finished</div><ul class="list" id="done"></ul></section>
  <section class="card" id="memory"><div class="label">own your memory</div><p class="muted" id="ownStatus"></p>
    <div id="ownForm"><input id="acct" placeholder="Walrus Memory account ID (0x…)" autocomplete="off" style="margin-top:12px"><input id="key" placeholder="Delegate private key" type="password" autocomplete="off" style="margin-top:8px">
    <button class="btn" id="connect">Move my memory to my account</button><p class="muted" style="font-size:12px;margin-top:8px">Create a delegate key at memory.walrus.xyz. The key is sent over HTTPS, stored encrypted, and you can revoke it there any time.</p></div>
    <button class="btn ghost" id="disconnect" hidden>Switch back to Anchor's account</button><div id="ownMsg"></div></section>
  <section class="card"><div class="label">settings</div>
    <label class="toggle"><span>☀️ Morning brief at 08:00</span><input type="checkbox" id="morning"></label>
    <p class="muted" style="margin-top:12px" id="meta"></p>
    <button class="btn ghost" id="stopShare" hidden>Stop sharing my card</button></section>
</div>
</main>
<script>
(() => {
  const demo = document.body.dataset.demo === "1";
  // Outside Telegram (the demo), a stand-in for the few Telegram calls the app makes.
  const tg = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? window.Telegram.WebApp
    : demo ? { initData: "", ready() {}, expand() {}, showAlert: (m) => alert(m), openTelegramLink: (u) => window.open(u, "_blank", "noopener") } : null;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const haptic = () => { try { tg.HapticFeedback.impactOccurred("light"); } catch {} };
  if (!tg) { $("loading").hidden = true; $("gate").style.display = "block"; return; }
  tg.ready(); tg.expand(); try { tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); } catch {}
  const api = async (path, opts = {}) => {
    const res = await fetch(path, { ...opts, headers: { "x-telegram-init-data": tg.initData, ...(opts.body ? { "content-type": "application/json" } : {}) } });
    if (!res.ok) { let m = "Something went wrong."; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res;
  };
  let data;
  const fmtDue = (d, at, today) => { if (!d) return ["no deadline", ""]; const cls = d < today ? "over" : d === today ? "due" : ""; const label = d === today ? "today" : d < today ? "overdue" : d; return [label + (at ? " " + at : ""), cls]; };

  function ring(kept, closed) {
    const pct = closed ? Math.round((kept / closed) * 100) : 0, r = 50, c = 2 * Math.PI * r;
    $("ring").innerHTML = '<circle cx="60" cy="60" r="50" fill="none" stroke="#15161d" stroke-width="12"/>' +
      '<circle cx="60" cy="60" r="50" fill="none" stroke="#2fd3b5" stroke-width="12" stroke-linecap="round" transform="rotate(-90 60 60)" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '" id="arc" style="transition:stroke-dashoffset 1s ease"/>' +
      '<text x="60" y="66" text-anchor="middle" font-size="26" font-weight="600" fill="#fff">' + (closed ? pct + "%" : "–") + "</text>";
    requestAnimationFrame(() => { $("arc").style.strokeDashoffset = String(c * (1 - (closed ? kept / closed : 0))); });
  }

  function render(d) {
    data = d;
    $("memBadge").textContent = d.ownMemory ? "Your own Walrus Memory" : "Walrus Memory";
    const s = d.summary;
    ring(s.kept30, s.closed30);
    $("heroLine").textContent = s.closed30 ? "Kept " + s.kept30 + " of " + s.closed30 : "Hi " + (d.name || "there");
    $("heroSub").textContent = s.closed30 ? (s.kept30 === s.closed30 ? "Every single one. Keep going." : "promises in the last 30 days. Every one counts.") : "Make a promise in the chat and it shows up here.";
    $("sOpen").textContent = d.open.length; $("sStreak").textContent = d.bestStreak;
    $("sWeek").textContent = (s.weeks[s.weeks.length - 1] || { kept: 0 }).kept;

    const cal = $("cal"); cal.replaceChildren();
    const today = new Date(d.today + "T12:00:00Z"); const dow = (today.getUTCDay() + 6) % 7;
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - dow - 28);
    for (let i = 0; i < 35; i++) { const day = new Date(start); day.setUTCDate(start.getUTCDate() + i); const iso = day.toISOString().slice(0, 10); const o = s.days[iso];
      const c = el("div", o ? (o.kept && o.missed ? "x" : o.missed ? "m" : "k") : ""); if (iso === d.today) c.classList.add("t"); if (iso > d.today) c.style.opacity = ".25"; c.title = iso; cal.appendChild(c); }

    const open = $("open"); open.replaceChildren();
    if (!d.open.length) open.appendChild(el("li", "empty", "Nothing open. Tell me what you'll do next, and by when."));
    for (const p of d.open) { const li = el("li"); li.appendChild(el("span", "", p.text)); const [t, cls] = fmtDue(p.due, p.at, d.today); li.appendChild(el("span", "chip " + cls, t)); open.appendChild(li); }

    const hb = $("habits"); hb.replaceChildren(); $("habitsCard").hidden = !d.habits.length;
    for (const h of d.habits) { const box = el("div", "habit"); const top = el("div", "top"); top.appendChild(el("span", "", h.text)); top.appendChild(el("span", "chip", h.progress + (h.best > h.streak ? " · best " + h.best : "")));
      box.appendChild(top); const dots = el("div", "dots"); for (let i = 34; i >= 0; i--) { const day = new Date(today); day.setUTCDate(today.getUTCDate() - i); const on = h.done.includes(day.toISOString().slice(0, 10)); dots.appendChild(el("i", on ? "on" : "")); }
      box.appendChild(dots); box.appendChild(el("p", "muted", h.times + "× a " + h.per)); hb.appendChild(box); }

    const ln = $("learned"); ln.replaceChildren();
    if (!d.learned.wins.length && !d.learned.patterns.length) ln.appendChild(el("p", "empty", "After a few promises I'll start noticing what helps you and what gets in the way."));
    for (const w of d.learned.wins) ln.appendChild(el("span", "pill win", "🏆 " + w));
    for (const p of d.learned.patterns) ln.appendChild(el("span", "pill pat", "🔁 " + p));

    const bars = $("bars"); bars.replaceChildren(); const max = Math.max(1, ...s.weeks.map((w) => w.closed));
    for (const w of s.weeks) { const b = el("div", "bar"); const total = el("i"); total.style.height = (w.closed - w.kept) / max * 72 + "px"; const kept = el("i", "kept"); kept.style.height = w.kept / max * 72 + "px";
      b.appendChild(total); b.appendChild(kept); b.appendChild(el("small", "", w.week.slice(5))); b.title = w.kept + "/" + w.closed; bars.appendChild(b); }

    const g = $("gallery"); g.replaceChildren(); $("proofCard").hidden = !d.proofs.length;
    for (const p of d.proofs) { const f = el("figure"); const img = el("img"); img.alt = p.description; f.appendChild(img); f.appendChild(el("figcaption", "", p.description)); g.appendChild(f);
      if (p.stored) api("/api/app/proof/" + encodeURIComponent(p.id)).then((r) => r.blob()).then((b) => { img.src = URL.createObjectURL(b); }).catch(() => { img.replaceWith(el("figcaption", "", "Still saving on Walrus…")); }); }

    const done = $("done"); done.replaceChildren(); const icon = { kept: "✅", partial: "🟡", broken: "❌" };
    if (!d.done.length) done.appendChild(el("li", "empty", "Kept and missed promises show up here."));
    for (const p of d.done) { const li = el("li"); li.appendChild(el("span", "", (icon[p.status] || "•") + " " + p.text)); li.appendChild(el("span", "chip", (p.chain ? "⛓ " : "") + (p.pic ? "📸 " : "") + (p.date || ""))); done.appendChild(li); }

    $("ownStatus").textContent = d.ownMemory ? "Your memory lives in your own Walrus Memory account (" + d.ownMemory.account + ") since " + d.ownMemory.since + ". It's yours outright." : "Your memories are encrypted on Walrus in a space only you have, inside Anchor's account. Move them into your own Walrus Memory account and they're yours outright, usable by any app you trust.";
    $("ownForm").hidden = !!d.ownMemory; $("disconnect").hidden = !d.ownMemory;
    $("morning").checked = d.morning;
    $("meta").textContent = "Timezone: " + d.tzLabel + (d.wallet ? " · Wallet: " + d.wallet : "") + (d.buddies.length ? " · Buddies: " + d.buddies.join(", ") : "") + (d.groups.length ? " · Groups: " + d.groups.join(", ") : "");
    $("stopShare").hidden = !d.sharing;
    $("loading").hidden = true; $("app").hidden = false;
  }

  const load = () => api("/api/app/me").then((r) => r.json()).then(render).catch((e) => { $("loading").replaceChildren(el("p", "err", e.message)); });
  load();

  let answers = null, showOn = true, flip = 0;
  const show = () => { $("swOn").classList.toggle("on", showOn); $("swOff").classList.toggle("on", !showOn); if (!answers) return; const a = $("answer"); a.style.opacity = "0";
    $("ansLabel").textContent = showOn ? "With your memory ⚓ (" + answers.recalled + " memories recalled)" : "Without memory: a stranger answering";
    $("ansLabel").classList.toggle("on", showOn);
    setTimeout(() => { a.textContent = showOn ? answers.on : answers.off; a.style.opacity = "1"; }, 150); };
  $("swOn").onclick = () => { clearTimeout(flip); showOn = true; haptic(); show(); };
  $("swOff").onclick = () => { clearTimeout(flip); showOn = false; haptic(); show(); };
  const q = $("q"), qClear = $("qClear");
  const syncClear = () => { qClear.hidden = !q.value; };
  q.oninput = syncClear;
  q.onfocus = () => setTimeout(() => q.select(), 0); // typing replaces the last question
  qClear.onclick = () => { q.value = ""; syncClear(); q.focus(); };
  q.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); q.blur(); $("ask").click(); } };
  $("ask").onclick = async () => { const text = q.value.trim() || q.placeholder; $("ask").disabled = true; clearTimeout(flip); answers = null; $("ansLabel").textContent = ""; $("answer").textContent = "Thinking both ways…";
    try { answers = await (await api("/api/app/compare", { method: "POST", body: JSON.stringify({ q: text }) })).json(); showOn = false; show(); flip = setTimeout(() => { showOn = true; show(); haptic(); }, 3500); }
    catch (e) { $("answer").textContent = e.message; } finally { $("ask").disabled = false; } };

  $("connect").onclick = async () => { const msg = $("ownMsg"); msg.replaceChildren(el("p", "muted", "Checking your key and copying your memories…")); $("connect").disabled = true;
    try { const r = await (await api("/api/app/memory", { method: "POST", body: JSON.stringify({ accountId: $("acct").value, key: $("key").value }) })).json(); $("key").value = "";
      msg.replaceChildren(el("p", "ok", "Connected. " + (r.copied ? r.copied + " memories copied to your account." : ""))); load(); }
    catch (e) { msg.replaceChildren(el("p", "err", e.message)); } finally { $("connect").disabled = false; } };
  $("disconnect").onclick = async () => { await api("/api/app/memory", { method: "DELETE" }).catch(() => {}); load(); };
  $("morning").onchange = (e) => { api("/api/app/morning", { method: "POST", body: JSON.stringify({ on: e.target.checked }) }).catch(() => {}); };
  $("shareBtn").onclick = async () => { haptic(); try { const { url } = await (await api("/api/app/share", { method: "POST" })).json(); const s = data.summary;
      const text = s.closed30 ? "I kept " + s.kept30 + " of my last " + s.closed30 + " promises with Anchor ⚓ It remembers what I said I'd do, and holds me to it." : "I'm using Anchor ⚓ to finally keep my promises to myself.";
      tg.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text)); $("stopShare").hidden = false; } catch (e) { tg.showAlert(e.message); } };
  $("stopShare").onclick = async () => { await api("/api/app/share", { method: "DELETE" }).catch(() => {}); $("stopShare").hidden = true; };
  if (location.hash === "#memory") setTimeout(() => $("memory").scrollIntoView({ behavior: "smooth" }), 600);
})();
</script></body></html>`;
}

export interface CardData {
  name: string;
  kept: number;
  closed: number;
  streak: number;
  weeks: Array<{ week: string; kept: number; closed: number }>;
  bot: string;
}

export function cardPage(d: CardData | null): string {
  const title = d ? (d.closed ? `${d.name} kept ${d.kept} of ${d.closed} promises in the last 30 days ⚓` : `${d.name} is keeping their promises with Anchor ⚓`) : "Anchor ⚓ holds you to your word";
  const desc = "Anchor is a free Telegram bot that remembers what you said you'd do, checks in when it's due, and learns what helps you follow through.";
  const bot = d?.bot ?? "Anchor_daBot";
  const max = Math.max(1, ...(d?.weeks ?? []).map((w) => w.closed));
  const bars = (d?.weeks ?? [])
    // Only draw a part that has something in it: an empty "missed" part would show as a cap on the bar.
    .map(
      (w) =>
        `<div class="b">${w.closed > w.kept ? `<i class="m" style="height:${((w.closed - w.kept) / max) * 60}px"></i>` : ""}${w.kept ? `<i class="k" style="height:${(w.kept / max) * 60}px"></i>` : ""}</div>`,
    )
    .join("");
  const pct = d && d.closed ? Math.round((d.kept / d.closed) * 100) : null;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>${BASE_CSS}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.c{width:100%;max-width:420px;border-radius:28px;padding:28px;background:radial-gradient(120% 90% at 0% 0%,#1c1440 0%,#07080c 55%);border:1px solid #1f2030}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:28px}.brand svg{width:26px;height:26px}
.big{font-size:64px;font-weight:600;letter-spacing:-.04em;line-height:1}
h1{font-size:22px;font-weight:500;line-height:1.3;margin:14px 0 6px}
p{color:var(--ash);line-height:1.5;font-size:15px}
.bars{display:flex;align-items:flex-end;gap:6px;height:64px;margin:22px 0}
.b{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;height:100%;border-bottom:2px solid #1f2030}.b i{display:block;border-radius:4px}.b i.k{background:var(--verdant)}.b i.m{background:var(--rose)}
.cta{display:block;text-align:center;background:var(--iris);color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:14px;margin-top:22px}
.s{color:var(--saffron);font-family:var(--mono);font-size:13px;margin-top:8px}
</style></head><body><div class="c">
<div class="brand">${logoSvg(26)}<span>Anchor</span></div>
${d ? `<div class="big">${pct === null ? "⚓" : `${pct}%`}</div><h1>${esc(title)}</h1>${d.streak > 1 ? `<div class="s">🔥 ${d.streak} in a row</div>` : ""}<div class="bars">${bars}</div>` : `<h1>${esc(title)}</h1>`}
<p>${esc(desc)}</p>
<a class="cta" href="https://t.me/${esc(bot)}">Make a promise on Telegram</a>
</div></body></html>`;
}
