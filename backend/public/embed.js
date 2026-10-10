// Embed affiché dans le tweet (player card X) : Launch avec couverture flottante, Hot / New façon reels
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const sharedToken = new URLSearchParams(location.search).get("token");
  const PANES = ["launch", "trending", "new"];
  let imageUrl = "";
  let pane = "launch";
  let quotes = [];

  XL.feeShare();
  $("cam").innerHTML = XL.icon("image");

  // ------------------------------------------------------------ onglets (pastille qui glisse)
  function show(name) {
    pane = name;
    const i = PANES.indexOf(name);
    $("seg").style.setProperty("--i", Math.max(0, i));
    $("seg").classList.toggle("none", i < 0);
    document.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === name)));
    $("vLaunch").hidden = name !== "launch";
    $("vFeed").hidden = name !== "trending" && name !== "new";
    $("vToken").hidden = name !== "token";
    if (name === "trending" || name === "new") { $("reel").dataset.sig = ""; $("reel").scrollTop = 0; loadFeed(); }
  }
  document.querySelectorAll("[data-pane]").forEach((b) => b.addEventListener("click", () => show(b.dataset.pane)));

  // ------------------------------------------------------------ une carte plein écran par token
  const pill = (t) => `<span class="num ${XL.flash("m:" + t.token, t.mcapUsd)}">${fmt.usd(t.mcapUsd)}</span>${fmt.pct(t.change24h)}`;
  function slide(t, enter) {
    const media = t.image
      ? `<img src="${fmt.esc(t.image)}" alt="" loading="lazy">`
      : XL.art(t).replace("xMidYMid slice", "xMidYMax slice"); // la pièce remonte au-dessus du texte
    const share = XL.tweetUrl(`$${t.symbol} on Base, launched from X`, t.share);
    return `<article class="slide${enter ? " enter" : ""}" data-token="${fmt.esc(t.token)}">
      <div class="s-media" data-like-media title="Double-tap to like">${media}<span class="ig-burst">${XL.icon("heart")}</span></div>
      <div class="s-shade"></div>
      <div class="s-top">${t.hot ? `<span class="hot">🔥 Hot</span>` : ""}${t.milestone ? `<span class="ms-badge">${XL.icon("trophy", "sm")}${fmt.usd(t.milestone)}</span>` : ""}<span class="chip-test">Testnet</span></div>
      <div class="s-side">
        <button class="s-btn like${t.liked ? " on" : ""}" type="button" data-like aria-pressed="${t.liked ? "true" : "false"}" aria-label="Like">${XL.icon("heart")}<span data-likes data-short data-n="${t.likes}">${fmt.count(t.likes)}</span></button>
        <a class="s-btn" href="/t/${fmt.esc(t.token)}#comments" aria-label="Comments">${XL.icon("comment")}<span>${t.comments ? fmt.count(t.comments) : "Chat"}</span></a>
        <a class="s-btn" href="/t/${fmt.esc(t.token)}" aria-label="Chart">${XL.icon("chart")}<span>Chart</span></a>
        <a class="s-btn" href="${share}" aria-label="Share on X">${XL.icon("share")}<span>Share</span></a>
      </div>
      <div class="s-info">
        <div class="s-who"><a class="s-who-link" href="/p/${fmt.esc(t.creator)}">${XL.avatar(t.creatorAvatar, t.creator, 24)}<b>@${fmt.esc(t.creator)}</b></a><span class="t">· ${fmt.ago(t.createdAt)}</span></div>
        <div class="s-sym">$${fmt.esc(t.symbol)} <small>${fmt.esc(t.name)}</small></div>
        ${t.description ? `<p class="s-desc">${fmt.esc(t.description)}</p>` : ""}
        <div class="s-row"><span class="s-pill">${pill(t)}</span>${XL.pair(t.quote)}<a class="s-buy" href="${fmt.esc(t.trade)}">${XL.icon("buy")}Buy</a></div>
      </div>
    </article>`;
  }

  // rendu sans saut : même liste = on met juste les chiffres à jour
  function render(el, rows, end = "") {
    const sig = rows.map((t) => t.token).join(",");
    if (rows.length && el.dataset.sig === sig) {
      for (const t of rows) {
        const card = el.querySelector(`[data-token="${t.token}"]`);
        if (!card) continue;
        const likes = card.querySelector("[data-likes]");
        if (likes && Number(likes.dataset.n) !== t.likes) { likes.dataset.n = t.likes; likes.textContent = fmt.count(t.likes); }
        const btn = card.querySelector("[data-like]");
        btn.classList.toggle("on", !!t.liked); btn.setAttribute("aria-pressed", String(!!t.liked));
        card.querySelector(".s-pill").innerHTML = pill(t);
      }
      return;
    }
    const first = !el.dataset.sig;
    const before = new Set((el.dataset.sig || "").split(","));
    const top = el.scrollTop;
    el.dataset.sig = sig;
    el.innerHTML = rows.length
      ? rows.map((t) => slide(t, first || !before.has(t.token))).join("") + end
      : `<div class="reel-end"><b>No tokens yet</b>The first one could be yours.<button class="p-go" type="button" data-go-launch>Launch a token</button></div>`;
    el.scrollTop = top;
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-go-launch]")) show("launch"); });

  const END = `<div class="reel-end"><b>You're all caught up</b><span>Launch the next one.</span><button class="p-go" type="button" data-go-launch>Launch a token</button></div>`;
  async function loadFeed() {
    if (pane !== "trending" && pane !== "new") return;
    try { render($("reel"), await api(`/api/tokens?sort=${pane}&limit=15`), END); } catch {}
  }
  async function loadShared(first = false) {
    try {
      const t = await api("/api/token/" + encodeURIComponent(sharedToken));
      if (first) document.title = `$${t.symbol} on XLaunch`;
      render($("tokenReel"), [t]);
    } catch (e) {
      if (first) $("tokenReel").innerHTML = `<div class="reel-end"><b>Token not found</b>${fmt.esc(e.message)}</div>`;
    }
  }
  $("tOwn").addEventListener("click", () => show("launch"));

  // ------------------------------------------------------------ lancement
  function setCover(html) {
    $("prevArt").innerHTML = html;
    $("stageBg").innerHTML = html;
  }
  let bumpT;
  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    if (imageUrl) return;
    setCover(XL.art({ symbol: sym || "NEW", token: "preview:" + sym }));
    const c = $("cover");
    clearTimeout(bumpT);
    c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    bumpT = setTimeout(() => c.classList.remove("bump"), 320);
  }
  let touched = false;
  $("symbol").addEventListener("input", () => { touched = true; preview(); });
  $("name").addEventListener("input", () => {
    if (!touched) $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    preview();
  });
  preview();

  const showMsg = (t, kind = "err") => { const m = $("msg"); m.hidden = !t; if (t) { m.className = "notice " + kind; m.textContent = t; } };
  let quotaText = "Gas is on us";
  const setQuota = () => {
    const q = quotes.find((x) => x.address === $("pair").value);
    $("quota").textContent = q?.test ? `${q.symbol} is a test stock with no value` : quotaText;
  };

  api("/api/quotes").then((list) => {
    quotes = list;
    const opt = (q) => `<option value="${fmt.esc(q.address)}" ${q.symbol === "ETH" ? "selected" : ""} ${q.paused ? "disabled" : ""}>Pair: ${fmt.esc(q.symbol)}</option>`;
    const crypto = list.filter((q) => q.kind !== "stock"), stocks = list.filter((q) => q.kind === "stock");
    $("pair").innerHTML = `<optgroup label="Crypto">${crypto.map(opt).join("")}</optgroup>` +
      (stocks.length ? `<optgroup label="Tokenized stocks">${stocks.map(opt).join("")}</optgroup>` : "");
    setQuota();
  }).catch(() => {});
  $("pair").addEventListener("change", setQuota);

  async function ensureLogin() {
    if (XL.me) return true;
    if (XL.isLogged()) { await XL.refreshMe(); if (XL.me) return true; }
    try { await XL.login(); return !!XL.me; } catch { return false; }
  }

  XL.onAuth((me) => {
    if (!me) { quotaText = "Gas is on us · sign in with X to launch"; $("launchBtn").disabled = false; }
    else if (me.ineligible) { quotaText = me.ineligible; $("launchBtn").disabled = true; }
    else {
      const left = Math.max(0, me.perDay - me.launchesLast24h);
      quotaText = left ? `Gas is on us · ${left} launch${left > 1 ? "es" : ""} left today` : "Daily limit reached";
      $("launchBtn").disabled = !left;
    }
    setQuota();
    // les cœurs dépendent du compte : on redessine
    $("reel").dataset.sig = ""; $("tokenReel").dataset.sig = "";
    refresh();
  });

  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("This logo is over 1 MB."); $("file").value = ""; return; }
    if (!(await ensureLogin())) { showMsg("Sign in with X to add a logo."); $("file").value = ""; return; }
    try {
      imageUrl = (await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } })).url;
      setCover(`<img src="${fmt.esc(imageUrl)}" alt="">`);
      showMsg("");
    } catch (e) { imageUrl = ""; $("file").value = ""; showMsg(e.message); preview(); }
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
    btn.disabled = true; btn.textContent = "Deploying on Base…";
    try {
      const r = await api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: $("pair").value || undefined }) });
      if (!imageUrl) setCover(XL.art({ symbol, token: r.token }));
      $("cover").style.pointerEvents = "none"; $("cam").hidden = true;
      $("doneSym").textContent = `$${symbol}`;
      $("doneShare").innerHTML = `${XL.X_SVG} Share on X`;
      $("doneShare").href = XL.tweetUrl(`I just launched $${symbol} on Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      $("composer").hidden = true; $("done").hidden = false;
      XL.coinRain({ symbol, token: r.token, image: imageUrl }, 16);
      XL.refreshMe();
    } catch (err) { showMsg(err.message); }
    finally { btn.textContent = "Launch on Base"; if (!XL.me?.ineligible) btn.disabled = false; }
  });

  $("doneAgain").addEventListener("click", () => {
    $("composer").reset(); touched = false; imageUrl = "";
    $("cover").style.pointerEvents = ""; $("cam").hidden = false;
    preview(); setQuota();
    $("done").hidden = true; $("composer").hidden = false; $("name").focus();
  });

  // ------------------------------------------------------------ démarrage et rafraîchissement
  function refresh() {
    if (document.hidden) return;
    if (pane === "token") loadShared();
    else if (pane !== "launch") loadFeed();
  }
  if (sharedToken) { show("token"); loadShared(true); } else show("launch");
  setInterval(refresh, 8000);
});
