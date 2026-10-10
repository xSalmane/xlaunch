document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { fmt } = XL;
  $("eq").innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="animation-delay:${(i * 97) % 600}ms"></i>`).join("");
  const views = (v) => { $("deck").hidden = v !== "deck"; $("crate").hidden = v !== "crate"; document.querySelectorAll(".tabs3 button").forEach((b) => b.classList.toggle("on", b.dataset.v === v)); if (v === "crate") crate(); };
  document.querySelectorAll(".tabs3 button").forEach((b) => (b.onclick = () => views(b.dataset.v)));

  // les sillons du disque : un sillon en spirale dont le rayon suit la courbe de prix
  function grooves(prices) {
    let s = `<svg viewBox="-100 -100 200 200"><circle r="100" fill="#0a0b0d"/>`;
    for (let r = 42; r < 98; r += 2.2) s += `<circle r="${r.toFixed(1)}" fill="none" stroke="${Math.round(r) % 2 ? "#1b1d22" : "#26292f"}" stroke-width="1.2"/>`;
    const lo = Math.min(...prices), hi = Math.max(...prices), N = 240;
    let d = "";
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, k = prices[Math.floor((i / N) * (prices.length - 1))];
      const r = 62 + ((k - lo) / (hi - lo || 1)) * 26;
      d += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    }
    s += `<path d="${d}Z" fill="none" stroke="#3c8aff" stroke-width="2.2"/><circle r="99" fill="none" stroke="#32353d" stroke-width="2"/></svg>`;
    return s;
  }
  const curve = [1, 1.2, 1.1, 1.5, 1.4, 1.9, 1.7, 2.3, 2.1, 2.8, 2.6, 3.2];
  const paint = () => { const s = P.sym($("name").value); const art = XL.art({ symbol: s, token: "v:" + s }); $("sleeve").innerHTML = art + `<span class="tag">$${s}</span>`; $("label").innerHTML = art; };
  $("name").addEventListener("input", paint); paint();
  $("disc").innerHTML = grooves(curve);

  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const s = P.sym($("name").value);
    const deploy = P.fakeDeploy(s);
    // le disque sort de la pochette et se pose sur la platine
    $("sleeve").style.transform = "translateX(-40px) rotate(-8deg) scale(0.86)";
    const rec = $("rec"), deckW = rec.parentElement.clientWidth;
    rec.style.transform = `translateX(${deckW - 22 - 107 - 130}px)`;
    await P.wait(1000);
    rec.style.zIndex = 4; $("sleeve").style.transform = "translateX(-260px) rotate(-14deg)";
    $("arm").classList.add("on");
    await P.wait(900);
    rec.classList.add("spin"); $("eq").classList.add("on");
    await deploy;
    $("nowSym").textContent = "$" + s; $("now").classList.add("on");
    $("f").hidden = true; $("after").hidden = false;
  });

  let crateT;
  async function crate() {
    const rows = (await P.hot()).slice(0, 7);
    const box = $("crateBox");
    box.querySelectorAll(".sl").forEach((e) => e.remove());
    const els = rows.map((t, i) => { const el = document.createElement("div"); el.className = "sl cov"; el.innerHTML = P.media(t) + `<span class="tag">$${fmt.esc(t.symbol)}<small>${fmt.usd(t.mcapUsd)}</small></span>`; box.append(el); el._t = t; return el; });
    const lay = () => els.forEach((el, i) => { const k = els.length - 1 - i; el.style.zIndex = String(40 - k); el.style.transform = k === 0 ? "rotateX(-8deg)" : `translateY(${-k * 5}px) rotateX(${-52 + k * 2}deg)`; });
    els.reverse(); lay();
    clearInterval(crateT);
    crateT = setInterval(() => {
      // on feuillette : la pochette de devant bascule au fond du bac
      const front = els.pop(); front.style.transform = "translateY(-60px) rotateX(-75deg) scale(0.9)"; front.style.opacity = "0";
      setTimeout(() => { els.unshift(front); front.style.transition = "none"; front.style.opacity = "1"; lay(); requestAnimationFrame(() => (front.style.transition = "")); }, 600);
      lay();
      $("crateTxt").textContent = `$${els[els.length - 1]._t.symbol} · ♥ ${els[els.length - 1]._t.likes}`;
    }, 1700);
  }
});
