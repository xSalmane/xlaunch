// Vitrine : le mur de tokens en direct, les chiffres, les tokens du jour, les paires
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;

  // un nom tapé ici arrive pré-rempli dans le compositeur de l'app
  $("start").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("startName").value.trim();
    location.href = name ? `/app?name=${encodeURIComponent(name)}#compose` : "/app#compose";
  });

  const media = (t) => (t.image ? `<img src="${fmt.esc(t.image)}" alt="" loading="lazy">` : XL.art(t));

  // ------------------------------------------------------------ la pool
  // Vue de dessus d'une pool de liquidité : chaque token flotte, taille selon sa market cap.
  // On remue l'eau avec la souris ou le doigt, les nouveaux lancements tombent dedans.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = $("pool"), wrap = $("poolWrap"), tip = $("poolTip"), ctx = cv.getContext("2d");
  let W = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  let bodies = [], ripples = [], hoverB = null, pointer = null, lastRipple = 0, visible = true, theme = {};
  const fresh = new Set(), seen = new Set();

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    theme = { coping: cs.getPropertyValue("--line").trim() || "#dee1e7", deck: cs.getPropertyValue("--soft").trim() || "#eef0f3", ink: cs.getPropertyValue("--ink").trim() };
  }
  readTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);

  function resize() {
    const box = wrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const oldR = R;
    W = box.width; cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr);
    cx = W / 2; cy = W / 2; R = W / 2 - Math.max(10, W * 0.035);
    if (oldR) bodies.forEach((b) => { b.x = cx + ((b.x - cx) * R) / oldR; b.y = cy + ((b.y - cy) * R) / oldR; });
    sizeBodies();
  }
  resize();
  new ResizeObserver(resize).observe(wrap);

  // les couvertures deviennent des images pour le canvas
  const svgImg = (svg) => { const im = new Image(); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" ')); return im; };
  function imageFor(t) {
    if (t.yours) return null;
    if (t.image) { const im = new Image(); im.src = t.image; return im; }
    return svgImg(XL.art(t));
  }

  // taille : racine de la market cap, bornée, pour que les gros tokens se voient sans écraser les autres
  function sizeBodies() {
    if (!bodies.length || !R) return;
    const caps = bodies.filter((b) => !b.t.yours).map((b) => b.t.mcapUsd);
    const lo = Math.sqrt(Math.min(...caps, 1e9)), hi = Math.sqrt(Math.max(...caps, 1));
    const n = bodies.length;
    const base = Math.min(R * 0.26, (R * 0.95) / Math.sqrt(n + 1));
    bodies.forEach((b) => {
      const k = b.t.yours ? 0.55 : hi > lo ? (Math.sqrt(b.t.mcapUsd) - lo) / (hi - lo) : 0.5;
      b.r = base * (0.62 + 0.55 * k);
    });
  }

  function spawn(t, drop) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.6;
    const b = { t, key: t.yours ? "yours" : t.token, img: imageFor(t), x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: 0, vy: 0, r: 20,
      seed: Math.random() * 1000, drop: drop && !reduce ? 1 : 0, dropDelay: 0 };
    return b;
  }

  function splash(x, y, big) {
    if (reduce) return;
    for (let i = 0; i < (big ? 3 : 1); i++) ripples.push({ x, y, t: -i * 0.18, max: big ? R * 0.55 : R * 0.22, w: big ? 3 : 1.6 });
  }

  function step(dt, now) {
    for (const b of bodies) {
      if (b.dropDelay > 0) { b.dropDelay -= dt; continue; }
      if (b.drop > 0) { b.drop = Math.max(0, b.drop - dt * 2.2); if (b.drop === 0) splash(b.x, b.y, true); continue; }
      // courant léger, différent pour chaque token
      const s = b.seed, T = now / 1000;
      b.vx += Math.cos(T * 0.31 + s) * 6 * dt; b.vy += Math.sin(T * 0.27 + s * 1.7) * 6 * dt;
      // le doigt pousse l'eau
      if (pointer) {
        const dx = b.x - pointer.x, dy = b.y - pointer.y, d = Math.hypot(dx, dy) || 1, reach = R * 0.32;
        if (d < reach) { const f = (1 - d / reach) * 900 * dt; b.vx += (dx / d) * f + pointer.vx * 0.04; b.vy += (dy / d) * f + pointer.vy * 0.04; }
      }
    }
    // pas de chevauchement : on se repousse doucement
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.drop || b.drop || a.dropDelay > 0 || b.dropDelay > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 4;
      if (d < min) { const push = (min - d) * 0.5, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; a.vx -= nx * 8; a.vy -= ny * 8; b.vx += nx * 8; b.vy += ny * 8; }
    }
    for (const b of bodies) {
      if (b.drop || b.dropDelay > 0) continue;
      b.vx *= 0.94; b.vy *= 0.94;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // le bord de la pool
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), lim = R - b.r - 6;
      if (d > lim) { const nx = dx / d, ny = dy / d; b.x = cx + nx * lim; b.y = cy + ny * lim; const vn = b.vx * nx + b.vy * ny; if (vn > 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; } }
    }
    ripples = ripples.filter((r) => (r.t += dt * 0.9) < 1);
  }

  function draw(now) {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, W);
    // margelle puis eau
    c.beginPath(); c.arc(cx, cy, R + Math.max(8, W * 0.028), 0, Math.PI * 2); c.fillStyle = theme.coping; c.fill();
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = "#0000ff"; c.fillRect(0, 0, W, W);
    // reflets au fond de l'eau : des lignes ondulées cerulean qui bougent lentement
    c.strokeStyle = "#3c8aff"; c.lineWidth = 1.4;
    const T = reduce ? 0 : now / 1000;
    for (let i = -6; i <= 6; i++) {
      c.beginPath();
      for (let x = cx - R; x <= cx + R; x += 8) {
        const y = cy + i * (R / 6.5) + Math.sin(x / (R * 0.18) + T * 0.8 + i) * R * 0.025 + Math.sin(x / (R * 0.07) - T * 1.3 + i * 2) * R * 0.008;
        x === cx - R ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    }
    // ondes
    for (const r of ripples) {
      if (r.t < 0) continue;
      c.beginPath(); c.arc(r.x, r.y, 6 + r.t * r.max, 0, Math.PI * 2);
      c.strokeStyle = "#ffffff"; c.globalAlpha = (1 - r.t) * 0.8; c.lineWidth = r.w * (1 - r.t) + 0.4; c.stroke(); c.globalAlpha = 1;
    }
    // ombre portée au fond, puis les jetons
    const sorted = [...bodies].sort((a, b) => a.r - b.r);
    for (const b of sorted) {
      if (b.dropDelay > 0) continue;
      const lift = b.drop * 1.6;                     // en train de tomber : plus gros, plus haut
      const bob = reduce ? 0 : Math.sin(now / 700 + b.seed) * 0.025;
      const r = b.r * (1 + lift + bob);
      c.beginPath(); c.arc(b.x + r * 0.12 + lift * 30, b.y + r * 0.16 + lift * 40, r, 0, Math.PI * 2); c.fillStyle = "#0000a8"; c.fill();
    }
    for (const b of sorted) {
      if (b.dropDelay > 0) continue;
      const lift = b.drop * 1.6;
      const bob = reduce ? 0 : Math.sin(now / 700 + b.seed) * 0.025;
      const r = b.r * (1 + lift + bob);
      c.save();
      c.beginPath(); c.arc(b.x, b.y, r, 0, Math.PI * 2); c.closePath();
      c.fillStyle = "#ffffff"; c.fill();
      if (b.t.yours) {
        c.fillStyle = "#0000ff"; c.textAlign = "center"; c.textBaseline = "middle";
        c.font = `700 ${Math.round(r * 0.9)}px "Funnel Display", system-ui, sans-serif`; c.fillText("+", b.x, b.y - r * 0.16);
        c.font = `700 ${Math.max(10, Math.round(r * 0.24))}px "Funnel Sans", system-ui, sans-serif`; c.fillText("Yours", b.x, b.y + r * 0.42);
      } else {
        c.clip();
        if (b.img?.complete && b.img.naturalWidth) {
          const inset = r * 0.1, s = (r - inset) * 2;
          c.beginPath(); c.arc(b.x, b.y, r - inset, 0, Math.PI * 2); c.clip();
          c.drawImage(b.img, b.x - s / 2, b.y - s / 2, s, s);
        }
      }
      c.restore();
      if (b === hoverB) { c.beginPath(); c.arc(b.x, b.y, r + 4, 0, Math.PI * 2); c.strokeStyle = "#ffffff"; c.lineWidth = 3; c.stroke(); }
    }
    c.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (visible && !document.hidden && R) { if (!reduce) step(dt, now); draw(now); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(wrap);

  // ------------------------------------------------------------ interactions
  const local = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const hit = (p) => [...bodies].sort((a, b) => b.r - a.r).find((b) => !b.drop && Math.hypot(b.x - p.x, b.y - p.y) < b.r) ?? null;
  cv.addEventListener("pointermove", (e) => {
    const p = local(e), now = performance.now();
    const inPool = Math.hypot(p.x - cx, p.y - cy) < R;
    pointer = inPool ? { x: p.x, y: p.y, vx: pointer ? (p.x - pointer.x) * 60 : 0, vy: pointer ? (p.y - pointer.y) * 60 : 0 } : null;
    if (inPool && now - lastRipple > 70 && pointer && Math.hypot(pointer.vx, pointer.vy) > 40) { splash(p.x, p.y, false); lastRipple = now; }
    hoverB = hit(p);
    wrap.classList.toggle("over-token", !!hoverB);
    if (hoverB && !hoverB.t.yours) {
      const t = hoverB.t;
      tip.innerHTML = `<b>$${fmt.esc(t.symbol)}</b>${fmt.usd(t.mcapUsd)} · ♥ ${fmt.count(t.likes)}`;
      tip.style.left = hoverB.x + "px"; tip.style.top = hoverB.y - hoverB.r + "px"; tip.hidden = false;
      caption(t);
    } else tip.hidden = true;
    if (reduce) draw(now);
  });
  cv.addEventListener("pointerleave", () => { pointer = null; hoverB = null; tip.hidden = true; wrap.classList.remove("over-token"); });
  cv.addEventListener("click", (e) => {
    const b = hit(local(e));
    if (b) location.href = b.t.yours ? "/app#compose" : "/t/" + b.t.token;
    else { const p = local(e); if (Math.hypot(p.x - cx, p.y - cy) < R) splash(p.x, p.y, true); }
  });

  function caption(t) {
    const el = $("poolInfo");
    if (!t || t.yours) { el.href = "/app#compose"; el.innerHTML = `<b>Drop yours in</b><span class="p-sub">Launch a token and it lands in the pool</span>`; return; }
    el.href = "/t/" + t.token;
    el.innerHTML = `<b>$${fmt.esc(t.symbol)}${fresh.has(t.token) ? `<span class="p-new">Just launched</span>` : ""}</b>
      <span class="p-sub"><span>${fmt.esc(t.name)} by @${fmt.esc(t.creator)}</span><span><strong>${fmt.usd(t.mcapUsd)}</strong> ${fmt.pct(t.change24h)}</span><span class="p-likes">♥ ${fmt.count(t.likes)}</span></span>`;
  }

  async function loadPool() {
    try {
      const rows = await api("/api/tokens?sort=new&limit=24");
      const first = !seen.size;
      const byKey = new Map(bodies.map((b) => [b.key, b]));
      const next = [];
      rows.forEach((t, i) => {
        const old = byKey.get(t.token);
        if (old) { old.t = t; next.push(old); return; }
        const b = spawn(t, true);
        if (first) b.dropDelay = 0.25 + i * 0.12;      // à l'ouverture, les tokens tombent un par un
        else { fresh.add(t.token); b.x = cx; b.y = cy; } // un nouveau lancement plonge au centre
        next.push(b);
        seen.add(t.token);
      });
      const yours = byKey.get("yours") ?? Object.assign(spawn({ yours: true }, true), { dropDelay: first ? 0.25 + rows.length * 0.12 : 0 });
      next.push(yours);
      bodies = next;
      sizeBodies();
      if (first || fresh.size) caption(rows.find((t) => fresh.has(t.token)) ?? rows[0]);
      $("poolLinks").innerHTML = rows.map((t) => `<a href="/t/${fmt.esc(t.token)}">$${fmt.esc(t.symbol)}, ${fmt.usd(t.mcapUsd)} market cap</a>`).join("");
      if (reduce) { for (let i = 0; i < 160; i++) step(0.016, 0); draw(performance.now()); } // sans animation : on pose les jetons sans chevauchement
    } catch { if (!bodies.length) caption(null); }
  }

  // ------------------------------------------------------------ chiffres
  async function loadStats() {
    try {
      const [s, c] = await Promise.all([api("/api/stats"), api("/api/config")]);
      $("sLaunches").textContent = fmt.count(s.launches);
      $("sVol").textContent = fmt.usd(s.volume24hUsd);
      // ce que les créateurs ont gagné jusqu'ici : 1 % de frais, dont leur part
      $("stepEarn").textContent = fmt.usd(s.volumeTotalUsd * 0.01 * (c.creatorFeeBps / 10_000));
    } catch {}
  }

  // ------------------------------------------------------------ tokens du jour
  async function loadTrend() {
    try {
      const rows = await api("/api/tokens?sort=trending&limit=5");
      $("trend").innerHTML = rows.length
        ? rows.map((t) => `<a class="l-row" href="/t/${fmt.esc(t.token)}">
            <span class="l-thumb">${media(t)}</span>
            <span class="l-name"><b>$${fmt.esc(t.symbol)}</b><span>${fmt.esc(t.name)} by @${fmt.esc(t.creator)}</span></span>
            <span class="l-spark">${XL.spark(t.spark)}</span>
            <span class="l-num">${fmt.usd(t.mcapUsd)}</span>
            <span class="l-num l-chg">${fmt.pct(t.change24h)}</span>
            <span class="l-likes">♥ ${fmt.count(t.likes24h)}</span>
          </a>`).join("")
        : `<p class="l-empty">Nothing launched yet today. <a href="/app#compose">Be the first.</a></p>`;
    } catch {}
  }

  // ------------------------------------------------------------ paires
  api("/api/quotes").then((list) => {
    $("pairs").innerHTML = list.map((q) => `<span class="l-chip${q.paused ? " off" : ""}" title="${fmt.esc(q.name)}${q.paused ? ", paused by its issuer" : ""}">
        ${q.icon ? `<img src="${fmt.esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : `<span class="l-chip-ic">${fmt.esc(q.symbol.slice(0, 1))}</span>`}
        ${fmt.esc(q.symbol)} <small>${fmt.esc(q.name)}</small></span>`).join("");
  }).catch(() => {});

  loadPool(); loadStats(); loadTrend();
  setInterval(() => { if (!document.hidden) { loadPool(); loadStats(); loadTrend(); } }, 8000);
});
