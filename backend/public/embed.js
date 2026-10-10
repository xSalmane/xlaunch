// Embed affiché dans le tweet (player card X) : rampe de lancement (ta pièce décolle pour de vrai), Hot / New façon reels
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
  $("logoBtn").innerHTML = XL.icon("image");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // ------------------------------------------------------------ le ciel et la rampe
  const NS = "http://www.w3.org/2000/svg";
  const sky = $("sky"), svg = $("skySvg"), coin = $("padCoin");
  let W = 0, H = 0, O = { x: 0, y: 0 }, planD = "", flying = false, recent = [];

  // trajectoire lissée (Catmull-Rom) à partir d'une liste de points
  function smooth(P) {
    let d = `M${P[0].x.toFixed(1)},${P[0].y.toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] ?? P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] ?? p2;
      d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }
  // un vol : décollage vertical puis la courbe de prix (ou une courbe montante pour ton futur token)
  function route(values, endY, endX) {
    const lo = Math.min(...values), hi = Math.max(...values);
    const P = [{ x: O.x, y: O.y }, { x: O.x + 4, y: O.y - Math.min(40, H * 0.22) }];
    const x0 = O.x + 26, x1 = endX, bottom = O.y - Math.min(46, H * 0.3);
    values.forEach((v, i) => {
      const k = hi > lo ? (v - lo) / (hi - lo) : i / Math.max(1, values.length - 1);
      P.push({ x: x0 + (i / Math.max(1, values.length - 1)) * (x1 - x0), y: bottom - k * (bottom - endY) });
    });
    return smooth(P);
  }
  function layoutSky() {
    const b = sky.getBoundingClientRect();
    if (!b.width || !b.height) return;
    W = b.width; H = b.height;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    O = { x: 44, y: H - 30 };
    if (!flying) coin.style.transform = `translate(${O.x}px, ${O.y}px)`;
    planD = route([0, 0.35, 0.22, 0.6, 0.48, 0.85, 1], Math.max(34, H * 0.2), W - 50);
    $("fPlan").setAttribute("d", flying ? "" : planD);
    drawOld();
  }
  // les vols des derniers tokens, en filigrane avec leur ticker
  function drawOld() {
    const g = $("fOld"); g.innerHTML = "";
    if (!W) return;
    recent.slice(0, 5).forEach((t, i) => {
      const endY = Math.max(16, H * (0.1 + 0.14 * i)), endX = W - 18 - (i % 3) * W * 0.08;
      const d = route(t.spark?.length > 1 ? t.spark : [1, 1.2], endY, endX);
      g.insertAdjacentHTML("beforeend", `<path class="f-old" d="${d}"/><circle class="f-node" cx="${endX}" cy="${endY}" r="3"/>`);
      const tag = document.createElementNS(NS, "text");
      tag.setAttribute("class", "f-tag"); tag.setAttribute("x", endX - 6); tag.setAttribute("y", endY - 7); tag.setAttribute("text-anchor", "end");
      tag.textContent = "$" + t.symbol; g.append(tag);
    });
  }
  new ResizeObserver(layoutSky).observe(sky);
  api("/api/tokens?sort=new&limit=5").then((rows) => { recent = rows; drawOld(); }).catch(() => {});

  // la pièce flotte doucement sur la rampe
  let bobT0 = performance.now();
  (function bob(now) {
    if (!flying && !reduce && W) coin.style.transform = `translate(${O.x}px, ${O.y + Math.sin((now - bobT0) / 600) * 3}px)`;
    requestAnimationFrame(bob);
  })(bobT0);

  function fx(kind, x, y, extra) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", kind === "ring" ? "f-ring" : "f-spark"); $("fFx").append(c);
    const t0 = performance.now(), life = kind === "ring" ? 650 : 450;
    const a = extra ?? 0, sp = 18 + Math.random() * 30;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / life);
      if (kind === "ring") { c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 6 + k * 34); c.setAttribute("stroke-width", 3 * (1 - k) + 0.3); c.setAttribute("stroke-opacity", 1 - k); }
      else { c.setAttribute("cx", x + Math.cos(a) * sp * k); c.setAttribute("cy", y + Math.sin(a) * sp * k); c.setAttribute("r", 2.2 * (1 - k)); }
      k < 1 ? requestAnimationFrame(tick) : c.remove();
    };
    requestAnimationFrame(tick);
  }

  // fait voler la pièce le long de la trajectoire, de `from` à `to` (0 → 1)
  function travel(from, to, ms, easeFn) {
    const live = $("fLive"), glow = $("fGlow"), len = live.getTotalLength();
    return new Promise((res) => {
      if (reduce || !len) { const p = live.getPointAtLength(len * to); coin.style.transform = `translate(${p.x}px, ${p.y}px)`; live.style.strokeDashoffset = glow.style.strokeDashoffset = String(len * (1 - Math.max(to, 0))); return res(); }
      const t0 = performance.now(); let lastSpark = 0;
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = from + (to - from) * easeFn(k);
        const p = live.getPointAtLength(len * e), q = live.getPointAtLength(Math.min(len, len * e + 2));
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        live.style.strokeDashoffset = glow.style.strokeDashoffset = String(len * (1 - e));
        coin.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${(ang * 180) / Math.PI + 90}deg)`;
        if (to > from && now - lastSpark > 30) { fx("spark", p.x, p.y, ang + Math.PI + (Math.random() - 0.5) * 1.3); lastSpark = now; }
        k < 1 ? requestAnimationFrame(tick) : res(p);
      };
      requestAnimationFrame(tick);
    });
  }
  const easeOut = (k) => 1 - Math.pow(1 - k, 3), easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2), easeIn = (k) => k * k;

  // décollage pendant le déploiement : la pièce monte, plane en attendant la confirmation de Base
  async function launchFlight(deploy) {
    flying = true; sky.classList.add("flying");
    const live = $("fLive"), glow = $("fGlow");
    $("fPlan").setAttribute("d", "");
    live.setAttribute("d", planD); glow.setAttribute("d", planD);
    const len = live.getTotalLength();
    live.style.strokeDasharray = glow.style.strokeDasharray = String(len);
    live.style.strokeDashoffset = glow.style.strokeDashoffset = String(len);
    fx("ring", O.x, O.y);
    const climb = travel(0, 0.62, 1500, easeOut);
    let hover = true;
    // en vol stationnaire : un petit balancement et un signal toutes les secondes
    climb.then(() => {
      if (!hover) return;
      const p = live.getPointAtLength(len * 0.62), t0 = performance.now(); let lastRing = 0;
      const tick = (now) => {
        if (!hover) return;
        coin.style.transform = `translate(${p.x + Math.sin((now - t0) / 260) * 2}px, ${p.y + Math.sin((now - t0) / 420) * 4}px) rotate(${Math.sin((now - t0) / 500) * 8}deg)`;
        if (now - lastRing > 1100) { fx("ring", p.x, p.y); lastRing = now; }
        requestAnimationFrame(tick);
      };
      if (!reduce) requestAnimationFrame(tick);
    });
    try {
      const [r] = await Promise.all([deploy(), climb]);
      hover = false;
      const end = await travel(0.62, 1, 900, easeInOut);
      const p = end ?? live.getPointAtLength(len);
      coin.style.transform = `translate(${p.x}px, ${p.y}px)`;
      fx("ring", p.x, p.y); fx("ring", p.x, p.y);
      return { r, end: p };
    } catch (err) {
      // échec : la pièce finit sa montée, puis retombe sur la rampe
      hover = false;
      await climb;
      await travel(0.62, 0, 700, easeIn);
      live.setAttribute("d", ""); glow.setAttribute("d", "");
      flying = false; sky.classList.remove("flying"); $("fPlan").setAttribute("d", planD);
      if (!reduce) { coin.animate([{ translate: "0 0" }, { translate: "-6px 0" }, { translate: "6px 0" }, { translate: "0 0" }], { duration: 300, iterations: 2 }); }
      throw err;
    }
  }

  // ------------------------------------------------------------ lancement
  function setCover(html) { $("prevArt").innerHTML = html; }
  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    if (imageUrl) return;
    setCover(XL.art({ symbol: sym || "NEW", token: "preview:" + sym }));
    if (!reduce && !flying) coin.animate([{ scale: 1 }, { scale: 1.12 }, { scale: 1 }], { duration: 260, easing: "ease-out" });
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
    $("cmpAv").innerHTML = me?.avatar ? `<img src="${fmt.esc(me.avatar)}" alt="" referrerpolicy="no-referrer">` : XL.X_SVG;
    if (!me) { quotaText = "Gas is on us. Sign in with X to launch"; $("launchBtn").disabled = false; }
    else if (me.ineligible) { quotaText = me.ineligible; $("launchBtn").disabled = true; }
    else {
      const left = Math.max(0, me.perDay - me.launchesLast24h);
      quotaText = left ? `Gas is on us. ${left} launch${left > 1 ? "es" : ""} left today` : "Daily limit reached";
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
  coin.addEventListener("click", (e) => { if (flying) e.preventDefault(); });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (flying) return;
    const name = $("name").value.trim(), symbol = $("symbol").value.trim();
    if (!name) { showMsg("Give your token a name."); $("name").focus(); return; }
    if (symbol.length < 2) { showMsg("The ticker needs at least 2 characters."); $("symbol").focus(); return; }
    showMsg("");
    if (!(await ensureLogin())) return showMsg("Sign in with X to launch your token.");
    if (XL.me?.ineligible) return showMsg(XL.me.ineligible);
    const btn = $("launchBtn");
    btn.disabled = true; btn.textContent = "Launching…";
    try {
      const { r, end } = await launchFlight(() => api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: $("pair").value || undefined }) }));
      if (!imageUrl) setCover(XL.art({ symbol, token: r.token }));
      const pin = $("skyPin");
      pin.href = "/t/" + r.token;
      pin.innerHTML = `<b>$${fmt.esc(symbol)}</b><span>Live on Base</span>`;
      pin.style.left = end.x + "px"; pin.style.top = end.y + "px"; pin.classList.add("on");
      $("doneSym").textContent = `$${symbol}`;
      $("doneShare").innerHTML = `${XL.X_SVG} Share on X`;
      $("doneShare").href = XL.tweetUrl(`I just launched $${symbol} on Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      $("composer").hidden = true; $("done").hidden = false;
      XL.refreshMe();
    } catch (err) { showMsg(err.message); }
    finally { btn.textContent = "Launch"; if (!XL.me?.ineligible) btn.disabled = false; }
  });

  $("doneAgain").addEventListener("click", () => {
    // la trajectoire rejoint les autres vols, une nouvelle pièce arrive sur la rampe
    const sym = $("doneSym").textContent;
    if (sym) recent.unshift({ symbol: sym.slice(1), spark: [0, 0.35, 0.22, 0.6, 0.48, 0.85, 1] });
    coin.style.transform = `translate(${O.x}px, ${O.y}px)`;
    $("fLive").setAttribute("d", ""); $("fGlow").setAttribute("d", ""); $("skyPin").classList.remove("on");
    flying = false; sky.classList.remove("flying");
    $("composer").reset(); touched = false; imageUrl = "";
    preview(); setQuota(); layoutSky();
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
