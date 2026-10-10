import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { isAddress, getAddress, type Address } from "viem";
import { config, blocklist, explorer } from "./config.js";
import { authRouter, requireAuth, softAuth, eligibility, DEV_LOGIN, type Session } from "./auth.js";
import { launchesRepo, claimsRepo, likesRepo } from "./db.js";
import { launchToken, relayerHasFunds, creatorState, claimFor, chainId, relayerAddress, creatorFeeBps } from "./chain.js";
import { listTokens, getToken, trades, chart, globalStats, activity } from "./market.js";
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
    title: "XLaunch — launch your token on Base, right from X",
    description: "A name, a ticker, one click. Gas is on us, and you earn a share of every trade.",
    player: `${config.publicUrl}/embed`,
  }));
});
app.get("/explore", (_req, res) => {
  res.type("html").send(render("explore.html", { title: "Explore — XLaunch", description: "Every token launched from X on Base." }));
});
app.get("/me", (_req, res) => {
  res.type("html").send(render("me.html", { title: "Earnings — XLaunch", description: "Your tokens and your trading fees." }));
});
app.get("/t/:token", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).type("html").send(render("404.html", { title: "Token not found — XLaunch", description: "" }));
  res.type("html").send(render("token.html", {
    title: `$${row.symbol} — ${row.name}`,
    description: row.description || `Launched by @${row.handle} on Base via XLaunch.`,
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
app.get("/api/activity", (_req, res) => res.json(activity(24)));

/** actifs avec lesquels on peut apparier un nouveau token */
app.get("/api/quotes", (_req, res) => {
  res.json(getQuotes().map((q) => ({
    address: q.address, symbol: q.symbol, name: q.name, kind: q.kind, decimals: q.decimals,
    usd: q.usd, icon: q.icon, test: q.mock, paused: q.paused,
  })));
});

/** coche « liked » sur les tokens que le visiteur connecté a likés */
function markLiked<T extends { token: string | null; liked: boolean }>(views: T[], s?: Session): T[] {
  if (!s) return views;
  const set = likesRepo.likedBy(s.sub, views.map((v) => v.token!).filter(Boolean));
  for (const v of views) v.liked = set.has(v.token!.toLowerCase());
  return views;
}

app.get("/api/tokens", softAuth, async (req, res) => {
  res.json(markLiked(listTokens({
    sort: String(req.query.sort ?? "new"),
    q: String(req.query.q ?? "").slice(0, 64),
    limit: Number(req.query.limit ?? 30),
    offset: Number(req.query.offset ?? 0),
    creatorFeeBps: await creatorFeeBps(),
  }), res.locals.session));
});

// compat embed
app.get("/api/recent", softAuth, async (_req, res) => {
  res.json(markLiked(listTokens({ sort: "new", limit: 20, creatorFeeBps: await creatorFeeBps() }), res.locals.session));
});

app.get("/api/token/:token", softAuth, async (req, res) => {
  const addr = String(req.params.token);
  const t = isAddress(addr) ? getToken(addr, await creatorFeeBps()) : undefined;
  if (!t) return res.status(404).json({ error: "No XLaunch token at this address." });
  markLiked([t], res.locals.session);
  res.json({ ...t, explorer: `${explorer}/token/${t.token}` });
});

app.get("/api/token/:token/trades", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).json({ error: "No XLaunch token at this address." });
  res.json(trades(row, Number(req.query.limit ?? 50)));
});

app.get("/api/token/:token/chart", (req, res) => {
  const row = isAddress(req.params.token) ? launchesRepo.byToken(req.params.token) : undefined;
  if (!row) return res.status(404).json({ error: "No XLaunch token at this address." });
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
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Pick a PNG, JPG, GIF or WebP image, 1 MB max." });
    const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
    if (!kind || (kind[0] === "webp" && buf.subarray(8, 12).toString() !== "WEBP"))
      return res.status(400).json({ error: "This file isn't a PNG, JPG, GIF or WebP image." });

    const day = Math.floor(Date.now() / 86_400_000);
    const u = uploadsToday.get(s.sub);
    const n = u && u.day === day ? u.n : 0;
    if (n >= 20) return res.status(429).json({ error: "You've reached the limit of 20 images per day." });
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

  if (!NAME_RE.test(name)) return res.status(400).json({ error: "The name must be 1 to 32 characters (letters, numbers, spaces)." });
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: "The ticker must be 2 to 10 letters or numbers." });
  if (image && !IMAGE_RE.test(image)) return res.status(400).json({ error: "Add the image with the upload button." });
  if (!quote) return res.status(400).json({ error: "This pair isn't available. Pick ETH, USDC or a stock from the list." });
  if (quote.paused) return res.status(400).json({ error: `${quote.symbol} is currently paused by its issuer. Pick another pair.` });

  const hay = `${name} ${symbol}`.toLowerCase();
  if (blocklist.some((w) => hay.includes(w))) return res.status(400).json({ error: "This name or ticker isn't allowed. Pick another one." });

  const why = eligibility(s);
  if (why) return res.status(403).json({ error: why });
  if (!(await relayerHasFunds())) return res.status(503).json({ error: "Launches are paused for now. Try again a bit later." });

  const slot = launchesRepo.reserve(
    { xId: s.sub, handle: s.handle, name, symbol, image, description, quote: quote.address, quoteSymbol: quote.symbol, quoteDecimals: quote.decimals, avatar: s.avatar },
    config.launchesPerUserPerDay, config.globalLaunchesPerHour
  );
  if (slot === "symbol_taken") return res.status(409).json({ error: `The ticker $${symbol} already exists. Pick another one.` });
  if (slot === "pending") return res.status(429).json({ error: "Your previous launch is still in progress." });
  if (slot === "user_limit") return res.status(429).json({ error: `You've reached your limit of ${config.launchesPerUserPerDay} launch(es) per 24 hours.` });
  if (slot === "global_limit") return res.status(429).json({ error: "Lots of launches right now. Try again in a few minutes." });

  try {
    const r = await launchToken({ name, symbol, image, xId: s.sub, quote });
    launchesRepo.markDone(slot, r);
    res.json({ token: r.token, txHash: r.txHash, share: `${config.publicUrl}/t/${r.token}`, explorer: `${explorer}/token/${r.token}` });
  } catch (e) {
    console.error("launch", e);
    launchesRepo.markFailed(slot, String(e));
    res.status(500).json({ error: "The deployment failed. It didn't count against your quota, so you can try again." });
  }
});

app.get("/api/creator", requireAuth, async (_req, res) => {
  const s = res.locals.session as Session;
  const mine = markLiked(listTokens({ xId: s.sub, limit: 100, creatorFeeBps: await creatorFeeBps() }), s);
  const assets = creatorAssets(mine.map((t) => ({ token: t.token!, quote: t.quote.address })));
  const state = await creatorState(s.sub, assets);
  res.json({
    boundWallet: state.boundWallet,
    tokens: mine,
    earnedTotalUsd: mine.reduce((a, t) => a + t.creatorFeesUsd, 0),
    likesReceived: likesRepo.receivedBy(s.sub),
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
  if (!isAddress(recipient)) return res.status(400).json({ error: "This isn't a valid Base address (0x followed by 40 characters)." });
  if (Date.now() / 1000 - s.iat > config.claimMaxAuthAgeSec)
    return res.status(401).json({ error: "For security, sign in with X again to claim.", reauth: true });
  if (claiming.has(s.sub)) return res.status(429).json({ error: "A claim is already in progress." });

  claiming.add(s.sub);
  try {
    const rows = launchesRepo.byUser(s.sub);
    const tokens = rows.map((r) => r.token as Address);
    const r = await claimFor(s.sub, getAddress(recipient), tokens, creatorAssets(rows.map((x) => ({ token: x.token!, quote: x.quote }))));
    claimsRepo.insert(s.sub, recipient, r.txHash);
    res.json({ ...r, explorer: `${explorer}/tx/${r.txHash}` });
  } catch (e) {
    console.error("claim", e);
    res.status(500).json({ error: "The claim failed. Your earnings are still held in escrow, so you can try again." });
  } finally {
    claiming.delete(s.sub);
  }
});

// Like / unlike : un like par compte X et par token
const likeRate = new Map<string, { n: number; t: number }>();
app.post("/api/like", requireAuth, express.json({ limit: "1kb" }), (req, res) => {
  const s = res.locals.session as Session;
  const token = String(req.body?.token ?? "");
  if (!isAddress(token) || !launchesRepo.byToken(token)) return res.status(404).json({ error: "No XLaunch token at this address." });
  const r = likeRate.get(s.sub);
  const nowMs = Date.now();
  if (r && nowMs - r.t < 60_000 && r.n >= 60) return res.status(429).json({ error: "Slow down a little: too many likes in a minute." });
  likeRate.set(s.sub, r && nowMs - r.t < 60_000 ? { n: r.n + 1, t: r.t } : { n: 1, t: nowMs });
  res.json(likesRepo.toggle(token, s.sub));
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
  if (!getQuotes().some((q) => q.mock)) return res.status(404).json({ error: "There's no test faucet on this network." });
  const to = String(req.body?.address ?? "").trim();
  if (!isAddress(to)) return res.status(400).json({ error: "This address isn't valid (0x followed by 40 characters)." });
  const last = faucetUsed.get(s.sub) ?? 0;
  if (Date.now() - last < 3_600_000) return res.status(429).json({ error: "You already used the faucet. Try again in an hour." });
  faucetUsed.set(s.sub, Date.now());
  try {
    const symbols = await mintTestStocks(getAddress(to));
    res.json({ sent: symbols });
  } catch (e) {
    faucetUsed.delete(s.sub);
    console.error("faucet", e);
    res.status(500).json({ error: "Sending failed. Try again in a moment." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown route." }));
app.use((_req, res) => res.status(404).type("html").send(render("404.html", { title: "Page not found — XLaunch", description: "" })));

await initQuotes();
startIndexer();
app.listen(config.port, () => {
  console.log(`XLaunch on ${config.publicUrl} (port ${config.port}) — chain ${config.chain} — relayer ${relayerAddress}${DEV_LOGIN ? " — demo login enabled" : ""}`);
});
