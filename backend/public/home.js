// Accueil : formulaire de lancement avec aperçu en direct + tokens récents
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt, toast } = XL;
  let imageUrl = "";
  let busy = false;

  XL.feeShare();

  // ------------------------------------------------------------ aperçu de la pièce
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };
  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    $("coinSym").innerHTML = `<small>$</small>${fmt.esc(sym || "TICKER")}`;
    $("stageName").textContent = $("name").value.trim() || "Ton token";
    $("bigCoin").style.setProperty("--h", hue(sym || "TICKER"));
    // le ticker doit tenir dans l'anneau intérieur de la pièce
    const len = (sym || "TICKER").length + 0.6;
    $("bigCoin").style.setProperty("--fit", Math.min(0.24, 1.05 / len).toFixed(3));
  }
  $("name").addEventListener("input", preview);
  $("symbol").addEventListener("input", preview);
  // le ticker se propose tout seul à partir du nom tant qu'on ne l'a pas touché
  let symbolTouched = false;
  $("symbol").addEventListener("input", () => (symbolTouched = true));
  $("name").addEventListener("input", () => {
    if (symbolTouched) return;
    $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    preview();
  });

  function showMsg(text, kind = "err") {
    const m = $("formMsg");
    if (!text) { m.hidden = true; return; }
    m.className = "notice " + kind; m.textContent = text; m.hidden = false;
  }

  async function ensureLogin() {
    if (XL.me) return true;
    if (XL.isLogged()) { await XL.refreshMe(); if (XL.me) return true; }
    try { await XL.login(); return !!XL.me; } catch { return false; }
  }

  // ------------------------------------------------------------ logo
  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("Ce logo dépasse 1 Mo. Choisis une image plus légère."); $("file").value = ""; return; }
    if (!(await ensureLogin())) { showMsg("Connecte-toi avec X pour ajouter un logo."); $("file").value = ""; return; }
    $("fileInfo").textContent = "Envoi du logo…";
    try {
      const r = await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } });
      imageUrl = r.url;
      const coin = $("bigCoin");
      coin.querySelector("img")?.remove();
      const img = new Image(); img.src = imageUrl; img.alt = "";
      coin.prepend(img); coin.classList.add("has-img");
      $("fileInfo").textContent = f.name;
      showMsg("");
    } catch (e) {
      imageUrl = ""; $("fileInfo").textContent = "PNG, JPG, GIF ou WebP, 1 Mo max.";
      showMsg(e.message);
    }
  });

  // ------------------------------------------------------------ quota
  XL.onAuth((me) => {
    if (!me) { $("quota").textContent = "Connexion X requise. Gas offert."; $("launchBtn").disabled = false; return; }
    if (me.ineligible) { $("quota").textContent = me.ineligible; $("launchBtn").disabled = true; return; }
    const left = Math.max(0, me.perDay - me.launchesLast24h);
    $("quota").textContent = left ? `Connecté en @${me.handle}. ${left} lancement${left > 1 ? "s" : ""} disponible${left > 1 ? "s" : ""} aujourd'hui.` : "Limite du jour atteinte. Reviens demain.";
    $("launchBtn").disabled = !left;
  });

  // ------------------------------------------------------------ lancement
  $("composer").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = $("name").value.trim();
    const symbol = $("symbol").value.trim();
    if (!name) { showMsg("Donne un nom à ton token."); $("name").focus(); return; }
    if (symbol.length < 2) { showMsg("Le ticker doit faire au moins 2 caractères."); $("symbol").focus(); return; }
    showMsg("");
    if (!(await ensureLogin())) { showMsg("Connecte-toi avec X pour lancer ton token."); return; }
    if (XL.me?.ineligible) { showMsg(XL.me.ineligible); return; }

    busy = true;
    const btn = $("launchBtn");
    btn.disabled = true; btn.textContent = "Déploiement sur Base…";
    try {
      const r = await api("/api/launch", {
        method: "POST",
        body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim() }),
      });
      $("bigCoin").classList.remove("pulse"); void $("bigCoin").offsetWidth; $("bigCoin").classList.add("pulse");
      $("composer").hidden = true;
      $("done").hidden = false;
      $("doneTitle").textContent = `$${symbol} est en ligne.`;
      $("doneShare").innerHTML = `${XL.X_SVG} Partager sur X`;
      $("doneShare").href = XL.tweetUrl(`Je viens de lancer $${symbol} sur Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      XL.refreshMe();
      loadLive();
    } catch (err) {
      showMsg(err.message);
    } finally {
      busy = false;
      btn.textContent = "Lancer sur Base";
      if (XL.me && !XL.me.ineligible) btn.disabled = false;
    }
  });

  $("doneAgain").addEventListener("click", () => {
    $("composer").reset(); imageUrl = ""; symbolTouched = false;
    $("bigCoin").classList.remove("has-img"); $("bigCoin").querySelector("img")?.remove();
    $("fileInfo").textContent = "PNG, JPG, GIF ou WebP, 1 Mo max.";
    preview();
    $("done").hidden = true; $("composer").hidden = false; $("name").focus();
  });

  // ------------------------------------------------------------ tokens récents
  let seen = null;
  async function loadLive() {
    try {
      const [rows, stats] = await Promise.all([api("/api/tokens?sort=new&limit=8"), api("/api/stats")]);
      const tbody = $("live").querySelector("tbody");
      tbody.innerHTML = rows.map((t) => XL.tokenRow(t, seen && !seen.has(t.token))).join("");
      seen = new Set(rows.map((t) => t.token));
      $("live").hidden = !rows.length;
      $("liveEmpty").hidden = !!rows.length;
      $("stats").innerHTML = `<span><b>${stats.launches}</b> tokens lancés</span><span><b>${fmt.eth(stats.volume24h)}</b> échangés en 24 h</span>`;
    } catch {}
  }
  loadLive();
  setInterval(() => { if (!document.hidden) loadLive(); }, 6000);
});
