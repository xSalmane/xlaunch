// Test bout-en-bout sur une chaîne locale (anvil) avec le vrai Uniswap v3.
// Couvre les trois types de paire et les deux sens de pool :
//   ETH (18 déc.), un actif « bas » à 6 décimales où le token est token1, un actif « haut » où il est token0.
// Usage : ANVIL_BIN=/chemin/anvil npm test
import {
  createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, formatUnits, erc20Abi,
  maxUint256, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { startLocalChain, KEYS as K, WETH, type LocalChain } from "./localchain.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const TREASURY = "0x000000000000000000000000000000000000dEaD" as const;
const LOW = "0x00000000000000000000000000000000000000a1" as Address; // toujours < token -> token1
const HIGH = "0xffffffffffffffffffffffffffffffffffff0001" as Address; // toujours > token -> token0
const SUPPLY = parseEther("1000000000");

let failed = 0;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
};

let lc: LocalChain | undefined;
try {
  lc = await startLocalChain({ port: 8546, treasury: TREASURY });
  const { factory, router, routerAbi } = lc;
  const pub = createPublicClient({ chain: baseSepolia, transport: http(lc.rpc) });
  const trader = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(K.trader), transport: http(lc.rpc) });
  const relayerW = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(K.relayer), transport: http(lc.rpc) });

  Object.assign(process.env, {
    PUBLIC_URL: "http://localhost", CHAIN: "base-sepolia", RPC_URL: lc.rpc, FACTORY_ADDRESS: factory,
    RELAYER_PRIVATE_KEY: K.relayer, ATTESTER_PRIVATE_KEY: K.attester, X_CLIENT_ID: "x", X_CLIENT_SECRET: "x",
    JWT_SECRET: "test", DB_PATH: ":memory:", START_FDV_USD: "10000",
  });
  const chain = await import("../src/chain.js");
  const { factoryAbi, mockAssetAbi } = await import("../src/abi.js");
  const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

  // actifs de test placés à des adresses extrêmes pour forcer les deux sens de pool
  const code = await pub.getCode({ address: lc.usdc });
  for (const a of [LOW, HIGH]) await pub.request({ method: "anvil_setCode" as never, params: [a, code] as never });
  await wait(await relayerW.writeContract({ address: factory, abi: factoryAbi, functionName: "setQuotes", args: [[LOW, HIGH, lc.usdc], true] }));
  check(await pub.readContract({ address: factory, abi: factoryAbi, functionName: "quoteAllowed", args: [LOW] }), "liste blanche : paires ajoutées par l'owner");

  const XID = "1234567890";
  const swap = async (tokenIn: Address, tokenOut: Address, amountIn: bigint, eth = false) => {
    const h = await trader.writeContract({
      address: router, abi: routerAbi, functionName: "exactInputSingle", value: eth ? amountIn : 0n,
      args: [{ tokenIn, tokenOut, fee: 10000, recipient: trader.account.address, deadline: 9_999_999_999n, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
    });
    return (await wait(h)).status === "success";
  };
  const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

  // ------------------------------------------------ 1) paire ETH (prix ETH fixé à 3 000 $)
  const ETHQ = { address: WETH, decimals: 18, usd: 3000 };
  const L1 = await chain.launchToken({ name: "Test Coin", symbol: "TEST", image: "", xId: XID, quote: ETHQ });
  check(supply(await bal(L1.token, L1.pool)), "ETH : 100 % de la supply dans la pool");
  check(await swap(WETH, L1.token, parseEther("1"), true), "ETH : achat de 1 ETH (3 000 $)");
  const got1 = await bal(L1.token, trader.account.address);
  // FDV 10 000 $ + achat 3 000 $ -> environ 3 000 / 13 000 de la supply (~23 %)
  check(got1 > parseEther("180000000") && got1 < parseEther("260000000"), `ETH : prix de départ cohérent (${fmtM(got1)} tokens pour 3 000 $)`);

  // ------------------------------------------------ 2) actif bas, 6 décimales, 1 $ -> token = token1
  const LOWQ = { address: LOW, decimals: 6, usd: 1 };
  const L2 = await chain.launchToken({ name: "Low Pair", symbol: "LOWP", image: "", xId: XID, quote: LOWQ });
  check(L2.tokenIsToken0 === false, "6 déc. : le token est token1 (sens inverse géré)");
  check(supply(await bal(L2.token, L2.pool)), "6 déc. : 100 % de la supply dans la pool");
  await wait(await relayerW.writeContract({ address: LOW, abi: mockAssetAbi, functionName: "mint", args: [trader.account.address, parseUnits("5000", 6)] }));
  await wait(await trader.writeContract({ address: LOW, abi: erc20Abi, functionName: "approve", args: [router, maxUint256] }));
  check(await swap(LOW, L2.token, parseUnits("3000", 6)), "6 déc. : achat de 3 000 unités (3 000 $)");
  const got2 = await bal(L2.token, trader.account.address);
  check(got2 > parseEther("180000000") && got2 < parseEther("260000000"), `6 déc. : même prix en dollars que la paire ETH (${fmtM(got2)} tokens)`);
  await wait(await trader.writeContract({ address: L2.token, abi: erc20Abi, functionName: "approve", args: [router, maxUint256] }));
  check(await swap(L2.token, LOW, got2 / 2n), "6 déc. : revente de la moitié");

  // ------------------------------------------------ 3) actif haut, prix d'une action (150 $) -> token = token0
  const HIGHQ = { address: HIGH, decimals: 6, usd: 150 };
  const L3 = await chain.launchToken({ name: "Stock Pair", symbol: "STKP", image: "", xId: XID, quote: HIGHQ });
  check(L3.tokenIsToken0 === true, "action : le token est token0");
  await wait(await relayerW.writeContract({ address: HIGH, abi: mockAssetAbi, functionName: "mint", args: [trader.account.address, parseUnits("100", 6)] }));
  await wait(await trader.writeContract({ address: HIGH, abi: erc20Abi, functionName: "approve", args: [router, maxUint256] }));
  check(await swap(HIGH, L3.token, parseUnits("20", 6)), "action : achat de 20 actions (3 000 $)");
  const got3 = await bal(L3.token, trader.account.address);
  check(got3 > parseEther("180000000") && got3 < parseEther("260000000"), `action : même prix en dollars (${fmtM(got3)} tokens)`);

  // ------------------------------------------------ 4) réclamation multi-actifs
  const tokens = [L1.token, L2.token, L3.token];
  const assets = [...tokens, WETH, LOW, HIGH];
  const C = await chain.claimFor(XID, RECIPIENT, tokens, assets);
  check(!!C.txHash, "réclamation envoyée (frais ramassés sur les 3 pools)");
  const rW = await bal(WETH, RECIPIENT), rL = await bal(LOW, RECIPIENT), rH = await bal(HIGH, RECIPIENT);
  check(rW > parseEther("0.0049") && rW <= parseEther("0.005"), `créateur : 50 % des frais ETH (${formatEther(rW)} WETH)`);
  check(rL > parseUnits("14.9", 6) && rL <= parseUnits("15", 6), `créateur : 50 % des frais à 6 déc. (${formatUnits(rL, 6)})`);
  check(rH > parseUnits("0.099", 6) && rH <= parseUnits("0.1", 6), `créateur : 50 % des frais en action (${formatUnits(rH, 6)})`);
  check((await bal(L2.token, RECIPIENT)) > 0n, "créateur : reçoit aussi sa part des frais en token (reventes)");
  check((await bal(LOW, TREASURY)) > parseUnits("14.9", 6), "plateforme : 50 % des frais dans l'actif de la paire");

  // ------------------------------------------------ 5) sécurité
  let blocked = false;
  try {
    await pub.simulateContract({ address: factory, abi: factoryAbi, functionName: "launch", account: trader.account.address,
      args: ["A", "A", "", chain.creatorIdOf("1"), ("0x" + "00".repeat(32)) as Hex, WETH, 1n << 96n, 0] });
  } catch { blocked = true; }
  check(blocked, "launch réservé au relayer");
  let refused = false;
  try {
    await pub.simulateContract({ address: factory, abi: factoryAbi, functionName: "launch", account: relayerW.account.address,
      args: ["B", "B", "", chain.creatorIdOf("1"), ("0x" + "11".repeat(32)) as Hex, "0x0000000000000000000000000000000000000bad", 1n << 96n, 0] });
  } catch { refused = true; }
  check(refused, "paire hors liste blanche refusée");
  const fake = privateKeyToAccount(K.trader);
  const sig = await fake.signTypedData({
    domain: { name: "XLaunch", version: "1", chainId: 84532, verifyingContract: factory },
    types: { Claim: [{ name: "creatorId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Claim",
    message: { creatorId: chain.creatorIdOf(XID), recipient: fake.address, nonce: 1n, deadline: 9_999_999_999n },
  });
  let rejected = false;
  try {
    await pub.simulateContract({ address: factory, abi: factoryAbi, functionName: "claim", account: fake.address,
      args: [chain.creatorIdOf(XID), fake.address, [WETH], 9_999_999_999n, sig] });
  } catch { rejected = true; }
  check(rejected, "fausse signature refusée");
} catch (e) {
  console.error(e);
  failed++;
} finally {
  lc?.stop();
}

// arrondi Uniswap toléré : moins de 0,000001 token (il est brûlé, personne ne le garde)
function supply(inPool: bigint) { return SUPPLY - inPool < 1_000_000_000_000n; }
function fmtM(v: bigint) { return (Number(v / 10n ** 18n) / 1e6).toFixed(0) + " M"; }

console.log(failed ? `\n${failed} échec(s)` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
