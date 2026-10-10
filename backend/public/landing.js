// Vitrine : le mur de tokens en direct, les chiffres, les tokens du jour, les paires
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { api, fmt } = XL;

  // un nom tapé ici arrive pré-rempli dans le compositeur de l'app
  $("start").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("startName").value.trim();
    location.href = name ? `/app?name=${encodeURIComponent(name)}#compose` : "/app#compose";
  });

  const media = (t) => (t.image ? `<img src="${fmt.esc(t.image)}" alt="" loading="lazy">` : XL.art(t));

  // ------------------------------------------------------------ la pièce
  // Chaque token lancé depuis X est une face. La pièce se retourne toute seule, on peut la lancer au doigt,
  // et la face cachée prend le token suivant pendant qu'elle est de dos : on ne voit jamais le changement.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stage = $("stage"), coin = $("coin3d"), faces = [$("faceA"), $("faceB")];
  const YOURS = { yours: true };
  let list = [YOURS], seen = new Set(), fresh = new Set();

  // la tranche : des disques empilés, plus clairs au milieu
  const SLICES = 18;
  for (let i = 0; i < SLICES; i++) {
    const e = document.createElement("div");
    e.className = "m-edge" + (i > 3 && i < SLICES - 4 ? " lit" : "");
    e.style.transform = `translateZ(calc(var(--t) * ${(i / (SLICES - 1) - 0.5).toFixed(3)}))`;
    coin.prepend(e);
  }

  const item = (k) => list[((k % list.length) + list.length) % list.length];
  const faceHtml = (t) => t.yours
    ? `<div class="m-yours"><b>+</b>Your token<br>goes here</div>`
    : media(t);
  function paint(face, k) {
    const t = item(k);
    const key = t.yours ? "yours" : t.token;
    if (face.dataset.key === key) return;
    face.dataset.key = key;
    face.innerHTML = faceHtml(t);
  }
  function caption(t) {
    const el = $("coinInfo");
    if (t.yours) {
      el.href = "/app#compose";
      el.innerHTML = `<b>Yours?</b><span class="m-sub">Launch a token and it gets minted here</span>`;
      return;
    }
    el.href = "/t/" + t.token;
    el.innerHTML = `<b>$${fmt.esc(t.symbol)}${fresh.has(t.token) ? `<span class="m-new">Just launched</span>` : ""}</b>
      <span class="m-sub"><span>${fmt.esc(t.name)} by @${fmt.esc(t.creator)}</span><span><strong>${fmt.usd(t.mcapUsd)}</strong> ${fmt.pct(t.change24h)}</span><span class="m-likes">♥ ${fmt.count(t.likes)}</span></span>`;
  }

  let angle = 0, vel = 0, target = 0, dragging = false, hover = false, lastX = 0, lastK = null, lastFlip = performance.now();
  function frame(now) {
    if (!dragging) {
      if (reduce) { angle = target; vel = 0; }
      else { vel += (target - angle) * 0.045; vel *= 0.8; angle += vel; if (Math.abs(target - angle) < 0.05 && Math.abs(vel) < 0.05) { angle = target; vel = 0; } }
      // un retournement toutes les 3,6 s, sauf si on regarde de près
      if (!reduce && !hover && !document.hidden && now - lastFlip > 3600) { target += 180; lastFlip = now; }
    }
    const k = Math.round(angle / 180);
    const dir = vel < -0.01 ? -1 : 1;
    paint(faces[((k % 2) + 2) % 2], k);              // face visible
    paint(faces[(((k + 1) % 2) + 2) % 2], k + dir);  // face cachée : le prochain token dans le sens du mouvement
    if (k !== lastK) { lastK = k; caption(item(k)); }
    const bob = reduce ? 0 : Math.sin(now / 900) * 6;
    const tilt = 12 + (reduce ? 0 : Math.sin(now / 1300) * 3);
    coin.style.transform = `translateY(${bob.toFixed(2)}px) rotateX(${tilt.toFixed(2)}deg) rotateY(${angle.toFixed(2)}deg)`;
    stage.style.setProperty("--sw", (0.55 + 0.45 * Math.abs(Math.cos((angle * Math.PI) / 180)) - bob / 60).toFixed(3));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // lancer la pièce à la main
  stage.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; vel = 0; stage.classList.add("drag"); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX; lastX = e.clientX;
    vel = dx * 0.6; angle += vel;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false; stage.classList.remove("drag");
    target = Math.round((angle + vel * 14) / 180) * 180; // l'élan décide sur quelle face elle retombe
    lastFlip = performance.now();
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("pointerenter", () => (hover = true));
  stage.addEventListener("pointerleave", () => { hover = false; lastFlip = performance.now(); });
  $("prevCoin").addEventListener("click", () => { target = Math.round(target / 180) * 180 - 180; lastFlip = performance.now(); });
  $("nextCoin").addEventListener("click", () => { target = Math.round(target / 180) * 180 + 180; lastFlip = performance.now(); });

  async function loadCoins() {
    try {
      const rows = await api("/api/tokens?sort=new&limit=24");
      const first = !seen.size;
      rows.forEach((t) => { if (!first && !seen.has(t.token)) fresh.add(t.token); seen.add(t.token); });
      const before = list.map((t) => t.token ?? "yours").join(",");
      list = [...rows, YOURS];
      if (list.map((t) => t.token ?? "yours").join(",") === before) return;
      faces.forEach((f) => (f.dataset.key = "")); lastK = null;
      // un nouveau lancement : la pièce tourne pour le montrer
      if (!first && fresh.size) {
        const n = list.length, k = Math.round(target / 180), pos = ((k % n) + n) % n;
        target = (k + (pos === 0 ? n : n - pos)) * 180; // prochaine face qui montre list[0], le plus récent
      }
    } catch {}
  }

  // ------------------------------------------------------------ chiffres
  async function loadStats() {
    try {
      const [s, c] = await Promise.all([api("/api/stats"), api("/api/config")]);
      $("sLaunches").textContent = fmt.count(s.launches);
      $("sVol").textContent = fmt.usd(s.volume24hUsd);
      // ce que les créateurs ont gagné jusqu'ici : 1 % de frais, dont leur part
      $("stepEarn").textContent = fmt.usd(s.volumeTotalUsd * 0.01 * (c.creatorFeeBps / 10_000));
    } catch {}
  }

  // ------------------------------------------------------------ tokens du jour
  async function loadTrend() {
    try {
      const rows = await api("/api/tokens?sort=trending&limit=5");
      $("trend").innerHTML = rows.length
        ? rows.map((t) => `<a class="l-row" href="/t/${fmt.esc(t.token)}">
            <span class="l-thumb">${media(t)}</span>
            <span class="l-name"><b>$${fmt.esc(t.symbol)}</b><span>${fmt.esc(t.name)} by @${fmt.esc(t.creator)}</span></span>
            <span class="l-spark">${XL.spark(t.spark)}</span>
            <span class="l-num">${fmt.usd(t.mcapUsd)}</span>
            <span class="l-num l-chg">${fmt.pct(t.change24h)}</span>
            <span class="l-likes">♥ ${fmt.count(t.likes24h)}</span>
          </a>`).join("")
        : `<p class="l-empty">Nothing launched yet today. <a href="/app#compose">Be the first.</a></p>`;
    } catch {}
  }

  // ------------------------------------------------------------ paires
  api("/api/quotes").then((list) => {
    $("pairs").innerHTML = list.map((q) => `<span class="l-chip${q.paused ? " off" : ""}" title="${fmt.esc(q.name)}${q.paused ? ", paused by its issuer" : ""}">
        ${q.icon ? `<img src="${fmt.esc(q.icon)}" alt="" referrerpolicy="no-referrer">` : `<span class="l-chip-ic">${fmt.esc(q.symbol.slice(0, 1))}</span>`}
        ${fmt.esc(q.symbol)} <small>${fmt.esc(q.name)}</small></span>`).join("");
  }).catch(() => {});

  loadCoins(); loadStats(); loadTrend();
  setInterval(() => { if (!document.hidden) { loadCoins(); loadStats(); loadTrend(); } }, 8000);
});
