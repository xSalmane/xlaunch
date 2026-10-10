import { db, now, type LaunchRow } from "./db.js";
import { config } from "./config.js";

/** Données de marché calculées à partir des swaps indexés. Tous les montants sont en ETH. */

const SUPPLY = 1_000_000_000;
const POOL_FEE = 0.01;

type Row = LaunchRow & {
  last_price: number | null; price_24h: number | null; vol24: number; vol_total: number; trades: number; buys24: number; sells24: number;
};

const SELECT = `
SELECT l.*,
  (SELECT price FROM swaps s WHERE s.pool=l.pool ORDER BY block DESC, log_index DESC LIMIT 1) AS last_price,
  (SELECT price FROM swaps s WHERE s.pool=l.pool AND s.ts<=@t24 ORDER BY block DESC, log_index DESC LIMIT 1) AS price_24h,
  (SELECT COALESCE(SUM(eth),0) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24) AS vol24,
  (SELECT COALESCE(SUM(eth),0) FROM swaps s WHERE s.pool=l.pool) AS vol_total,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool) AS trades,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24 AND side='buy') AS buys24,
  (SELECT COUNT(*) FROM swaps s WHERE s.pool=l.pool AND s.ts>@t24 AND side='sell') AS sells24
FROM launches l WHERE l.status='done'`;

const SORTS: Record<string, string> = {
  new: "l.id DESC",
  mcap: "COALESCE(last_price, l.init_price) DESC",
  volume: "vol24 DESC, l.id DESC",
};

export function listTokens(o: { sort?: string; q?: string; limit?: number; offset?: number; xId?: string }) {
  const q = (o.q ?? "").trim().replace(/^\$/, "");
  const where: string[] = [];
  if (q) where.push(`(l.name LIKE @like OR l.symbol LIKE @like OR l.handle LIKE @like OR lower(l.token)=lower(@q))`);
  if (o.xId) where.push(`l.x_id=@xId`);
  const sql = `${SELECT}${where.length ? " AND " + where.join(" AND ") : ""} ORDER BY ${SORTS[o.sort ?? "new"] ?? SORTS.new} LIMIT @limit OFFSET @offset`;
  const rows = db.prepare(sql).all({
    t24: now() - 86400, like: `%${q}%`, q, xId: o.xId ?? "",
    limit: Math.min(Math.max(o.limit ?? 30, 1), 100), offset: Math.max(o.offset ?? 0, 0),
  }) as Row[];
  return rows;
}

export function getToken(token: string) {
  return db.prepare(`${SELECT} AND lower(l.token)=lower(@token)`).get({ t24: now() - 86400, token }) as Row | undefined;
}

export function serialize(r: Row, creatorFeeBps: number) {
  const price = r.last_price ?? r.init_price ?? 0;
  const ref = r.price_24h ?? r.init_price ?? price;
  const feesTotal = r.vol_total * POOL_FEE;
  return {
    token: r.token, pool: r.pool, name: r.name, symbol: r.symbol, image: r.image, description: r.description,
    creator: r.handle, createdAt: r.created_at, txHash: r.tx_hash,
    price, mcap: price * SUPPLY, change24h: ref ? price / ref - 1 : 0,
    volume24h: r.vol24, volumeTotal: r.vol_total, trades: r.trades, buys24h: r.buys24, sells24h: r.sells24,
    creatorFeesEarned: (feesTotal * creatorFeeBps) / 10_000,
    trade: uniswapLink(r.token!),
    share: `${config.publicUrl}/t/${r.token}`,
  };
}

export function trades(pool: string, limit = 50) {
  return db
    .prepare(`SELECT tx_hash txHash, ts, trader, side, eth, tokens, price FROM swaps WHERE pool=? ORDER BY block DESC, log_index DESC LIMIT ?`)
    .all(pool.toLowerCase(), Math.min(limit, 200));
}

/** points du graphique : prix après chaque swap (les 1000 derniers), précédés du prix de départ */
export function chart(r: LaunchRow) {
  const pts = (db
    .prepare(`SELECT ts, price FROM (SELECT ts, price, block, log_index FROM swaps WHERE pool=? ORDER BY block DESC, log_index DESC LIMIT 1000) ORDER BY block, log_index`)
    .all(r.pool) as { ts: number; price: number }[]);
  return [{ ts: r.created_at, price: r.init_price ?? 0 }, ...pts];
}

export function globalStats() {
  const t24 = now() - 86400;
  const g = db.prepare(`SELECT
      (SELECT COUNT(*) FROM launches WHERE status='done') launches,
      (SELECT COUNT(*) FROM launches WHERE status='done' AND created_at>@t24) launches24h,
      (SELECT COALESCE(SUM(eth),0) FROM swaps WHERE ts>@t24) volume24h,
      (SELECT COALESCE(SUM(eth),0) FROM swaps) volumeTotal`).get({ t24 }) as Record<string, number>;
  return g;
}

export function uniswapLink(token: string) {
  return `https://app.uniswap.org/swap?chain=${config.chain === "base" ? "base" : "base_sepolia"}&inputCurrency=ETH&outputCurrency=${token}`;
}
