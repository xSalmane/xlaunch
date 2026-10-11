// Hero animé de la vitrine. Par défaut la rampe de lancement (d) ; ?hero=a (ticker géant), b (tweet → token), c (éventail de cartes) restent consultables.
document.addEventListener("DOMContentLoaded", () => {
  const { api, fmt } = XL;
  const hv = document.getElementById("hv");
  const asked = new URLSearchParams(location.search).get("hero");
  const variant = ["a", "b", "c", "d"].includes(asked) ? asked : "d";
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


  // ============================================================ D. la rampe de lancement
  // Le post part, la pièce du token décolle et sa trajectoire est son vrai graphique de prix.
  // Chaque vol laisse sa traînée : le panneau devient la carte du ciel de tous les lancements.
  function heroD() {
    document.querySelector(".l-hero").classList.add("is-d");
    hv.innerHTML = `<div class="ln" id="ln">
        <svg class="ln-sky" id="lnSky" aria-hidden="true"><g class="ln-grid" id="lnGrid"></g><g id="lnOld"></g><path class="ln-glow" id="lnGlow"/><path class="ln-cur" id="lnCur"/><g id="lnFx"></g></svg>
        <div class="ln-count" id="lnCount"></div>
        <div class="ln-coin" id="lnCoin" aria-hidden="true"></div>
        <a class="ln-pin" id="lnPin"></a>
        <article class="ln-tw" id="lnTw">
          <header class="ln-tw-head"><span class="ln-av" id="lnAv"></span><div class="ln-who"><b id="lnName"></b><span id="lnHandle"></span></div>${X_PATH}</header>
          <p class="ln-text"><span id="lnTyped"></span><span class="tw-caret"></span></p>
          <footer class="ln-tw-foot"><span>Gas paid by Bluebird</span><span class="ln-post" id="lnPost">Post</span></footer>
        </article>
      </div>`;
    const $ = (id) => document.getElementById(id);
    const ln = $("ln"), sky = $("lnSky"), cur = $("lnCur"), glow = $("lnGlow"), coin = $("lnCoin"), pin = $("lnPin"), tw = $("lnTw");
    const NS = "http://www.w3.org/2000/svg";
    let W = 0, H = 0, idx = 0, run = 0, flights = 0;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // aucun token encore (mainnet au lancement) : vols d'exemple, signalés comme tels, qui mènent au compositeur
    const DEMO = [
      { symbol: "YOURS", spark: [1, 1.4, 1.2, 2.1, 2.6, 3.4, 3.1, 4.4], change24h: 0.9 },
      { symbol: "GM", spark: [1, 0.9, 1.5, 1.9, 1.7, 2.4, 2.9], change24h: 0.5 },
      { symbol: "BIRD", spark: [1, 1.6, 1.3, 1.8, 2.7, 2.5, 3.6, 3.9], change24h: 0.7 },
      { symbol: "BASED", spark: [1, 1.2, 1.1, 1.7, 2.2, 2.0, 2.8], change24h: 0.3 },
    ].map((t, i) => ({ ...t, demo: true, token: "demo-" + i, name: t.symbol, creator: "you", creatorAvatar: "", likes: 0, mcapUsd: 0 }));
    const list = () => (tokens.length ? tokens : DEMO);

    function measure() {
      const b = ln.getBoundingClientRect();
      if (Math.abs(b.width - W) < 2 && Math.abs(b.height - H) < 2) return false;
      W = b.width; H = b.height;
      sky.setAttribute("viewBox", `0 0 ${W} ${H}`);
      // quadrillage de graphique
      const g = $("lnGrid"); g.innerHTML = "";
      const step = Math.max(48, Math.round(W / 12));
      for (let x = step; x < W; x += step) g.insertAdjacentHTML("beforeend", `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
      for (let y = step; y < H; y += step) g.insertAdjacentHTML("beforeend", `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
      $("lnOld").innerHTML = ""; // les anciennes trajectoires ne correspondent plus à la nouvelle taille
      return true;
    }
    new ResizeObserver(() => measure()).observe(ln);
    measure();

    // point de départ : l'avatar du post
    function origin() {
      const a = $("lnAv").getBoundingClientRect(), b = ln.getBoundingClientRect();
      return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
    }
    // trajectoire : décollage vertical, puis la courbe de prix du token, lissée (Catmull-Rom)
    function flightPath(t, o, lane) {
      const pts = t.spark?.length > 1 ? t.spark : [1, 1];
      const lo = Math.min(...pts), hi = Math.max(...pts);
      const top = 64 + (lane % 3) * 34, bottom = o.y - 120;
      const x0 = o.x + 30, x1 = W - 70 - ((lane * 0.37) % 1) * W * 0.22;
      const P = [{ x: o.x, y: o.y }, { x: o.x + 6, y: o.y - 70 }];
      pts.forEach((v, i) => {
        const k = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        // plus le token a monté, plus il vole haut
        const ceiling = top + (1 - Math.min(1, Math.max(0, 0.5 + t.change24h))) * (bottom - top) * 0.45;
        P.push({ x: x0 + (i / (pts.length - 1)) * (x1 - x0), y: bottom - k * (bottom - ceiling) });
      });
      let d = `M${P[0].x.toFixed(1)},${P[0].y.toFixed(1)}`;
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? p2;
        const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      }
      return d;
    }
    function ring(x, y, max) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "ln-ring"); c.setAttribute("cx", x); c.setAttribute("cy", y);
      $("lnFx").append(c);
      const t0 = performance.now();
      const tick = (now) => { const k = Math.min(1, (now - t0) / 700); c.setAttribute("r", 8 + k * max); c.setAttribute("stroke-width", 3 * (1 - k) + 0.3); c.setAttribute("stroke-opacity", 1 - k); k < 1 ? requestAnimationFrame(tick) : c.remove(); };
      requestAnimationFrame(tick);
    }
    function spark(x, y, ang) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "ln-spark"); $("lnFx").append(c);
      const sp = 30 + Math.random() * 50, a = ang + Math.PI + (Math.random() - 0.5) * 1.4, t0 = performance.now();
      const tick = (now) => { const k = Math.min(1, (now - t0) / 500); c.setAttribute("cx", x + Math.cos(a) * sp * k); c.setAttribute("cy", y + Math.sin(a) * sp * k); c.setAttribute("r", 2.6 * (1 - k)); k < 1 ? requestAnimationFrame(tick) : c.remove(); };
      requestAnimationFrame(tick);
    }

    async function fly(t, my) {
      // 1. le post s'écrit
      tw.classList.remove("typed"); tw.classList.add("swap"); await wait(reduce ? 0 : 320); if (my !== run) return;
      $("lnAv").innerHTML = t.creatorAvatar ? `<img src="${fmt.esc(t.creatorAvatar)}" alt="" referrerpolicy="no-referrer">` : fmt.esc(t.creator[0].toUpperCase());
      $("lnName").textContent = t.creator; $("lnHandle").textContent = `@${t.creator} · now`;
      tw.classList.remove("swap");
      const text = `launching $${t.symbol} on Base 🔵`, typed = $("lnTyped");
      const paint = (s2) => { typed.innerHTML = fmt.esc(s2).replace(/\$[A-Z0-9]+/g, (m) => `<span class="cash">${m}</span>`); };
      if (reduce) paint(text);
      else { await wait(350); for (let i = 1; i <= text.length; i++) { if (my !== run) return; paint(text.slice(0, i)); await wait(32); } }
      tw.classList.add("typed");
      // 2. on poste
      await wait(reduce ? 0 : 280); $("lnPost").classList.add("press"); await wait(reduce ? 0 : 160); $("lnPost").classList.remove("press");
      if (my !== run) return;
      // 3. décollage le long du graphique de prix
      const o = origin(), lane = flights % 7;
      cur.setAttribute("d", flightPath(t, o, lane)); glow.setAttribute("d", cur.getAttribute("d"));
      const len = cur.getTotalLength();
      cur.style.strokeDasharray = len; cur.style.strokeDashoffset = len;
      glow.style.strokeDasharray = len; glow.style.strokeDashoffset = len;
      coin.innerHTML = media(t); coin.style.opacity = "1";
      ring(o.x, o.y, 46);
      const DUR = reduce ? 0 : 2300, t0 = performance.now();
      let lastSpark = 0;
      await new Promise((res) => {
        const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
        const tick = (now) => {
          const k = DUR ? Math.min(1, (now - t0) / DUR) : 1, e = ease(k);
          const p = cur.getPointAtLength(len * e), q = cur.getPointAtLength(Math.min(len, len * e + 2));
          const ang = Math.atan2(q.y - p.y, q.x - p.x);
          cur.style.strokeDashoffset = String(len * (1 - e)); glow.style.strokeDashoffset = String(len * (1 - e));
          coin.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${(ang * 180) / Math.PI + 90}deg) scale(${1 + 0.15 * Math.sin(k * Math.PI)})`;
          if (!reduce && now - lastSpark > 28 && k < 0.98) { spark(p.x, p.y, ang); lastSpark = now; }
          if (k < 1 && my === run) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
      if (my !== run) return;
      // 4. arrivée : l'étiquette se plante
      const end = cur.getPointAtLength(len);
      coin.style.transform = `translate(${end.x}px, ${end.y}px) rotate(0deg)`;
      ring(end.x, end.y, 30);
      pin.href = t.demo ? "/app#compose" : "/t/" + t.token;
      pin.innerHTML = t.demo
        ? `<b>$${fmt.esc(t.symbol)}<span class="p-new">Example</span></b><span>Your token could fly here</span>`
        : `<b>$${fmt.esc(t.symbol)}${fresh.has(t.token) ? `<span class="p-new">Just launched</span>` : ""}</b><span><strong>${fmt.usd(t.mcapUsd)}</strong> ${fmt.pct(t.change24h)} · ♥ ${fmt.count(t.likes)}</span>`;
      pin.style.left = end.x + "px"; pin.style.top = end.y + "px";
      pin.classList.add("on");
      flights++;
      $("lnCount").innerHTML = tokens.length ? `<b>${fmt.count(tokens.length)}</b>tokens launched from X` : `<b>Be first.</b>launch the first token from X`;
      await wait(reduce ? 0 : 2200); if (my !== run) return;
      // 5. la traînée reste au ciel, la pièce devient un point
      const old = document.createElementNS(NS, "path");
      old.setAttribute("class", "ln-old"); old.setAttribute("d", cur.getAttribute("d"));
      const node = document.createElementNS(NS, "circle");
      node.setAttribute("class", "ln-node"); node.setAttribute("cx", end.x); node.setAttribute("cy", end.y); node.setAttribute("r", 4);
      const tag = document.createElementNS(NS, "text");
      tag.setAttribute("class", "ln-tag"); tag.setAttribute("x", end.x + 9); tag.setAttribute("y", end.y + 4); tag.textContent = "$" + t.symbol;
      $("lnOld").append(old, node, tag);
      while ($("lnOld").children.length > 24) $("lnOld").firstElementChild.remove();
      if (reduce) return;
      cur.setAttribute("d", ""); glow.setAttribute("d", ""); coin.style.opacity = "0"; pin.classList.remove("on");
      fresh.delete(t.token);
    }

    async function loop() {
      const my = ++run;
      while (my === run) {
        const L = list();
        const f = L.findIndex((t) => fresh.has(t.token)); // un nouveau lancement passe devant
        if (f >= 0) idx = f;
        await fly(L[idx % L.length], my);
        if (reduce) {
          // sans animation : toutes les trajectoires d'un coup, la dernière étiquetée
          if (++idx < Math.min(L.length, 6)) continue;
          return;
        }
        idx = (idx + 1) % L.length;
      }
    }
    load().then(loop);
    setInterval(() => { if (!document.hidden) load(); }, 10000);
  }

  ({ a: heroA, b: heroB, c: heroC, d: heroD })[variant]();
});
