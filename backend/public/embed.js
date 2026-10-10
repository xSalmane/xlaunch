// Embed affiché dans le tweet (player card X) : lancement compact + fiche token
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  let imageUrl = "";

  // paire : menu déroulant compact (ETH, USDC, actions tokenisées)
  api("/api/quotes").then((quotes) => {
    const opt = (q) => `<option value="${fmt.esc(q.address)}" ${q.symbol === "ETH" ? "selected" : ""} ${q.paused ? "disabled" : ""}>${fmt.esc(q.symbol)} — ${fmt.esc(q.name)}</option>`;
    const crypto = quotes.filter((q) => q.kind !== "stock"), stocks = quotes.filter((q) => q.kind === "stock");
    $("pair").innerHTML = `<optgroup label="Crypto">${crypto.map(opt).join("")}</optgroup>` +
      (stocks.length ? `<optgroup label="Tokenized stocks">${stocks.map(opt).join("")}</optgroup>` : "");
  }).catch(() => {});

  const showMsg = (t, kind = "err") => { const m = $("msg"); m.hidden = !t; if (t) { m.className = "notice " + kind; m.textContent = t; } };
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };

  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    $("coin").style.setProperty("--h", hue(sym || "X"));
    if (!imageUrl) $("coin").textContent = sym ? sym.slice(0, 4) : "$";
  }
  let touched = false;
  $("symbol").addEventListener("input", () => { touched = true; preview(); });
  $("name").addEventListener("input", () => {
    if (!touched) $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    preview();
  });

  async function ensureLogin() {
    if (XL.me) return true;
    try { await XL.login(); return !!XL.me; } catch { return false; }
  }

  XL.onAuth((me) => {
    if (!me) { $("quota").textContent = "Sign in with X to launch."; $("launchBtn").disabled = false; return; }
    if (me.ineligible) { $("quota").textContent = me.ineligible; $("launchBtn").disabled = true; return; }
    const left = Math.max(0, me.perDay - me.launchesLast24h);
    $("quota").textContent = left ? `${left} launch${left > 1 ? "es" : ""} left today.` : "Daily limit reached.";
    $("launchBtn").disabled = !left;
  });

  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("This logo is over 1 MB."); return; }
    if (!(await ensureLogin())) { showMsg("Sign in with X to add a logo."); return; }
    $("fileInfo").textContent = "Uploading…";
    try {
      imageUrl = (await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } })).url;
      $("coin").innerHTML = `<img src="${fmt.esc(imageUrl)}" alt="">`;
      $("fileInfo").textContent = f.name; showMsg("");
    } catch (e) { imageUrl = ""; $("fileInfo").textContent = "1 MB max."; showMsg(e.message); }
  });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim(), symbol = $("symbol").value.trim();
    if (!name) return showMsg("Give your token a name.");
    if (symbol.length < 2) return showMsg("The ticker needs at least 2 characters.");
    showMsg("");
    if (!(await ensureLogin())) return showMsg("Sign in with X to launch your token.");
    const btn = $("launchBtn");
    btn.disabled = true; btn.textContent = "Deploying on Base…";
    try {
      const r = await api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: $("pair").value }) });
      $("composer").hidden = true; $("done").hidden = false;
      $("done").scrollIntoView({ block: "start", behavior: "smooth" });
      $("doneTitle").textContent = `$${symbol} is live.`;
      $("doneShare").innerHTML = `${XL.X_SVG} Share on X`;
      $("doneShare").href = XL.tweetUrl(`I just launched $${symbol} on Base 🔵`, r.share);
      XL.coinRain({ symbol, token: r.token, image: imageUrl }, 16);
      $("donePage").href = "/t/" + r.token;
      loadRecent();
    } catch (err) { showMsg(err.message); }
    finally { btn.textContent = "Launch on Base"; btn.disabled = false; }
  });

  async function loadRecent() {
    try {
      const rows = await api("/api/tokens?sort=new&limit=5");
      $("recent").innerHTML = rows.length
        ? rows.map((t) => `<a href="/t/${fmt.esc(t.token)}" target="_blank" rel="noopener">${XL.coin(t, 30)}
            <span><b>$${fmt.esc(t.symbol)}</b> ${XL.pair(t.quote)}<br><span class="mute">@${fmt.esc(t.creator)}</span></span>
            <span class="r">${fmt.usd(t.mcapUsd)}<br><span style="color:#ff2d55">♥ ${fmt.count(t.likes ?? 0)}</span></span></a>`).join("")
        : `<span class="mute">No tokens yet.</span>`;
    } catch {}
  }

  // fiche token si ouvert depuis le tweet d'un token
  const token = new URLSearchParams(location.search).get("token");
  if (token) {
    api("/api/token/" + encodeURIComponent(token)).then((t) => {
      $("tokenCard").hidden = false; $("composer").hidden = true; $("recentCard").hidden = true;
      $("tCoin").innerHTML = XL.coin(t, 52);
      $("tTitle").textContent = `$${t.symbol}`;
      $("tBy").innerHTML = `${fmt.esc(t.name)}, by @${fmt.esc(t.creator)} ${XL.pair(t.quote)}`;
      $("tMcap").textContent = fmt.usd(t.mcapUsd);
      $("tChange").innerHTML = fmt.pct(t.change24h);
      $("tBuy").href = t.trade;
      $("tBuy").textContent = `Buy with ${t.quote.symbol}`;
      $("tOpen").href = "/t/" + t.token;
    }).catch(() => {});
    $("tOwn").onclick = () => { $("tokenCard").hidden = true; $("composer").hidden = false; $("recentCard").hidden = false; };
  }

  loadRecent();
  setInterval(() => { if (!document.hidden) loadRecent(); }, 8000);
});
