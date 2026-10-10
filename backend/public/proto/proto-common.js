// outils communs aux prototypes : données réelles pour Hot, faux déploiement pour Launch
window.P = {
  hot: () => XL.api("/api/tokens?sort=trending&limit=8").catch(() => []),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  media: (t) => (t.image ? `<img src="${XL.fmt.esc(t.image)}" alt="">` : XL.art(t)),
  fakeDeploy: async (sym) => { await new Promise((r) => setTimeout(r, 1400)); return { token: "0x7a3f" + Math.random().toString(16).slice(2, 10) + "c21e09b4a1d6f3e2b7c8a90d4e1f2a3b", symbol: sym }; },
  sym: (name) => name.normalize("NFD").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 7) || "NEW",
  countUp(el, to, ms, f) {
    const t0 = performance.now();
    return new Promise((res) => { const tick = (n) => { const k = Math.min(1, (n - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(to * e); k < 1 ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
  },
};
