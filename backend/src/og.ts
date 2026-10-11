// Image de partage d'un token (1200×630) : ce que X affiche dans le tweet, surtout sur mobile.
// Même couverture générative que sur le site (même algorithme, même graine), plus les chiffres du moment.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import type { TokenView } from "./market.js";

const require = createRequire(import.meta.url);
const fontFiles = (pkg: string, prefix: string, weights: string[]) => {
  const dir = path.dirname(require.resolve(`@expo-google-fonts/${pkg}/package.json`));
  return weights.map((w) => path.join(dir, w, `${prefix}_${w}.ttf`)).filter((f) => fs.existsSync(f));
};
// mêmes polices que le site : Funnel Sans partout (Funnel Display a des éperons qui ressemblent à des points)
const FONTS = [...fontFiles("funnel-sans", "FunnelSans", ["500Medium", "700Bold", "800ExtraBold"])];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

// ------------------------------------------------------------ couverture (copie fidèle de XL.art côté navigateur)
function seedOf(str: string) { let h = 2166136261; for (const c of String(str).toLowerCase()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function artSvg(t: { token: string | null; symbol: string }, id: string) {
  const r = rng(seedOf(t.token || t.symbol));
  const h1 = Math.floor(r() * 360), h2 = (h1 + 40 + Math.floor(r() * 140)) % 360;
  const kind = Math.floor(r() * 4);
  const ang = Math.floor(r() * 360);
  let pat = "";
  if (kind === 0) {
    const cx = 20 + r() * 60, cy = 20 + r() * 60;
    for (let i = 1; i <= 12; i++) pat += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(i * 9).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="${(0.06 + r() * 0.16).toFixed(2)}" stroke-width="${(1 + r() * 3).toFixed(1)}"/>`;
  } else if (kind === 1) {
    const n = 18 + Math.floor(r() * 14);
    for (let i = 0; i < n; i++) {
      const a1 = (i / n) * Math.PI * 2, a2 = ((i + 0.5) / n) * Math.PI * 2;
      if (i % 2) pat += `<path d="M50,50 L${(50 + 90 * Math.cos(a1)).toFixed(1)},${(50 + 90 * Math.sin(a1)).toFixed(1)} L${(50 + 90 * Math.cos(a2)).toFixed(1)},${(50 + 90 * Math.sin(a2)).toFixed(1)}Z" fill="#fff" fill-opacity="0.09"/>`;
    }
  } else if (kind === 2) {
    for (let x = 5; x < 100; x += 10) for (let y = 5; y < 100; y += 10) pat += `<circle cx="${x}" cy="${y}" r="${(0.6 + r() * 2.6).toFixed(1)}" fill="#fff" fill-opacity="${(0.12 + r() * 0.25).toFixed(2)}"/>`;
  } else {
    for (let i = 0; i < 9; i++) {
      const y = 8 + i * 11, a = 3 + r() * 6, f = 1 + r() * 2;
      let d = `M0,${y}`;
      for (let x = 0; x <= 100; x += 5) d += ` L${x},${(y + a * Math.sin((x / 100) * Math.PI * 2 * f + i)).toFixed(1)}`;
      pat += `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${(0.1 + r() * 0.18).toFixed(2)}" stroke-width="${(1.5 + r() * 2.5).toFixed(1)}"/>`;
    }
  }
  const sym = "$" + String(t.symbol || "?").slice(0, 8);
  const fs_ = Math.min(13, 62 / sym.length);
  return {
    hue: h1,
    inner: `<defs><linearGradient id="${id}" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="hsl(${h1},78%,56%)"/><stop offset="1" stop-color="hsl(${h2},82%,42%)"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#${id})"/>${pat}
      <circle cx="50" cy="50" r="27" fill="hsl(${h1},85%,52%)" stroke="#fff" stroke-opacity="0.95" stroke-width="2.4"/>
      <circle cx="50" cy="50" r="22.5" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="1.2"/>
      <text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="Funnel Sans" font-weight="700" font-size="${fs_.toFixed(1)}" fill="#fff">${esc(sym)}</text>`,
  };
}

// ------------------------------------------------------------ formats
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = (v: number) => (v >= 1000 ? "$" + compact.format(v) : "$" + (v >= 1 ? v.toFixed(0) : v.toFixed(2)));
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
const fit = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/** logo envoyé par le créateur, en data URI (seulement s'il vient de nos uploads) */
function logoData(image: string, uploadDir: string): string | null {
  const m = /\/u\/([\w.-]+)$/.exec(image || "");
  if (!m) return null;
  const file = path.join(uploadDir, m[1]);
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  const type = buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : buf.subarray(0, 3).toString() === "GIF" ? "image/gif" : buf.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  return type ? `data:${type};base64,${buf.toString("base64")}` : null;
}

function sparkPath(points: number[], x: number, y: number, w: number, h: number) {
  const pts = points.length > 1 ? points : [points[0] ?? 1, points[0] ?? 1];
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi === lo) { hi *= 1.05; lo *= 0.95; }
  const px = (i: number) => x + (i / (pts.length - 1)) * w;
  const py = (v: number) => y + (1 - (v - lo) / (hi - lo || 1)) * h;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  return { line, area: `${line} L${x + w},${y + h} L${x},${y + h} Z` };
}

export function renderTokenCard(t: TokenView & { spark?: number[] }, opts: { uploadDir: string; chainLabel: string; site: string }): Buffer {
  const W = 1200, H = 630;
  const art = artSvg(t, "g");
  const logo = logoData(t.image, opts.uploadDir);
  const cover = logo
    ? `<image href="${logo}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice"/>`
    : art.inner;
  const up = t.change24h >= 0;
  const col = up ? "#66c800" : "#fc401f";
  const sp = sparkPath(t.spark?.length ? t.spark : [t.price], 640, 430, 480, 92);
  const sym = fit("$" + t.symbol, 11);
  const symSize = Math.round(Math.min(104, 520 / (sym.length * 0.72)));
  const milestone = t.milestone ? `<g transform="translate(96,104) rotate(-3)"><rect width="${usd(t.milestone).length * 13 + 96}" height="44" rx="22" fill="#111827" fill-opacity="0.82" stroke="#ffd12f" stroke-opacity="0.8" stroke-width="2"/><path transform="translate(14,10)" d="m12 2 3 6.2 6.8 1-4.9 4.8 1.2 6.8L12 17.6 5.9 20.8l1.2-6.8L2.2 9.2l6.8-1z" fill="#ffd257"/><text x="44" y="29" font-size="20" font-weight="700" fill="#ffd257">Hit ${usd(t.milestone)}</text></g>` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <clipPath id="clip"><rect x="0" y="0" width="100" height="100" rx="8"/></clipPath>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient>
    
  </defs>
  <rect width="${W}" height="${H}" fill="#0a0b0d"/>
  <g filter="url(#blur)" opacity="0.55"><circle cx="300" cy="315" r="260" fill="hsl(${art.hue},85%,52%)"/></g>
  <g transform="translate(70,80) rotate(-3 235 235)">
    <rect x="-2" y="-2" width="474" height="474" rx="40" fill="#fff" fill-opacity="0.16"/>
    <svg x="0" y="0" width="470" height="470" viewBox="0 0 100 100"><g clip-path="url(#clip)">${cover}</g></svg>
  </g>
  ${milestone}
  <text x="640" y="150" font-size="28" font-weight="500" fill="#ffffff" fill-opacity="0.7">@${esc(fit(t.creator, 15))} · paired with ${esc(t.quote.symbol)}</text>
  <text x="634" y="${150 + symSize + 4}" font-family="Funnel Sans" font-size="${symSize}" font-weight="800" fill="#ffffff" letter-spacing="-3">${esc(sym)}</text>
  <text x="640" y="${150 + symSize + 52}" font-size="32" font-weight="500" fill="#ffffff" fill-opacity="0.82">${esc(fit(t.name, 26))}</text>
  <text x="640" y="410" font-family="Funnel Sans" font-size="58" font-weight="800" fill="#ffffff">${usd(t.mcapUsd)}<tspan dx="18" font-size="34" fill="${col}">${pct(t.change24h)}</tspan></text>
  <text x="640" y="350" font-size="22" font-weight="500" fill="#ffffff" fill-opacity="0.55">MARKET CAP</text>
  <path d="${sp.area}" fill="url(#fade)"/>
  <path d="${sp.line}" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
  <path transform="translate(640,551)" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.7 1.2 5.2 3 1.5-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" fill="#fc401f"/>
  <text x="674" y="575" font-size="26" font-weight="700" fill="#ffffff">${t.likes}<tspan dx="28" fill="#ffffff" fill-opacity="0.65" font-weight="500">${t.trades} trade${t.trades === 1 ? "" : "s"}</tspan><tspan dx="28" fill="#ffffff" fill-opacity="0.65" font-weight="500">${t.comments} comment${t.comments === 1 ? "" : "s"}</tspan></text>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="#0000ff"/>
  <svg x="${Math.round(1130 - opts.site.length * 30 * 0.48 - 50)}" y="34" width="38" height="38" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="22" fill="#0000ff"/><circle cx="36" cy="44" r="15" fill="#fff"/><circle cx="40" cy="44" r="7" fill="#0000ff"/><path d="M58,30 L80,44 L58,58" fill="none" stroke="#ffd12f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M24,74 H54" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>
  <text x="1130" y="62" font-family="Funnel Sans" font-size="30" font-weight="700" fill="#ffffff" text-anchor="end">${esc(opts.site)}</text>
  <text x="1130" y="94" font-size="16" font-weight="700" fill="#ffffff" fill-opacity="0.45" text-anchor="end" letter-spacing="2">${esc(opts.chainLabel)}</text>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: "Funnel Sans" },
  });
  return resvg.render().asPng();
}
