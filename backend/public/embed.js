// Embed affiché dans le tweet (player card X) : lancement compact + fiche token
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  let imageUrl = "";

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
    if (!me) { $("quota").textContent = "Connexion X requise."; $("launchBtn").disabled = false; return; }
    if (me.ineligible) { $("quota").textContent = me.ineligible; $("launchBtn").disabled = true; return; }
    const left = Math.max(0, me.perDay - me.launchesLast24h);
    $("quota").textContent = left ? `${left} lancement${left > 1 ? "s" : ""} disponible${left > 1 ? "s" : ""} aujourd'hui.` : "Limite du jour atteinte.";
    $("launchBtn").disabled = !left;
  });

  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("Ce logo dépasse 1 Mo."); return; }
    if (!(await ensureLogin())) { showMsg("Connecte-toi avec X pour ajouter un logo."); return; }
    $("fileInfo").textContent = "Envoi…";
    try {
      imageUrl = (await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } })).url;
      $("coin").innerHTML = `<img src="${fmt.esc(imageUrl)}" alt="">`;
      $("fileInfo").textContent = f.name; showMsg("");
    } catch (e) { imageUrl = ""; $("fileInfo").textContent = "1 Mo max."; showMsg(e.message); }
  });

  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim(), symbol = $("symbol").value.trim();
    if (!name) return showMsg("Donne un nom à ton token.");
    if (symbol.length < 2) return showMsg("Le ticker doit faire au moins 2 caractères.");
    showMsg("");
    if (!(await ensureLogin())) return showMsg("Connecte-toi avec X pour lancer ton token.");
    const btn = $("launchBtn");
    btn.disabled = true; btn.textContent = "Déploiement sur Base…";
    try {
      const r = await api("/api/launch", { method: "POST", body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim() }) });
      $("composer").hidden = true; $("done").hidden = false;
      $("done").scrollIntoView({ block: "start", behavior: "smooth" });
      $("doneTitle").textContent = `$${symbol} est en ligne.`;
      $("doneShare").innerHTML = `${XL.X_SVG} Partager sur X`;
      $("doneShare").href = XL.tweetUrl(`Je viens de lancer $${symbol} sur Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      loadRecent();
    } catch (err) { showMsg(err.message); }
    finally { btn.textContent = "Lancer sur Base"; btn.disabled = false; }
  });

  async function loadRecent() {
    try {
      const rows = await api("/api/tokens?sort=new&limit=5");
      $("recent").innerHTML = rows.length
        ? rows.map((t) => `<a href="/t/${fmt.esc(t.token)}" target="_blank" rel="noopener">${XL.coin(t, 30)}
            <span><b>$${fmt.esc(t.symbol)}</b> <span class="mute">@${fmt.esc(t.creator)}</span></span>
            <span class="r">${fmt.eth(t.mcap, 2)}<br>${fmt.pct(t.change24h)}</span></a>`).join("")
        : `<span class="mute">Aucun token pour l'instant.</span>`;
    } catch {}
  }

  // fiche token si ouvert depuis le tweet d'un token
  const token = new URLSearchParams(location.search).get("token");
  if (token) {
    api("/api/token/" + encodeURIComponent(token)).then((t) => {
      $("tokenCard").hidden = false; $("composer").hidden = true; $("recentCard").hidden = true;
      $("tCoin").innerHTML = XL.coin(t, 52);
      $("tTitle").textContent = `$${t.symbol}`;
      $("tBy").textContent = `${t.name}, par @${t.creator}`;
      $("tMcap").textContent = fmt.eth(t.mcap, 2);
      $("tChange").innerHTML = fmt.pct(t.change24h);
      $("tBuy").href = t.trade;
      $("tOpen").href = "/t/" + t.token;
    }).catch(() => {});
    $("tOwn").onclick = () => { $("tokenCard").hidden = true; $("composer").hidden = false; $("recentCard").hidden = false; };
  }

  loadRecent();
  setInterval(() => { if (!document.hidden) loadRecent(); }, 8000);
});
