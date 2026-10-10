// Embed affiché dans le tweet (player card X) : onglets Launch / Trending / New, posts Instagram compacts
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const params = new URLSearchParams(location.search);
  const sharedToken = params.get("token");
  let imageUrl = "";
  let pane = "launch";
  let quotes = [];

  XL.feeShare();

  // ------------------------------------------------------------ onglets
  $("tabLaunchIcon").innerHTML = `${XL.icon("feather")}Launch`;
  $("tabTrendIcon").innerHTML = `${XL.icon("heart")}Trending`;
  $("tabNewIcon").innerHTML = `${XL.icon("coins")}New`;
  $("cam").innerHTML = XL.icon("image");

  function show(name) {
    pane = name;
    document.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === name)));
    $("pane-token").hidden = name !== "token";
    $("pane-launch").hidden = name !== "launch";
    $("pane-feed").hidden = name !== "trending" && name !== "new";
    $("body").scrollTop = 0;
    if (name === "trending" || name === "new") { $("feed").dataset.sig = ""; loadFeed(); }
  }
  document.querySelectorAll("[data-pane]").forEach((b) => b.addEventListener("click", () => show(b.dataset.pane)));

  // ------------------------------------------------------------ listes : rendu sans saut pendant un like
  function render(el, rows, empty) {
    const sig = rows.map((t) => t.token).join(",");
    if (el.dataset.sig === sig && rows.length) {
      // même liste : on met juste les chiffres à jour
      for (const t of rows) {
        const card = el.querySelector(`[data-token="${t.token}"]`);
        if (!card) continue;
        const likes = card.querySelector("[data-likes]");
        if (likes && Number(likes.dataset.n) !== t.likes) { likes.dataset.n = t.likes; likes.textContent = XL.likesText(t.likes); }
        const btn = card.querySelector("[data-like]");
        btn?.classList.toggle("on", !!t.liked); btn?.setAttribute("aria-pressed", String(!!t.liked));
        const pill = card.querySelector(".ig-pill");
        if (pill) pill.innerHTML = `<span class="num ${XL.flash("m:" + t.token, t.mcapUsd)}">${fmt.usd(t.mcapUsd)}</span>${fmt.pct(t.change24h)}`;
      }
      return;
    }
    const before = el.dataset.sig ? new Set(el.dataset.sig.split(",")) : null;
    el.dataset.sig = sig;
    el.innerHTML = rows.length ? rows.map((t) => XL.post(t, !!before && !before.has(t.token))).join("") : empty;
  }

  const EMPTY = `<div class="e-empty"><b>No tokens yet</b>The first one could be yours.</div>`;
  async function loadRecent() {
    try { render($("recent"), await api("/api/tokens?sort=new&limit=3"), EMPTY); } catch {}
  }
  async function loadFeed() {
    if (pane !== "trending" && pane !== "new") return;
    try { render($("feed"), await api(`/api/tokens?sort=${pane}&limit=15`), EMPTY); } catch {}
  }

  // ------------------------------------------------------------ token partagé dans le tweet
  async function loadShared(first = false) {
    try {
      const t = await api("/api/token/" + encodeURIComponent(sharedToken));
      if (first) document.title = `$${t.symbol} on XLaunch`;
      render($("tokenPost"), [t], "");
    } catch (e) {
      if (first) $("tokenPost").innerHTML = `<div class="e-empty"><b>Token not found</b>${fmt.esc(e.message)}</div>`;
    }
  }
  $("tOwn").addEventListener("click", () => show("launch"));

  // ------------------------------------------------------------ compositeur
  let bumpT;
  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    if (imageUrl) return;
    $("prevArt").innerHTML = XL.art({ symbol: sym || "NEW", token: "preview:" + (sym || "") });
    const p = $("prev");
    clearTimeout(bumpT);
    p.classList.remove("bump"); void p.offsetWidth; p.classList.add("bump");
    bumpT = setTimeout(() => p.classList.remove("bump"), 300);
  }
  let touched = false;
  $("symbol").addEventListener("input", () => { touched = true; preview(); });
  $("name").addEventListener("input", () => {
    if (!touched) $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    preview();
  });
  preview();

  const showMsg = (t, kind = "err") => { const m = $("msg"); m.hidden = !t; if (t) { m.className = "notice " + kind; m.textContent = t; } };
  const DEFAULT_HINT = "Tap the square to add a logo, or keep a generated cover.";
  const pairHint = () => {
    const q = quotes.find((x) => x.address === $("pair").value);
    $("pairHint").textContent = q?.test ? `${q.symbol} is a test stock with no value.` : DEFAULT_HINT;
  };

  // paire : menu compact (ETH, USDC, actions tokenisées)
  api("/api/quotes").then((list) => {
    quotes = list;
    const opt = (q) => `<option value="${fmt.esc(q.address)}" ${q.symbol === "ETH" ? "selected" : ""} ${q.paused ? "disabled" : ""}>Pair: ${fmt.esc(q.symbol)}</option>`;
    const crypto = list.filter((q) => q.kind !== "stock"), stocks = list.filter((q) => q.kind === "stock");
    $("pair").innerHTML = `<optgroup label="Crypto">${crypto.map(opt).join("")}</optgroup>` +
      (stocks.length ? `<optgroup label="Tokenized stocks">${stocks.map(opt).join("")}</optgroup>` : "");
    pairHint();
  }).catch(() => { $("pair").innerHTML = `<option value="">Pair: ETH</option>`; });
  $("pair").addEventListener("change", pairHint);
  $("pairHint").textContent = DEFAULT_HINT;

  async function ensureLogin() {
    if (XL.me) return true;
    if (XL.isLogged()) { await XL.refreshMe(); if (XL.me) return true; }
    try { await XL.login(); return !!XL.me; } catch { return false; }
  }

  XL.onAuth((me) => {
    if (!me) { $("quota").textContent = "Sign in with X to launch. Gas is on us."; $("launchBtn").disabled = false; }
    else if (me.ineligible) { $("quota").textContent = me.ineligible; $("launchBtn").disabled = true; }
    else {
      const left = Math.max(0, me.perDay - me.launchesLast24h);
      $("quota").textContent = left ? `Gas is on us · ${left} left today` : "Daily limit reached";
      $("launchBtn").disabled = !left;
    }
    // les cœurs dépendent du compte : on redessine les listes
    ["recent", "feed", "tokenPost"].forEach((id) => ($(id).dataset.sig = ""));
    refresh();
  });

  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("This logo is over 1 MB."); $("file").value = ""; return; }
    if (!(await ensureLogin())) { showMsg("Sign in with X to add a logo."); $("file").value = ""; return; }
    $("pairHint").textContent = "Uploading…";
    try {
      imageUrl = (await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } })).url;
      $("prevArt").innerHTML = `<img src="${fmt.esc(imageUrl)}" alt="">`;
      showMsg(""); pairHint();
    } catch (e) { imageUrl = ""; $("file").value = ""; showMsg(e.message); pairHint(); preview(); }
  });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim(), symbol = $("symbol").value.trim();
    if (!name) { showMsg("Give your token a name."); $("name").focus(); return; }
    if (symbol.length < 2) { showMsg("The ticker needs at least 2 characters."); $("symbol").focus(); return; }
    showMsg("");
    if (!(await ensureLogin())) return showMsg("Sign in with X to launch your token.");
    if (XL.me?.ineligible) return showMsg(XL.me.ineligible);
    const btn = $("launchBtn");
    btn.disabled = true; btn.textContent = "Deploying…";
    try {
      const r = await api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: $("pair").value || undefined }) });
      $("doneArt").innerHTML = imageUrl ? `<img src="${fmt.esc(imageUrl)}" alt="">` : XL.art({ symbol, token: r.token });
      $("doneTitle").textContent = `$${symbol} is live on Base`;
      $("doneShare").innerHTML = `${XL.X_SVG} Share on X`;
      $("doneShare").href = XL.tweetUrl(`I just launched $${symbol} on Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      $("composer").hidden = true; $("done").hidden = false;
      $("body").scrollTop = 0;
      XL.coinRain({ symbol, token: r.token, image: imageUrl }, 16);
      XL.refreshMe();
      loadRecent();
    } catch (err) { showMsg(err.message); }
    finally { btn.textContent = "Launch"; if (!XL.me?.ineligible) btn.disabled = false; }
  });

  $("doneAgain").addEventListener("click", () => {
    $("composer").reset(); touched = false; imageUrl = "";
    preview(); pairHint();
    $("done").hidden = true; $("composer").hidden = false; $("name").focus();
  });

  // ------------------------------------------------------------ démarrage et rafraîchissement
  function refresh() {
    if (document.hidden) return;
    if (pane === "launch") loadRecent();
    else if (pane === "token") loadShared();
    else loadFeed();
  }
  if (sharedToken) {
    show("token");
    loadShared(true);
  } else show("launch");
  setInterval(refresh, 8000);
});
