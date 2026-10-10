// Hero animé de la vitrine. Trois variantes à comparer : ?hero=a (ticker géant), b (tweet → token), c (éventail de cartes).
document.addEventListener("DOMContentLoaded", () => {
  const { api, fmt } = XL;
  const hv = document.getElementById("hv");
  const variant = ["a", "b", "c"].includes(new URLSearchParams(location.search).get("hero")) ? new URLSearchParams(location.search).get("hero") : "a";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const media = (t) => (t.image ? `<img src="${fmt.esc(t.image)}" alt="" loading="lazy">` : XL.art(t));
  const X_PATH = `<svg class="tw-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
  let tokens = [];
  const fresh = new Set();

  async function load() {
    try {
      const rows = await api("/api/tokens?sort=new&limit=12");
      const known = new Set(tokens.map((t) => t.token));
      if (tokens.length) rows.forEach((t) => { if (!known.has(t.token)) fresh.add(t.token); });
      tokens = rows;
      return true;
    } catch { return false; }
  }
  const sub = (t) => `<span>${fmt.esc(t.name)} by @${fmt.esc(t.creator)}</span><span><strong>${fmt.usd(t.mcapUsd)}</strong> ${fmt.pct(t.change24h)}</span><span class="likes">♥ ${fmt.count(t.likes)}</span>`;

  // ============================================================ A. le ticker géant
  function heroA() {
    document.querySelector(".l-hero").classList.add("is-a");
    hv.innerHTML = `<div class="tk" id="tk">
        <div class="tk-bars" id="tkBars"></div>
        <div class="tk-line" id="tkLine" role="link" tabindex="0" aria-label="Open token"></div>
        <div class="tk-meta" id="tkMeta"></div>
      </div><span class="tk-measure" id="tkMeasure" aria-hidden="true"></span>`;
    const line = document.getElementById("tkLine"), meas = document.getElementById("tkMeasure"), tk = document.getElementById("tk");
    const DUR = 3600, CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let idx = 0, current = "", timer = null, paused = false, startedAt = 0, left = DUR;
    const widthOf = (ch) => { if (!ch) return 0; meas.textContent = ch; return meas.getBoundingClientRect().width; };

    function roll(text) {
      const from = [...current], to = [...text];
      const n = Math.max(from.length, to.length);
      while (line.children.length < n) line.insertAdjacentHTML("beforeend", `<span class="tk-cell" style="width:0"><span class="tk-reel"><span></span></span></span>`);
      [...line.children].forEach((cell, i) => {
        const a = from[i] ?? "", b = to[i] ?? "";
        cell.classList.toggle("dollar", b === "$");
        const reel = cell.firstElementChild;
        if (reduce || a === b) {
          reel.style.transition = "none"; reel.style.transform = "none";
          reel.innerHTML = `<span>${fmt.esc(b || " ")}</span>`;
          cell.style.width = widthOf(b) + "px";
          return;
        }
        // un rouleau : l'ancienne lettre, quelques lettres au hasard, puis la nouvelle
        const spin = b === "$" || a === "$" ? 2 : 5 + i;
        const seq = [a || " ", ...Array.from({ length: spin }, () => CHARS[Math.floor(Math.random() * CHARS.length)]), b || " "];
        reel.style.transition = "none"; reel.style.transform = "translateY(0)";
        reel.innerHTML = seq.map((c) => `<span>${fmt.esc(c)}</span>`).join("");
        void reel.offsetHeight;
        reel.style.transition = `transform ${0.55 + i * 0.07}s cubic-bezier(.2,.9,.25,1) ${i * 0.03}s`;
        reel.style.transform = `translateY(-${seq.length - 1}em)`;
        cell.style.width = Math.max(widthOf(a), widthOf(b)) + "px";
        setTimeout(() => { cell.style.width = widthOf(b) + "px"; }, 300 + i * 70);
      });
      current = text;
      // nettoyage une fois les rouleaux arrêtés
      setTimeout(() => {
        [...line.children].forEach((cell, i) => {
          const b = to[i];
          if (b === undefined) { cell.remove(); return; }
          const reel = cell.firstElementChild;
          reel.style.transition = "none"; reel.style.transform = "none"; reel.innerHTML = `<span>${fmt.esc(b)}</span>`;
        });
      }, 1600);
    }

    function show(i) {
      if (!tokens.length) { roll("$YOURS"); document.getElementById("tkMeta").innerHTML = `<span>No token yet. Launch the first one.</span><a href="/app#compose">Launch a token</a>`; return; }
      idx = ((i % tokens.length) + tokens.length) % tokens.length;
      const t = tokens[idx];
      roll("$" + t.symbol.slice(0, 10));
      line.onclick = () => (location.href = "/t/" + t.token);
      line.onkeydown = (e) => { if (e.key === "Enter") location.href = "/t/" + t.token; };
      document.getElementById("tkMeta").innerHTML = `${sub(t).replace('class="likes"', 'class="tk-likes"')}${fresh.has(t.token) ? `<span class="p-new">Just launched</span>` : ""}<a href="/t/${fmt.esc(t.token)}">View token</a>`;
      const bars = document.getElementById("tkBars");
      bars.style.setProperty("--dur", DUR / 1000 + "s");
      bars.innerHTML = tokens.map((_, j) => `<span class="${j < idx ? "done" : j === idx ? "on" : ""}"><i></i></span>`).join("");
      startedAt = performance.now(); left = DUR;
      clearTimeout(timer);
      if (!reduce) timer = setTimeout(() => show(idx + 1), DUR);
    }
    // on s'arrête pour lire au survol, comme les stories
    tk.addEventListener("pointerenter", () => { paused = true; tk.classList.add("paused"); clearTimeout(timer); left = Math.max(400, left - (performance.now() - startedAt)); });
    tk.addEventListener("pointerleave", () => { paused = false; tk.classList.remove("paused"); startedAt = performance.now(); if (!reduce) timer = setTimeout(() => show(idx + 1), left); });
    load().then(() => show(0));
    setInterval(async () => { if (document.hidden) return; const n = tokens.length; await load(); if (tokens.length !== n && !paused) show(0); }, 10000);
  }

  // ============================================================ B. le tweet qui devient token
  function heroB() {
    hv.innerHTML = `<div class="tw-stage"><article class="tw" id="tw">
        <header class="tw-head"><span class="tw-av" id="twAv"></span><div class="tw-who"><b id="twName"></b><span id="twHandle"></span></div>${X_PATH}</header>
        <p class="tw-text"><span id="twTyped"></span><span class="tw-caret"></span></p>
        <a class="tw-card" id="twCard"><span class="tw-cover" id="twCover"></span>
          <span class="tw-body"><b id="twSym"></b><span class="tw-name" id="twTokName"></span>
            <span class="tw-price"><strong id="twMcap"></strong><span id="twChg"></span></span>
            <span class="tw-spark" id="twSpark"></span></span></a>
        <footer class="tw-acts">
          <span><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/></svg><b id="twCom">0</b></span>
          <span><svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg><b id="twTrades">0</b></span>
          <span class="tw-like"><svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.7 1.2 5.2 3 1.5-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg><b id="twLikes">0</b></span>
        </footer>
      </article></div>`;
    const $ = (id) => document.getElementById(id);
    const tw = $("tw");
    let idx = 0, run = 0;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const countUp = (el, to, ms, f) => new Promise((res) => {
      if (reduce) { el.textContent = f(to); return res(); }
      const t0 = performance.now(), from = 0;
      const tick = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(from + (to - from) * e); k < 1 ? requestAnimationFrame(tick) : res(); };
      requestAnimationFrame(tick);
    });

    async function play(t, my) {
      tw.classList.remove("typed", "carded", "out");
      tw.classList.add("in"); void tw.offsetWidth; tw.classList.remove("in");
      $("twAv").innerHTML = t.creatorAvatar ? `<img src="${fmt.esc(t.creatorAvatar)}" alt="" referrerpolicy="no-referrer">` : fmt.esc(t.creator[0].toUpperCase());
      $("twName").textContent = t.creator; $("twHandle").textContent = `@${t.creator} · now`;
      $("twCard").href = "/t/" + t.token;
      $("twCover").innerHTML = media(t);
      $("twSym").textContent = "$" + t.symbol; $("twTokName").textContent = t.name;
      $("twChg").innerHTML = fmt.pct(t.change24h);
      $("twSpark").innerHTML = XL.spark(t.spark);
      $("twLikes").textContent = "0"; $("twCom").textContent = "0"; $("twTrades").textContent = "0"; $("twMcap").textContent = "$10K";
      const text = `$${t.symbol} is live on Base 🔵${t.description ? "\n" + t.description : ""}`;
      const typed = $("twTyped");
      const paint = (s) => { typed.innerHTML = fmt.esc(s).replace(/\$[A-Z0-9]+/g, (m) => `<span class="cash">${m}</span>`); };
      if (reduce) paint(text);
      else for (let i = 1; i <= text.length; i++) { if (my !== run) return; paint(text.slice(0, i)); await wait(i < 8 ? 55 : 24); }
      tw.classList.add("typed");
      await wait(250); if (my !== run) return;
      tw.classList.add("carded");
      await wait(250);
      await Promise.all([
        countUp($("twMcap"), t.mcapUsd, 1400, fmt.usd),
        countUp($("twLikes"), t.likes, 1600, (v) => fmt.count(Math.round(v))),
        countUp($("twTrades"), t.trades, 1500, (v) => fmt.count(Math.round(v))),
        countUp($("twCom"), t.comments ?? 0, 1200, (v) => fmt.count(Math.round(v))),
      ]);
      await wait(2600); if (my !== run) return;
      tw.classList.add("out");
      await wait(500);
    }
    async function loop() {
      const my = ++run;
      while (my === run) {
        if (!tokens.length) { await wait(3000); continue; }
        const nextFresh = tokens.findIndex((t) => fresh.has(t.token));
        if (nextFresh >= 0) { idx = nextFresh; fresh.delete(tokens[idx].token); }
        await play(tokens[idx % tokens.length], my);
        if (reduce) return;
        idx = (idx + 1) % tokens.length;
      }
    }
    load().then(loop);
    setInterval(() => { if (!document.hidden) load(); }, 10000);
  }

  // ============================================================ C. l'éventail de cartes
  function heroC() {
    hv.innerHTML = `<div class="fan-stage" id="fan"><div class="fan-info" id="fanInfo"></div></div>`;
    const fan = document.getElementById("fan");
    let cards = [], timer = null, hover = false;
    const cardHtml = (t) => t.yours
      ? `<a class="fc yours" href="/app#compose"><span class="fc-cover">+</span><b>Your token</b><span class="fc-row"><span>Launch it from X</span></span></a>`
      : `<a class="fc" href="/t/${fmt.esc(t.token)}"><span class="fc-cover">${media(t)}</span><b>$${fmt.esc(t.symbol)}</b><span class="fc-row"><strong>${fmt.usd(t.mcapUsd)}</strong>${fmt.pct(t.change24h)}</span></a>`;

    function build() {
      fan.querySelectorAll(".fc").forEach((c) => c.remove());
      const list = [...tokens.slice(0, 6), { yours: true }];
      cards = list.map((t) => { fan.insertAdjacentHTML("afterbegin", cardHtml(t)); const el = fan.querySelector(".fc"); el._t = t; return el; });
      layout(false);
    }
    function layout(animate, wrapped) {
      const n = cards.length, fi = Math.floor(n / 2), step = Math.min(10, 46 / Math.max(1, fi)) * (hover ? 1.35 : 1);
      cards.forEach((el, j) => {
        const off = j - fi, front = j === fi; // l'éventail s'ouvre autour de la carte de devant
        el.classList.toggle("front", front);
        if (el === wrapped) { el.classList.add("wrap"); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("wrap"))); }
        el.style.zIndex = String(100 - Math.round(Math.abs(off) * 10));
        el.style.transform = `rotate(${(off * step).toFixed(2)}deg) translateY(${front ? -26 : Math.abs(off) * 4}px) scale(${front ? 1.06 : 1})`;
      });
      const t = cards[fi]?._t;
      const info = document.getElementById("fanInfo");
      info.innerHTML = !t ? "" : t.yours
        ? `<b>Your token, next in the deck</b><span class="p-sub"><span>Launch it from X and it gets dealt in here</span></span>`
        : `<b>$${fmt.esc(t.symbol)}${fresh.has(t.token) ? `<span class="p-new">Just launched</span>` : ""}</b><span class="p-sub">${sub(t)}</span>`;
    }
    function next() {
      // la carte la plus à gauche passe à droite : le paquet avance d'un cran
      const first = cards.shift(); cards.push(first);
      layout(true, first);
    }
    const schedule = () => { clearTimeout(timer); if (!reduce) timer = setTimeout(() => { if (!hover && !document.hidden) next(); schedule(); }, 3200); };
    fan.addEventListener("pointerenter", () => { hover = true; layout(true); });
    fan.addEventListener("pointerleave", () => { hover = false; layout(true); });
    load().then(() => { build(); schedule(); });
    setInterval(async () => { if (document.hidden) return; const sig = tokens.map((t) => t.token).join(); await load(); if (tokens.map((t) => t.token).join() !== sig) build(); }, 10000);
  }

  ({ a: heroA, b: heroB, c: heroC })[variant]();
});
