document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const { fmt } = XL;
  const stage = $("stage");
  const tabs = (on) => `<nav class="tabs3"><button class="${on === "c" ? "on" : ""}" data-v="c">Create</button><button class="${on === "h" ? "on" : ""}" data-v="h">🔥 Hot</button></nav>`;
  let face = 0, current = null;
  // transition en cube : la nouvelle story arrive par la droite en tournant
  function swap(html) {
    const el = document.createElement("div"); el.className = "st"; el.innerHTML = html;
    el.style.transform = "rotateY(90deg)"; stage.append(el);
    const old = current; current = el;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = "rotateY(0)"; if (old) old.style.transform = "rotateY(-90deg)"; }));
    if (old) setTimeout(() => old.remove(), 750);
    el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => (b.dataset.v === "h" ? hot() : create())));
    return el;
  }
  function create() {
    clearTimeout(hotT);
    const el = swap(`<span class="cov" id="bg"></span><div class="shade"></div>
      <div class="bars"><span class="on" style="--d:999s"><i></i></span></div>
      <div class="who"><span class="av">Y</span><b>Your story</b><span>· create</span>${tabs("c")}</div>
      <div class="big"><h1 id="ttl">Name it</h1></div>
      <div class="stk t" id="sT">$NEW</div><div class="stk p">Pair ETH</div><div class="stk g">Gas $0</div>
      <form id="f"><input id="name" placeholder="Name your token…" autocomplete="off"><button>Launch ➤</button></form>
      <div class="posted" id="posted"><b id="pSym"></b>is live on Base</div>`);
    const paint = () => { const s = P.sym(el.querySelector("#name").value); el.querySelector("#bg").innerHTML = XL.art({ symbol: s, token: "s:" + s }); el.querySelector("#ttl").textContent = el.querySelector("#name").value || "Name it"; const t = el.querySelector("#sT"); t.textContent = "$" + s; t.classList.remove("bounce"); void t.offsetWidth; t.classList.add("bounce"); };
    el.querySelector("#name").addEventListener("input", paint); paint();
    el.querySelector("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const s = P.sym(el.querySelector("#name").value);
      const bar = el.querySelector(".bars span"); bar.className = "on"; bar.style.setProperty("--d", "1.5s");
      await P.fakeDeploy(s);
      el.querySelector("#pSym").textContent = "$" + s; el.querySelector("#posted").classList.add("on");
      el.querySelector("#f").style.opacity = "0";
      for (let i = 0; i < 14; i++) {
        const h = document.createElement("span"); h.className = "heart"; h.textContent = ["❤️", "🔵", "🚀"][i % 3]; h.style.left = 20 + Math.random() * 360 + "px"; el.append(h);
        h.animate([{ transform: "translateY(0) scale(0.6)", opacity: 1 }, { transform: `translateY(-${180 + Math.random() * 120}px) scale(1.2) rotate(${(Math.random() - 0.5) * 60}deg)`, opacity: 0 }], { duration: 1400 + Math.random() * 600, delay: i * 60, easing: "ease-out", fill: "forwards" });
      }
    });
  }
  let hotT;
  async function hot() {
    const rows = (await P.hot()).slice(0, 6);
    let i = 0;
    const show = () => {
      const t = rows[i % rows.length];
      swap(`<span class="cov">${P.media(t)}</span><div class="shade"></div>
        <div class="bars">${rows.map((_, j) => `<span class="${j < i % rows.length ? "done" : j === i % rows.length ? "on" : ""}"><i></i></span>`).join("")}</div>
        <div class="who"><span class="av">${fmt.esc(t.creator[0].toUpperCase())}</span><b>@${fmt.esc(t.creator)}</b><span>· ${fmt.ago(t.createdAt)}</span>${tabs("h")}</div>
        ${t.milestone ? `<div class="mstk">🏆 ${fmt.usd(t.milestone)}</div>` : ""}
        <div class="cap"><h2>$${fmt.esc(t.symbol)}</h2><p>${fmt.usd(t.mcapUsd)} · ${(t.change24h >= 0 ? "+" : "") + (t.change24h * 100).toFixed(0)}% · ♥ ${t.likes}</p></div>
        <div class="reply"><span>Reply to @${fmt.esc(t.creator)}…</span><b>♡</b><a href="#">Buy</a></div>`);
      i++; hotT = setTimeout(show, 2600);
    };
    clearTimeout(hotT); show();
  }
  create();
});
