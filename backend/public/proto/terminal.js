document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { fmt } = XL;
  let timer;
  const views = (v) => { $("launch").hidden = v !== "launch"; $("top").hidden = v !== "top"; document.querySelectorAll(".tabs3 button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); if (v === "top") top(); };
  document.querySelectorAll(".tabs3 button").forEach((b) => (b.onclick = () => views(b.dataset.v)));
  const out = $("out");
  const line = (html, cls = "") => { const d = document.createElement("div"); d.className = "ln " + cls; d.innerHTML = html; out.append(d); return d; };
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  async function step(label, result, ms) {
    const d = line(`<span class="y">${SPIN[0]}</span> ${label}`);
    const t0 = performance.now(); let i = 0;
    await new Promise((r) => { const it = setInterval(() => { d.firstChild.textContent = SPIN[++i % SPIN.length]; if (performance.now() - t0 > ms) { clearInterval(it); r(); } }, 70); });
    d.innerHTML = `<span class="ok">✓</span> ${label} <span class="dim">${result}</span>`;
  }
  const hex = (n) => "0x" + Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  function asciiCoin(sym) {
    const s = ("$" + sym).slice(0, 8).padStart(Math.ceil((8 + ("$" + sym).slice(0, 8).length) / 2)).padEnd(8);
    return ["    .-~~~~~~-.", "  .'          '.", " /   " + s + "   \\", "|    ◉  base    |", " \\              /", "  '.          .'", "    '-......-'"].join("\n");
  }
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim() || "New Token", sym = P.sym(name), pair = $("pair").value;
    $("f").querySelector(".cur").remove(); $("go").remove();
    $("name").replaceWith(Object.assign(document.createElement("b"), { textContent: name })); $("pair").replaceWith(Object.assign(document.createElement("b"), { textContent: pair }));
    const deploy = P.fakeDeploy(sym);
    await step("signing in as @you", "ok", 380);
    await step(`deploying ERC-20 $${sym} · 1,000,000,000`, hex(6) + "…", 650);
    await step(`creating Uniswap v3 pool ${sym}/${pair} · 1% fee`, "ok", 520);
    await step("seeding 100% of supply into the pool", "ok", 420);
    await step("locking liquidity forever", "ok", 420);
    await deploy;
    line(`<span class="dim">gas paid by xlaunch: 0.00041 ETH · you paid: $0</span>`);
    line(asciiCoin(sym), "ascii");
    line(`<span class="ok">● LIVE</span> xlaunch.app/t/${hex(4)}…${hex(3).slice(2)}`);
    line(`<div class="btns"><a href="#">[ share on x ]</a><a class="o" href="#">[ open chart ]</a></div>`);
  });
  async function top() {
    const rows = await P.hot();
    const prev = new Map();
    const draw = () => {
      $("tbl").innerHTML = `<tr><th>#</th><th>ticker</th><th class="r">mcap</th><th class="r">24h</th><th class="r">♥</th></tr>` + rows.slice(0, 8).map((t, i) => {
        const jitter = 1 + (Math.random() - 0.5) * 0.02, mc = t.mcapUsd * jitter, changed = prev.has(t.token) && Math.abs(prev.get(t.token) - mc) / mc > 0.006;
        prev.set(t.token, mc);
        return `<tr><td class="dim">${i + 1}</td><td><b>$${fmt.esc(t.symbol)}</b></td><td class="r${changed ? " hl" : ""}">${fmt.usd(mc)}</td><td class="r ${t.change24h >= 0 ? "ok" : "y"}">${t.change24h >= 0 ? "+" : ""}${(t.change24h * 100).toFixed(1)}%</td><td class="r">${t.likes}</td></tr>`;
      }).join("");
    };
    draw(); clearInterval(timer); timer = setInterval(draw, 700);
  }
});
