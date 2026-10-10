import { parseAbiItem, type Address, type Log } from "viem";
import { db, kv, launchesRepo } from "./db.js";
import { publicClient, sqrtToPrice } from "./chain.js";

/**
 * Suit les swaps de toutes les pools lancées et les enregistre en base :
 * c'est ce qui alimente les prix, volumes, graphiques et listes de trades du site.
 */
const SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);
const CHUNK = 2_000n; // blocs par requête getLogs
const POOLS_PER_QUERY = 100;
const INTERVAL_MS = Number(process.env.INDEXER_INTERVAL_MS ?? 3000);

const insert = db.prepare(`INSERT OR IGNORE INTO swaps
  (pool, tx_hash, log_index, block, ts, trader, side, eth, tokens, price) VALUES (?,?,?,?,?,?,?,?,?,?)`);

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
      // token = token0, WETH = token1. amount1 > 0 : WETH entre dans la pool -> achat
      const buy = amount1 > 0n;
      return [
        l.address.toLowerCase(), l.transactionHash, l.logIndex, Number(l.blockNumber), ts, tx.from.toLowerCase(),
        buy ? "buy" : "sell",
        Math.abs(Number(amount1)) / 1e18,
        Math.abs(Number(amount0)) / 1e18,
        sqrtToPrice(sqrtPriceX96),
      ] as const;
    })
  );
  db.transaction(() => rows.forEach((r) => insert.run(...r)))();
}

async function scan(pools: string[], from: bigint, to: bigint) {
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n > to ? to : start + CHUNK - 1n;
    for (let i = 0; i < pools.length; i += POOLS_PER_QUERY) {
      const logs = await publicClient.getLogs({
        address: pools.slice(i, i + POOLS_PER_QUERY) as Address[],
        event: SWAP,
        fromBlock: start,
        toBlock: end,
        strict: true,
      });
      await store(logs as SwapLog[]);
    }
  }
}

async function tick() {
  const latest = await publicClient.getBlockNumber();
  const last = kv.get("indexer:last") ? BigInt(kv.get("indexer:last")!) : latest;
  const all = launchesRepo.pools();

  // nouvelles pools : rattrapage depuis leur bloc de lancement
  const fresh = all.filter((p) => !known.has(p.pool));
  for (const p of fresh) {
    const from = BigInt(p.launch_block ?? Number(last));
    if (from <= last) await scan([p.pool], from, last);
    known.add(p.pool);
  }

  if (latest > last && known.size) await scan([...known], last + 1n, latest);
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
