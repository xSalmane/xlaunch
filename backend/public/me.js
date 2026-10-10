// Profil / Mes gains : total gagné, séquestre, récupération, mes tokens, robinet de test
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const ADDR = /^0x[a-fA-F0-9]{40}$/;
  let loaded = false;

  $("meLogin").innerHTML = `${XL.X_SVG} Sign in with X`;
  $("meLogin").onclick = () => XL.login().catch(() => {});

  // onglets Tokens / Earnings (un lien /me#earnings ouvre directement les gains)
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $("tab-gains").hidden = b.dataset.tab !== "gains";
    $("tab-tokens").hidden = b.dataset.tab !== "tokens";
  }));
  if (location.hash === "#earnings") document.querySelector('[data-tab="gains"]').click();

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
    $("sLikes").textContent = fmt.count(c.likesReceived ?? 0);
    $("pSub").textContent = `${c.tokens.length} token${c.tokens.length === 1 ? "" : "s"} launched`;
    const pending = c.escrow.filter((e) => e.amount !== "0");
    $("escrow").innerHTML = pending.map((e) => {
      const v = Number(BigInt(e.amount)) / 10 ** e.decimals;
      return `<div><span class="mute">Ready to claim</span><b>${fmt.esc(fmt.amount(v, e.symbol))} <span class="mute" style="font-weight:500">(${fmt.usd(e.usd)})</span></b></div>`;
    }).join("");
    $("escrowNote").textContent = c.boundWallet
      ? `Your earnings go to ${fmt.short(c.boundWallet)}. Fees build up in the pools and are sent to this address each time you claim.`
      : c.tokens.length
        ? "Fees build up in the pools. They're collected and sent to your address when you claim them."
        : "Launch a token to start earning trading fees.";
    if (c.boundWallet && !$("recipient").value) $("recipient").value = c.boundWallet;
    $("claimForm").hidden = !c.tokens.length;
    $("mine").innerHTML = c.tokens.map((t) => XL.tile(t)).join("");
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
    if (!logged) { loaded = false; $("pTitle").textContent = "Earnings"; $("pSub").textContent = ""; }
  });
  if (!XL.isLogged()) $("loggedOut").hidden = false;

  $("claimForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const recipient = $("recipient").value.trim();
    if (!ADDR.test(recipient)) { msg("This address isn't valid: it must start with 0x and be 42 characters long."); $("recipient").focus(); return; }
    if (!confirm(`Send your earnings to ${recipient}?\n\nDouble-check the address: transfers are final.`)) return;

    const btn = $("claimBtn");
    btn.disabled = true; btn.textContent = "Claiming…"; msg("");
    try {
      let r;
      try {
        r = await api("/api/claim", { method: "POST", body: JSON.stringify({ recipient }) });
      } catch (err) {
        if (!err.data?.reauth) throw err;
        // par sécurité, une connexion X récente est demandée avant d'envoyer des fonds
        msg("For security, sign in with X again to confirm.", "info");
        await XL.login();
        r = await api("/api/claim", { method: "POST", body: JSON.stringify({ recipient }) });
      }
      msg(`Earnings sent. <a href="${fmt.esc(r.explorer)}" target="_blank" rel="noopener">View transaction</a>`, "ok");
      load();
    } catch (err) {
      msg(fmt.esc(err.message));
    } finally {
      btn.disabled = false; btn.textContent = "Claim my earnings";
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
      if (!ADDR.test(address)) return show("This address isn't valid: it must start with 0x and be 42 characters long.", "err");
      if (!XL.me) { try { await XL.login(); } catch { return; } }
      $("faucetBtn").disabled = true; show("Sending, about 30 seconds…", "info");
      try {
        const r = await api("/api/test-faucet", { method: "POST", body: JSON.stringify({ address }) });
        show(`Sent: 10 ${r.sent.join(", 10 ")}.`, "ok");
      } catch (err) { show(err.message, "err"); }
      $("faucetBtn").disabled = false;
    });
  }).catch(() => {});
});
