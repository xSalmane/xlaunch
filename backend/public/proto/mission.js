document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { fmt } = XL;
  let sec = 10;
  setInterval(() => { sec = sec > 0 ? sec - 1 : 10; $("clock").textContent = `T-00:00:${String(sec).padStart(2, "0")}`; }, 1000);
  const paint = () => { const s = P.sym($("name").value); $("coin").innerHTML = XL.art({ symbol: s, token: "m:" + s }); };
  $("name").addEventListener("input", paint); paint();
  const views = (v) => { ["pad", "orbit", "log"].forEach((x) => ($(x).hidden = x !== v)); document.querySelectorAll(".tabs3 button").forEach((b) => b.classList.toggle("on", b.dataset.v === v || (v === "orbit" && b.dataset.v === "pad"))); if (v === "log") loadLog(); };
  document.querySelectorAll(".tabs3 button").forEach((b) => b.onclick = () => views(b.dataset.v));

  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sym = P.sym($("name").value);
    const deploy = P.fakeDeploy(sym);
    $("f").style.visibility = "hidden";
    for (const n of ["3", "2", "1"]) { $("count").innerHTML = `<span>${n}</span>`; await P.wait(650); }
    $("count").innerHTML = `<span class="lift">LIFTOFF</span>`;
    $("flame").classList.add("on"); document.body.classList.add("shake");
    for (let i = 0; i < 8; i++) { const s = document.createElement("div"); s.className = "smoke go"; s.style.left = 160 + Math.random() * 60 + "px"; s.style.setProperty("--dx", (Math.random() - 0.5) * 220 + "px"); s.style.animationDelay = i * 0.05 + "s"; $("stage").append(s); }
    const fly = [$("coin"), $("flame")].map((el) => el.animate([{ transform: "translateY(0)" }, { transform: "translateY(-30px)", offset: 0.25 }, { transform: "translateY(-460px)" }], { duration: 1500, easing: "cubic-bezier(.6,0,.9,.4)", fill: "forwards" }));
    await Promise.all([deploy, ...fly.map((a) => a.finished)]);
    document.body.classList.remove("shake");
    const t = { token: "0x7a3f", symbol: sym };
    $("coin2").innerHTML = XL.art({ symbol: sym, token: "m:" + sym });
    $("oSym").textContent = "$" + sym; views("orbit");
    await Promise.all([P.countUp($("alt"), 10040, 1200, fmt.usd), P.countUp($("vel"), 12.4, 1200, (v) => "+" + v.toFixed(1) + "%"), P.countUp($("crew"), 3, 1200, (v) => String(Math.round(v)))]);
  });

  async function loadLog() {
    const rows = await P.hot();
    $("rows").innerHTML = rows.slice(0, 7).map((t, i) => `<div class="row" style="animation-delay:${i * 70}ms"><span class="id">XL-${String(40 - i).padStart(4, "0")}</span><span><b>$${fmt.esc(t.symbol)}</b> <span class="st">ORBIT</span></span><span>${fmt.usd(t.mcapUsd)}</span><span class="${t.change24h >= 0 ? "up" : "down"}">${t.change24h >= 0 ? "▲" : "▼"}${Math.abs(t.change24h * 100).toFixed(0)}%</span></div>`).join("");
  }
});
