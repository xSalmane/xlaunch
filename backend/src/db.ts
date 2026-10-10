import Database from "better-sqlite3";
import { config } from "./config.js";

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS launches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id         TEXT NOT NULL,
  handle       TEXT NOT NULL,
  name         TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  image        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  token        TEXT,
  pool         TEXT,
  tx_hash      TEXT,
  launch_block INTEGER,
  quote        TEXT NOT NULL DEFAULT '',       -- actif de la paire (WETH, USDC, action…)
  quote_symbol TEXT NOT NULL DEFAULT 'ETH',
  quote_decimals INTEGER NOT NULL DEFAULT 18,
  token_is0    INTEGER NOT NULL DEFAULT 1,      -- le token est-il token0 de la pool
  init_price   REAL,                            -- prix de départ, en actif de paire par token
  error        TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_user ON launches(x_id, created_at);
CREATE INDEX IF NOT EXISTS launches_time ON launches(created_at);
CREATE INDEX IF NOT EXISTS launches_token ON launches(token);

CREATE TABLE IF NOT EXISTS swaps (
  pool       TEXT NOT NULL,
  tx_hash    TEXT NOT NULL,
  log_index  INTEGER NOT NULL,
  block      INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  trader     TEXT NOT NULL,
  side       TEXT NOT NULL,      -- buy | sell
  quote_amt  REAL NOT NULL,      -- montant d'actif de paire échangé
  tokens     REAL NOT NULL,      -- montant de tokens échangé
  price      REAL NOT NULL,      -- actif de paire par token après le swap
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS swaps_pool_ts ON swaps(pool, ts);
CREATE INDEX IF NOT EXISTS swaps_ts ON swaps(ts);

CREATE TABLE IF NOT EXISTS claims (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id       TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  tx_hash    TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- un like par compte X et par token
CREATE TABLE IF NOT EXISTS likes (
  token      TEXT NOT NULL,           -- adresse en minuscules
  x_id       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token, x_id)
);
CREATE INDEX IF NOT EXISTS likes_token_time ON likes(token, created_at);
CREATE INDEX IF NOT EXISTS likes_user ON likes(x_id);
`);

// migrations douces (bases déjà créées par une version précédente)
for (const sql of [`ALTER TABLE launches ADD COLUMN creator_avatar TEXT NOT NULL DEFAULT ''`]) {
  try { db.exec(sql); } catch { /* colonne déjà présente */ }
}

export const now = () => Math.floor(Date.now() / 1000);

export type LaunchRow = {
  id: number; x_id: string; handle: string; name: string; symbol: string; image: string; description: string;
  status: string; token: string | null; pool: string | null; tx_hash: string | null; launch_block: number | null;
  quote: string; quote_symbol: string; quote_decimals: number; token_is0: number; creator_avatar: string;
  init_price: number | null; error: string | null; created_at: number;
};

export const kv = {
  get(k: string): string | undefined {
    return (db.prepare(`SELECT v FROM kv WHERE k=?`).get(k) as { v: string } | undefined)?.v;
  },
  set(k: string, v: string) {
    db.prepare(`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(k, v);
  },
};

export const launchesRepo = {
  countUserLast24h(xId: string): number {
    return (db
      .prepare(`SELECT COUNT(*) c FROM launches WHERE x_id=? AND status!='failed' AND created_at>?`)
      .get(xId, now() - 86400) as { c: number }).c;
  },
  countGlobalLastHour(): number {
    return (db
      .prepare(`SELECT COUNT(*) c FROM launches WHERE status!='failed' AND created_at>?`)
      .get(now() - 3600) as { c: number }).c;
  },
  symbolTaken(symbol: string): boolean {
    return !!db.prepare(`SELECT 1 FROM launches WHERE upper(symbol)=upper(?) AND status!='failed'`).get(symbol);
  },
  hasPending(xId: string): boolean {
    return !!db.prepare(`SELECT 1 FROM launches WHERE x_id=? AND status='pending'`).get(xId);
  },
  /** réserve un slot de façon atomique (évite le double-clic / requêtes parallèles) */
  reserve(
    p: { xId: string; handle: string; name: string; symbol: string; image: string; description: string;
      quote: string; quoteSymbol: string; quoteDecimals: number; avatar?: string },
    perDay: number, perHour: number,
  ): number | "user_limit" | "global_limit" | "pending" | "symbol_taken" {
    const tx = db.transaction(() => {
      if (launchesRepo.symbolTaken(p.symbol)) return "symbol_taken" as const;
      if (launchesRepo.hasPending(p.xId)) return "pending" as const;
      if (launchesRepo.countUserLast24h(p.xId) >= perDay) return "user_limit" as const;
      if (launchesRepo.countGlobalLastHour() >= perHour) return "global_limit" as const;
      const r = db
        .prepare(`INSERT INTO launches (x_id, handle, name, symbol, image, description, quote, quote_symbol, quote_decimals, creator_avatar, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(p.xId, p.handle, p.name, p.symbol, p.image, p.description, p.quote.toLowerCase(), p.quoteSymbol, p.quoteDecimals, p.avatar ?? "", now());
      return Number(r.lastInsertRowid);
    });
    return tx.immediate();
  },
  markDone(id: number, r: { token: string; pool: string; txHash: string; block: number; initPrice: number; tokenIsToken0: boolean }) {
    db.prepare(`UPDATE launches SET status='done', token=?, pool=?, tx_hash=?, launch_block=?, init_price=?, token_is0=? WHERE id=?`)
      .run(r.token, r.pool.toLowerCase(), r.txHash, r.block, r.initPrice, r.tokenIsToken0 ? 1 : 0, id);
  },
  markFailed(id: number, error: string) {
    db.prepare(`UPDATE launches SET status='failed', error=? WHERE id=?`).run(error.slice(0, 500), id);
  },
  byUser(xId: string): LaunchRow[] {
    return db.prepare(`SELECT * FROM launches WHERE x_id=? AND status='done' ORDER BY id DESC`).all(xId) as LaunchRow[];
  },
  /** créateur par pseudo X (le plus récent lancement, pour l'avatar à jour) */
  creatorByHandle(handle: string): { x_id: string; handle: string; creator_avatar: string } | undefined {
    return db.prepare(`SELECT x_id, handle, creator_avatar FROM launches WHERE lower(handle)=lower(?) AND status='done' ORDER BY id DESC LIMIT 1`)
      .get(handle) as { x_id: string; handle: string; creator_avatar: string } | undefined;
  },
  byToken(token: string): LaunchRow | undefined {
    return db.prepare(`SELECT * FROM launches WHERE lower(token)=lower(?) AND status='done'`).get(token) as LaunchRow | undefined;
  },
  pools(): { pool: string; launch_block: number; token_is0: number; quote_decimals: number }[] {
    return db.prepare(`SELECT pool, launch_block, token_is0, quote_decimals FROM launches WHERE status='done'`)
      .all() as { pool: string; launch_block: number; token_is0: number; quote_decimals: number }[];
  },
};

export const likesRepo = {
  /** ajoute ou retire le like ; renvoie le nouvel état et le total */
  toggle(token: string, xId: string): { liked: boolean; likes: number } {
    const t = token.toLowerCase();
    const tx = db.transaction(() => {
      const had = db.prepare(`SELECT 1 FROM likes WHERE token=? AND x_id=?`).get(t, xId);
      if (had) db.prepare(`DELETE FROM likes WHERE token=? AND x_id=?`).run(t, xId);
      else db.prepare(`INSERT INTO likes (token, x_id, created_at) VALUES (?,?,?)`).run(t, xId, now());
      const { c } = db.prepare(`SELECT COUNT(*) c FROM likes WHERE token=?`).get(t) as { c: number };
      return { liked: !had, likes: c };
    });
    return tx.immediate();
  },
  /** parmi ces tokens, ceux que ce compte a likés */
  likedBy(xId: string, tokens: string[]): Set<string> {
    if (!tokens.length) return new Set();
    const rows = db
      .prepare(`SELECT token FROM likes WHERE x_id=? AND token IN (${tokens.map(() => "?").join(",")})`)
      .all(xId, ...tokens.map((t) => t.toLowerCase())) as { token: string }[];
    return new Set(rows.map((r) => r.token));
  },
  /** total des likes reçus par les tokens d'un créateur */
  receivedBy(xId: string): number {
    return (db.prepare(`SELECT COUNT(*) c FROM likes k JOIN launches l ON lower(l.token)=k.token WHERE l.x_id=?`).get(xId) as { c: number }).c;
  },
};

export const claimsRepo = {
  insert(xId: string, recipient: string, txHash: string) {
    db.prepare(`INSERT INTO claims (x_id, recipient, tx_hash, created_at) VALUES (?,?,?,?)`).run(xId, recipient, txHash, now());
  },
};
