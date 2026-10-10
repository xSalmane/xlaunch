// Page d'un token : chiffres clés, graphique du prix, trades, infos
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const addr = location.pathname.split("/").pop();
  const cfg = await api("/api/config").catch(() => ({ explorer: "https://basescan.org" }));
  let first = true;
  let quoteSym = "";

  async function loadToken() {
    const t = await api("/api/token/" + addr);
    if (first) {
      first = false;
      $("tCoin").innerHTML = XL.coin(t, 72);
      $("tTitle").innerHTML = `$${fmt.esc(t.symbol)} <span class="mute">${fmt.esc(t.name)}</span>`;
      $("tMeta").innerHTML = `<span>par <b>@${fmt.esc(t.creator)}</b></span><span>${fmt.ago(t.createdAt)}</span>`;
      $("tBuy").href = t.trade;
      $("tBuy").textContent = `Acheter avec ${t.quote.symbol}`;
      $("tPair").innerHTML = XL.pair(t.quote);
      quoteSym = t.quote.symbol;
      $("tShare").innerHTML = `${XL.X_SVG} Partager`;
      $("tShare").href = XL.tweetUrl(`$${t.symbol} sur Base, lancé depuis X`, t.share);
      $("tAddr").textContent = fmt.short(t.token);
      $("tAddr").title = "Copier l'adresse du contrat";
      $("tAddr").onclick = () => XL.copy(t.token, "Adresse copiée");
      $("tPool").textContent = fmt.short(t.pool);
      $("tPool").href = `${cfg.explorer}/address/${t.pool}`;
      if (t.description) { $("tDesc").textContent = t.description; $("tDesc").hidden = false; }
    }
    $("kMcap").textContent = fmt.usd(t.mcapUsd);
    $("kPrice").textContent = fmt.price(t.priceUsd) + " $";
    $("kPrice").title = `${fmt.price(t.price)} ${t.quote.symbol} par token`;
    $("kChange").innerHTML = fmt.pct(t.change24h);
    $("kVol").textContent = fmt.usd(t.volume24hUsd);
    $("kFees").textContent = fmt.usd(t.creatorFeesUsd);
    $("tTrades").textContent = new Intl.NumberFormat("fr-FR").format(t.trades);
  }

  async function loadTrades() {
    const rows = await api(`/api/token/${addr}/trades?limit=30`);
    $("noTrades").hidden = !!rows.length;
    $("trades").hidden = !rows.length;
    const n0 = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 2 });
    $("trades").querySelector("tbody").innerHTML = rows.map((r) => `
      <tr><td class="${r.side === "buy" ? "up" : "down"}">${r.side === "buy" ? "Achat" : "Vente"}</td>
      <td>${fmt.amount(r.quoteAmount, quoteSym)}<div class="tsub">${fmt.usd(r.usd)}</div></td>
      <td>${n0.format(r.tokens)}</td>
      <td class="hide-sm"><a href="${cfg.explorer}/address/${r.trader}" target="_blank" rel="noopener">${fmt.short(r.trader)}</a></td>
      <td><a href="${cfg.explorer}/tx/${r.txHash}" target="_blank" rel="noopener">${fmt.ago(r.ts)}</a></td></tr>`).join("");
  }

  // ------------------------------------------------------------ graphique (SVG fait main)
  let points = [];
  let chartUsd = 0;
  async function loadChart() {
    const c = await api(`/api/token/${addr}/chart`);
    points = c.points; chartUsd = c.usd;
    $("chartTitle").textContent = `Prix en ${c.quote}`;
    drawChart();
  }
  function drawChart() {
    const box = $("chart");
    const W = box.clientWidth || 600, H = box.clientHeight || 320;
    const pad = { l: 4, r: 4, t: 16, b: 22 };
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
    const up = pts[pts.length - 1].price >= pts[0].price;
    const col = up ? "var(--up)" : "var(--down)";
    const dur = t1 - t0;
    const label = (ts) => new Date(ts * 1000).toLocaleString("fr-FR", dur > 172800 ? { day: "numeric", month: "short" } : { hour: "2-digit", minute: "2-digit" });

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(points[0].price)}" y2="${y(points[0].price)}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <path d="${area}" fill="url(#fill)"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <text x="${pad.l}" y="${H - 4}" fill="var(--mute)" font-size="12">${label(t0)}</text>
      <text x="${W - pad.r}" y="${H - 4}" fill="var(--mute)" font-size="12" text-anchor="end">maintenant</text>
      <line id="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--mute)" stroke-width="1" opacity="0"/>
      <circle id="cd" r="4" fill="${col}" opacity="0"/>
    </svg><div class="tip" hidden></div>`;
    $("chartRange").textContent = `depuis le lancement`;

    const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cx = svg.getElementById("cx"), cd = svg.getElementById("cd");
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const ts = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
      let p = pts[0];
      for (const q of pts) { if (q.ts <= ts) p = q; else break; }
      const px = x(Math.min(ts, t1));
      cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.setAttribute("opacity", ".5");
      cd.setAttribute("cx", px); cd.setAttribute("cy", y(p.price)); cd.setAttribute("opacity", "1");
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((px / W) * r.width, 70), r.width - 70) + "px";
      tip.textContent = `${fmt.price(p.price)} ${quoteSym}, soit ${fmt.usd(p.price * 1e9 * chartUsd)} de market cap`;
    };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("opacity", "0"); cd.setAttribute("opacity", "0"); });
  }
  window.addEventListener("resize", () => drawChart());

  try {
    await Promise.all([loadToken(), loadTrades(), loadChart()]);
  } catch (e) {
    $("tTitle").textContent = "Token introuvable";
    $("tMeta").textContent = e.message;
    return;
  }
  setInterval(() => {
    if (document.hidden) return;
    loadToken().catch(() => {}); loadTrades().catch(() => {}); loadChart().catch(() => {});
  }, 5000);
});
