import { parseAbiItem, type Address, type Log } from "viem";
import { db, kv, launchesRepo, feesRepo } from "./db.js";
import { publicClient, sqrtToPrice, factory } from "./chain.js";
import { config } from "./config.js";

/**
 * Suit les swaps de toutes les pools lancées et les enregistre en base :
 * c'est ce qui alimente les prix, volumes, graphiques et listes de trades du site.
 */
const SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);
// blocs par requête getLogs : beaucoup de RPC publics plafonnent la plage (ex. 200 sur sepolia.base.org).
// On démarre à INDEXER_BLOCK_RANGE et on s'aligne automatiquement sur la limite annoncée par le RPC.
let chunk = BigInt(process.env.INDEXER_BLOCK_RANGE ?? 2_000);
const POOLS_PER_QUERY = 100;
const INTERVAL_MS = Number(process.env.INDEXER_INTERVAL_MS ?? 3000);

const insert = db.prepare(`INSERT OR IGNORE INTO swaps
  (pool, tx_hash, log_index, block, ts, trader, side, quote_amt, tokens, price) VALUES (?,?,?,?,?,?,?,?,?,?)`);

/** sens de chaque pool (le token est-il token0 ?) et décimales de l'actif de paire */
const poolInfo = new Map<string, { is0: boolean; dec: number }>();

const known = new Set<string>(); // pools déjà rattrapées
const blockTs = new Map<bigint, number>();

async function timestampOf(block: bigint): Promise<number> {
  const hit = blockTs.get(block);
  if (hit) return hit;
  const b = await publicClient.getBlock({ blockNumber: block });
  const ts = Number(b.timestamp);
  blockTs.set(block, ts);
  if (blockTs.size > 5000) blockTs.delete(blockTs.keys().next().value!);
  return ts;
}

type SwapLog = Log<bigint, number, false, typeof SWAP, true>;

async function store(logs: SwapLog[]) {
  if (!logs.length) return;
  const rows = await Promise.all(
    logs.map(async (l) => {
      const [ts, tx] = await Promise.all([
        timestampOf(l.blockNumber!),
        publicClient.getTransaction({ hash: l.transactionHash! }),
      ]);
      const { amount0, amount1, sqrtPriceX96 } = l.args;
      const info = poolInfo.get(l.address.toLowerCase()) ?? { is0: true, dec: 18 };
      const tokenAmt = info.is0 ? amount0 : amount1;
      const quoteAmt = info.is0 ? amount1 : amount0;
      // l'actif de paire entre dans la pool -> quelqu'un achète le token
      const buy = quoteAmt > 0n;
      return [
        l.address.toLowerCase(), l.transactionHash, l.logIndex, Number(l.blockNumber), ts, tx.from.toLowerCase(),
        buy ? "buy" : "sell",
        Math.abs(Number(quoteAmt)) / 10 ** info.dec,
        Math.abs(Number(tokenAmt)) / 1e18,
        sqrtToPrice(sqrtPriceX96, info.is0, info.dec),
      ] as const;
    })
  );
  db.transaction(() => rows.forEach((r) => insert.run(...r)))();
}

/** plage maximale annoncée dans l'erreur du RPC ("limited to a 200 range", "range of 10000 blocks"…) */
function rangeLimit(e: unknown): bigint | null {
  const msg = String((e as Error)?.message ?? e);
  if (!/limit|range|too many|exceed/i.test(msg)) return null;
  const m = msg.match(/(\d{2,6})\s*(?:-?\s*block)?\s*range|range\s*(?:of|is)?\s*(\d{2,6})/i);
  const n = m ? BigInt(m[1] ?? m[2]) : null;
  return n && n < chunk ? n : chunk > 50n ? chunk / 2n : null;
}

async function getLogsAdaptive(pools: Address[], from: bigint, to: bigint) {
  for (;;) {
    try {
      return await publicClient.getLogs({ address: pools, event: SWAP, fromBlock: from, toBlock: to, strict: true });
    } catch (e) {
      const limit = rangeLimit(e);
      if (!limit || to - from + 1n <= limit) throw e;
      chunk = limit;
      console.log(`indexer : plage getLogs réduite à ${chunk} blocs (limite du RPC)`);
      return null; // l'appelant redécoupe avec la nouvelle taille
    }
  }
}

async function scan(pools: string[], from: bigint, to: bigint) {
  let start = from;
  while (start <= to) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    let ok = true;
    for (let i = 0; i < pools.length; i += POOLS_PER_QUERY) {
      const logs = await getLogsAdaptive(pools.slice(i, i + POOLS_PER_QUERY) as Address[], start, end);
      if (logs === null) { ok = false; break; }
      await store(logs as SwapLog[]);
    }
    if (ok) start = end + 1n;
  }
}

// frais réellement collectés par le contrat : base des gains de parrainage
const FEES = parseAbiItem("event FeesCollected(address indexed token, uint256 tokenAmount, uint256 quoteAmount)");
export async function recordFeeLogs(logs: { args: { token?: Address; quoteAmount?: bigint }; transactionHash: string | null; logIndex: number | null; blockNumber: bigint | null }[]) {
  for (const l of logs) {
    const token = l.args.token, amt = l.args.quoteAmount;
    if (!token || amt === undefined || !l.transactionHash || l.logIndex === null) continue;
    const row = launchesRepo.byToken(token);
    if (!row) continue;
    const ts = l.blockNumber ? await timestampOf(l.blockNumber) : Math.floor(Date.now() / 1000);
    feesRepo.insert({ txHash: l.transactionHash, logIndex: l.logIndex, token, quoteAmt: Number(amt) / 10 ** row.quote_decimals, ts });
  }
}
async function scanFees(from: bigint, to: bigint) {
  let start = from;
  while (start <= to) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    try {
      const logs = await publicClient.getLogs({ address: factory.address, event: FEES, fromBlock: start, toBlock: end, strict: true });
      await recordFeeLogs(logs);
      start = end + 1n;
    } catch (e) {
      const limit = rangeLimit(e);
      if (!limit) throw e;
      chunk = limit;
    }
  }
}

async function tick() {
  const latest = await publicClient.getBlockNumber();
  const last = kv.get("indexer:last") ? BigInt(kv.get("indexer:last")!) : latest;
  const all = launchesRepo.pools();
  for (const p of all) poolInfo.set(p.pool, { is0: !!p.token_is0, dec: p.quote_decimals });

  // nouvelles pools : rattrapage depuis leur bloc de lancement
  const fresh = all.filter((p) => !known.has(p.pool));
  for (const p of fresh) {
    const from = BigInt(p.launch_block ?? Number(last));
    if (from <= last) await scan([p.pool], from, last);
    known.add(p.pool);
  }

  if (latest > last && known.size) await scan([...known], last + 1n, latest);
  if (latest > last && !config.factoryPending) await scanFees(last + 1n, latest);
  kv.set("indexer:last", latest.toString());
}

export function startIndexer() {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      console.error("indexer", (e as Error).message);
    } finally {
      running = false;
    }
  };
  loop();
  return setInterval(loop, INTERVAL_MS);
}
