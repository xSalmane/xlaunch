import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { isAddress, getAddress, type Address } from "viem";
import { config, blocklist, explorer } from "./config.js";
import { authRouter, requireAuth, eligibility, DEV_LOGIN, type Session } from "./auth.js";
import { launchesRepo, claimsRepo } from "./db.js";
import { launchToken, relayerHasFunds, creatorState, claimFor, chainId, relayerAddress, creatorFeeBps } from "./chain.js";
import { listTokens, getToken, trades, chart, globalStats } from "./market.js";
import { initQuotes, getQuotes, quoteOf, mintTestStocks } from "./quotes.js";
import { startIndexer } from "./indexer.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const publicDir = path.resolve(import.meta.dirname, "../public");
const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Sécurité : seules /embed et la fiche token encadrable peuvent s'afficher dans X.
app.use((req, res, next) => {
  const frameable = req.path === "/embed";
  res.setHeader(
    "Content-Security-Policy",
    (frameable
      ? "frame-ancestors https://x.com https://*.x.com https://twitter.com https://*.twitter.com 'self'; "
      : "frame-ancestors 'self'; ") +
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'"
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use(authRouter);

// ------------------------------------------------------------------ pages
const templates = new Map<string, string>();
function render(file: string, meta: { title: string; description: string; player?: string }) {
  let html = templates.get(file);
  if (!html || process.env.NODE_ENV !== "production") {
    html = fs.readFileSync(path.join(publicDir, file), "utf8");
    templates.set(file, html);
  }
  const img = `${config.publicUrl}/static/card.png`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta name="twitter:site" content="${esc(config.xSite)}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    ...(meta.player
      ? [
          `<meta name="twitter:card" content="player">`,
          `<meta name="twitter:player" content="${esc(meta.player)}">`,
          `<meta name="twitter:player:width" content="480">`,
          `<meta name="twitter:player:height" content="600">`,
        ]
      : [`<meta name="twitter:card" content="summary_large_image">`]),
  ].join("\n");
  return html.replace("<!--META-->", tags);
}

app.get("/", (_req, res) => {
  res.type("html").send(render("index.html", {
    title: "XLaunch — lance ton token sur Base depuis X",
    description: "Un nom, un ticker, un clic. Le gas est offert et tu touches une part des frais de trading.",
    player: `${config.publicUrl}/embed`,
  }));
});
app.get("/explore", (_req, res) => {
  res.type("html").send(render("explore.html", { title: "Explorer — XLaunch", description: "Tous les tokens lancés depuis X sur Base." }));
});
app.get("/me", (_req, res) => {
  res.type("html").send(render("me.html", { title: "Mes gains — XLaunch", description: "Tes tokens et tes frais de trading." }));
});
app.get("/t/:token", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).type("html").send(render("404.html", { title: "Token introuvable — XLaunch", description: "" }));
  res.type("html").send(render("token.html", {
    title: `$${row.symbol} — ${row.name}`,
    description: row.description || `Lancé par @${row.handle} sur Base via XLaunch.`,
    player: `${config.publicUrl}/embed?token=${row.token}`,
  }));
});
app.get("/embed", (_req, res) => res.sendFile(path.join(publicDir, "embed.html")));
app.use("/static", express.static(publicDir, { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.use("/u", express.static(uploadDir, {
  maxAge: "30d", immutable: true,
  setHeaders: (res) => res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"),
}));

// ------------------------------------------------------------------ API publique
app.get("/api/config", async (_req, res) => {
  res.json({
    chainId, chain: config.chain, explorer, factory: config.factory, weth: config.weth,
    creatorFeeBps: await creatorFeeBps(), devLogin: DEV_LOGIN, testFaucet: getQuotes().some((q) => q.mock),
    rules: { minAccountAgeDays: config.minAccountAgeDays, minFollowers: config.minFollowers, perDay: config.launchesPerUserPerDay },
  });
});

app.get("/api/stats", (_req, res) => res.json(globalStats()));

/** actifs avec lesquels on peut apparier un nouveau token */
app.get("/api/quotes", (_req, res) => {
  res.json(getQuotes().map((q) => ({
    address: q.address, symbol: q.symbol, name: q.name, kind: q.kind, decimals: q.decimals,
    usd: q.usd, icon: q.icon, test: q.mock, paused: q.paused,
  })));
});

app.get("/api/tokens", async (req, res) => {
  res.json(listTokens({
    sort: String(req.query.sort ?? "new"),
    q: String(req.query.q ?? "").slice(0, 64),
    limit: Number(req.query.limit ?? 30),
    offset: Number(req.query.offset ?? 0),
    creatorFeeBps: await creatorFeeBps(),
  }));
});

// compat embed
app.get("/api/recent", async (_req, res) => {
  res.json(listTokens({ sort: "new", limit: 20, creatorFeeBps: await creatorFeeBps() }));
});

app.get("/api/token/:token", async (req, res) => {
  const t = isAddress(req.params.token) ? getToken(req.params.token, await creatorFeeBps()) : undefined;
  if (!t) return res.status(404).json({ error: "Aucun token XLaunch à cette adresse." });
  res.json({ ...t, explorer: `${explorer}/token/${t.token}` });
});

app.get("/api/token/:token/trades", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).json({ error: "Aucun token XLaunch à cette adresse." });
  res.json(trades(row, Number(req.query.limit ?? 50)));
});

app.get("/api/token/:token/chart", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).json({ error: "Aucun token XLaunch à cette adresse." });
  res.json(chart(row));
});

// ------------------------------------------------------------------ API connectée
app.get("/api/me", requireAuth, (_req, res) => {
  const s = res.locals.session as Session;
  res.json({
    handle: s.handle,
    avatar: s.avatar,
    ineligible: eligibility(s),
    launchesLast24h: launchesRepo.countUserLast24h(s.sub),
    perDay: config.launchesPerUserPerDay,
    authAge: Math.floor(Date.now() / 1000) - s.iat,
    claimMaxAuthAge: config.claimMaxAuthAgeSec,
  });
});

// Upload d'image (logo du token). On vérifie la signature binaire, pas juste le type annoncé.
const MAGIC: [string, number[]][] = [
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
  ["webp", [0x52, 0x49, 0x46, 0x46]],
];
const uploadsToday = new Map<string, { n: number; day: number }>();
app.post(
  "/api/upload",
  requireAuth,
  express.raw({ type: ["image/png", "image/jpeg", "image/gif", "image/webp"], limit: "1mb" }),
  (req, res) => {
    const s = res.locals.session as Session;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Choisis une image PNG, JPG, GIF ou WebP de 1 Mo maximum." });
    const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
    if (!kind || (kind[0] === "webp" && buf.subarray(8, 12).toString() !== "WEBP"))
      return res.status(400).json({ error: "Ce fichier n'est pas une image PNG, JPG, GIF ou WebP." });

    const day = Math.floor(Date.now() / 86_400_000);
    const u = uploadsToday.get(s.sub);
    const n = u && u.day === day ? u.n : 0;
    if (n >= 20) return res.status(429).json({ error: "Limite de 20 images par jour atteinte." });
    uploadsToday.set(s.sub, { n: n + 1, day });

    const name = `${crypto.randomBytes(16).toString("hex")}.${kind[0]}`;
    fs.writeFileSync(path.join(uploadDir, name), buf);
    res.json({ url: `${config.publicUrl}/u/${name}` });
  }
);

const NAME_RE = /^[\p{L}\p{N} .'\-!&]{1,32}$/u;
const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;
const IMAGE_RE = new RegExp(`^${config.publicUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/u/[0-9a-f]{32}\\.(png|jpg|gif|webp)$`);

app.post("/api/launch", requireAuth, express.json({ limit: "10kb" }), async (req, res) => {
  const s = res.locals.session as Session;
  const name = String(req.body?.name ?? "").trim();
  const symbol = String(req.body?.symbol ?? "").trim().replace(/^\$/, "").toUpperCase();
  const image = String(req.body?.image ?? "").trim();
  const description = String(req.body?.description ?? "").trim().slice(0, 280);
  const quote = quoteOf(String(req.body?.quote ?? config.weth));

  if (!NAME_RE.test(name)) return res.status(400).json({ error: "Le nom doit faire 1 à 32 caractères (lettres, chiffres, espaces)." });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: "Le ticker doit faire 2 à 10 lettres ou chiffres." });
  if (image && !IMAGE_RE.test(image)) return res.status(400).json({ error: "Ajoute l'image avec le bouton d'import." });
  if (!quote) return res.status(400).json({ error: "Cette paire n'est pas disponible. Choisis ETH, USDC ou une action de la liste." });
  if (quote.paused) return res.status(400).json({ error: `${quote.symbol} est suspendu par son émetteur en ce moment. Choisis une autre paire.` });

  const hay = `${name} ${symbol}`.toLowerCase();
  if (blocklist.some((w) => hay.includes(w))) return res.status(400).json({ error: "Ce nom ou ce ticker n'est pas autorisé. Choisis-en un autre." });

  const why = eligibility(s);
  if (why) return res.status(403).json({ error: why });
  if (!(await relayerHasFunds())) return res.status(503).json({ error: "Les lancements sont en pause pour le moment. Réessaie un peu plus tard." });

  const slot = launchesRepo.reserve(
    { xId: s.sub, handle: s.handle, name, symbol, image, description, quote: quote.address, quoteSymbol: quote.symbol, quoteDecimals: quote.decimals, avatar: s.avatar },
    config.launchesPerUserPerDay, config.globalLaunchesPerHour
  );
  if (slot === "symbol_taken") return res.status(409).json({ error: `Le ticker $${symbol} existe déjà. Choisis-en un autre.` });
  if (slot === "pending") return res.status(429).json({ error: "Ton lancement précédent est encore en cours." });
  if (slot === "user_limit") return res.status(429).json({ error: `Tu as atteint ta limite de ${config.launchesPerUserPerDay} lancement(s) par 24 h.` });
  if (slot === "global_limit") return res.status(429).json({ error: "Beaucoup de lancements en ce moment. Réessaie dans quelques minutes." });

  try {
    const r = await launchToken({ name, symbol, image, xId: s.sub, quote });
    launchesRepo.markDone(slot, r);
    res.json({ token: r.token, txHash: r.txHash, share: `${config.publicUrl}/t/${r.token}`, explorer: `${explorer}/token/${r.token}` });
  } catch (e) {
    console.error("launch", e);
    launchesRepo.markFailed(slot, String(e));
    res.status(500).json({ error: "Le déploiement a échoué. Ton quota n'est pas consommé, tu peux réessayer." });
  }
});

app.get("/api/creator", requireAuth, async (_req, res) => {
  const s = res.locals.session as Session;
  const mine = listTokens({ xId: s.sub, limit: 100, creatorFeeBps: await creatorFeeBps() });
  const assets = creatorAssets(mine.map((t) => ({ token: t.token!, quote: t.quote.address })));
  const state = await creatorState(s.sub, assets);
  res.json({
    boundWallet: state.boundWallet,
    tokens: mine,
    earnedTotalUsd: mine.reduce((a, t) => a + t.creatorFeesUsd, 0),
    escrow: state.escrow.map((e) => {
      const q = quoteOf(e.asset);
      const t = mine.find((x) => x.token?.toLowerCase() === e.asset.toLowerCase());
      const decimals = q ? q.decimals : 18;
      return {
        ...e, decimals,
        symbol: q?.symbol ?? t?.symbol ?? "?",
        usd: q ? (Number(BigInt(e.amount)) / 10 ** decimals) * q.usd : (t ? (Number(BigInt(e.amount)) / 1e18) * t.priceUsd : 0),
      };
    }),
  });
});

const claiming = new Set<string>();
app.post("/api/claim", requireAuth, express.json({ limit: "2kb" }), async (req, res) => {
  const s = res.locals.session as Session;
  const recipient = String(req.body?.recipient ?? "").trim();
  if (!isAddress(recipient)) return res.status(400).json({ error: "Cette adresse n'est pas une adresse Base valide (0x suivi de 40 caractères)." });
  if (Date.now() / 1000 - s.iat > config.claimMaxAuthAgeSec)
    return res.status(401).json({ error: "Pour réclamer, reconnecte-toi avec X (sécurité).", reauth: true });
  if (claiming.has(s.sub)) return res.status(429).json({ error: "Une réclamation est déjà en cours." });

  claiming.add(s.sub);
  try {
    const rows = launchesRepo.byUser(s.sub);
    const tokens = rows.map((r) => r.token as Address);
    const r = await claimFor(s.sub, getAddress(recipient), tokens, creatorAssets(rows.map((x) => ({ token: x.token!, quote: x.quote }))));
    claimsRepo.insert(s.sub, recipient, r.txHash);
    res.json({ ...r, explorer: `${explorer}/tx/${r.txHash}` });
  } catch (e) {
    console.error("claim", e);
    res.status(500).json({ error: "La réclamation a échoué. Tes gains sont toujours en séquestre, tu peux réessayer." });
  } finally {
    claiming.delete(s.sub);
  }
});

/** tous les actifs où un créateur peut avoir des gains : ses tokens + les actifs de paire utilisés */
function creatorAssets(items: { token: string; quote: string }[]): Address[] {
  const set = new Map<string, Address>();
  for (const i of items) {
    set.set(i.token.toLowerCase(), getAddress(i.token));
    if (i.quote) set.set(i.quote.toLowerCase(), getAddress(i.quote));
  }
  return [...set.values()];
}

// Robinet de test : 10 unités de chaque fausse action vers une adresse (testnet uniquement)
const faucetUsed = new Map<string, number>();
app.post("/api/test-faucet", requireAuth, express.json({ limit: "2kb" }), async (req, res) => {
  const s = res.locals.session as Session;
  if (!getQuotes().some((q) => q.mock)) return res.status(404).json({ error: "Pas de robinet de test sur ce réseau." });
  const to = String(req.body?.address ?? "").trim();
  if (!isAddress(to)) return res.status(400).json({ error: "Cette adresse n'est pas valide (0x suivi de 40 caractères)." });
  const last = faucetUsed.get(s.sub) ?? 0;
  if (Date.now() - last < 3_600_000) return res.status(429).json({ error: "Robinet déjà utilisé : réessaie dans une heure." });
  faucetUsed.set(s.sub, Date.now());
  try {
    const symbols = await mintTestStocks(getAddress(to));
    res.json({ sent: symbols });
  } catch (e) {
    faucetUsed.delete(s.sub);
    console.error("faucet", e);
    res.status(500).json({ error: "L'envoi a échoué. Réessaie dans un instant." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Route inconnue." }));
app.use((_req, res) => res.status(404).type("html").send(render("404.html", { title: "Page introuvable — XLaunch", description: "" })));

await initQuotes();
startIndexer();
app.listen(config.port, () => {
  console.log(`XLaunch sur ${config.publicUrl} (port ${config.port}) — chaîne ${config.chain} — relayer ${relayerAddress}${DEV_LOGIN ? " — connexion démo active" : ""}`);
});
