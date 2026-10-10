// Démo locale complète, sans X ni vrais fonds :
//   chaîne anvil + Uniswap v3 + XLaunchFactory, paires ETH / USDC / actions de test,
//   connexion de démo, tokens d'exemple et trades simulés.
// Usage : ANVIL_BIN=$(which anvil) npm run local        (ajoute --no-seed pour partir de zéro)
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, maxUint256, erc20Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { startLocalChain, KEYS, WETH } from "../test/localchain.js";

const PORT = Number(process.env.PORT ?? 8787);
const seed = !process.argv.includes("--no-seed");
const DB = "./local.db";
for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true });
fs.rmSync("./data-local", { recursive: true, force: true });

const lc = await startLocalChain({ port: 8546 });
process.on("exit", () => lc.stop());
process.on("SIGINT", () => process.exit(0));
console.log("Chaîne locale prête, factory", lc.factory);

Object.assign(process.env, {
  PUBLIC_URL: process.env.PUBLIC_URL ?? `http://localhost:${PORT}`,
  PORT: String(PORT),
  CHAIN: "base-sepolia",
  RPC_URL: lc.rpc,
  FACTORY_ADDRESS: lc.factory,
  RELAYER_PRIVATE_KEY: KEYS.relayer,
  ATTESTER_PRIVATE_KEY: KEYS.attester,
  X_CLIENT_ID: "local",
  X_CLIENT_SECRET: "local",
  JWT_SECRET: "local-dev-secret",
  DEV_LOGIN: "1",
  DB_PATH: DB,
  DATA_DIR: "./data-local",
  UPLOAD_DIR: "./uploads-local",
  USDC_ADDRESS: lc.usdc,
  MIN_ACCOUNT_AGE_DAYS: "0",
  MIN_FOLLOWERS: "0",
  LAUNCHES_PER_USER_PER_DAY: process.env.LAUNCHES_PER_USER_PER_DAY ?? "20",
  INDEXER_INTERVAL_MS: "1500",
});

const { launchToken } = await import("../src/chain.js");
const { launchesRepo } = await import("../src/db.js");
const { initQuotes, getQuotes } = await import("../src/quotes.js");
const { mockAssetAbi } = await import("../src/abi.js");
await initQuotes();
const quotes = getQuotes();
console.log("Paires disponibles :", quotes.map((q) => q.symbol).join(", "));

const pub = createPublicClient({ chain: baseSepolia, transport: http(lc.rpc) });
const trader = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(KEYS.trader), transport: http(lc.rpc) });
const relayerW = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(KEYS.relayer), transport: http(lc.rpc) });
const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });

type Seeded = { token: Address; quote: (typeof quotes)[number] };

/** achète (montant en dollars) ou revend une part des tokens détenus */
async function trade(t: Seeded, buy: boolean, usd: number) {
  const q = t.quote;
  const isEth = q.kind === "eth";
  let amountIn: bigint;
  if (buy) amountIn = parseUnits((usd / q.usd).toFixed(Math.min(q.decimals, 8)), q.decimals);
  else {
    const bal = await pub.readContract({ address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [trader.account.address] });
    if (bal === 0n) return;
    amountIn = bal / BigInt(3 + Math.floor(Math.random() * 5));
  }
  const tokenIn = buy ? (isEth ? WETH : q.address) : t.token;
  const tokenOut = buy ? t.token : (isEth ? WETH : q.address);
  await wait(await trader.writeContract({
    address: lc.router, abi: lc.routerAbi, functionName: "exactInputSingle", value: buy && isEth ? amountIn : 0n,
    args: [{ tokenIn, tokenOut, fee: 10000, recipient: trader.account.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  }));
}

const seeded: Seeded[] = [];
if (seed) {
  // le trader de démo reçoit de quoi acheter avec chaque actif de paire
  for (const q of quotes.filter((x) => x.kind !== "eth")) {
    await wait(await relayerW.writeContract({ address: q.address, abi: mockAssetAbi, functionName: "mint", args: [trader.account.address, parseUnits(String(Math.ceil(1_000_000 / q.usd)), q.decimals)] }));
    await wait(await trader.writeContract({ address: q.address, abi: erc20Abi, functionName: "approve", args: [lc.router, maxUint256] }));
  }
  const pick = (sym: string) => quotes.find((q) => q.symbol === sym) ?? quotes[0];
  const examples = [
    { handle: "maelle_onchain", name: "Croissant", symbol: "CRSNT", quote: "ETH", description: "The official breakfast of Paris degens." },
    { handle: "basedtom", name: "Blue Hour", symbol: "BLUE", quote: "USDC", description: "For people who trade between 5 and 6 AM." },
    { handle: "nina_builds", name: "Green Candle", symbol: "GCNDL", quote: "tNVDA", description: "Paired with NVIDIA, obviously." },
    { handle: "lucas_eth", name: "Boules", symbol: "BOULE", quote: "tAAPL", description: "Shoot or point?" },
    { handle: "sarah0x", name: "Rocket", symbol: "RKT", quote: "tTSLA", description: "To the moon, the long way round." },
  ];
  for (const e of examples) {
    const q = pick(e.quote);
    const xId = String(100000 + seeded.length);
    const slot = launchesRepo.reserve({ xId, handle: e.handle, name: e.name, symbol: e.symbol, image: "", description: e.description, quote: q.address, quoteSymbol: q.symbol, quoteDecimals: q.decimals }, 99, 999);
    if (typeof slot !== "number") continue;
    const r = await launchToken({ name: e.name, symbol: e.symbol, image: "", xId, quote: q });
    launchesRepo.markDone(slot, r);
    seeded.push({ token: r.token, quote: q });
    await wait(await trader.writeContract({ address: r.token, abi: erc20Abi, functionName: "approve", args: [lc.router, maxUint256] }));
  }
  for (let i = 0; i < 35; i++) {
    const t = seeded[i % seeded.length];
    await trade(t, i < seeded.length || Math.random() < 0.7, 50 + Math.random() * 900);
  }
  // des likes de démonstration (comptes fictifs) pour remplir Trending
  const { likesRepo } = await import("../src/db.js");
  seeded.forEach((t, i) => {
    const n = [14, 3, 9, 6, 1][i] ?? 2;
    for (let k = 0; k < n; k++) likesRepo.toggle(t.token, `demo-${k}`);
  });
  console.log(`${seeded.length} tokens d'exemple, 35 trades et des likes créés`);
}

await import("../src/server.js");

// trades simulés en continu pour voir le site vivre
if (seed) {
  setInterval(async () => {
    try {
      const t = seeded[Math.floor(Math.random() * seeded.length)];
      await trade(t, Math.random() < 0.65, 20 + Math.random() * 300);
    } catch (e) {
      console.error("trade simulé", (e as Error).message);
    }
  }, 6000);
}
