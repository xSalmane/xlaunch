document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { fmt } = XL;
  const views = (v) => { $("mint").hidden = v !== "mint"; $("hot").hidden = v !== "hot"; document.querySelectorAll(".tabs3 button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); if (v === "hot") startPusher(); };
  document.querySelectorAll(".tabs3 button").forEach((b) => (b.onclick = () => views(b.dataset.v)));
  $("name").addEventListener("input", () => { const s = P.sym($("name").value); $("ghost").textContent = "$" + s; $("tk").textContent = s; $("blank").animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 200 }); });

  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sym = P.sym($("name").value);
    const deploy = P.fakeDeploy(sym);
    $("face").innerHTML = XL.art({ symbol: sym, token: "p:" + sym });
    // la presse descend, frappe, remonte
    const H = $("press").clientHeight, drop = H - 26 - 84 - 30 - 104 + 6;
    await $("ram").animate([{ transform: "translateY(0)" }, { transform: "translateY(-14px)", offset: 0.5 }, { transform: `translateY(${drop}px)` }], { duration: 520, easing: "cubic-bezier(.7,0,1,.6)", fill: "forwards" }).finished;
    $("blank").classList.add("struck");
    document.body.classList.add("shake"); setTimeout(() => document.body.classList.remove("shake"), 360);
    $("flash").animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(9)" }], { duration: 420, easing: "ease-out" });
    $("blank").animate([{ transform: "scale(1.18, 0.8)" }, { transform: "scale(0.95, 1.05)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
    for (let i = 0; i < 16; i++) {
      const s = document.createElement("i"); s.className = "spark"; $("press").append(s);
      const a = Math.PI + (i / 15) * Math.PI, d = 70 + Math.random() * 70;
      s.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d * 0.7 + 40}px)`, opacity: 0 }], { duration: 600 + Math.random() * 300, easing: "cubic-bezier(.2,.8,.4,1)" }).onfinish = () => s.remove();
    }
    await P.wait(260);
    $("ram").animate([{ transform: `translateY(${drop}px)` }, { transform: "translateY(0)" }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    await deploy;
    // la pièce saute et tourne : elle est frappée
    $("blank").animate([{ transform: "translateY(0) rotateY(0)" }, { transform: "translateY(-70px) rotateY(540deg)", offset: 0.55 }, { transform: "translateY(0) rotateY(720deg)" }], { duration: 1200, easing: "cubic-bezier(.3,.7,.4,1)" });
    $("mintedTxt").textContent = `$${sym} minted on Base`; $("minted").classList.add("on");
    $("f").hidden = true; $("after").hidden = false;
  });

  let pusherOn = false;
  async function startPusher() {
    if (pusherOn) return; pusherOn = true;
    const rows = await P.hot();
    if (!rows.length) return;
    const tray = $("tray"), W = tray.clientWidth, Hh = tray.clientHeight;
    const slots = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) slots.push({ x: 18 + c * (W - 110) / 2, y: 50 + r * ((Hh - 130) / 2) });
    let q = 0;
    const coins = slots.map((s, i) => { const el = document.createElement("div"); el.className = "pc cov"; const t = rows[q++ % rows.length]; el._t = t; el.innerHTML = P.media(t); el.style.left = s.x + "px"; el.style.top = s.y + "px"; el._r = Math.floor(i / 3); tray.append(el); return el; });
    const show = (t) => ($("tick").innerHTML = `$${fmt.esc(t.symbol)} <span>${fmt.usd(t.mcapUsd)} · ♥ ${t.likes}</span>`);
    show(coins[coins.length - 1]._t);
    setInterval(() => {
      // la rangée de devant tombe, tout avance d'un cran, une nouvelle rangée arrive au fond
      coins.filter((c) => c._r === 2).forEach((c) => { c.classList.add("drop"); setTimeout(() => c.remove(), 800); show(c._t); });
      coins.splice(0, coins.length, ...coins.filter((c) => c._r < 2));
      coins.forEach((c) => { c._r++; c.style.top = 50 + c._r * ((Hh - 130) / 2) + "px"; });
      for (let k = 0; k < 3; k++) { const el = document.createElement("div"); el.className = "pc cov"; const t = rows[q++ % rows.length]; el._t = t; el._r = 0; el.innerHTML = P.media(t); el.style.left = slots[k].x + "px"; el.style.top = "10px"; el.style.opacity = "0"; tray.append(el); requestAnimationFrame(() => { el.style.top = "50px"; el.style.opacity = "1"; }); coins.push(el); }
    }, 2000);
  }
});
