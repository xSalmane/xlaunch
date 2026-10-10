// XLaunch — code partagé par toutes les pages : session X, API, formats, posts, colonne de droite
(() => {
  const KEY = "xl_token";
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
  };

  // jeton revenu d'une connexion en pleine page (#t=…)
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t")) {
    store.set(hash.get("t"));
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
    catch { throw Object.assign(new Error("Connexion au serveur impossible. Vérifie ta connexion internet."), { status: 0 }); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !data.reauth) { store.set(null); me = null; emit(); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Erreur " + res.status), { status: res.status, data });
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
      const url = "/auth/x/start?return=" + encodeURIComponent(location.pathname + location.search);
      const w = window.open(url, "xlaunch-auth", "width=520,height=720");
      if (!w) { location.href = url; return; } // popup bloquée : connexion en pleine page
      const onMsg = (e) => {
        if (e.origin !== location.origin || e.data?.type !== "xlaunch-auth") return;
        window.removeEventListener("message", onMsg);
        clearInterval(timer);
        store.set(e.data.token);
        refreshMe().then(resolve);
      };
      window.addEventListener("message", onMsg);
      const timer = setInterval(() => {
        if (w.closed) {
          clearInterval(timer);
          setTimeout(() => { window.removeEventListener("message", onMsg); if (!me) reject(new Error("Connexion annulée.")); }, 400);
        }
      }, 500);
    });
  }

  function logout() { store.set(null); me = null; emit(); }

  // ------------------------------------------------------------ formats
  const nf = (d) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
  function eth(v, digits = 3) {
    if (!v) return "0 ETH";
    if (v < 0.001) return "< 0,001 ETH";
    return nf(v < 1 ? digits : 2).format(v) + " ETH";
  }
  /** montants en dollars : 12,4 k$, 3,2 M$, 0,85 $ */
  function usd(v) {
    if (!v) return "0 $";
    if (v < 0.01) return "< 0,01 $";
    if (v < 1000) return nf(v < 10 ? 2 : 0).format(v) + " $";
    return compact.format(v).replace(/\s?k$/, " k").replace(/\s?M$/, " M").replace(/\s?Md$/, " Md") + "$";
  }
  /** quantité d'un actif : 1 234,5 USDC, 0,0042 ETH */
  function amount(v, symbol) {
    const d = v >= 100 ? 0 : v >= 1 ? 2 : 4;
    return (v && v < 0.0001 ? "< 0,0001" : nf(d).format(v)) + " " + symbol;
  }
  const count = (n) => (n >= 1000 ? compact.format(n) : String(n));
  /** très petits prix : 0,0₈3412 (zéros comptés en indice) */
  function price(v) {
    if (!v) return "0";
    if (v >= 1) return nf(2).format(v);
    if (v >= 0.001) return nf(6).format(v);
    const [m, e] = v.toExponential(3).split("e");
    const zeros = -Number(e) - 1;
    const digits = m.replace(".", "").replace(/0+$/, "").slice(0, 4);
    return `0,0${String(zeros).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉"[c]).join("")}${digits}`;
  }
  function pct(v) {
    if (!isFinite(v)) return "—";
    const p = v * 100;
    const txt = (p > 0 ? "+" : "") + nf(Math.abs(p) >= 100 ? 0 : 1).format(p) + " %";
    return `<span class="${p > 0.05 ? "up" : p < -0.05 ? "down" : "mute"}">${txt}</span>`;
  }
  /** âge court, comme sur un fil social : 12 s, 5 min, 3 h, 2 j */
  function ago(ts) {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} j`;
    return new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const hue = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };

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
  /** mini-graphique du prix (svg) */
  function spark(points) {
    const pts = points && points.length > 1 ? points : [points?.[0] ?? 1, points?.[0] ?? 1];
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || hi || 1;
    const W = 100, H = 40;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(2)},${(H - 3 - ((p - lo) / span) * (H - 6)).toFixed(2)}`).join("");
    const col = pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)";
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function tweetUrl(text, url) { return "https://x.com/intent/post?" + new URLSearchParams({ text, url }); }

  /** un lancement présenté comme un post du fil */
  function post(t, isNew = false) {
    const href = "/t/" + esc(t.token);
    const share = tweetUrl(`$${t.symbol} sur Base, lancé depuis X`, t.share);
    return `<article class="post${isNew ? " post-new" : ""}" data-href="${href}">
      ${avatar(t.creatorAvatar, t.creator)}
      <div class="post-body">
        <div class="post-head"><b>@${esc(t.creator)}</b><span class="mute">a lancé un token</span><span class="mute">· ${ago(t.createdAt)}</span></div>
        ${t.description ? `<p class="post-text">${esc(t.description)}</p>` : ""}
        <a class="tcard" href="${href}">
          ${coin(t, 44)}
          <span class="tcard-name"><b>$${esc(t.symbol)}</b> ${pair(t.quote)}<span class="mute">${esc(t.name)}</span></span>
          <span class="tcard-num"><b>${usd(t.mcapUsd)}</b>${pct(t.change24h)}</span>
          <span class="tcard-spark">${spark(t.spark)}</span>
        </a>
        <div class="post-actions">
          <a class="act" href="${href}" title="Trades">${icon("chart", "sm")}${count(t.trades)}</a>
          <a class="act buy" href="${esc(t.trade)}" target="_blank" rel="noopener" title="Acheter avec ${esc(t.quote?.symbol)}">${icon("buy", "sm")}Acheter</a>
          <a class="act" href="${share}" target="_blank" rel="noopener" title="Partager sur X">${icon("share", "sm")}Partager</a>
          <span class="act" title="Frais gagnés par le créateur">${icon("coins", "sm")}${usd(t.creatorFeesUsd)}</span>
        </div>
      </div>
    </article>`;
  }

  /** ligne compacte (explorer, mes tokens) */
  function row(t, rank) {
    return `<a class="mini-row" href="/t/${esc(t.token)}">
      ${rank ? `<span class="mute" style="width:18px">${rank}</span>` : ""}
      ${coin(t, 40)}
      <span class="grow"><b>$${esc(t.symbol)}</b> ${pair(t.quote)}<br><span class="mute">${esc(t.name)} · @${esc(t.creator)}</span></span>
      <span class="r"><b>${usd(t.mcapUsd)}</b><br>${pct(t.change24h)}</span>
    </a>`;
  }

  function toast(msg, ms = 2600) {
    const el = document.createElement("div");
    el.className = "toast"; el.role = "status"; el.textContent = msg;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }
  async function copy(text, label = "Copié") {
    try { await navigator.clipboard.writeText(text); toast(label); } catch { toast("Copie impossible, sélectionne le texte à la main."); }
  }

  /** « la moitié » / « 30 % » selon la part créateur configurée */
  async function feeShare() {
    try {
      const c = await api("/api/config");
      const label = c.creatorFeeBps === 5000 ? "la moitié" : nf(1).format(c.creatorFeeBps / 100) + " %";
      document.querySelectorAll("[data-fee-share]").forEach((el) => (el.textContent = label));
      return c;
    } catch { return null; }
  }

  /** sélecteur de paire (ETH, USDC, actions tokenisées) ; renvoie une fonction qui donne l'actif choisi */
  async function pairPicker(el, onChange = () => {}) {
    let quotes = [];
    try { quotes = await api("/api/quotes"); } catch { el.innerHTML = `<span class="mute">Paires indisponibles, ETH sera utilisé.</span>`; }
    const groups = [
      ["Crypto", quotes.filter((q) => q.kind !== "stock")],
      ["Actions tokenisées", quotes.filter((q) => q.kind === "stock")],
    ].filter(([, list]) => list.length);
    el.innerHTML = groups.map(([label, list]) => `
      <div class="pair-group">${label}</div>
      <div class="pair-grid" role="radiogroup" aria-label="${label}">
        ${list.map((q) => `<label class="pair-opt" title="${esc(q.name)}${q.paused ? " — suspendu par l'émetteur" : ""}">
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
          <button class="who-out" type="button" title="Se déconnecter" aria-label="Se déconnecter">${icon("logout", "sm")}</button></div>`;
        slot.querySelector(".who-out").onclick = logout;
        slot.querySelector("img")?.addEventListener("error", (e) => {
          const ph = document.createElement("span"); ph.className = "avatar-ph"; e.target.replaceWith(ph);
        });
      } else {
        slot.innerHTML = `<button class="btn ink wide" type="button" data-login>${X_SVG}<span class="lbl">Se connecter avec X</span></button>`;
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
        const [top, stats] = await Promise.all([api("/api/tokens?sort=volume&limit=5"), api("/api/stats")]);
        box.innerHTML = top.length
          ? top.map((t, i) => `<a class="trend" href="/t/${esc(t.token)}">
              <span class="rank">${i + 1}</span>${coin(t, 36)}
              <span class="trend-txt"><b>$${esc(t.symbol)}</b><span class="mute">${esc(t.quote?.symbol)} · @${esc(t.creator)}</span></span>
              <span class="trend-num"><b>${usd(t.volume24hUsd)}</b><br>${pct(t.change24h)}</span></a>`).join("")
          : `<div class="trend mute">Aucun token pour l'instant.</div>`;
        const s = document.querySelector("[data-stats]");
        if (s) s.innerHTML = `<div><b>${count(stats.launches)}</b><span class="mute">tokens lancés</span></div><div><b>${usd(stats.volume24hUsd)}</b><span class="mute">échangés en 24 h</span></div>`;
      } catch {}
    };
    draw();
    setInterval(() => { if (!document.hidden) draw(); }, 15000);
  }

  // bandeau visible tant que le site tourne sur le testnet
  async function testnetBanner() {
    try {
      const c = await api("/api/config");
      if (c.chain === "base") return;
      const el = document.createElement("div");
      el.className = "testnet";
      el.textContent = document.body.hasAttribute("data-compact")
        ? "Testnet Base Sepolia : les tokens n'ont aucune valeur."
        : c.devLogin
          ? "Version de test sur Base Sepolia : les tokens n'ont aucune valeur et la connexion X est simulée."
          : "Version de test sur Base Sepolia : les tokens n'ont aucune valeur.";
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
    if (img.tagName === "IMG" && img.classList.contains("post-avatar")) {
      const s = document.createElement("span");
      s.className = "post-avatar"; s.style.cssText = img.style.cssText; s.textContent = img.dataset.fallback || "?";
      img.replaceWith(s);
    }
  }, true);

  window.XL = {
    api, login, logout, refreshMe, onAuth: (fn) => { listeners.add(fn); fn(me); }, get me() { return me; },
    isLogged: () => !!store.get(),
    fmt: { eth, usd, amount, price, pct, ago, short, esc, count }, coin, pair, avatar, spark, post, row, icon,
    toast, copy, tweetUrl, feeShare, pairPicker, X_SVG,
  };

  listeners.add(drawAuth);
  document.addEventListener("DOMContentLoaded", () => {
    markNav(); drawAuth(); refreshMe(); testnetBanner(); sideRight();
  });
})();
