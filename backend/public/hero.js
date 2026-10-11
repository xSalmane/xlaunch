// Hero animé de la vitrine : la rampe de lancement (le post s'écrit, la pièce décolle le long de sa vraie courbe de prix).
document.addEventListener("DOMContentLoaded", () => {
  const { api, fmt } = XL;
  const hv = document.getElementById("hv");
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

  heroD();
});
