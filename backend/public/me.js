// Profil : le sien (/me : tokens, smart followers, gains) ou celui d'un créateur (/p/pseudo : tokens, smart followers)
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;
  const ADDR = /^0x[a-fA-F0-9]{40}$/;
  const pub = location.pathname.startsWith("/p/") ? decodeURIComponent(location.pathname.split("/")[2] || "").replace(/[^\w]/g, "") : null;
  let loaded = false;

  $("meLogin").innerHTML = `${XL.X_SVG} Sign in with X`;
  $("meLogin").onclick = () => XL.login().catch(() => {});

  // ------------------------------------------------------------ onglets (Tokens / Smart followers / Earnings)
  function tab(name) {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === name)));
    ["tokens", "smart", "gains"].forEach((t) => ($("tab-" + t).hidden = t !== name));
    if (name === "smart") loadSmart();
  }
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));
  $("sfLine").addEventListener("click", () => { tab("smart"); $("tab-smart").scrollIntoView({ behavior: "smooth", block: "start" }); });

  function msg(text, kind = "err") {
    const m = $("claimMsg");
    if (!text) { m.hidden = true; return; }
    m.className = "notice " + kind; m.innerHTML = text; m.hidden = false;
  }

  function header({ handle, avatar }) {
    $("pName").textContent = handle;
    $("pHandle").textContent = `@${handle}`;
    $("pX").href = `https://x.com/${encodeURIComponent(handle)}`;
    $("pAvatar").innerHTML = avatar
      ? `<img class="profile-avatar" src="${fmt.esc(avatar.replace("_normal", "_400x400"))}" alt="" referrerpolicy="no-referrer">`
      : `<span class="profile-avatar sf-ph">${fmt.esc(handle[0]?.toUpperCase() ?? "?")}</span>`;
    $("pAvatar").querySelector("img")?.addEventListener("error", (e) => {
      const s = document.createElement("span"); s.className = "profile-avatar sf-ph"; s.textContent = handle[0]?.toUpperCase() ?? "?"; e.target.replaceWith(s);
    });
  }
  function tokensGrid(tokens, own) {
    $("mine").innerHTML = tokens.map((t) => XL.tile(t)).join("");
    $("mineEmpty").hidden = !!tokens.length;
    $("mineEmpty").innerHTML = own
      ? `<b>No tokens launched</b>Your first token is one post away.<div style="margin-top:14px"><a class="btn" href="/#compose">Launch my token</a></div>`
      : `<b>No tokens yet</b>@${fmt.esc(pub)} hasn't launched a token on XLaunch.`;
    $("sTokens").textContent = tokens.length;
    $("sTokens").nextSibling.textContent = tokens.length === 1 ? " token" : " tokens";
    $("pSub").textContent = `${tokens.length} token${tokens.length === 1 ? "" : "s"} launched`;
  }

  // ------------------------------------------------------------ smart followers (Frontrun)
  let smartFor = null, smart = null, smartErr = "";
  const sfAvatar = (f, size) => f.avatar
    ? `<img class="sf-av" src="${fmt.esc(f.avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy" style="--s:${size}px" data-fallback="${fmt.esc(f.handle[0].toUpperCase())}">`
    : `<span class="sf-av sf-ph" style="--s:${size}px">${fmt.esc(f.handle[0].toUpperCase())}</span>`;

  async function fetchSmart(handle) {
    if (smartFor === handle.toLowerCase()) return;
    smartFor = handle.toLowerCase(); smart = null; smartErr = "";
    $("sfLine").hidden = false;
    $("sfLine").innerHTML = `<span class="sf-skel"></span><span class="mute">Loading smart followers…</span>`;
    try {
      const r = await api("/api/smart-followers/" + encodeURIComponent(handle));
      if (!r.configured) { $("sfLine").hidden = true; return; }
      smart = r;
    } catch (e) { smartErr = e.message || "Smart followers are unavailable right now."; }
    $("tabSmartBtn").hidden = false;
    $("sSmartWrap").hidden = !smart;
    if (smart) $("sSmart").textContent = fmt.count(smart.totalCount);
    drawLine(handle);
    if (!$("tab-smart").hidden) loadSmart();
  }

  function drawLine(handle) {
    const el = $("sfLine");
    if (!smart) { el.innerHTML = `<span class="mute">Smart followers unavailable right now</span>`; return; }
    const top = smart.followers.slice(0, 3);
    if (!top.length) { el.innerHTML = `<span class="mute">No smart followers yet</span>`; return; }
    const names = top.slice(0, 2).map((f) => `<b>${fmt.esc(f.name)}</b>`);
    const rest = smart.totalCount - names.length;
    el.innerHTML = `<span class="sf-stack">${top.map((f) => sfAvatar(f, 22)).join("")}</span>
      <span class="sf-txt">Followed by ${names.join(", ")}${rest > 0 ? ` and <b>${fmt.count(rest)} other smart account${rest === 1 ? "" : "s"}</b>` : ""}</span>`;
    el.title = `Smart followers of @${handle}, via Frontrun`;
  }

  function loadSmart() {
    const box = $("sfList");
    if (smartErr) { box.innerHTML = `<div class="feed-empty"><b>Unavailable right now</b>${fmt.esc(smartErr)}</div>`; return; }
    if (!smart) { box.innerHTML = `<div class="feed-empty">Loading…</div>`; return; }
    if (!smart.followers.length) { box.innerHTML = `<div class="feed-empty"><b>No smart followers yet</b>None of the accounts Frontrun tracks follows this profile.</div>`; return; }
    const more = smart.totalCount - smart.followers.length;
    box.innerHTML = smart.followers.map((f, n) => `<a class="sf-row" href="https://x.com/${fmt.esc(f.handle)}" target="_blank" rel="noopener" style="--d:${Math.min(n, 12) * 30}ms">
        ${sfAvatar(f, 44)}
        <span class="sf-main"><span class="sf-name"><b>${fmt.esc(f.name)}</b>${f.label ? `<span class="sf-tag">${fmt.esc(f.label)}</span>` : ""}</span>
          <span class="mute">@${fmt.esc(f.handle)}</span></span>
        <span class="sf-num"><b>${fmt.count(f.followers)}</b><span class="mute">followers</span></span>
      </a>`).join("") + (more > 0 ? `<div class="sf-more mute">and ${fmt.count(more)} more</div>` : "");
  }

  // ------------------------------------------------------------ profil public d'un créateur
  if (pub) {
    $("tabGainsBtn").hidden = true;
    $("loggedOut").hidden = true; $("loggedIn").hidden = false;
    $("pTitle").textContent = `@${pub}`;
    header({ handle: pub, avatar: "" });
    const loadPub = async () => {
      const p = await api("/api/profile/" + encodeURIComponent(pub));
      if (!loaded) { loaded = true; header(p); $("pTitle").textContent = `@${p.handle}`; document.title = `@${p.handle} — XLaunch`; }
      tokensGrid(p.tokens, false);
      $("sLikes").textContent = fmt.count(p.likesReceived);
      $("sLikes").nextSibling.textContent = p.likesReceived === 1 ? " like" : " likes";
      $("sEarned").textContent = fmt.usd(p.earnedTotalUsd);
    };
    loadPub().catch((e) => { $("mine").innerHTML = ""; $("mineEmpty").hidden = false; $("mineEmpty").textContent = e.message; });
    fetchSmart(pub);
    setInterval(() => { if (!document.hidden) loadPub().catch(() => {}); }, 15000);
    return;
  }

  // ------------------------------------------------------------ mon profil
  if (location.hash === "#earnings") tab("gains");

  async function load() {
    const c = await api("/api/creator");
    $("earned").textContent = fmt.usd(c.earnedTotalUsd);
    $("sEarned").textContent = fmt.usd(c.earnedTotalUsd);
    $("sLikes").textContent = fmt.count(c.likesReceived ?? 0);
    $("sLikes").nextSibling.textContent = c.likesReceived === 1 ? " like" : " likes";
    tokensGrid(c.tokens, true);
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
  }

  XL.onAuth((me) => {
    const logged = !!me;
    if (!logged && XL.isLogged()) return; // vérification de la session en cours
    $("loggedOut").hidden = logged;
    $("loggedIn").hidden = !logged;
    if (logged && !loaded) {
      loaded = true;
      $("pTitle").textContent = me.handle;
      header(me);
      load().catch((e) => msg(fmt.esc(e.message)));
      fetchSmart(me.handle);
    }
    if (!logged) { loaded = false; smartFor = null; $("pTitle").textContent = "Earnings"; $("pSub").textContent = ""; }
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
