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

  loadStats(); loadTrend();
  setInterval(() => { if (!document.hidden) { loadStats(); loadTrend(); } }, 8000);
});
