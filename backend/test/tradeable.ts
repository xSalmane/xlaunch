// Test de tradabilité : un token lancé par Bluebird s'achète et se revend tout de suite, comme le feraient
// les bots de trading (Based Bot, Sigma, Maestro…), les agrégateurs et le site Uniswap :
//   QuoterV2 (cotation), SwapRouter02 (router des agrégateurs), Universal Router (app Uniswap, nombreux bots),
//   swap direct sur la pool (bots), routage multi-saut via USDC, transferts sans taxe, pool officielle indexable.
// Usage : ANVIL_BIN=/chemin/anvil UNI_NODE_MODULES=/chemin/node_modules npx tsx test/tradeable.ts
//   (UNI_NODE_MODULES : dossier contenant @uniswap/swap-router-contracts et @uniswap/universal-router)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, erc20Abi, maxUint256,
  encodeAbiParameters, encodePacked, parseAbi, type Abi, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { startLocalChain, KEYS as K, WETH, type LocalChain } from "./localchain.js";

const require = createRequire(import.meta.url);
const UNI = process.env.UNI_NODE_MODULES ?? "";
const art = (p: string) => JSON.parse(fs.readFileSync(path.join(UNI, p), "utf8"));
const local = (p: string) => JSON.parse(fs.readFileSync(require.resolve(p), "utf8"));

let failed = 0;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
};
const near = (a: bigint, b: bigint, bps = 1n) => (a > b ? a - b : b - a) * 10_000n <= b * bps;

let lc: LocalChain | undefined;
try {
  lc = await startLocalChain({ port: 8547 });
  const pub = createPublicClient({ chain: baseSepolia, transport: http(lc.rpc) });
  const acct = privateKeyToAccount(K.trader);
  const me = acct.address;
  const trader = createWalletClient({ chain: baseSepolia, account: acct, transport: http(lc.rpc) });
  const deployer = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(K.deployer), transport: http(lc.rpc) });
  const relayerW = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(K.relayer), transport: http(lc.rpc) });
  const wait = async (hash: Hex) => (await pub.waitForTransactionReceipt({ hash })).status === "success";
  const deploy = async (abi: Abi, bytecode: Hex, args: unknown[] = []) =>
    (await pub.waitForTransactionReceipt({ hash: await deployer.deployContract({ abi, bytecode, args }) })).contractAddress!;
  const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

  Object.assign(process.env, {
    PUBLIC_URL: "http://localhost", CHAIN: "base-sepolia", RPC_URL: lc.rpc, FACTORY_ADDRESS: lc.factory, RPC_FALLBACKS: "",
    RELAYER_PRIVATE_KEY: K.relayer, ATTESTER_PRIVATE_KEY: K.attester, X_CLIENT_ID: "x", X_CLIENT_SECRET: "x",
    JWT_SECRET: "test", DB_PATH: ":memory:", START_FDV_USD: "10000",
  });
  const chain = await import("../src/chain.js");
  const { mockAssetAbi, factoryAbi } = await import("../src/abi.js");

  // ------------------------------------------------ contrats Uniswap utilisés par les bots / agrégateurs
  const quoterArt = local("@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json");
  const sr02Art = art("@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json");
  const urArt = art("@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json");
  const poolArt = local("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
  const npmArt = local("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
  const quoter = await deploy(quoterArt.abi, quoterArt.bytecode, [lc.uniFactory, WETH]);
  const sr02 = await deploy(sr02Art.abi, sr02Art.bytecode, ["0x0000000000000000000000000000000000000000", lc.uniFactory, lc.npm, WETH]);
  const POOL_INIT_CODE_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
  const Z = "0x0000000000000000000000000000000000000000" as Address;
  const ur = await deploy(urArt.abi, urArt.bytecode, [{
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", weth9: WETH, v2Factory: Z, v3Factory: lc.uniFactory,
    pairInitCodeHash: ("0x" + "00".repeat(32)) as Hex, poolInitCodeHash: POOL_INIT_CODE_HASH,
    v4PoolManager: Z, v3NFTPositionManager: lc.npm, v4PositionManager: Z, spokePool: Z,
  }]);
  // swap direct sur la pool (bot)
  const solc = require("../../contracts/node_modules/solc");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "B.sol": { content: fs.readFileSync(new URL("./sol/BotSwapper.sol", import.meta.url), "utf8") } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const B = out.contracts["B.sol"].BotSwapper;
  const bot = await deploy(B.abi, ("0x" + B.evm.bytecode.object) as Hex);

  // ------------------------------------------------ lancement réel par la factory (paire ETH)
  const L = await chain.launchToken({ name: "Trade Test", symbol: "TRADE", image: "", xId: "42", quote: { address: WETH, decimals: 18, usd: 3000 } });
  const T = L.token, pool = L.pool;
  console.log(`token ${T}, pool ${pool}`);

  // 1. la pool est une pool Uniswap v3 officielle (c'est ce que DexScreener / GeckoTerminal indexent)
  check(String(await pub.readContract({ address: pool, abi: poolArt.abi, functionName: "factory" })).toLowerCase() === lc.uniFactory.toLowerCase(), "pool créée par la factory Uniswap v3 officielle (indexable par DexScreener)");
  check(Number(await pub.readContract({ address: pool, abi: poolArt.abi, functionName: "fee" })) === 10000, "palier de frais standard 1 % (supporté par les routers et bots)");
  const npmOwner = await pub.readContract({ address: lc.npm, abi: npmArt.abi, functionName: "ownerOf", args: [1n] });
  check(String(npmOwner).toLowerCase() === lc.factory.toLowerCase(), "position LP détenue à vie par la factory (liquidité verrouillée)");
  const supply = await pub.readContract({ address: T, abi: erc20Abi, functionName: "totalSupply" });
  check((await bal(T, pool)) * 10_000n >= supply * 9_999n, "≈100 % de la supply dans la pool, 0 chez le créateur ou la plateforme");
  check((await pub.readContract({ address: T, abi: erc20Abi, functionName: "decimals" })) === 18, "ERC-20 standard (18 décimales, name/symbol lisibles)");

  // 2. cotation immédiate (premier trade, prix juste hors de la plage)
  const quote = async (tokenIn: Address, tokenOut: Address, amountIn: bigint) =>
    (await pub.simulateContract({ address: quoter, abi: quoterArt.abi, functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: 10000, sqrtPriceLimitX96: 0n }] })).result[0] as bigint;
  const q1 = await quote(WETH, T, parseEther("0.01"));
  check(q1 > 0n, `QuoterV2 cote dès le lancement : 0.01 ETH → ${formatEther(q1)} TRADE`);

  // 3. achat via SwapRouter02 avec de l'ETH natif (agrégateurs, Uniswap API)
  const before = await bal(T, me);
  const ok3 = await wait(await trader.writeContract({
    address: sr02, abi: sr02Art.abi, functionName: "exactInputSingle", value: parseEther("0.01"),
    args: [{ tokenIn: WETH, tokenOut: T, fee: 10000, recipient: me, amountIn: parseEther("0.01"), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  }));
  const got3 = (await bal(T, me)) - before;
  check(ok3 && got3 === q1, `SwapRouter02 : achat 0.01 ETH, reçu exactement la cotation (aucune taxe)`);

  // 4. micro-achat (les bots testent souvent avec un montant minuscule)
  const b4 = await bal(T, me);
  const ok4 = await wait(await trader.writeContract({
    address: sr02, abi: sr02Art.abi, functionName: "exactInputSingle", value: 1_000_000_000n,
    args: [{ tokenIn: WETH, tokenOut: T, fee: 10000, recipient: me, amountIn: 1_000_000_000n, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  }));
  check(ok4 && (await bal(T, me)) > b4, "micro-achat de 0.000000001 ETH accepté");

  // 5. Universal Router (app Uniswap et beaucoup de bots) : WRAP_ETH puis V3_SWAP_EXACT_IN
  const path1 = encodePacked(["address", "uint24", "address"], [WETH, 10000, T]);
  const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;
  const amt5 = parseEther("0.05");
  const q5 = await quote(WETH, T, amt5);
  const b5 = await bal(T, me);
  const ok5 = await wait(await trader.writeContract({
    address: ur, abi: urArt.abi, functionName: "execute", value: amt5,
    args: ["0x0b00", [
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ADDRESS_THIS, amt5]),
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], [me, amt5, 0n, path1, false]),
    ], 9_999_999_999n],
  }));
  check(ok5 && (await bal(T, me)) - b5 === q5, "Universal Router : achat 0.05 ETH (WRAP_ETH + V3_SWAP_EXACT_IN), sans taxe");

  // 6. swap direct sur la pool, comme un bot (WETH envoyé au contrat puis pool.swap + callback)
  await wait(await trader.writeContract({ address: WETH, abi: parseAbi(["function deposit() payable"]), functionName: "deposit", value: parseEther("0.02") }));
  await wait(await trader.writeContract({ address: WETH, abi: erc20Abi, functionName: "transfer", args: [bot, parseEther("0.02")] }));
  const q6 = await quote(WETH, T, parseEther("0.02"));
  const b6 = await bal(T, me);
  const ok6 = await wait(await trader.writeContract({ address: bot, abi: B.abi, functionName: "swap", args: [pool, WETH, parseEther("0.02"), me] }));
  check(ok6 && (await bal(T, me)) - b6 === q6, "swap direct sur la pool (style bot) : achat 0.02 ETH");

  // 7. transfert entre wallets : montant exact (pas de taxe, pas de liste noire, pas de limite)
  const friend = "0x00000000000000000000000000000000000f00d1" as Address;
  const tAmt = (await bal(T, me)) / 10n;
  await wait(await trader.writeContract({ address: T, abi: erc20Abi, functionName: "transfer", args: [friend, tAmt] }));
  check((await bal(T, friend)) === tAmt, "transfert wallet → wallet : montant exact reçu");

  // 8. revente via SwapRouter02 (test « honeypot » : on peut ressortir)
  await wait(await trader.writeContract({ address: T, abi: erc20Abi, functionName: "approve", args: [sr02, maxUint256] }));
  const sellAmt = (await bal(T, me)) / 2n;
  const q8 = await quote(T, WETH, sellAmt);
  const w8 = await bal(WETH, me);
  const ok8 = await wait(await trader.writeContract({
    address: sr02, abi: sr02Art.abi, functionName: "exactInputSingle",
    args: [{ tokenIn: T, tokenOut: WETH, fee: 10000, recipient: me, amountIn: sellAmt, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  }));
  check(ok8 && (await bal(WETH, me)) - w8 === q8, `SwapRouter02 : revente de la moitié → ${formatEther(q8)} WETH (= cotation, pas de taxe de vente)`);

  // 9. revente via Universal Router jusqu'en ETH natif (V3_SWAP_EXACT_IN vers le router puis UNWRAP_WETH)
  const sell9 = (await bal(T, me)) / 2n;
  const q9 = await quote(T, WETH, sell9);
  await wait(await trader.writeContract({ address: T, abi: erc20Abi, functionName: "transfer", args: [ur, sell9] }));
  const e9 = await pub.getBalance({ address: me });
  const h9 = await trader.writeContract({
    address: ur, abi: urArt.abi, functionName: "execute",
    args: ["0x000c", [
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
        [ADDRESS_THIS, sell9, 0n, encodePacked(["address", "uint24", "address"], [T, 10000, WETH]), false]),
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [me, 0n]),
    ], 9_999_999_999n],
  });
  const r9 = await pub.waitForTransactionReceipt({ hash: h9 });
  const gas9 = r9.gasUsed * r9.effectiveGasPrice;
  check(r9.status === "success" && (await pub.getBalance({ address: me })) + gas9 - e9 === q9, `Universal Router : revente en ETH natif → ${formatEther(q9)} ETH`);

  // 10. aller-retour : on récupère ~98 % (2 × 1 % de frais LP), rien d'autre n'est prélevé
  const rtIn = parseEther("0.1");
  const rtTokens = await quote(WETH, T, rtIn);
  const rtOut = await (async () => {
    await wait(await trader.writeContract({
      address: sr02, abi: sr02Art.abi, functionName: "exactInputSingle", value: rtIn,
      args: [{ tokenIn: WETH, tokenOut: T, fee: 10000, recipient: me, amountIn: rtIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
    }));
    return quote(T, WETH, rtTokens);
  })();
  const pct = Number((rtOut * 10_000n) / rtIn) / 100;
  check(pct > 97.9 && pct < 98.1, `aller-retour 0.1 ETH → ${pct} % récupérés (seulement les 2 × 1 % de frais)`);

  // 11. gros achat (5 ETH) : passe, avec l'impact de prix attendu
  const b11 = await bal(T, me);
  const ok11 = await wait(await trader.writeContract({
    address: sr02, abi: sr02Art.abi, functionName: "exactInputSingle", value: parseEther("5"),
    args: [{ tokenIn: WETH, tokenOut: T, fee: 10000, recipient: me, amountIn: parseEther("5"), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  }));
  check(ok11 && (await bal(T, me)) > b11, "gros achat de 5 ETH accepté");

  // 12. paire USDC : achetable en ETH par routage multi-saut ETH → USDC → TOKEN (si une pool ETH/USDC existe)
  await wait(await relayerW.writeContract({ address: lc.factory, abi: factoryAbi, functionName: "setQuote", args: [lc.usdc, true] }));
  const LU = await chain.launchToken({ name: "Usdc Pair", symbol: "USDP", image: "", xId: "42", quote: { address: lc.usdc, decimals: 6, usd: 1 } });
  // pool WETH/USDC à 3 000 $, pleine plage, comme sur Base
  await wait(await relayerW.writeContract({ address: lc.usdc, abi: mockAssetAbi, functionName: "mint", args: [me, parseUnits("3000000", 6)] }));
  const [t0, t1] = BigInt(WETH) < BigInt(lc.usdc) ? [WETH, lc.usdc] : [lc.usdc, WETH];
  const wethIs0 = t0 === WETH;
  const price = wethIs0 ? 3000 * 1e6 / 1e18 : 1e18 / (3000 * 1e6); // token1 / token0, unités brutes
  const sqrtP = BigInt(Math.floor(Math.sqrt(price) * 2 ** 96));
  await wait(await trader.writeContract({ address: lc.npm, abi: npmArt.abi, functionName: "createAndInitializePoolIfNecessary", args: [t0, t1, 500, sqrtP] }));
  await wait(await trader.writeContract({ address: WETH, abi: parseAbi(["function deposit() payable"]), functionName: "deposit", value: parseEther("500") }));
  for (const t of [WETH, lc.usdc]) await wait(await trader.writeContract({ address: t, abi: erc20Abi, functionName: "approve", args: [lc.npm, maxUint256] }));
  await wait(await trader.writeContract({ address: lc.npm, abi: npmArt.abi, functionName: "mint", args: [{
    token0: t0, token1: t1, fee: 500, tickLower: -887270, tickUpper: 887270,
    amount0Desired: wethIs0 ? parseEther("300") : parseUnits("900000", 6), amount1Desired: wethIs0 ? parseUnits("900000", 6) : parseEther("300"),
    amount0Min: 0n, amount1Min: 0n, recipient: me, deadline: 9_999_999_999n,
  }] }));
  const pathU = encodePacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, lc.usdc, 10000, LU.token]);
  const qU = (await pub.simulateContract({ address: quoter, abi: quoterArt.abi, functionName: "quoteExactInput", args: [pathU, parseEther("0.01")] })).result[0] as bigint;
  const bU = await bal(LU.token, me);
  const okU = await wait(await trader.writeContract({
    address: sr02, abi: sr02Art.abi, functionName: "exactInput", value: parseEther("0.01"),
    args: [{ path: pathU, recipient: me, amountIn: parseEther("0.01"), amountOutMinimum: 0n }],
  }));
  check(okU && qU > 0n && (await bal(LU.token, me)) - bU === qU, "paire USDC : achat en ETH via ETH → USDC → TOKEN (multi-saut)");

  console.log(failed ? `\n${failed} échec(s).` : "\nTout est vert : tradable par routers, agrégateurs et bots dès le lancement.");
} catch (e) {
  console.error(e);
  failed++;
} finally {
  lc?.stop();
  process.exit(failed ? 1 : 0);
}
