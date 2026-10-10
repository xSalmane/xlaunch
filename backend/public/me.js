// Profil / Mes gains : total gagné, séquestre, récupération, mes tokens, robinet de test
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const ADDR = /^0x[a-fA-F0-9]{40}$/;
  let loaded = false;

  $("meLogin").innerHTML = `${XL.X_SVG} Se connecter avec X`;
  $("meLogin").onclick = () => XL.login().catch(() => {});

  // onglets Gains / Mes tokens
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("tab-gains").hidden = b.dataset.tab !== "gains";
    $("tab-tokens").hidden = b.dataset.tab !== "tokens";
  }));

  function msg(text, kind = "err") {
    const m = $("claimMsg");
    if (!text) { m.hidden = true; return; }
    m.className = "notice " + kind; m.innerHTML = text; m.hidden = false;
  }

  async function load() {
    const c = await api("/api/creator");
    $("earned").textContent = fmt.usd(c.earnedTotalUsd);
    $("sEarned").textContent = fmt.usd(c.earnedTotalUsd);
    $("sTokens").textContent = c.tokens.length;
    $("pSub").textContent = `${c.tokens.length} token${c.tokens.length > 1 ? "s" : ""} lancé${c.tokens.length > 1 ? "s" : ""}`;
    const pending = c.escrow.filter((e) => e.amount !== "0");
    $("escrow").innerHTML = pending.map((e) => {
      const v = Number(BigInt(e.amount)) / 10 ** e.decimals;
      return `<div><span class="mute">En attente</span><b>${fmt.esc(fmt.amount(v, e.symbol))} <span class="mute" style="font-weight:500">(${fmt.usd(e.usd)})</span></b></div>`;
    }).join("");
    $("escrowNote").textContent = c.boundWallet
      ? `Tes gains sont versés sur ${fmt.short(c.boundWallet)}. Les frais s'accumulent dans les pools et partent sur cette adresse à chaque récupération.`
      : c.tokens.length
        ? "Les frais s'accumulent dans les pools. Ils sont ramassés et envoyés sur ton adresse au moment où tu les récupères."
        : "Lance un token pour commencer à toucher des frais de trading.";
    if (c.boundWallet && !$("recipient").value) $("recipient").value = c.boundWallet;
    $("claimForm").hidden = !c.tokens.length;
    $("mine").innerHTML = c.tokens.map((t) => XL.post(t)).join("");
    $("mineEmpty").hidden = !!c.tokens.length;
  }

  XL.onAuth((me) => {
    const logged = !!me;
    if (!logged && XL.isLogged()) return; // vérification de la session en cours
    $("loggedOut").hidden = logged;
    $("loggedIn").hidden = !logged;
    if (logged && !loaded) {
      loaded = true;
      $("pTitle").textContent = me.handle;
      $("pName").textContent = me.handle;
      $("pHandle").textContent = `@${me.handle}`;
      $("pX").href = `https://x.com/${encodeURIComponent(me.handle)}`;
      $("pAvatar").innerHTML = me.avatar
        ? `<img class="profile-avatar" src="${fmt.esc(me.avatar.replace("_normal", "_400x400"))}" alt="" referrerpolicy="no-referrer">`
        : `<span class="profile-avatar"></span>`;
      $("pAvatar").querySelector("img")?.addEventListener("error", (e) => {
        const s = document.createElement("span"); s.className = "profile-avatar"; e.target.replaceWith(s);
      });
      load().catch((e) => msg(fmt.esc(e.message)));
    }
    if (!logged) { loaded = false; $("pTitle").textContent = "Mes gains"; $("pSub").textContent = ""; }
  });
  if (!XL.isLogged()) $("loggedOut").hidden = false;

  $("claimForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const recipient = $("recipient").value.trim();
    if (!ADDR.test(recipient)) { msg("Cette adresse n'est pas valide : elle doit commencer par 0x et faire 42 caractères."); $("recipient").focus(); return; }
    if (!confirm(`Envoyer tes gains vers ${recipient} ?\n\nVérifie bien l'adresse : l'envoi est définitif.`)) return;

    const btn = $("claimBtn");
    btn.disabled = true; btn.textContent = "Récupération en cours…"; msg("");
    try {
      let r;
      try {
        r = await api("/api/claim", { method: "POST", body: JSON.stringify({ recipient }) });
      } catch (err) {
        if (!err.data?.reauth) throw err;
        // par sécurité, une connexion X récente est demandée avant d'envoyer des fonds
        msg("Par sécurité, reconnecte-toi avec X pour confirmer.", "info");
        await XL.login();
        r = await api("/api/claim", { method: "POST", body: JSON.stringify({ recipient }) });
      }
      msg(`Gains envoyés. <a href="${fmt.esc(r.explorer)}" target="_blank" rel="noopener">Voir la transaction</a>`, "ok");
      load();
    } catch (err) {
      msg(fmt.esc(err.message));
    } finally {
      btn.disabled = false; btn.textContent = "Récupérer mes gains";
    }
  });

  setInterval(() => { if (!document.hidden && loaded) load().catch(() => {}); }, 10000);

  // ------------------------------------------------------------ robinet d'actions de test (testnet)
  api("/api/config").then((c) => {
    if (!c.testFaucet) return;
    $("faucet").hidden = false;
    $("faucetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const address = $("faucetAddr").value.trim();
      const m = $("faucetMsg");
      const show = (t, k) => { m.className = "notice " + k; m.textContent = t; m.hidden = false; };
      if (!ADDR.test(address)) return show("Cette adresse n'est pas valide : elle doit commencer par 0x et faire 42 caractères.", "err");
      if (!XL.me) { try { await XL.login(); } catch { return; } }
      $("faucetBtn").disabled = true; show("Envoi en cours, environ 30 secondes…", "info");
      try {
        const r = await api("/api/test-faucet", { method: "POST", body: JSON.stringify({ address }) });
        show(`Envoyé : 10 ${r.sent.join(", 10 ")}.`, "ok");
      } catch (err) { show(err.message, "err"); }
      $("faucetBtn").disabled = false;
    });
  }).catch(() => {});
});
