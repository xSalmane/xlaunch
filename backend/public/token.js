// Page d'un token : le lancement comme un post détaillé, le graphique, puis les trades façon réponses
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const addr = location.pathname.split("/").pop();
  const cfg = await api("/api/config").catch(() => ({ explorer: "https://basescan.org" }));
  XL.feeShare();
  let first = true;
  let tok = null;

  async function loadToken() {
    const t = (tok = await api("/api/token/" + addr));
    if (first) {
      first = false;
      document.title = `$${t.symbol} — ${t.name}`;
      $("hTitle").textContent = `$${t.symbol}`;
      $("post").innerHTML = XL.post(t);
      $("tBuy").href = t.trade;
      $("tBuy").querySelector("span").textContent = `Buy with ${t.quote.symbol}`;
      $("tCopy").onclick = () => XL.copy(t.token, "Address copied");
      document.querySelector(".detail-card").style.setProperty("--h", XL.hue(t.token));
      $("fPair").innerHTML = XL.pair(t.quote);
      $("fAddr").textContent = fmt.short(t.token);
      $("fAddr").href = `${cfg.explorer}/token/${t.token}`;
      $("fPool").textContent = fmt.short(t.pool);
      $("fPool").href = `${cfg.explorer}/address/${t.pool}`;
      const d = new Date(t.createdAt * 1000);
      $("tMeta").dataset.when = `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
      // le post reste en place (pas de saut pendant un like) : on met juste à jour ses chiffres
      const card = $("post").querySelector("[data-token]");
      const likes = card?.querySelector("[data-likes]");
      if (likes && Number(likes.dataset.n) !== t.likes) { likes.dataset.n = t.likes; likes.textContent = XL.likesText(t.likes); }
      const pill = card?.querySelector(".ig-pill");
      if (pill) pill.innerHTML = `<span class="num ${XL.flash("m:" + t.token, t.mcapUsd)}">${fmt.usd(t.mcapUsd)}</span>${fmt.pct(t.change24h)}`;
    }
    const fl = (el, key, v) => { el.className = "num " + XL.flash(key, v); };
    $("kMcap").textContent = fmt.usd(t.mcapUsd); fl($("kMcap"), "k:m", t.mcapUsd);
    $("kPrice").textContent = "$" + fmt.price(t.priceUsd); fl($("kPrice"), "k:p", t.priceUsd);
    $("kPrice").title = `${fmt.price(t.price)} ${t.quote.symbol} per token`;
    $("kChange").innerHTML = fmt.pct(t.change24h);
    $("kVol").textContent = fmt.usd(t.volume24hUsd); fl($("kVol"), "k:v", t.volume24hUsd);
    $("fFees").textContent = fmt.usd(t.creatorFeesUsd);
    $("hSub").textContent = `${fmt.count(t.trades)} trade${t.trades === 1 ? "" : "s"}`;
    $("tMeta").innerHTML = `${$("tMeta").dataset.when} · <b style="color:var(--ink)">${fmt.count(t.trades)}</b> trades · <b style="color:var(--ink)">${fmt.usd(t.creatorFeesUsd)}</b> to the creator`;
  }

  async function loadTrades() {
    const rows = await api(`/api/token/${addr}/trades?limit=40`);
    const sym = tok?.quote?.symbol ?? "";
    const n = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
    const known = new Set([...$("trades").querySelectorAll("[data-tx]")].map((x) => x.dataset.tx));
    $("noTrades").hidden = !!rows.length;
    $("tradeCount").textContent = rows.length ? `latest ${rows.length}` : "";
    $("trades").innerHTML = rows.map((r) => {
      const buy = r.side === "buy";
      const fresh = known.size && !known.has(r.txHash);
      return `<div class="reply${fresh ? " post-enter" : ""}" data-tx="${r.txHash}">
        <span class="reply-dot ${buy ? "buy" : "sell"}">${XL.icon(buy ? "up" : "down", "sm")}</span>
        <div class="reply-body">
          <div><a href="${cfg.explorer}/address/${r.trader}" target="_blank" rel="noopener">${fmt.short(r.trader)}</a>
            <span class="mute">· <a class="mute" style="color:inherit" href="${cfg.explorer}/tx/${r.txHash}" target="_blank" rel="noopener">${fmt.ago(r.ts)}</a></span></div>
          <div>${buy ? "bought" : "sold"} <b>${n.format(r.tokens)} $${fmt.esc(tok?.symbol ?? "")}</b>
            ${buy ? "for" : "for"} <b>${fmt.esc(fmt.amount(r.quoteAmount, sym))}</b> <span class="mute">(${fmt.usd(r.usd)})</span></div>
        </div>
      </div>`;
    }).join("");
  }

  // ------------------------------------------------------------ graphique (SVG fait main)
  let points = [];
  let drawn = false;
  let chartUsd = 0;
  let quoteSym = "";
  async function loadChart() {
    const c = await api(`/api/token/${addr}/chart`);
    points = c.points; chartUsd = c.usd; quoteSym = c.quote;
    $("chartTitle").textContent = `Price in ${c.quote}`;
    drawChart();
  }
  function drawChart() {
    const box = $("chart");
    const W = box.clientWidth || 560, H = box.clientHeight || 240;
    const pad = { l: 2, r: 2, t: 14, b: 20 };
    if (!points.length) { box.innerHTML = ""; return; }
    const now = Math.floor(Date.now() / 1000);
    const pts = [...points, { ts: now, price: points[points.length - 1].price }];
    const t0 = pts[0].ts, t1 = Math.max(now, t0 + 60);
    const prices = pts.map((p) => p.price);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    if (hi === lo) { hi *= 1.1; lo *= 0.9; }
    const span = hi - lo; hi += span * 0.08; lo = Math.max(0, lo - span * 0.08);
    const x = (ts) => pad.l + ((ts - t0) / (t1 - t0)) * (W - pad.l - pad.r);
    const y = (p) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);

    // ligne en escalier : le prix reste constant entre deux trades
    let d = `M${x(pts[0].ts)},${y(pts[0].price)}`;
    for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].ts)}V${y(pts[i].price)}`;
    const area = `${d}V${H - pad.b}H${x(pts[0].ts)}Z`;
    const col = pts[pts.length - 1].price >= pts[0].price ? "var(--up)" : "var(--down)";
    const dur = t1 - t0;
    const label = (ts) => new Date(ts * 1000).toLocaleString("en-US", dur > 172800 ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" });

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".2"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(points[0].price)}" y2="${y(points[0].price)}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <path class="fill${drawn ? "" : " draw"}" d="${area}" fill="url(#fill)"/>
      <path class="line${drawn ? "" : " draw"}" d="${d}" fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      <text x="${pad.l}" y="${H - 4}" fill="var(--mute)" font-size="12">${label(t0)}</text>
      <text x="${W - pad.r}" y="${H - 4}" fill="var(--mute)" font-size="12" text-anchor="end">now</text>
      <line id="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--mute)" stroke-width="1" opacity="0"/>
      <circle id="cd" r="4" fill="${col}" opacity="0"/>
    </svg><div class="tip" hidden></div>`;

    const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cx = svg.getElementById("cx"), cd = svg.getElementById("cd");
    // le graphique se dessine une seule fois, à l'ouverture de la page
    if (!drawn) { const line = svg.querySelector(".line"); line.style.setProperty("--len", Math.ceil(line.getTotalLength() + 10)); drawn = true; }
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const ts = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
      let p = pts[0];
      for (const q of pts) { if (q.ts <= ts) p = q; else break; }
      const px = x(Math.min(ts, t1));
      cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.setAttribute("opacity", ".5");
      cd.setAttribute("cx", px); cd.setAttribute("cy", y(p.price)); cd.setAttribute("opacity", "1");
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((px / W) * r.width, 90), r.width - 90) + "px";
      tip.textContent = `${fmt.price(p.price)} ${quoteSym} · ${fmt.usd(p.price * 1e9 * chartUsd)} market cap`;
    };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("opacity", "0"); cd.setAttribute("opacity", "0"); });
  }
  window.addEventListener("resize", () => drawChart());

  try {
    await loadToken();
    await Promise.all([loadTrades(), loadChart()]);
  } catch (e) {
    $("tTitle").textContent = "Token not found";
    $("tSub").textContent = e.message;
    return;
  }
  setInterval(() => {
    if (document.hidden) return;
    loadToken().catch(() => {}); loadTrades().catch(() => {}); loadChart().catch(() => {});
  }, 5000);
});
