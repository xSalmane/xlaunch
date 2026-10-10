// Mes gains : total gagné, séquestre, réclamation et liste de mes tokens
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const ADDR = /^0x[a-fA-F0-9]{40}$/;
  let loaded = false;

  $("meLogin").innerHTML = `${XL.X_SVG} Se connecter avec X`;
  $("meLogin").onclick = () => XL.login().catch(() => {});

  function msg(text, kind = "err") {
    const m = $("claimMsg");
    if (!text) { m.hidden = true; return; }
    m.className = "notice " + kind; m.innerHTML = text; m.hidden = false;
  }

  async function load() {
    const c = await api("/api/creator");
    $("earned").textContent = fmt.eth(c.earnedTotal, 4);
    const pending = c.escrow.filter((e) => e.amount !== "0");
    $("escrow").innerHTML = pending.map((e) => {
      const v = Number(BigInt(e.amount)) / 1e18;
      return `<div><span>En attente</span><b>${e.symbol === "ETH" ? fmt.eth(v, 5) : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v) + " " + fmt.esc(e.symbol)}</b></div>`;
    }).join("");
    $("escrowNote").textContent = c.boundWallet
      ? `Tes gains sont versés sur ${fmt.short(c.boundWallet)}. Les frais s'accumulent dans la pool et partent sur cette adresse à chaque récupération.`
      : c.tokens.length
        ? "Les frais s'accumulent dans la pool. Ils sont ramassés et envoyés sur ton adresse au moment où tu les récupères."
        : "";
    if (c.boundWallet && !$("recipient").value) $("recipient").value = c.boundWallet;
    $("claimForm").hidden = !c.tokens.length;

    $("mine").querySelector("tbody").innerHTML = c.tokens.map((t) => `
      <tr class="row" data-href="/t/${fmt.esc(t.token)}">
        <td><div class="tcell">${XL.coin(t, 34)}<a class="tname" href="/t/${fmt.esc(t.token)}">$${fmt.esc(t.symbol)} <span class="mute">${fmt.esc(t.name)}</span></a></div></td>
        <td>${fmt.eth(t.volumeTotal)}</td><td>${fmt.eth(t.creatorFeesEarned, 4)}</td>
      </tr>`).join("");
    $("mine").hidden = !c.tokens.length;
    $("mineEmpty").hidden = !!c.tokens.length;
  }

  XL.onAuth(async (me) => {
    const logged = !!me;
    if (!logged && XL.isLogged()) return; // en cours de vérification
    $("loggedOut").hidden = logged;
    $("loggedIn").hidden = !logged;
    if (logged && !loaded) {
      loaded = true;
      $("meSub").textContent = `Les frais de trading des tokens de @${me.handle}, réservés à ce compte X.`;
      load().catch((e) => msg(e.message));
    }
    if (!logged) loaded = false;
  });
  // pas de session du tout : afficher tout de suite l'invitation à se connecter
  if (!XL.isLogged()) { $("loggedOut").hidden = false; }

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
});
