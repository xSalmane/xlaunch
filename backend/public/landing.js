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

  // ------------------------------------------------------------ le mur
  const narrow = matchMedia("(max-width: 640px)");
  let shown = [];
  function drawWall(rows, intro) {
    const cols = narrow.matches ? 5 : 6, total = cols * cols;
    const tokens = rows.slice(0, total - 1); // une case reste pour « le vôtre »
    const fresh = new Set(intro ? [] : tokens.filter((t) => !shown.includes(t.token)).map((t) => t.token));
    shown = tokens.map((t) => t.token);
    const cells = tokens.map((t) => `<a class="w-tile${fresh.has(t.token) ? " land" : ""}" href="/t/${fmt.esc(t.token)}" aria-label="$${fmt.esc(t.symbol)}, ${fmt.usd(t.mcapUsd)} market cap">
        ${media(t)}<span class="w-lbl">$${fmt.esc(t.symbol)}<span>${fmt.usd(t.mcapUsd)}</span></span></a>`);
    cells.push(`<a class="w-tile cta" href="/app#compose" aria-label="Launch your token"><b>+</b>Yours</a>`);
    // cases vides : quelques-unes plus foncées, réparties sans motif apparent
    while (cells.length < total) { const n = cells.length; cells.push(`<span class="w-tile empty${(n * 7 + 3) % 11 < 3 ? " alt" : ""}" aria-hidden="true"></span>`); }
    const wall = $("wall");
    wall.style.setProperty("--cols", cols);
    wall.innerHTML = cells.join("");
    if (intro) {
      // le mur s'assemble en diagonale, depuis le coin des derniers lancements
      [...wall.children].forEach((el, i) => {
        el.classList.add("in");
        el.style.setProperty("--d", ((i % cols) + Math.floor(i / cols)) * 45 + "ms");
      });
    }
  }
  async function loadWall(intro = false) {
    try {
      const rows = await api("/api/tokens?sort=new&limit=36");
      const sig = rows.map((t) => t.token).join(",");
      if (!intro && sig === shown.join(",")) return;
      drawWall(rows, intro);
    } catch { if (intro) drawWall([], true); }
  }
  narrow.addEventListener("change", () => loadWall(true));

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

  loadWall(true); loadStats(); loadTrend();
  setInterval(() => { if (!document.hidden) { loadWall(); loadStats(); loadTrend(); } }, 8000);
});
