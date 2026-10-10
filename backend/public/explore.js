// Explorer : recherche, tri (nouveaux, tendances, market cap), pagination, rafraîchissement
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const PAGE = 30;
  const params = new URLSearchParams(location.search);
  let sort = ["new", "trending", "mcap"].includes(params.get("sort")) ? params.get("sort") : params.get("sort") === "volume" ? "trending" : "new";
  let q = params.get("q") || "";
  let count = PAGE;

  $("q").value = q;
  const syncTabs = () => document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sort === sort)));
  syncTabs();

  function syncUrl() {
    const p = new URLSearchParams();
    if (sort !== "new") p.set("sort", sort);
    if (q) p.set("q", q);
    history.replaceState(null, "", location.pathname + (p.size ? "?" + p : ""));
  }

  async function load() {
    try {
      const rows = await XL.api(`/api/tokens?sort=${sort}&limit=${count + 1}&q=${encodeURIComponent(q)}`);
      const shown = rows.slice(0, count);
      $("list").innerHTML = shown.map((t, i) => XL.tile(t, sort === "new" ? 0 : i + 1)).join("");
      $("more").hidden = rows.length <= count;
      $("empty").hidden = !!shown.length;
      $("empty").innerHTML = q
        ? `<b>No results for "${XL.fmt.esc(q)}"</b>Try another name, a $ticker, an @creator or a pair (USDC, tNVDA…).`
        : `<b>No tokens yet</b>The first one could be yours.<div style="margin-top:14px"><a class="btn" href="/app#compose">Launch a token</a></div>`;
    } catch (e) {
      $("empty").hidden = false;
      $("empty").textContent = e.message;
    }
  }

  document.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => { sort = b.dataset.sort; count = PAGE; syncTabs(); syncUrl(); load(); })
  );
  let t;
  $("q").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { q = $("q").value.trim(); count = PAGE; syncUrl(); load(); }, 250);
  });
  $("qform").addEventListener("submit", (e) => { e.preventDefault(); q = $("q").value.trim(); syncUrl(); load(); });
  $("more").addEventListener("click", () => { count += PAGE; load(); });

  load();
  setInterval(() => { if (!document.hidden) load(); }, 8000);
});
