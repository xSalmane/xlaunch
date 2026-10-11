// Carte X : un terminal bleu Base. launch (vrai lancement, étapes affichées comme des logs), top / new en direct, info d'un token partagé.
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const sharedToken = new URLSearchParams(location.search).get("token");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let pane = "launch", quotes = [], imageUrl = "", busy = false, feedTimer = null;

  // ------------------------------------------------------------ onglets
  const CWD = { launch: "~/launch", trending: "~/top", new: "~/new", token: "~/info" };
  function show(name) {
    pane = name;
    document.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === name)));
    $("vLaunch").hidden = name !== "launch";
    $("vFeed").hidden = name !== "trending" && name !== "new";
    $("vToken").hidden = name !== "token";
    $("cwd").textContent = CWD[name];
    clearInterval(feedTimer);
    if (name === "trending" || name === "new") {
      $("feedCmd").textContent = name === "trending" ? "bluebird top --sort hot --live" : "bluebird ls --new --live";
      prev.clear(); loadFeed(); feedTimer = setInterval(loadFeed, 5000);
    }
    if (name === "token") loadInfo();
  }
  document.querySelectorAll("[data-pane]").forEach((b) => b.addEventListener("click", () => show(b.dataset.pane)));

  // ------------------------------------------------------------ compte
  $("login").addEventListener("click", () => XL.login().catch(() => {}));
  async function ensureLogin() {
    if (XL.me) return true;
    if (XL.isLogged()) { await XL.refreshMe(); if (XL.me) return true; }
    try { await XL.login(); return !!XL.me; } catch { return false; }
  }
  let quotaText = "gas is on us";
  XL.onAuth((me) => {
    $("who").textContent = me ? `${me.handle}@base` : "bluebird@base";
    $("login").hidden = !!me || XL.isLogged();
    if (!me) quotaText = "gas is on us · login with X to launch";
    else if (me.ineligible) quotaText = me.ineligible.toLowerCase();
    else { const left = Math.max(0, me.perDay - me.launchesLast24h); quotaText = left ? `gas is on us · ${left} launch${left > 1 ? "es" : ""} left today` : "daily limit reached"; }
    $("launchBtn").disabled = !!me && (!!me.ineligible || me.perDay - me.launchesLast24h <= 0);
    setQuota();
    if (pane === "trending" || pane === "new") loadFeed();
    if (pane === "token") loadInfo();
  });
  api("/api/config").then((c) => { $("intro").textContent = `Bluebird · ${c.chain === "base" ? "Base" : "Base Sepolia (testnet)"} · gas sponsored`; }).catch(() => {});

  // ------------------------------------------------------------ la commande launch
  let touched = false;
  $("symbol").addEventListener("input", () => { touched = true; $("symbol").value = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase(); });
  $("name").addEventListener("input", () => { if (!touched) $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6); });
  function setQuota() {
    const q = quotes.find((x) => x.address === $("pair").value);
    $("quota").textContent = q?.test ? `${q.symbol} is a test stock with no value` : quotaText;
  }
  api("/api/quotes").then((list) => {
    quotes = list;
    const opt = (q) => `<option value="${fmt.esc(q.address)}" ${q.symbol === "ETH" ? "selected" : ""} ${q.paused ? "disabled" : ""}>${fmt.esc(q.symbol)}</option>`;
    const crypto = list.filter((q) => q.kind !== "stock"), stocks = list.filter((q) => q.kind === "stock");
    $("pair").innerHTML = `<optgroup label="crypto">${crypto.map(opt).join("")}</optgroup>` + (stocks.length ? `<optgroup label="tokenized stocks">${stocks.map(opt).join("")}</optgroup>` : "");
    setQuota();
  }).catch(() => {});
  $("pair").addEventListener("change", setQuota);

  // sortie du terminal
  const out = $("out");
  const scrollEnd = () => { const s = $("vLaunch"); s.scrollTop = s.scrollHeight; };
  function line(html, cls = "") { const d = document.createElement("div"); d.className = "ln " + cls; d.innerHTML = html; out.append(d); scrollEnd(); return d; }
  // une étape avec son spinner ; se résout quand `until` se termine (et au moins `min` ms)
  async function step(label, until, min = 300) {
    const d = line(`<span class="warn">${SPIN[0]}</span> ${label}`);
    let i = 0;
    const it = reduce ? null : setInterval(() => { d.firstChild.textContent = SPIN[++i % SPIN.length]; }, 80);
    try {
      const [r] = await Promise.all([until ?? Promise.resolve(), new Promise((res) => setTimeout(res, reduce ? 0 : min))]);
      clearInterval(it);
      return { d, r, label };
    } catch (e) { clearInterval(it); d.innerHTML = `<span class="warn">✗</span> ${label}`; throw e; }
  }
  const done = (s, extra = "") => { s.d.innerHTML = `<span class="ok">✓</span> ${s.label} ${extra}`; scrollEnd(); };
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  function asciiCoin(sym) {
    const s = ("$" + sym).slice(0, 9), w = 9, pad = Math.floor((w - s.length) / 2);
    const mid = " ".repeat(pad) + s + " ".repeat(w - s.length - pad);
    return ["     .-~~~~~~~-.", "   .'           '.", "  /   " + mid + "   \\", " |     ◉  base     |", "  \\               /", "   '.           .'", "     '-.......-'"].join("\n");
  }

  // logo : envoyé tout de suite, avec sa ligne de log
  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { line(`<span class="warn">✗</span> logo is over 1 MB`); $("file").value = ""; return; }
    if (!(await ensureLogin())) { line(`<span class="warn">✗</span> login with X to attach a logo`); $("file").value = ""; return; }
    try {
      const s = await step(`uploading ${fmt.esc(f.name)} (${Math.max(1, Math.round(f.size / 1024))} KB)`, api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } }));
      imageUrl = s.r.url; done(s, `<span class="dim">ok</span>`);
      $("logoLbl").textContent = `[ ${f.name.slice(0, 14)} ✓ ]`;
    } catch (e) { imageUrl = ""; $("file").value = ""; line(`<span class="warn">✗</span> ${fmt.esc(e.message)}`); }
  });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = $("name").value.trim(), symbol = $("symbol").value.trim();
    const pair = quotes.find((q) => q.address === $("pair").value)?.symbol ?? "ETH";
    out.innerHTML = "";
    if (!name) { line(`<span class="warn">✗</span> missing token name`); $("name").focus(); return; }
    if (symbol.length < 2) { line(`<span class="warn">✗</span> --ticker needs at least 2 characters`); $("symbol").focus(); return; }
    busy = true; $("launchBtn").disabled = true;
    try {
      const auth = await step("authenticating with X", ensureLogin(), 250);
      if (!auth.r) { auth.d.innerHTML = `<span class="warn">✗</span> login with X to launch`; return; }
      done(auth, `<span class="dim">@${fmt.esc(XL.me.handle)}</span>`);
      if (XL.me.ineligible) { line(`<span class="warn">✗</span> ${fmt.esc(XL.me.ineligible)}`); return; }
      // un seul appel déploie tout (token, pool, verrou) en une transaction sur Base
      const launch = api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: $("pair").value || undefined }) });
      const tx = await step(`broadcasting launch tx on Base`, launch, 900);
      const r = tx.r;
      done(tx, `<span class="dim">${short(r.txHash)}</span>`);
      const quick = async (label, extra) => done(await step(label, null, 260), extra);
      await quick(`ERC-20 $${fmt.esc(symbol)} deployed · 1,000,000,000 supply`, `<span class="dim">${short(r.token)}</span>`);
      await quick(`Uniswap v3 pool ${fmt.esc(symbol)}/${fmt.esc(pair)} created · 1% fee`);
      await quick(`100% of supply seeded into the pool`);
      await quick(`liquidity locked forever`);
      line(`gas paid by bluebird · you paid $0`, "dim");
      line(fmt.esc(asciiCoin(symbol)), "ascii");
      line(`<span class="ok">● LIVE</span> <a href="/t/${fmt.esc(r.token)}">bluebird/t/${short(r.token)}</a>`);
      line(`<div class="btns"><a class="btn-t" href="${XL.tweetUrl(`I just launched $${symbol} on Base 🔵`, r.share)}">share on x</a><a class="btn-t btn-o" href="/t/${fmt.esc(r.token)}">open chart</a><button class="btn-t btn-o" type="button" data-again>launch another</button></div>`);
      $("composer").querySelectorAll("input, select").forEach((el) => (el.disabled = true));
      $("runrow").hidden = true;
      XL.refreshMe();
    } catch (err) {
      line(`<span class="warn">✗</span> ${fmt.esc(err.message)}`);
      line(`edit the command and run it again`, "dim");
    } finally {
      busy = false; if (!XL.me?.ineligible) $("launchBtn").disabled = false;
    }
  });
  out.addEventListener("click", (e) => {
    if (!e.target.closest("[data-again]")) return;
    $("composer").reset(); touched = false; imageUrl = ""; $("logoLbl").textContent = "[ attach ]";
    $("composer").querySelectorAll("input, select").forEach((el) => (el.disabled = false));
    $("runrow").hidden = false; out.innerHTML = ""; setQuota(); $("name").focus();
  });

  // ------------------------------------------------------------ top / new : un tableau qui vit
  const prev = new Map();
  async function loadFeed() {
    if (document.hidden || (pane !== "trending" && pane !== "new")) return;
    try {
      const rows = await api(`/api/tokens?sort=${pane}&limit=12`);
      $("tbl").innerHTML = `<tr><th>#</th><th>ticker</th><th class="r">mcap</th><th class="r">24h</th><th class="r">♥</th></tr>` + rows.map((t, i) => {
        const changed = prev.has(t.token) && prev.get(t.token) !== Math.round(t.mcapUsd);
        prev.set(t.token, Math.round(t.mcapUsd));
        return `<tr data-token="${fmt.esc(t.token)}"><td class="dim">${i + 1}</td><td><a href="/t/${fmt.esc(t.token)}">$${fmt.esc(t.symbol)}</a>${t.hot ? ` <span class="warn">hot</span>` : ""}</td>
          <td class="r${changed ? " hl" : ""}">${fmt.usd(t.mcapUsd)}</td><td class="r ${t.change24h >= 0 ? "ok" : "warn"}">${t.change24h >= 0 ? "+" : ""}${(t.change24h * 100).toFixed(1)}%</td>
          <td class="r"><button class="t-like${t.liked ? " on" : ""}" type="button" data-like aria-pressed="${t.liked}" aria-label="Like $${fmt.esc(t.symbol)}">${t.liked ? "♥" : "♡"} <span data-likes data-short data-n="${t.likes}">${fmt.count(t.likes)}</span></button></td></tr>`;
      }).join("");
      $("feedNote").textContent = rows.length ? `${rows.length} tokens · refreshes every 5s · tap ♡ to like` : "no tokens yet. run launch to create the first one.";
    } catch {}
  }
  // le cœur suit l'état du like (XL.toggleLike change la classe « on »)
  new MutationObserver((list) => list.forEach((m) => {
    const b = m.target;
    if (m.attributeName === "class" && b.classList?.contains("t-like")) { const on = b.classList.contains("on"); if (b.firstChild && b.firstChild.nodeType === 3) b.firstChild.textContent = on ? "♥ " : "♡ "; }
  })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

  // ------------------------------------------------------------ bluebird info : le token partagé dans le tweet
  async function loadInfo() {
    try {
      const t = await api("/api/token/" + encodeURIComponent(sharedToken));
      document.title = `$${t.symbol} on Bluebird`;
      $("infoCmd").textContent = `bluebird info $${t.symbol}`;
      $("info").innerHTML = `<div class="ln ascii">${fmt.esc(asciiCoin(t.symbol))}</div>
        <dl class="kv" data-token="${fmt.esc(t.token)}">
          <dt>name</dt><dd>${fmt.esc(t.name)}</dd>
          <dt>creator</dt><dd><a href="/p/${fmt.esc(t.creator)}">@${fmt.esc(t.creator)}</a></dd>
          <dt>pair</dt><dd>${fmt.esc(t.quote.symbol)}</dd>
          <dt>mcap</dt><dd><b>${fmt.usd(t.mcapUsd)}</b> <span class="${t.change24h >= 0 ? "ok" : "warn"}">${t.change24h >= 0 ? "+" : ""}${(t.change24h * 100).toFixed(1)}%</span></dd>
          <dt>activity</dt><dd>${t.trades} trades · ${t.comments ?? 0} comments</dd>
          <dt>likes</dt><dd><button class="t-like${t.liked ? " on" : ""}" type="button" data-like aria-pressed="${t.liked}">${t.liked ? "♥" : "♡"} <span data-likes data-short data-n="${t.likes}">${fmt.count(t.likes)}</span></button></dd>
        </dl>
        <div class="btns"><a class="btn-t" href="${fmt.esc(t.trade)}">buy with ${fmt.esc(t.quote.symbol)}</a><a class="btn-t btn-o" href="/t/${fmt.esc(t.token)}">chart</a><a class="btn-t btn-o" href="${XL.tweetUrl(`$${t.symbol} on Base, launched from X`, t.share)}">share</a></div>
        <div class="ln" style="margin-top:14px"><span class="pr">$</span> launch your own <button class="btn-t" type="button" data-own>↵ launch</button></div>`;
    } catch (e) {
      $("info").innerHTML = `<div class="ln"><span class="warn">✗</span> ${fmt.esc(e.message)}</div>`;
    }
  }
  $("info").addEventListener("click", (e) => { if (e.target.closest("[data-own]")) show("launch"); });

  if (sharedToken) show("token"); else show("launch");
});
