// Accueil : compositeur (lancer un token comme on écrit un post) + fil des lancements
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  let imageUrl = "";
  let busy = false;

  XL.feeShare();

  // ------------------------------------------------------------ aperçu de la pièce
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 195 + (h % 70); };
  function preview() {
    const sym = $("symbol").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (sym !== $("symbol").value) $("symbol").value = sym;
    $("coin").style.setProperty("--h", hue(sym || "X"));
    if (!imageUrl) $("coin").textContent = sym ? sym.slice(0, 4) : "$";
    const used = $("description").value.length;
    $("chars").textContent = used ? `${280 - used}` : "";
  }
  let symbolTouched = false;
  $("symbol").addEventListener("input", () => { symbolTouched = true; preview(); });
  $("name").addEventListener("input", () => {
    if (!symbolTouched) $("symbol").value = $("name").value.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
    preview();
  });
  // la description grandit avec le texte, comme un post
  $("description").addEventListener("input", (e) => {
    e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; preview();
  });

  // ------------------------------------------------------------ paire
  let getPair = () => null;
  const togglePairs = (open = $("pairBox").hidden) => {
    $("pairBox").hidden = !open;
    $("pairToggle").setAttribute("aria-expanded", String(open));
  };
  $("pairToggle").addEventListener("click", () => togglePairs());
  $("pairNow").addEventListener("click", () => togglePairs());
  XL.pairPicker($("pairs"), (q) => {
    if (!q) return;
    $("pairNow").innerHTML = `${q.icon ? `<img src="${fmt.esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : ""}Paire : ${fmt.esc(q.symbol)} ▾`;
    $("pairHint").textContent = q.test ? `${q.symbol} est une action de test, sans valeur.` : "";
  }).then((fn) => (getPair = fn));

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
  function setLogo(url) {
    imageUrl = url;
    $("logoPrev").hidden = !url;
    if (url) {
      $("logoImg").src = url;
      $("coin").innerHTML = `<img src="${fmt.esc(url)}" alt="">`;
    } else preview();
  }
  $("logoRm").addEventListener("click", () => { $("file").value = ""; setLogo(""); });
  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { showMsg("Ce logo dépasse 1 Mo. Choisis une image plus légère."); $("file").value = ""; return; }
    if (!(await ensureLogin())) { showMsg("Connecte-toi avec X pour ajouter un logo."); $("file").value = ""; return; }
    try {
      const r = await api("/api/upload", { method: "POST", body: f, headers: { "Content-Type": f.type } });
      setLogo(r.url); showMsg("");
    } catch (e) { setLogo(""); showMsg(e.message); }
  });

  // ------------------------------------------------------------ quota
  XL.onAuth((me) => {
    if (!me) { $("quota").textContent = "Connexion X requise. Gas offert."; $("launchBtn").disabled = false; return; }
    if (me.ineligible) { $("quota").textContent = me.ineligible; $("launchBtn").disabled = true; return; }
    const left = Math.max(0, me.perDay - me.launchesLast24h);
    $("quota").textContent = left ? `${left} lancement${left > 1 ? "s" : ""} dispo aujourd'hui` : "Limite du jour atteinte";
    $("launchBtn").disabled = !left;
  });

  // ------------------------------------------------------------ lancement
  $("compose").addEventListener("submit", async (e) => {
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
    btn.disabled = true; btn.textContent = "Déploiement…";
    try {
      const r = await api("/api/launch", {
        method: "POST",
        body: JSON.stringify({ name, symbol, image: imageUrl, description: $("description").value.trim(), quote: getPair()?.address }),
      });
      $("doneCoin").innerHTML = XL.coin({ symbol, token: r.token, image: imageUrl }, 48);
      $("doneCoin").firstElementChild.classList.add("pulse");
      $("doneTitle").textContent = `$${symbol} est en ligne.`;
      $("doneShare").innerHTML = `${XL.X_SVG} Partager sur X`;
      $("doneShare").href = XL.tweetUrl(`Je viens de lancer $${symbol} sur Base 🔵`, r.share);
      $("donePage").href = "/t/" + r.token;
      $("compose").hidden = true; $("done").hidden = false;
      XL.refreshMe();
      load(true);
    } catch (err) {
      showMsg(err.message);
    } finally {
      busy = false;
      btn.textContent = "Lancer";
      if (XL.me && !XL.me.ineligible) btn.disabled = false;
    }
  });

  $("doneAgain").addEventListener("click", () => {
    $("compose").reset(); symbolTouched = false; setLogo("");
    $("description").style.height = "";
    $("pairs").dispatchEvent(new Event("change"));
    $("done").hidden = true; $("compose").hidden = false; $("name").focus();
  });

  // ouvert depuis « Lancer un token » (/#compose)
  if (location.hash === "#compose") setTimeout(() => $("name").focus(), 50);
  window.addEventListener("hashchange", () => { if (location.hash === "#compose") $("name").focus(); });

  // ------------------------------------------------------------ fil
  const PAGE = 20;
  let sort = "new";
  let count = PAGE;
  let seen = null;
  async function load(highlight = false) {
    try {
      const rows = await api(`/api/tokens?sort=${sort}&limit=${count + 1}`);
      const shown = rows.slice(0, count);
      $("feed").innerHTML = shown.map((t) => XL.post(t, highlight && seen && !seen.has(t.token))).join("");
      seen = new Set(shown.map((t) => t.token));
      $("feedEmpty").hidden = !!shown.length;
      $("more").hidden = rows.length <= count;
    } catch {}
  }
  document.querySelectorAll("[data-feed]").forEach((b) => b.addEventListener("click", () => {
    sort = b.dataset.feed; count = PAGE; seen = null;
    document.querySelectorAll("[data-feed]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    load();
  }));
  $("more").addEventListener("click", () => { count += PAGE; load(); });
  load();
  setInterval(() => { if (!document.hidden) load(true); }, 6000);
});
