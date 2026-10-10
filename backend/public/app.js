// XLaunch — code partagé par toutes les pages du site
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
    try {
      res = await fetch(path, { ...opts, headers });
    } catch {
      throw Object.assign(new Error("Connexion au serveur impossible. Vérifie ta connexion internet."), { status: 0 });
    }
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
      const ret = location.pathname + location.search;
      const url = "/auth/x/start?return=" + encodeURIComponent(ret);
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
  function eth(v, digits = 3) {
    if (!v) return "0 ETH";
    if (v < 0.001) return "< 0,001 ETH";
    return nf(v < 1 ? digits : 2).format(v) + " ETH";
  }
  /** montants en dollars : 12,4 k$, 3,2 M$, 0,85 $ */
  const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
  function usd(v) {
    if (!v) return "0 $";
    if (v < 0.01) return "< 0,01 $";
    if (v < 1000) return nf(v < 10 ? 2 : 0).format(v) + " $";
    return compact.format(v).replace(/\s?k$/, " k").replace(/\s?M$/, " M").replace(/\s?Md$/, " Md") + "$";
  }
  /** quantité d'un actif : 1 234,5 USDC, 0,0042 ETH, 3,1 tNVDA */
  function amount(v, symbol) {
    const d = v >= 100 ? 0 : v >= 1 ? 2 : 4;
    return (v && v < 0.0001 ? "< 0,0001" : nf(d).format(v)) + " " + symbol;
  }
  /** pastille de la paire (ETH, USDC, action) */
  function pair(q, cls = "") {
    if (!q) return "";
    const icon = q.icon ? `<img src="${esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : "";
    return `<span class="pairtag ${cls} pairtag-${esc(q.kind)}">${icon}${esc(q.symbol)}</span>`;
  }
  /** très petits prix : 0,0₈3412 (zéros comptés en indice) */
  function price(v) {
    if (!v) return "0";
    if (v >= 1) return nf(2).format(v);
    if (v >= 0.001) return nf(6).format(v);
    const s = v.toExponential(3); // ex 3.412e-9
    const [m, e] = s.split("e");
    const zeros = -Number(e) - 1;
    const digits = m.replace(".", "").replace(/0+$/, "").slice(0, 4);
    const sub = String(zeros).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉"[c]).join("");
    return `0,0${sub}${digits}`;
  }
  function pct(v) {
    if (!isFinite(v)) return "—";
    const p = v * 100;
    const txt = (p > 0 ? "+" : "") + nf(Math.abs(p) >= 100 ? 0 : 1).format(p) + " %";
    return `<span class="${p > 0.05 ? "up" : p < -0.05 ? "down" : "mute"}">${txt}</span>`;
  }
  function ago(ts) {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `il y a ${s} s`;
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const hue = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };

  /** pastille ronde du token : son image, sinon une pièce générée à partir de l'adresse */
  function coin(t, size = 40) {
    const label = esc(String(t.symbol || "?").slice(0, 4));
    const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : "";
    return `<span class="coin" style="--s:${size}px;--h:${hue(t.token || t.symbol)}" aria-hidden="true">${img || label}</span>`;
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

  const X_SVG = `<svg class="x-logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;

  function tweetUrl(text, url) {
    return "https://x.com/intent/post?" + new URLSearchParams({ text, url });
  }

  // ------------------------------------------------------------ en-tête commun
  function header() {
    const slot = document.querySelector("[data-auth]");
    if (!slot) return;
    const draw = (m) => {
      if (m) {
        const av = m.avatar
          ? `<img src="${esc(m.avatar)}" alt="" referrerpolicy="no-referrer">`
          : `<span class="avatar-ph"></span>`;
        slot.innerHTML = `<a class="who" href="/me" style="text-decoration:none">${av}<span>@${esc(m.handle)}</span></a>
          <button class="btn quiet small" data-logout>Se déconnecter</button>`;
        slot.querySelector("[data-logout]").onclick = logout;
        // photo X indisponible : pastille neutre à la place d'une image cassée
        slot.querySelector(".who img")?.addEventListener("error", (e) => {
          const ph = document.createElement("span"); ph.className = "avatar-ph"; e.target.replaceWith(ph);
        });
      } else {
        slot.innerHTML = `<button class="btn small" data-login>${X_SVG} Se connecter avec X</button>`;
        slot.querySelector("[data-login]").onclick = () => login().catch(() => {});
      }
    };
    listeners.add(draw);
    draw(me);
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.getAttribute("href") === location.pathname) a.setAttribute("aria-current", "page");
    });
  }

  /** ligne de tableau d'un token (accueil + explorer) */
  function tokenRow(t, isNew = false) {
    return `<tr class="row${isNew ? " new-row" : ""}" data-href="/t/${esc(t.token)}">
      <td><div class="tcell">${coin(t, 38)}<div><a class="tname" href="/t/${esc(t.token)}">$${esc(t.symbol)} <span class="mute">${esc(t.name)}</span></a>
        <div class="tsub">par @${esc(t.creator)}</div></div></div></td>
      <td class="hide-sm">${pair(t.quote)}</td>
      <td>${usd(t.mcapUsd)}</td>
      <td class="hide-sm">${usd(t.volume24hUsd)}</td>
      <td>${pct(t.change24h)}</td>
      <td class="hide-sm mute">${ago(t.createdAt)}</td>
    </tr>`;
  }
  // toute la ligne est cliquable (le lien du nom reste le chemin clavier)
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-href]");
    if (tr && !e.target.closest("a,button")) location.href = tr.dataset.href;
  });

  /** "la moitié" / "30 %" selon la part créateur configurée */
  async function feeShare() {
    try {
      const c = await api("/api/config");
      const label = c.creatorFeeBps === 5000 ? "la moitié" : nf(1).format(c.creatorFeeBps / 100) + " %";
      document.querySelectorAll("[data-fee-share]").forEach((el) => (el.textContent = label));
      return c;
    } catch { return null; }
  }

  /**
   * Sélecteur de paire (ETH, USDC, actions tokenisées). Remplit `el` et renvoie une fonction
   * qui donne l'actif choisi. `onChange` est appelé à chaque choix.
   */
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

  window.XL = {
    tokenRow, feeShare, pairPicker,
    api, login, logout, refreshMe, onAuth: (fn) => { listeners.add(fn); fn(me); }, get me() { return me; },
    isLogged: () => !!store.get(),
    fmt: { eth, usd, amount, price, pct, ago, short, esc }, coin, pair, toast, copy, tweetUrl, X_SVG,
  };

  // bandeau visible tant que le site tourne sur le testnet
  async function testnetBanner() {
    try {
      const c = await api("/api/config");
      if (c.chain === "base") return;
      const el = document.createElement("div");
      el.className = "testnet";
      const compact = document.body.hasAttribute("data-compact");
      el.textContent = compact
        ? "Testnet Base Sepolia : les tokens n'ont aucune valeur."
        : c.devLogin
        ? "Version de test sur Base Sepolia : les tokens n'ont aucune valeur et la connexion X est simulée (tu choisis un pseudo)."
        : "Version de test sur Base Sepolia : les tokens n'ont aucune valeur.";
      document.body.prepend(el);
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => { header(); refreshMe(); testnetBanner(); });
})();
