// Explorer : recherche, tri, pagination et rafraîchissement automatique
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const PAGE = 30;
  const params = new URLSearchParams(location.search);
  let sort = ["new", "volume", "mcap"].includes(params.get("sort")) ? params.get("sort") : "new";
  let q = params.get("q") || "";
  let count = PAGE;
  let seen = null;

  $("q").value = q;
  const syncButtons = () => document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === sort)));
  syncButtons();

  function syncUrl() {
    const p = new URLSearchParams();
    if (sort !== "new") p.set("sort", sort);
    if (q) p.set("q", q);
    history.replaceState(null, "", location.pathname + (p.size ? "?" + p : ""));
  }

  async function load(highlight = false) {
    try {
      const rows = await XL.api(`/api/tokens?sort=${sort}&limit=${count + 1}&q=${encodeURIComponent(q)}`);
      const shown = rows.slice(0, count);
      $("list").querySelector("tbody").innerHTML = shown.map((t) => XL.tokenRow(t, highlight && seen && !seen.has(t.token))).join("");
      seen = new Set(shown.map((t) => t.token));
      $("list").hidden = !shown.length;
      $("more").hidden = rows.length <= count;
      $("empty").hidden = !!shown.length;
      $("empty").innerHTML = q
        ? `Aucun token ne correspond à « ${XL.fmt.esc(q)} ».`
        : `Aucun token lancé pour l'instant.<br><a class="btn" href="/">Lancer le premier</a>`;
    } catch (e) {
      $("empty").hidden = false;
      $("empty").textContent = e.message;
    }
  }

  document.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => { sort = b.dataset.sort; count = PAGE; seen = null; syncButtons(); syncUrl(); load(); })
  );
  let t;
  $("q").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { q = $("q").value.trim(); count = PAGE; seen = null; syncUrl(); load(); }, 250);
  });
  $("more").addEventListener("click", () => { count += PAGE; load(); });

  load();
  setInterval(() => { if (!document.hidden) load(true); }, 8000);
});
