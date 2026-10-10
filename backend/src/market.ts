import { db, now, type LaunchRow } from "./db.js";
import { config } from "./config.js";
import { quoteOf, quoteUsd } from "./quotes.js";

/**
 * Données de marché calculées à partir des swaps indexés.
 * Les montants bruts sont dans l'actif de la paire ; on les convertit en dollars avec le prix
 * de référence actuel de cet actif, pour comparer des tokens appariés à ETH, USDC ou une action.
 */

const SUPPLY = 1_000_000_000;
const POOL_FEE = 0.01;

type Row = LaunchRow & {
  last_price: number | null; price_24h: number | null; vol24: number; vol_total: number;
  trades: number; buys24: number; sells24: number; likes: number; likes24: number; likes1h: number;
};

/** « Hot » : au moins 3 likes dans la dernière heure */
const HOT_LIKES_1H = 3;

const SELECT = `
SELECT l.*,
  (SELECT price FROM swaps s WHERE s.pool=l.pool ORDER BY block DESC, log_index DESC LIMIT 1) AS last_price,
  (SELECT price FROM swaps s WHERE s.pool=l.pool AND s.ts<=@t24 ORDER BY block DESC, log_index DESC LIMIT 1) AS price_24h,
  (SELECT COALESCE(SUM(quote_amt),0) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24) AS vol24,
  (SELECT COALESCE(SUM(quote_amt),0) FROM swaps s WHERE s.pool=l.pool) AS vol_total,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool) AS trades,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24 AND side='buy') AS buys24,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24 AND side='sell') AS sells24,
  (SELECT COUNT(*) FROM likes k WHERE k.token=lower(l.token)) AS likes,
  (SELECT COUNT(*) FROM likes k WHERE k.token=lower(l.token) AND k.created_at>@t24) AS likes24,
  (SELECT COUNT(*) FROM likes k WHERE k.token=lower(l.token) AND k.created_at>@t1) AS likes1h
FROM launches l WHERE l.status='done'`;

export type TokenView = ReturnType<typeof serialize>;

export function serialize(r: Row, creatorFeeBps: number) {
  const usd = quoteUsd(r.quote);
  const price = r.last_price ?? r.init_price ?? 0;
  const ref = r.price_24h ?? r.init_price ?? price;
  const feesQuote = r.vol_total * POOL_FEE;
  const q = quoteOf(r.quote);
  return {
    token: r.token, pool: r.pool, name: r.name, symbol: r.symbol, image: r.image, description: r.description,
    creator: r.handle, creatorAvatar: r.creator_avatar ?? "", createdAt: r.created_at, txHash: r.tx_hash,
    quote: { address: r.quote, symbol: r.quote_symbol, decimals: r.quote_decimals, kind: q?.kind ?? "eth", icon: q?.icon ?? "", usd },
    // en actif de paire
    price, volume24hQuote: r.vol24,
    // en dollars
    priceUsd: price * usd,
    mcapUsd: price * usd * SUPPLY,
    volume24hUsd: r.vol24 * usd,
    volumeTotalUsd: r.vol_total * usd,
    creatorFeesUsd: ((feesQuote * creatorFeeBps) / 10_000) * usd,
    change24h: ref ? price / ref - 1 : 0,
    trades: r.trades, buys24h: r.buys24, sells24h: r.sells24,
    likes: r.likes, likes24h: r.likes24, hot: r.likes1h >= HOT_LIKES_1H, liked: false,
    trade: uniswapLink(r.token!, r.quote, r.quote_symbol),
    share: `${config.publicUrl}/t/${r.token}`,
  };
}

export function listTokens(o: { sort?: string; q?: string; limit?: number; offset?: number; xId?: string; creatorFeeBps: number }) {
  const q = (o.q ?? "").trim().replace(/^\$/, "");
  const where: string[] = [];
  if (q) where.push(`(l.name LIKE @like OR l.symbol LIKE @like OR l.handle LIKE @like OR l.quote_symbol LIKE @like OR lower(l.token)=lower(@q))`);
  if (o.xId) where.push(`l.x_id=@xId`);
  const rows = db.prepare(`${SELECT}${where.length ? " AND " + where.join(" AND ") : ""} ORDER BY l.id DESC LIMIT 2000`).all({
    t24: now() - 86400, t1: now() - 3600, like: `%${q}%`, q, xId: o.xId ?? "",
  }) as Row[];
  const views = rows.map((r) => serialize(r, o.creatorFeeBps));
  // tri en dollars : seul moyen de comparer des paires différentes
  // Trending = les plus likés sur 24 h, puis au total, puis le volume
  if (o.sort === "trending") views.sort((a, b) => b.likes24h - a.likes24h || b.likes - a.likes || b.volume24hUsd - a.volume24hUsd || b.createdAt - a.createdAt);
  else if (o.sort === "mcap") views.sort((a, b) => b.mcapUsd - a.mcapUsd);
  else if (o.sort === "volume") views.sort((a, b) => b.volume24hUsd - a.volume24hUsd || b.createdAt - a.createdAt);
  const offset = Math.max(o.offset ?? 0, 0);
  const limit = Math.min(Math.max(o.limit ?? 30, 1), 100);
  return withSpark(views.slice(offset, offset + limit));
}

/** mini-graphique : les 24 derniers prix de chaque pool (pour les cartes du fil) */
const sparkStmt = db.prepare(`SELECT price FROM (SELECT price, block, log_index FROM swaps WHERE pool=? ORDER BY block DESC, log_index DESC LIMIT 24) ORDER BY block, log_index`);
function withSpark<T extends { pool: string | null; price: number }>(views: T[]) {
  return views.map((v) => {
    const pts = v.pool ? (sparkStmt.all(v.pool) as { price: number }[]).map((x) => x.price) : [];
    return { ...v, spark: pts.length ? pts : [v.price] };
  });
}

export function getToken(token: string, creatorFeeBps: number) {
  const r = db.prepare(`${SELECT} AND lower(l.token)=lower(@token)`).get({ t24: now() - 86400, t1: now() - 3600, token }) as Row | undefined;
  return r ? serialize(r, creatorFeeBps) : undefined;
}

export function trades(row: LaunchRow, limit = 50) {
  const usd = quoteUsd(row.quote);
  const rows = db
    .prepare(`SELECT tx_hash txHash, ts, trader, side, quote_amt quoteAmount, tokens, price FROM swaps WHERE pool=? ORDER BY block DESC, log_index DESC LIMIT ?`)
    .all(row.pool!.toLowerCase(), Math.min(limit, 200)) as { quoteAmount: number; price: number }[];
  return rows.map((t) => ({ ...t, usd: t.quoteAmount * usd }));
}

/** points du graphique : prix (en actif de paire) après chaque swap, précédés du prix de départ */
export function chart(r: LaunchRow) {
  const pts = db
    .prepare(`SELECT ts, price FROM (SELECT ts, price, block, log_index FROM swaps WHERE pool=? ORDER BY block DESC, log_index DESC LIMIT 1000) ORDER BY block, log_index`)
    .all(r.pool) as { ts: number; price: number }[];
  return { quote: r.quote_symbol, usd: quoteUsd(r.quote), points: [{ ts: r.created_at, price: r.init_price ?? 0 }, ...pts] };
}

export function globalStats() {
  const t24 = now() - 86400;
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM launches WHERE status='done') launches,
      (SELECT COUNT(*) FROM launches WHERE status='done' AND created_at>@t24) launches24h`).get({ t24 }) as Record<string, number>;
  const vols = db.prepare(`SELECT l.quote, COALESCE(SUM(CASE WHEN s.ts>@t24 THEN s.quote_amt END),0) v24, COALESCE(SUM(s.quote_amt),0) vt
      FROM swaps s JOIN launches l ON l.pool=s.pool GROUP BY l.quote`).all({ t24 }) as { quote: string; v24: number; vt: number }[];
  return {
    ...counts,
    volume24hUsd: vols.reduce((a, v) => a + v.v24 * quoteUsd(v.quote), 0),
    volumeTotalUsd: vols.reduce((a, v) => a + v.vt * quoteUsd(v.quote), 0),
  };
}

export function uniswapLink(token: string, quote: string, quoteSymbol: string) {
  const chainParam = config.chain === "base" ? "base" : "base_sepolia";
  const input = quoteSymbol === "ETH" ? "ETH" : quote;
  return `https://app.uniswap.org/swap?chain=${chainParam}&inputCurrency=${input}&outputCurrency=${token}`;
}

/** derniers trades, tous tokens confondus (bande « live » du site) */
export function activity(limit = 24) {
  const rows = db.prepare(`SELECT s.tx_hash txHash, s.ts, s.trader, s.side, s.quote_amt quoteAmount, s.tokens,
      l.token, l.symbol, l.image, l.quote, l.quote_symbol quoteSymbol
    FROM swaps s JOIN launches l ON l.pool = s.pool
    ORDER BY s.block DESC, s.log_index DESC LIMIT ?`).all(Math.min(limit, 50)) as { quoteAmount: number; quote: string }[];
  return rows.map((r) => ({ ...r, usd: r.quoteAmount * quoteUsd(r.quote) }));
}
