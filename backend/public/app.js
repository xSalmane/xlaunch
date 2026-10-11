// Bluebird — code partagé par toutes les pages : session X, API, formats, posts, colonne de droite, effets
(() => {
  const KEY = "xl_token";
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
  };

  // nonce de connexion : seul l'onglet qui a lancé la connexion accepte le jeton qui en revient
  // (sinon un lien piégé …#t=<jeton de l'attaquant> connecterait la victime au compte de l'attaquant)
  const NONCE = "xl_login_nonce";
  const nonce = {
    make() { const n = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""); try { sessionStorage.setItem(NONCE, n); } catch {} return n; },
    take(n) { let ok = false; try { ok = !!n && sessionStorage.getItem(NONCE) === n; if (ok) sessionStorage.removeItem(NONCE); } catch {} return ok; },
  };

  // jeton revenu d'une connexion en pleine page (#t=…&n=…)
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t")) {
    if (nonce.take(hash.get("n"))) store.set(hash.get("t"));
    history.replaceState(null, "", location.pathname + location.search);
  }

  const listeners = new Set();
  let me = null;

  async function api(path, opts = {}) {
    const token = store.get();
    const headers = { ...(opts.body && !(opts.body instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try { res = await fetch(path, { ...opts, headers }); }
    catch { throw Object.assign(new Error("Can't reach the server. Check your internet connection."), { status: 0 }); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !data.reauth) { store.set(null); me = null; emit(); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Error " + res.status), { status: res.status, data });
    return data;
  }

  function emit() { listeners.forEach((fn) => fn(me)); }

  async function refreshMe() {
    if (!store.get()) { me = null; emit(); return null; }
    try { me = await api("/api/me"); } catch { me = null; }
    emit();
    return me;
  }

  /** ouvre la connexion X en popup ; résout quand l'utilisateur est connecté */
  function login() {
    return new Promise((resolve, reject) => {
      const n = nonce.make();
      const url = "/auth/x/start?return=" + encodeURIComponent(location.pathname + location.search) + "&nonce=" + n;
      const w = window.open(url, "xlaunch-auth", "width=520,height=720");
      if (!w) { location.href = url; return; } // popup bloquée : connexion en pleine page
      const onMsg = (e) => {
        if (e.origin !== location.origin || e.data?.type !== "xlaunch-auth") return;
        if (!nonce.take(e.data.nonce)) return;
        window.removeEventListener("message", onMsg);
        clearInterval(timer);
        store.set(e.data.token);
        refreshMe().then(resolve);
      };
      window.addEventListener("message", onMsg);
      const timer = setInterval(() => {
        if (w.closed) {
          clearInterval(timer);
          setTimeout(() => { window.removeEventListener("message", onMsg); if (!me) reject(new Error("Sign-in cancelled.")); }, 400);
        }
      }, 500);
    });
  }

  function logout() { store.set(null); me = null; emit(); }

  // ------------------------------------------------------------ formats (anglais)
  const nf = (d) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  function eth(v, digits = 3) {
    if (!v) return "0 ETH";
    if (v < 0.001) return "< 0.001 ETH";
    return nf(v < 1 ? digits : 2).format(v) + " ETH";
  }
  /** montants en dollars : $12.4K, $3.2M, $0.85 */
  function usd(v) {
    if (!v) return "$0";
    if (v < 0.01) return "<$0.01";
    if (v < 1000) return "$" + nf(v < 10 ? 2 : 0).format(v);
    return "$" + compact.format(v);
  }
  /** quantité d'un actif : 1,234.5 USDC, 0.0042 ETH */
  function amount(v, symbol) {
    const d = v >= 100 ? 0 : v >= 1 ? 2 : 4;
    return (v && v < 0.0001 ? "< 0.0001" : nf(d).format(v)) + " " + symbol;
  }
  const count = (n) => (n >= 1000 ? compact.format(n) : String(n));
  /** très petits prix : 0.0₈3412 (zéros comptés en indice) */
  function price(v) {
    if (!v) return "0";
    if (v >= 1) return nf(2).format(v);
    if (v >= 0.001) return nf(6).format(v);
    const [m, e] = v.toExponential(3).split("e");
    const zeros = -Number(e) - 1;
    const digits = m.replace(".", "").replace(/0+$/, "").slice(0, 4);
    return `0.0${String(zeros).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉"[c]).join("")}${digits}`;
  }
  function pct(v) {
    if (!isFinite(v)) return "—";
    const p = v * 100;
    const txt = (p > 0 ? "+" : "") + nf(Math.abs(p) >= 100 ? 0 : 1).format(p) + "%";
    return `<span class="${p > 0.05 ? "up" : p < -0.05 ? "down" : "mute"}">${txt}</span>`;
  }
  /** âge court, comme sur un fil social : 12s, 5m, 3h, 2d */
  function ago(ts) {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
    return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const hue = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };

  // ------------------------------------------------------------ chiffres qui bougent : flash vert / rouge
  const prev = new Map();
  /** renvoie la classe de flash si la valeur a changé depuis le dernier affichage */
  function flash(key, value) {
    const before = prev.get(key);
    prev.set(key, value);
    if (before === undefined || Math.abs(value - before) < Math.abs(before) * 1e-6) return "";
    return value > before ? "flash-up" : "flash-down";
  }

  // ------------------------------------------------------------ icônes (traits simples)
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.2A6 6 0 1 1 9.2 15.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 5-6"/>',
    share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    up: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    buy: '<path d="M4 7h16l-1.5 9.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    feather: '<path d="M20 4c-7 0-12 5-13 12l-3 4"/><path d="M7 16h6c4 0 6-4 7-8"/>',
    heart: '<path d="M12 20.3s-7.4-4.5-9.3-9.1C1.3 7.8 3.5 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.5 0 5.7 3.3 4.3 6.7-1.9 4.6-9.3 9.1-9.3 9.1z"/>',
    comment: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v7h14v-7M12 8v12"/><path d="M12 8C10 4 6.5 4.5 7.5 7c.4 1 2.5 1 4.5 1zM12 8c2-4 5.5-3.5 4.5-1-.4 1-2.5 1-4.5 1z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  };
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? ""}</svg>`;
  const X_SVG = `<svg class="x-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;

  // ------------------------------------------------------------ éléments
  /** pastille ronde du token : son logo, sinon une pièce générée à partir de l'adresse */
  function coin(t, size = 40) {
    const label = esc(String(t.symbol || "?").slice(0, 4));
    const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : "";
    return `<span class="coin" style="--s:${size}px;--h:${hue(t.token || t.symbol)}" aria-hidden="true">${img || label}</span>`;
  }
  /** pastille de la paire (ETH, USDC, action) */
  function pair(q, cls = "") {
    if (!q) return "";
    const ic = q.icon ? `<img src="${esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : "";
    return `<span class="pairtag ${cls}">${ic}${esc(q.symbol)}</span>`;
  }
  function avatar(src, handle, size = 40) {
    return src
      ? `<img class="post-avatar" src="${esc(src)}" alt="" referrerpolicy="no-referrer" style="width:${size}px;height:${size}px" data-fallback="${esc((handle || "?")[0].toUpperCase())}">`
      : `<span class="post-avatar" style="width:${size}px;height:${size}px">${esc((handle || "?")[0].toUpperCase())}</span>`;
  }
  /** mini-graphique du prix (svg) avec une aire légère */
  function spark(points) {
    const pts = points && points.length > 1 ? points : [points?.[0] ?? 1, points?.[0] ?? 1];
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || hi || 1;
    const W = 100, H = 40;
    const xy = pts.map((p, i) => [((i / (pts.length - 1)) * W).toFixed(2), (H - 3 - ((p - lo) / span) * (H - 6)).toFixed(2)]);
    const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
    const col = pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)";
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="area" d="${d}L${W},${H}L0,${H}Z" fill="${col}"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function tweetUrl(text, url) { return "https://x.com/intent/post?" + new URLSearchParams({ text, url: withRef(url) }); }
  /** nos liens partagés portent le parrainage de la personne connectée */
  function withRef(url) {
    if (!me?.handle || !url || !String(url).startsWith(location.origin)) return url;
    const u = new URL(url);
    u.searchParams.set("ref", me.handle);
    return u.toString();
  }
  // arrivée via un lien de parrainage : on retient le premier parrain, puis on l'envoie une fois connecté
  try {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref && /^\w{1,15}$/.test(ref) && !localStorage.getItem("xl_ref")) localStorage.setItem("xl_ref", ref);
  } catch {}
  async function sendReferral() {
    let ref = null;
    try { ref = localStorage.getItem("xl_ref"); if (!ref || localStorage.getItem("xl_ref_done")) return; } catch { return; }
    if (!me || ref.toLowerCase() === me.handle.toLowerCase()) return;
    try {
      await api("/api/referral", { method: "POST", body: JSON.stringify({ ref }) });
      localStorage.setItem("xl_ref_done", "1");
    } catch {}
  }

  // ------------------------------------------------------------ couvertures génératives (la touche spéciale)
  // Chaque token sans logo reçoit une couverture unique, calculée à partir de son adresse :
  // mêmes couleurs et même motif partout où il apparaît, jamais deux fois le même visuel.
  function seedOf(str) { let h = 2166136261; for (const c of String(str).toLowerCase()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  let artN = 0;
  function art(t) {
    const r = rng(seedOf(t.token || t.symbol));
    const h1 = Math.floor(r() * 360), h2 = (h1 + 40 + Math.floor(r() * 140)) % 360;
    const kind = Math.floor(r() * 4);
    const ang = Math.floor(r() * 360);
    const id = "a" + (++artN);
    const W = "rgb(255 255 255 / ";
    let pat = "";
    if (kind === 0) { // anneaux
      const cx = 20 + r() * 60, cy = 20 + r() * 60;
      for (let i = 1; i <= 12; i++) pat += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(i * 9).toFixed(1)}" fill="none" stroke="${W}${(0.06 + r() * 0.16).toFixed(2)})" stroke-width="${(1 + r() * 3).toFixed(1)}"/>`;
    } else if (kind === 1) { // rayons
      const n = 18 + Math.floor(r() * 14);
      for (let i = 0; i < n; i++) {
        const a1 = (i / n) * Math.PI * 2, a2 = ((i + 0.5) / n) * Math.PI * 2;
        if (i % 2) pat += `<path d="M50,50 L${(50 + 90 * Math.cos(a1)).toFixed(1)},${(50 + 90 * Math.sin(a1)).toFixed(1)} L${(50 + 90 * Math.cos(a2)).toFixed(1)},${(50 + 90 * Math.sin(a2)).toFixed(1)}Z" fill="${W}0.09)"/>`;
      }
    } else if (kind === 2) { // trame de points
      for (let x = 5; x < 100; x += 10) for (let y = 5; y < 100; y += 10) pat += `<circle cx="${x}" cy="${y}" r="${(0.6 + r() * 2.6).toFixed(1)}" fill="${W}${(0.12 + r() * 0.25).toFixed(2)})"/>`;
    } else { // vagues
      for (let i = 0; i < 9; i++) {
        const y = 8 + i * 11, a = 3 + r() * 6, f = 1 + r() * 2;
        let d = `M0,${y}`;
        for (let x = 0; x <= 100; x += 5) d += ` L${x},${(y + a * Math.sin((x / 100) * Math.PI * 2 * f + i)).toFixed(1)}`;
        pat += `<path d="${d}" fill="none" stroke="${W}${(0.1 + r() * 0.18).toFixed(2)})" stroke-width="${(1.5 + r() * 2.5).toFixed(1)}"/>`;
      }
    }
    const sym = "$" + String(t.symbol || "?").slice(0, 8);
    const fs = Math.min(13, 62 / sym.length);
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="${id}" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="hsl(${h1} 78% 56%)"/><stop offset="1" stop-color="hsl(${h2} 82% 42%)"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#${id})"/>${pat}
      <circle cx="50" cy="50" r="27" fill="hsl(${h1} 85% 52%)" stroke="${W}0.95)" stroke-width="2.4"/>
      <circle cx="50" cy="50" r="22.5" fill="none" stroke="${W}0.45)" stroke-width="1.2"/>
      <text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="Instrument Sans, system-ui, sans-serif" font-weight="800" font-size="${fs.toFixed(1)}" fill="#fff">${esc(sym)}</text>
    </svg>`;
  }
  const media = (t) => (t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : art(t));
  const likesText = (n) => (n === 1 ? "1 like" : `${count(n)} likes`);
  const HEART_SOLID = `<svg viewBox="0 0 24 24" aria-hidden="true">${P.heart}</svg>`;

  /** un lancement présenté comme un post Instagram */
  function post(t, isNew = false) {
    const href = "/t/" + esc(t.token);
    const share = tweetUrl(`$${t.symbol} on Base, launched from X`, t.share);
    const f = flash("m:" + t.token, t.mcapUsd);
    return `<article class="ig${isNew ? " post-enter" : ""}" data-token="${esc(t.token)}">
      <header class="ig-head">
        <a href="/p/${esc(t.creator)}" aria-label="@${esc(t.creator)}'s profile">${avatar(t.creatorAvatar, t.creator, 34)}</a>
        <div class="who-line"><a class="who-link" href="/p/${esc(t.creator)}"><b>@${esc(t.creator)}</b></a> <span class="mute">· ${ago(t.createdAt)}</span><br>
          <span class="mute">launched $${esc(t.symbol)}, paired with</span> ${pair(t.quote)}</div>
        ${t.milestone ? `<span class="ms-badge" title="Market cap hit ${usd(t.milestone)}">${icon("trophy", "sm")}${usd(t.milestone)}</span>` : ""}
        ${t.hot ? `<span class="hot" title="3+ likes in the last hour">🔥 Hot</span>` : ""}
      </header>
      <div class="ig-media" data-like-media title="Double-tap to like">
        ${media(t)}
        <span class="ig-pill"><span class="num ${f}">${usd(t.mcapUsd)}</span>${pct(t.change24h)}</span>
        <span class="ig-burst">${HEART_SOLID}</span>
      </div>
      <div class="ig-actions">
        <button class="ig-btn like${t.liked ? " on" : ""}" type="button" data-like aria-pressed="${t.liked ? "true" : "false"}" aria-label="Like">${icon("heart")}</button>
        <a class="ig-btn ig-com" href="${href}#comments" aria-label="Comments">${icon("comment")}${t.comments ? `<span>${count(t.comments)}</span>` : ""}</a>
        <a class="ig-btn" href="${href}" aria-label="Chart and trades">${icon("chart")}</a>
        <a class="ig-btn" href="${share}" target="_blank" rel="noopener" aria-label="Share on X">${icon("share")}</a>
        <span class="grow"></span>
        <a class="btn small" href="${esc(t.trade)}" target="_blank" rel="noopener">${icon("buy", "sm")}Buy with ${esc(t.quote?.symbol ?? "ETH")}</a>
      </div>
      <div class="ig-likes" data-likes data-n="${t.likes}">${likesText(t.likes)}</div>
      <div class="ig-stats"><b>$${esc(t.symbol)}</b> ${esc(t.name)} <span class="mute">· ${count(t.trades)} trades · ${usd(t.creatorFeesUsd)} earned by the creator</span></div>
      ${t.description ? `<p class="ig-caption"><a class="who-link" href="/p/${esc(t.creator)}"><b>@${esc(t.creator)}</b></a> ${esc(t.description)}</p>` : ""}
      <a class="ig-more" href="${href}${t.comments ? "#comments" : ""}">${t.comments ? `View ${t.comments === 1 ? "1 comment" : `all ${count(t.comments)} comments`}` : `View chart and ${t.trades === 1 ? "1 trade" : count(t.trades) + " trades"}`}</a>
    </article>`;
  }

  /** tuile carrée (grille de l'explorer et du profil) */
  function tile(t, rank = 0) {
    return `<a class="tile" href="/t/${esc(t.token)}" aria-label="$${esc(t.symbol)}, ${likesText(t.likes)}">
      ${media(t)}
      ${t.hot ? `<span class="hot">🔥</span>` : ""}
      ${t.milestone ? `<span class="ms-badge tile-ms">${icon("trophy", "sm")}${usd(t.milestone)}</span>` : ""}
      ${rank ? `<span class="tile-rank">#${rank}</span>` : ""}
      <span class="tile-cap"><span>$${esc(t.symbol)}</span><span>♥ ${count(t.likes)}</span></span>
      <span class="tile-over"><span>♥ ${likesText(t.likes)}</span><span>${usd(t.mcapUsd)} ${pct(t.change24h).replace(/class="(up|down|mute)"/, 'style="color:#fff"')}</span></span>
    </a>`;
  }

  // ------------------------------------------------------------ likes : bouton cœur et double-tap sur le visuel
  async function toggleLike(card, burst = false) {
    if (!card) return;
    if (!me) { try { await login(); } catch { return; } }
    const btn = card.querySelector("[data-like]");
    const box = card.querySelector("[data-likes]");
    const wasOn = btn.classList.contains("on");
    if (burst && wasOn) return; // le double-tap ne retire jamais un like
    const set = (on, n) => {
      card.ownerDocument.querySelectorAll(`[data-token="${card.dataset.token}"]`).forEach((c) => {
        const b = c.querySelector("[data-like]"), l = c.querySelector("[data-likes]");
        b?.classList.toggle("on", on); b?.setAttribute("aria-pressed", String(on));
        if (l) { l.dataset.n = n; l.textContent = l.hasAttribute("data-short") ? count(n) : likesText(n); }
      });
    };
    const n0 = Number(box?.dataset.n ?? 0);
    set(!wasOn, Math.max(0, n0 + (wasOn ? -1 : 1)));
    btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
    try {
      const r = await api("/api/like", { method: "POST", body: JSON.stringify({ token: card.dataset.token }) });
      set(r.liked, r.likes);
    } catch (e) { set(wasOn, n0); toast(e.message); }
  }
  function burstAt(mediaEl) {
    const b = mediaEl.querySelector(".ig-burst");
    if (!b) return;
    b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-like]");
    if (b) { e.preventDefault(); toggleLike(b.closest("[data-token]")); }
  });
  document.addEventListener("dblclick", (e) => {
    const m = e.target.closest("[data-like-media]");
    if (m) { e.preventDefault(); burstAt(m); toggleLike(m.closest("[data-token]"), true); }
  });
  // double-tap au doigt (certains navigateurs mobiles n'émettent pas dblclick)
  let lastTap = { t: 0, el: null };
  document.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    const m = e.target.closest("[data-like-media]");
    if (!m) return;
    const now = Date.now();
    if (lastTap.el === m && now - lastTap.t < 320) { burstAt(m); toggleLike(m.closest("[data-token]"), true); lastTap = { t: 0, el: null }; }
    else lastTap = { t: now, el: m };
  });

  /** pluie de pièces, pour fêter un lancement */
  function coinRain(t, n = 26) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = document.createElement("div");
    box.className = "coin-rain";
    for (let i = 0; i < n; i++) {
      const s = 22 + Math.random() * 30;
      box.insertAdjacentHTML("beforeend", coin(t, s));
      const c = box.lastElementChild;
      c.style.left = Math.random() * 100 + "vw";
      c.style.setProperty("--delay", (Math.random() * 0.7).toFixed(2) + "s");
      c.style.setProperty("--d", (1.4 + Math.random() * 1.2).toFixed(2) + "s");
      c.style.setProperty("--r", (Math.random() * 900 - 450).toFixed(0) + "deg");
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 3500);
  }

  // ------------------------------------------------------------ paliers de market cap
  const MILESTONES = [25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
  let celebrated = false;
  /** fête un palier franchi depuis la dernière visite (une seule fois par page, jamais à la découverte d'un token) */
  function milestoneCheck(t) {
    if (!t?.token || !t.milestone) return;
    const k = "xl_ms_" + t.token.toLowerCase();
    let seen = null;
    try { seen = localStorage.getItem(k); localStorage.setItem(k, String(t.milestone)); } catch { return; }
    if (seen === null || Number(seen) >= t.milestone || celebrated) return;
    celebrated = true;
    coinRain(t, 22);
    const share = tweetUrl(`$${t.symbol} just hit ${usd(t.milestone)} market cap on Base 🏆`, t.share);
    const el = document.createElement("div");
    el.className = "ms-pop"; el.role = "status";
    el.innerHTML = `<span class="ms-pop-ic">${icon("trophy")}</span><div><b>$${esc(t.symbol)} hit ${usd(t.milestone)}</b><span>New market cap milestone</span></div>
      <a class="btn small" href="${share}" target="_blank" rel="noopener">${X_SVG} Share</a><button class="ms-x" type="button" aria-label="Close">×</button>`;
    document.body.append(el);
    const close = () => el.remove();
    el.querySelector(".ms-x").onclick = close;
    setTimeout(close, 9000);
  }

  function toast(msg, ms = 2600) {
    const el = document.createElement("div");
    el.className = "toast"; el.role = "status"; el.textContent = msg;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }
  async function copy(text, label = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(label); } catch { toast("Couldn't copy. Select the text by hand."); }
  }

  /** « half » / « 30% » selon la part créateur configurée */
  async function feeShare() {
    try {
      const c = await api("/api/config");
      const label = c.creatorFeeBps === 5000 ? "half" : nf(1).format(c.creatorFeeBps / 100) + "%";
      document.querySelectorAll("[data-fee-share]").forEach((el) => (el.textContent = label));
      return c;
    } catch { return null; }
  }

  /** sélecteur de paire (ETH, USDC, actions tokenisées) ; renvoie une fonction qui donne l'actif choisi */
  async function pairPicker(el, onChange = () => {}) {
    let quotes = [];
    try { quotes = await api("/api/quotes"); } catch { el.innerHTML = `<span class="mute">Pairs unavailable, ETH will be used.</span>`; }
    const groups = [
      ["Crypto", quotes.filter((q) => q.kind !== "stock")],
      ["Tokenized stocks", quotes.filter((q) => q.kind === "stock")],
    ].filter(([, list]) => list.length);
    el.innerHTML = groups.map(([label, list]) => `
      <div class="pair-group">${label}</div>
      <div class="pair-grid" role="radiogroup" aria-label="${label}">
        ${list.map((q) => `<label class="pair-opt" title="${esc(q.name)}${q.paused ? " — paused by its issuer" : ""}">
          <input type="radio" name="quote" value="${esc(q.address)}" ${q.symbol === "ETH" ? "checked" : ""} ${q.paused ? "disabled" : ""}>
          <span>${q.icon ? `<img src="${esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : ""}${esc(q.symbol)}</span>
        </label>`).join("")}
      </div>`).join("");
    const current = () => {
      const v = el.querySelector("input[name=quote]:checked")?.value;
      return quotes.find((q) => q.address === v) ?? quotes[0] ?? null;
    };
    el.addEventListener("change", () => onChange(current()));
    onChange(current());
    return current;
  }

  // ------------------------------------------------------------ coquille : compte, navigation, colonne de droite
  function drawAuth() {
    document.querySelectorAll("[data-auth]").forEach((slot) => {
      if (me) {
        const av = me.avatar ? `<img src="${esc(me.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar-ph"></span>`;
        slot.innerHTML = `<div class="who"><a href="/me" style="display:contents">${av}<span class="who-txt"><b>${esc(me.handle)}</b><span class="mute">@${esc(me.handle)}</span></span></a>
          <button class="who-out" type="button" title="Sign out" aria-label="Sign out">${icon("logout", "sm")}</button></div>`;
        slot.querySelector(".who-out").onclick = logout;
        slot.querySelector("img")?.addEventListener("error", (e) => {
          const ph = document.createElement("span"); ph.className = "avatar-ph"; e.target.replaceWith(ph);
        });
      } else {
        slot.innerHTML = `<button class="btn ink wide" type="button" data-login>${X_SVG}<span class="lbl">Sign in with X</span></button>`;
        slot.querySelector("[data-login]").onclick = () => login().catch(() => {});
      }
    });
  }

  function markNav() {
    const page = location.pathname === "/" ? "/" : "/" + location.pathname.split("/")[1];
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.getAttribute("href") === page) a.setAttribute("aria-current", "page");
    });
  }

  async function sideRight() {
    const box = document.querySelector("[data-trends]");
    if (!box) return;
    const draw = async () => {
      try {
        const [top, stats] = await Promise.all([api("/api/tokens?sort=trending&limit=5"), api("/api/stats")]);
        box.innerHTML = top.length
          ? top.map((t, i) => `<a class="trend" href="/t/${esc(t.token)}">
              <span class="rank">${i + 1}</span>${coin(t, 36)}
              <span class="trend-txt"><b>$${esc(t.symbol)}</b><span class="mute">${esc(t.quote?.symbol)} · @${esc(t.creator)}</span></span>
              <span class="trend-num"><b class="heart num ${flash("l:" + t.token, t.likes24h)}">♥ ${count(t.likes24h)}</b><br><span class="mute">${usd(t.mcapUsd)}</span></span></a>`).join("")
          : `<div class="trend mute">No tokens yet.</div>`;
        const s = document.querySelector("[data-stats]");
        if (s) s.innerHTML = `<div><b>${count(stats.launches)}</b><span class="mute">tokens launched</span></div><div><b class="num ${flash("stats", stats.volume24hUsd)}">${usd(stats.volume24hUsd)}</b><span class="mute">traded in 24h</span></div>`;
      } catch {}
    };
    draw();
    setInterval(() => { if (!document.hidden) draw(); }, 10000);
  }

  // bandeau visible tant que le site tourne sur le testnet
  async function testnetBanner() {
    try {
      const c = await api("/api/config");
      if (c.chain === "base") return;
      // carte du tweet : pas de bandeau, une pastille discrète gérée par la page
      if (document.body.hasAttribute("data-compact")) { document.body.dataset.chain = "testnet"; return; }
      const el = document.createElement("div");
      el.className = "testnet";
      el.textContent = document.body.hasAttribute("data-compact")
        ? "Base Sepolia testnet: tokens have no value."
        : c.devLogin
          ? "Base Sepolia testnet: tokens have no value and sign-in with X is simulated."
          : "Base Sepolia testnet: tokens have no value.";
      document.body.prepend(el);
      document.body.classList.add("has-banner");
    } catch {}
  }

  // un post entier est cliquable ; les liens et boutons à l'intérieur gardent leur propre action
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-href]");
    if (el && !e.target.closest("a,button,input,label")) location.href = el.dataset.href;
  });
  // avatars X indisponibles : initiale à la place d'une image cassée
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && (img.classList.contains("post-avatar") || img.classList.contains("sf-av"))) {
      const s = document.createElement("span");
      s.className = img.classList.contains("sf-av") ? "sf-av sf-ph" : "post-avatar"; s.style.cssText = img.style.cssText; s.textContent = img.dataset.fallback || "?";
      img.replaceWith(s);
    }
  }, true);

  window.XL = {
    api, login, logout, refreshMe, onAuth: (fn) => { listeners.add(fn); fn(me); }, get me() { return me; },
    isLogged: () => !!store.get(),
    fmt: { eth, usd, amount, price, pct, ago, short, esc, count }, coin, pair, avatar, spark, post, tile, art, icon, flash, hue,
    toggleLike, likesText, coinRain, toast, copy, tweetUrl, withRef, feeShare, pairPicker, X_SVG, MILESTONES, milestoneCheck,
  };

  listeners.add(drawAuth);
  listeners.add((m) => { if (m) sendReferral(); });
  document.addEventListener("DOMContentLoaded", () => {
    markNav(); drawAuth(); refreshMe(); testnetBanner(); sideRight();
  });
})();
