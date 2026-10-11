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

-- commentaires sous un token
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL,           -- adresse en minuscules
  x_id       TEXT NOT NULL,
  handle     TEXT NOT NULL,
  avatar     TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_token ON comments(token, id);
CREATE INDEX IF NOT EXISTS comments_user ON comments(x_id, created_at);

-- parrainage : qui a fait venir qui (un seul parrain par compte, définitif)
CREATE TABLE IF NOT EXISTS referrals (
  x_id            TEXT PRIMARY KEY,   -- le filleul
  handle          TEXT NOT NULL,
  referrer_x_id   TEXT NOT NULL,
  referrer_handle TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_x_id);

-- comptes X déjà passés sur le site (pour le parrainage : qui existe, depuis quand)
CREATE TABLE IF NOT EXISTS users (
  x_id       TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  avatar     TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_handle ON users(handle COLLATE NOCASE);

-- versements de parrainage déjà effectués (en ETH, depuis le trésor)
CREATE TABLE IF NOT EXISTS referral_payouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id       TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  usd        REAL NOT NULL,
  wei        TEXT NOT NULL,
  tx_hash    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_payouts_user ON referral_payouts(x_id);

-- frais réellement collectés par le contrat (événements FeesCollected) : base des gains de parrainage.
-- On ne se fie pas au volume, qu'on peut gonfler par wash trading contre sa propre liquidité.
CREATE TABLE IF NOT EXISTS fee_collections (
  tx_hash   TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  token     TEXT NOT NULL,            -- adresse du token lancé (minuscules)
  quote_amt REAL NOT NULL,            -- frais côté actif de paire, en unités de l'actif
  ts        INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS fee_collections_token ON fee_collections(token);
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
  /** la tx est partie : on garde son hash pour la rapprocher si la confirmation tarde */
  markSent(id: number, txHash: string) {
    db.prepare(`UPDATE launches SET tx_hash=? WHERE id=? AND status='pending'`).run(txHash, id);
  },
  pendingRows(): LaunchRow[] {
    return db.prepare(`SELECT * FROM launches WHERE status='pending'`).all() as LaunchRow[];
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

export type CommentRow = { id: number; token: string; x_id: string; handle: string; avatar: string; body: string; created_at: number };
export const commentsRepo = {
  list(token: string, limit = 50, before = 0): CommentRow[] {
    return db.prepare(`SELECT * FROM comments WHERE token=? ${before ? "AND id<?" : ""} ORDER BY id DESC LIMIT ?`)
      .all(...(before ? [token.toLowerCase(), before, limit] : [token.toLowerCase(), limit])) as CommentRow[];
  },
  insert(c: { token: string; xId: string; handle: string; avatar: string; body: string }): CommentRow {
    const r = db.prepare(`INSERT INTO comments (token, x_id, handle, avatar, body, created_at) VALUES (?,?,?,?,?,?)`)
      .run(c.token.toLowerCase(), c.xId, c.handle, c.avatar, c.body, now());
    return db.prepare(`SELECT * FROM comments WHERE id=?`).get(r.lastInsertRowid) as CommentRow;
  },
  byId(id: number): CommentRow | undefined {
    return db.prepare(`SELECT * FROM comments WHERE id=?`).get(id) as CommentRow | undefined;
  },
  remove(id: number) { db.prepare(`DELETE FROM comments WHERE id=?`).run(id); },
  countUserSince(xId: string, since: number): number {
    return (db.prepare(`SELECT COUNT(*) c FROM comments WHERE x_id=? AND created_at>?`).get(xId, since) as { c: number }).c;
  },
  lastBody(xId: string): string | undefined {
    return (db.prepare(`SELECT body FROM comments WHERE x_id=? ORDER BY id DESC LIMIT 1`).get(xId) as { body: string } | undefined)?.body;
  },
};

export const referralsRepo = {
  of(xId: string): { referrer_x_id: string; referrer_handle: string } | undefined {
    return db.prepare(`SELECT referrer_x_id, referrer_handle FROM referrals WHERE x_id=?`).get(xId) as { referrer_x_id: string; referrer_handle: string } | undefined;
  },
  /** enregistre le parrain si le compte n'en a pas encore ; renvoie true si c'est fait */
  attach(p: { xId: string; handle: string; referrerXId: string; referrerHandle: string }): boolean {
    const r = db.prepare(`INSERT OR IGNORE INTO referrals (x_id, handle, referrer_x_id, referrer_handle, created_at) VALUES (?,?,?,?,?)`)
      .run(p.xId, p.handle, p.referrerXId, p.referrerHandle, now());
    return r.changes > 0;
  },
  referredBy(referrerXId: string): { x_id: string; handle: string; created_at: number }[] {
    return db.prepare(`SELECT x_id, handle, created_at FROM referrals WHERE referrer_x_id=? ORDER BY created_at DESC`).all(referrerXId) as { x_id: string; handle: string; created_at: number }[];
  },
  /** dollars déjà versés ou en cours de versement */
  paidUsd(xId: string): number {
    return (db.prepare(`SELECT COALESCE(SUM(usd),0) u FROM referral_payouts WHERE x_id=? AND status!='failed'`).get(xId) as { u: number }).u;
  },
  startPayout(p: { xId: string; recipient: string; usd: number; wei: string }): number {
    return Number(db.prepare(`INSERT INTO referral_payouts (x_id, recipient, usd, wei, created_at) VALUES (?,?,?,?,?)`)
      .run(p.xId, p.recipient, p.usd, p.wei, now()).lastInsertRowid);
  },
  sentPayout(id: number, txHash: string) {
    db.prepare(`UPDATE referral_payouts SET tx_hash=? WHERE id=?`).run(txHash, id);
  },
  finishPayout(id: number, txHash: string | null, ok: boolean) {
    db.prepare(`UPDATE referral_payouts SET tx_hash=?, status=? WHERE id=?`).run(txHash, ok ? "done" : "failed", id);
  },
};

export const feesRepo = {
  insert(p: { txHash: string; logIndex: number; token: string; quoteAmt: number; ts: number }) {
    db.prepare(`INSERT OR IGNORE INTO fee_collections (tx_hash, log_index, token, quote_amt, ts) VALUES (?,?,?,?,?)`)
      .run(p.txHash, p.logIndex, p.token.toLowerCase(), p.quoteAmt, p.ts);
  },
  /** frais côté actif de paire collectés pour un token */
  collected(token: string): number {
    return (db.prepare(`SELECT COALESCE(SUM(quote_amt),0) q FROM fee_collections WHERE token=?`).get(token.toLowerCase()) as { q: number }).q;
  },
  lastAt(token: string): number {
    return (db.prepare(`SELECT COALESCE(MAX(ts),0) t FROM fee_collections WHERE token=?`).get(token.toLowerCase()) as { t: number }).t;
  },
};

export const usersRepo = {
  touch(xId: string, handle: string, avatar: string) {
    db.prepare(`INSERT INTO users (x_id, handle, avatar, first_seen, last_seen) VALUES (?,?,?,?,?)
      ON CONFLICT(x_id) DO UPDATE SET handle=excluded.handle, avatar=excluded.avatar, last_seen=excluded.last_seen`)
      .run(xId, handle, avatar, now(), now());
  },
  get(xId: string): { x_id: string; handle: string; first_seen: number } | undefined {
    return db.prepare(`SELECT x_id, handle, first_seen FROM users WHERE x_id=?`).get(xId) as { x_id: string; handle: string; first_seen: number } | undefined;
  },
  byHandle(handle: string): { x_id: string; handle: string } | undefined {
    return db.prepare(`SELECT x_id, handle FROM users WHERE lower(handle)=lower(?) ORDER BY last_seen DESC LIMIT 1`).get(handle) as { x_id: string; handle: string } | undefined;
  },
};
