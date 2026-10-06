/**
 * Public landing + proof page.
 *
 * Visual language: a black void, one violet action, amber labels, oversized
 * weight-400 headlines over ultra-light body copy, and a particle
 * constellation that forms an anchor. Structure follows the commitment-
 * contract flow: promise → remembered → checked → learned.
 */

export interface ProofData {
  bot: string | null;
  model: string;
  totalUsers: number;
  totalMemories: number;
  usersWith10PlusMemories: number;
  users: Array<{ user: string; memories: number; lastActive: string }>;
  generatedAt: string;
  /** e.g. "19:00 (Africa/Lagos)" */
  checkinTime: string;
}

import { logoSvg } from "./logo.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const REPO = "https://github.com/angelraph/anchor";

function when(iso: string): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function renderPage(p: ProofData): string {
  const cta = p.bot ?? REPO;
  const ledger = p.users.length
    ? p.users
        .map(
          (u) => `<li><span class="id">${esc(u.user)}</span><span class="bar"><i style="width:${Math.min(100, (u.memories / Math.max(10, ...p.users.map((x) => x.memories))) * 100).toFixed(1)}%"></i></span><span class="n">${u.memories}</span><span class="t">${esc(when(u.lastActive))}</span></li>`,
        )
        .join("")
    : `<li class="empty">No one yet, be the first to make a promise.</li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anchor, keep your word</title>
<meta name="description" content="Anchor is a Telegram accountability partner that remembers your promises on Walrus Memory, checks in when they're due, and learns what makes you follow through.">
<meta property="og:title" content="Anchor, keep your word">
<meta property="og:description" content="The accountability bot that remembers. Long-term memory on Walrus.">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;400;600&display=swap" rel="stylesheet">
<style>
:root{
  --void:#000;--bone:#fff;--ash:#9a9a9a;--mist:#bdbdbd;
  --iris:#8052ff;--saffron:#ffb829;--verdant:#15846e;
  --font:'PPNeueMontreal','Inter',ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --max:1280px;--gutter:clamp(16px,4vw,48px);
}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--void);color-scheme:dark}
body{background:var(--void);color:var(--bone);font-family:var(--font);font-feature-settings:"ss01" on;font-size:18px;line-height:1.5;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.wrap{max-width:var(--max);margin:0 auto;padding:0 var(--gutter)}
#field{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
main,header,footer{position:relative;z-index:1}

/* nav */
header .wrap{display:flex;align-items:center;justify-content:space-between;height:84px}
.logo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:600;letter-spacing:-0.01em}
.logo svg{width:30px;height:30px}
nav{display:flex;align-items:center;gap:30px}
nav a.link{font-size:14px;font-weight:600;letter-spacing:.025em;text-transform:uppercase;color:var(--ash);transition:color .2s}
nav a.link:hover{color:var(--bone)}
.pill{display:inline-flex;align-items:center;gap:8px;background:var(--iris);color:var(--bone);font-size:14px;font-weight:600;letter-spacing:.025em;text-transform:uppercase;padding:14.4px 22px;border-radius:24px;transition:transform .2s,filter .2s}
.pill:hover{transform:translateY(-1px);filter:brightness(1.12)}
.ghost{font-size:14px;font-weight:400;color:var(--ash);border-bottom:1px solid transparent;transition:color .2s,border-color .2s}
.ghost:hover{color:var(--bone);border-color:var(--bone)}

/* type */
.label{display:block;font-size:14px;font-weight:600;letter-spacing:.025em;text-transform:uppercase;color:var(--saffron);margin-bottom:18px}
.display{font-size:clamp(56px,9.6vw,113px);font-weight:400;line-height:.95;letter-spacing:-0.04em}
.h-lg{font-size:clamp(42px,6.4vw,78px);font-weight:400;line-height:1.05;letter-spacing:-0.04em}
.h-sm{font-size:clamp(30px,3.6vw,42px);font-weight:400;line-height:1.15;letter-spacing:-0.04em}
.body{font-size:18px;font-weight:200;line-height:1.5;color:var(--bone);max-width:520px}
.muted{color:var(--mist)}
em.spark{font-style:normal;color:var(--saffron)}

/* layout */
section{padding:clamp(60px,10vw,120px) 0}
.split{display:grid;grid-template-columns:1.15fr 1fr;gap:clamp(36px,6vw,96px);align-items:center}
.split.flip > :first-child{order:2}
#how .split{align-items:start}
#how .split > :first-child{position:sticky;top:120px}
.hero{min-height:calc(100vh - 84px);display:flex;align-items:center;padding-top:24px}
.hero .body{margin:30px 0 36px}
.hero-actions{display:flex;align-items:center;gap:30px;flex-wrap:wrap}
.stage{aspect-ratio:1/1;width:100%}

/* stats */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(24px,4vw,60px);margin-top:60px}
.stat b{display:block;font-size:clamp(56px,8vw,96px);font-weight:400;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:12px;font-size:14px;font-weight:600;letter-spacing:.025em;text-transform:uppercase;color:var(--ash)}

/* steps */
.steps{list-style:none;counter-reset:s}
.steps li{display:grid;grid-template-columns:96px 1fr;gap:24px;padding:36px 0}
.steps li::before{counter-increment:s;content:"0" counter(s);font-size:42px;font-weight:400;letter-spacing:-0.04em;color:var(--iris);line-height:1}
.steps h3{font-size:clamp(24px,2.4vw,27px);font-weight:400;letter-spacing:-0.02em;margin-bottom:12px}
.steps p{font-weight:200;color:var(--mist);max-width:560px}

/* before/after */
.convo{display:flex;flex-direction:column;gap:24px}
.msg{font-size:18px;font-weight:200;line-height:1.5}
.msg small{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;color:var(--ash)}
.msg.you{color:var(--mist)}
.msg.without small{color:var(--ash)}
.msg.with small{color:var(--iris)}
.msg.with{color:var(--bone)}
.recall{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--saffron);font-weight:600}

/* ledger */
.ledger{list-style:none;margin-top:36px}
.ledger li{display:grid;grid-template-columns:130px 1fr 60px 110px;gap:18px;align-items:center;padding:14px 0;font-size:15px}
.ledger .id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mist);font-size:14px}
.ledger .bar{height:2px;background:#1a1a1a;border-radius:2px;overflow:hidden}
.ledger .bar i{display:block;height:100%;background:var(--iris)}
.ledger .n{text-align:right;font-variant-numeric:tabular-nums}
.ledger .t{color:var(--ash);font-size:14px;text-align:right}
.ledger .empty{display:block;color:var(--ash);font-weight:200}

/* commands */
.cmds{display:grid;grid-template-columns:repeat(2,1fr);gap:24px 60px;margin-top:36px}
.cmds div{font-weight:200;color:var(--mist)}
.cmds code{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;color:var(--saffron);margin-bottom:6px}

/* faq */
.faq{margin-top:36px;max-width:860px}
.faq details{padding:24px 0}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:baseline;gap:24px;font-size:clamp(20px,2.2vw,24px);font-weight:400;letter-spacing:-0.02em}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--iris);font-size:28px;line-height:1;transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq summary:focus-visible{outline:2px solid var(--iris);outline-offset:6px;border-radius:6px}
.faq p{margin-top:12px;font-weight:200;color:var(--mist);max-width:720px}
.faq a{color:var(--saffron)}

footer{padding:60px 0 48px}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;font-size:14px;color:var(--ash)}
footer a:hover{color:var(--bone)}

@media (max-width:900px){
  nav a.link{display:none}
  .split,.split.flip{grid-template-columns:1fr}
  .split.flip > :first-child{order:0}
  #how .split > :first-child{position:static}
  .hero{min-height:auto}
  .stage{max-width:440px;margin:0 auto}
  .stats{grid-template-columns:1fr}
  .steps li{grid-template-columns:60px 1fr;gap:12px}
  .steps li::before{font-size:30px}
  .cmds{grid-template-columns:1fr}
  .ledger li{grid-template-columns:100px 1fr 44px;font-size:14px}
  .ledger .t{display:none}
}
@media (prefers-reduced-motion:reduce){.pill,.ghost{transition:none}}
</style>
</head>
<body>
<canvas id="field" aria-hidden="true"></canvas>

<header>
  <div class="wrap">
    <a class="logo" href="/" aria-label="Anchor home">
      ${logoSvg(30, "navGrad")}
      Anchor
    </a>
    <nav>
      <a class="link" href="#how">How it works</a>
      <a class="link" href="#proof">Proof</a>
      <a class="link" href="#faq">FAQ</a>
      <a class="link" href="${REPO}">GitHub</a>
      <a class="pill" href="${esc(cta)}">Open in Telegram</a>
    </nav>
  </div>
</header>

<main>
  <section class="hero">
    <div class="wrap split">
      <div>
        <span class="label">Accountability, with memory</span>
        <h1 class="display">Keep your word.</h1>
        <p class="body">Tell Anchor what you'll do and by when. It remembers on Walrus, messages you first when it's due, and learns what actually makes <em class="spark">you</em> follow through, across days, weeks and devices.</p>
        <div class="hero-actions">
          <a class="pill" href="${esc(cta)}">Make a promise</a>
          <a class="ghost" href="#how">See how it works →</a>
        </div>
      </div>
      <canvas class="stage" id="anchor" aria-label="A constellation of particles forming an anchor"></canvas>
    </div>
  </section>

  <section id="proof">
    <div class="wrap">
      <span class="label">Live from Walrus Memory</span>
      <h2 class="h-lg">Real people. Real promises.</h2>
      <div class="stats">
        <div class="stat"><b data-count="${p.totalUsers}">${p.totalUsers}</b><span>People using Anchor</span></div>
        <div class="stat"><b data-count="${p.totalMemories}">${p.totalMemories}</b><span>Memories on Walrus</span></div>
        <div class="stat"><b data-count="${p.usersWith10PlusMemories}">${p.usersWith10PlusMemories}</b><span>People with 10+ memories</span></div>
      </div>
    </div>
  </section>

  <section id="how">
    <div class="wrap split flip">
      <div>
        <span class="label">How it works</span>
        <h2 class="h-lg">A promise is only as strong as its memory.</h2>
      </div>
      <ol class="steps">
        <li><div><h3>Make a promise</h3><p>"I'll send five job applications by Friday." Anchor turns intentions into a concrete promise with a real date.</p></div></li>
        <li><div><h3>It's remembered, for real</h3><p>The promise is encrypted and stored in your own Walrus Memory namespace. It survives restarts, devices and weeks of silence.</p></div></li>
        <li><div><h3>Anchor checks in first</h3><p>When it's due, Anchor messages you. Did it, partly, didn't, or move it: one tap records the outcome.</p></div></li>
        <li><div><h3>It learns what works for you</h3><p>Excuses become patterns. Wins become strategy. Next time, Anchor reminds you what actually worked.</p></div></li>
      </ol>
    </div>
  </section>

  <section>
    <div class="wrap split">
      <div>
        <span class="label">Before / after</span>
        <h2 class="h-lg">Same bot. One remembers.</h2>
        <p class="body muted" style="margin-top:24px">Both answers are real Gemini output for the same message, from a test conversation. Send <code style="color:var(--saffron)">/compare</code> to Anchor to see both answers side by side for your own life.</p>
      </div>
      <div class="convo">
        <p class="msg you"><small>You · a day later</small>What do you remember about me and my exam plan?</p>
        <p class="msg without"><small>Without memory</small>Right now, I don't have anything saved about you or your exam plan yet. Tell me what exam you are preparing for and what you need to get done.</p>
        <p class="msg with"><small>With Walrus Memory</small>I know you are a nursing student prepping for your pharmacology exam, and that you tend to procrastinate and get distracted by your phone when you try studying at home. You focus much better when you go to the library. As for your plan, you promised to revise two chapters of pharmacology by tomorrow evening, Wednesday, October 7th.</p>
        <span class="recall">⚓ 6 memories recalled</span>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <span class="label">Memory ledger</span>
      <h2 class="h-sm">Every person, their own encrypted namespace.</h2>
      <p class="body muted" style="margin-top:18px">Anonymised. Counts come straight from Walrus Memory, with no database of ours in between.</p>
      <ul class="ledger">${ledger}</ul>
    </div>
  </section>

  <section>
    <div class="wrap">
      <span class="label">Inside the chat</span>
      <h2 class="h-sm">Memory you can inspect.</h2>
      <div class="cmds">
        <div><code>/why</code>The exact memories behind the last reply, with Walrus blob IDs.</div>
        <div><code>/compare</code>Your message answered with and without memory.</div>
        <div><code>/promises</code>Open and kept promises, and your follow-through rate.</div>
        <div><code>/forget</code>Pick a memory and Anchor never uses it again.</div>
      </div>
    </div>
  </section>

  <section id="faq">
    <div class="wrap">
      <span class="label">FAQ</span>
      <h2 class="h-sm">Questions people ask first.</h2>
      <div class="faq">
        <details><summary>Do I need an account, a wallet or crypto?</summary><p>No. Open Anchor in Telegram and start talking. Your Telegram account is all it uses to know it's you.</p></details>
        <details><summary>Where is my memory stored, and who can read it?</summary><p>Each person gets their own namespace in Walrus Memory. Memories are encrypted before they are stored on Walrus, and recall never crosses from one person to another. Anchor's server holds the key it needs to read your memories back to you, so treat it like any app you chat with. This page only ever shows anonymised counts.</p></details>
        <details><summary>When does Anchor check in?</summary><p>Every evening at ${esc(p.checkinTime)}, about promises due that day or earlier. Tap Did it, Partly, Didn't or Move it, or just reply in your own words. You can also send /checkin any time.</p></details>
        <details><summary>What if I break a promise?</summary><p>Nothing bad happens. Anchor records it honestly, asks what got in the way, and uses that next time. Patterns and wins are the point: they are how it learns what actually works for you.</p></details>
        <details><summary>Can I make it forget something?</summary><p>Yes. Send /forget and a topic, pick the memory, and Anchor will never use it again. Walrus Memory is append-only, so the encrypted record isn't erased; Anchor stores a tombstone that hides it from every future recall.</p></details>
        <details><summary>How do I see what it remembers?</summary><p>/memory lists everything, grouped by type. /why shows the exact memories behind its last reply, with Walrus blob IDs. /compare answers your message with and without memory, side by side.</p></details>
        <details><summary>Which AI runs it?</summary><p>${esc(p.model)} through the Vercel AI SDK, with automatic fallback to other Gemini models when one is busy. Long-term memory is Walrus Memory on mainnet.</p></details>
        <details><summary>Is it free and open source?</summary><p>Free to use, and MIT-licensed. The code, setup guide and design notes are on <a href="${REPO}">GitHub</a>.</p></details>
      </div>
    </div>
  </section>

  <section>
    <div class="wrap split">
      <h2 class="display" style="font-size:clamp(48px,7vw,96px)">What will you hold yourself to?</h2>
      <div>
        <p class="body">No sign-up. Open Telegram, say what you'll do. Anchor takes it from there.</p>
        <div class="hero-actions" style="margin-top:30px"><a class="pill" href="${esc(cta)}">Make a promise</a></div>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <span>Built for Walrus Session 8 · ${esc(p.model)} · Walrus Memory mainnet</span>
    <span><a href="${REPO}">GitHub</a> · <a href="/proof.json">proof.json</a> · updated ${esc(when(p.generatedAt))}</span>
  </div>
</footer>

<script>
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLORS = ["#8052ff", "#ffb829", "#15846e", "#b16cff", "#4f7dff", "#ff5ca8", "#2fd3b5"];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function tri(ctx, x, y, s, rot, color, alpha) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.87, s * 0.5); ctx.lineTo(-s * 0.87, s * 0.5); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  // Sample points along an anchor silhouette drawn on an offscreen canvas.
  function anchorPoints(n) {
    const S = 400, c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineCap = "round"; g.lineWidth = 26;
    g.beginPath(); g.arc(200, 70, 32, 0, Math.PI * 2); g.stroke();             // ring
    g.beginPath(); g.moveTo(200, 102); g.lineTo(200, 345); g.stroke();          // shank
    g.beginPath(); g.moveTo(125, 150); g.lineTo(275, 150); g.stroke();          // stock
    g.beginPath(); g.arc(200, 225, 125, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); // arms
    g.lineWidth = 22;
    g.beginPath(); g.moveTo(101, 300); g.lineTo(78, 250); g.lineTo(130, 268); g.stroke(); // left fluke
    g.beginPath(); g.moveTo(299, 300); g.lineTo(322, 250); g.lineTo(270, 268); g.stroke(); // right fluke
    const d = g.getImageData(0, 0, S, S).data, pts = [];
    for (let i = 0; i < n * 40 && pts.length < n; i++) {
      const x = Math.random() * S | 0, y = Math.random() * S | 0;
      if (d[(y * S + x) * 4 + 3] > 128) pts.push([x / S, y / S]);
    }
    return pts;
  }

  // Hero constellation
  const stage = document.getElementById("anchor");
  if (stage) {
    const ctx = stage.getContext("2d");
    const targets = anchorPoints(900);
    const parts = targets.map(([tx, ty]) => ({ tx, ty, x: Math.random(), y: Math.random(), s: rnd(1.6, 4.2), r: rnd(0, 6.28), vr: rnd(-0.01, 0.01), c: COLORS[Math.random() * COLORS.length | 0], ph: rnd(0, 6.28) }));
    let w = 0, h = 0, dpr = 1, t0 = performance.now();
    const size = () => { dpr = Math.min(2, devicePixelRatio || 1); const r = stage.getBoundingClientRect(); w = r.width; h = r.height; stage.width = w * dpr; stage.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener("resize", size);
    const frame = (now) => {
      const t = (now - t0) / 1000, k = reduce ? 1 : Math.min(1, t / 2.2), e = 1 - Math.pow(1 - k, 3);
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        const wob = reduce ? 0 : Math.sin(t * 0.8 + p.ph) * 0.004;
        const x = (p.x + (p.tx - p.x) * e + wob) * w, y = (p.y + (p.ty - p.y) * e + Math.cos(t * 0.7 + p.ph) * 0.004 * (reduce ? 0 : 1)) * h;
        p.r += reduce ? 0 : p.vr;
        tri(ctx, x, y, p.s, p.r, p.c, 0.55 + 0.45 * Math.sin(t + p.ph) ** 2);
      }
      if (!reduce) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Ambient field
  const field = document.getElementById("field"), fx = field.getContext("2d");
  let fw = 0, fh = 0;
  const amb = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(1.5, 3.5), r: rnd(0, 6.28), v: rnd(0.002, 0.008), c: COLORS[Math.random() * COLORS.length | 0], a: rnd(0.12, 0.35) }));
  const fsize = () => { const d = Math.min(2, devicePixelRatio || 1); fw = innerWidth; fh = innerHeight; field.width = fw * d; field.height = fh * d; fx.setTransform(d, 0, 0, d, 0, 0); };
  fsize(); addEventListener("resize", fsize);
  const drift = () => {
    fx.clearRect(0, 0, fw, fh);
    for (const p of amb) { if (!reduce) { p.y -= p.v / 10; p.r += 0.003; if (p.y < -0.02) p.y = 1.02; } tri(fx, p.x * fw, p.y * fh, p.s, p.r, p.c, p.a); }
    if (!reduce) requestAnimationFrame(drift);
  };
  drift();

  // Count-up for live stats
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (!en.isIntersecting) return; io.unobserve(en.target);
      const el = en.target, end = +el.dataset.count, t0 = performance.now();
      const step = (n) => { const k = Math.min(1, (n - t0) / 1200); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }), { threshold: 0.4 });
    document.querySelectorAll("[data-count]").forEach((el) => io.observe(el));
  }
})();
</script>
</body>
</html>`;
}
