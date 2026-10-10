// Test bout-en-bout sur une chaîne locale (anvil) avec le vrai Uniswap v3 :
// launch -> swap -> collecte des frais -> réclamation -> sécurité.
// Usage : ANVIL_BIN=/chemin/anvil npm test
import { createPublicClient, createWalletClient, http, parseEther, formatEther, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { startLocalChain, KEYS as K, WETH, type LocalChain } from "./localchain.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const TREASURY = "0x000000000000000000000000000000000000dEaD" as const;

let failed = 0;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failed++;
};

let lc: LocalChain | undefined;
try {
  lc = await startLocalChain({ port: 8546, treasury: TREASURY });
  const { factory, router, routerAbi } = lc;
  const routerArt = { abi: routerAbi };
  const pub = createPublicClient({ chain: baseSepolia, transport: http(lc.rpc) });
  const trader = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(K.trader), transport: http(lc.rpc) });

  Object.assign(process.env, {
    PUBLIC_URL: "http://localhost", CHAIN: "base-sepolia", RPC_URL: lc.rpc, FACTORY_ADDRESS: factory,
    RELAYER_PRIVATE_KEY: K.relayer, ATTESTER_PRIVATE_KEY: K.attester, X_CLIENT_ID: "x", X_CLIENT_SECRET: "x",
    JWT_SECRET: "test", DB_PATH: ":memory:",
  });
  const chain = await import("../src/chain.js");
  const { factoryAbi } = await import("../src/abi.js");
  const XID = "1234567890";

  // 1) launch
  check(await chain.relayerHasFunds(), "relayer a des fonds");
  const L = await chain.launchToken({ name: "Test Coin", symbol: "TEST", image: "https://x.y/z.png", xId: XID });
  console.log("token", L.token, "pool", L.pool);
  check(BigInt(L.token) < BigInt(WETH), "token < WETH (token0)");
  const supply = parseEther("1000000000");
  const escrowTok = await pub.readContract({ address: factory, abi: factoryAbi, functionName: "escrow", args: [chain.creatorIdOf(XID), L.token] });
  check(escrowTok === 0n, "aucune supply pour le créateur");
  const poolBal = await pub.readContract({ address: L.token, abi: erc20Abi, functionName: "balanceOf", args: [L.pool] });
  check(supply - poolBal < 1_000_000n, `100 % de la supply dans la pool, hors arrondi (${formatEther(poolBal)})`);
  const tresTok = await pub.readContract({ address: L.token, abi: erc20Abi, functionName: "balanceOf", args: [TREASURY] });
  const facTok = await pub.readContract({ address: L.token, abi: erc20Abi, functionName: "balanceOf", args: [factory] });
  check(facTok === 0n && tresTok === supply - poolBal, "aucun token gardé par la plateforme (arrondi brûlé)");

  // 2) swap 1 ETH -> token
  const swapHash = await trader.writeContract({
    address: router, abi: routerArt.abi, functionName: "exactInputSingle", value: parseEther("1"),
    args: [{ tokenIn: WETH, tokenOut: L.token, fee: 10000, recipient: trader.account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: parseEther("1"), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  });
  check((await pub.waitForTransactionReceipt({ hash: swapHash })).status === "success", "swap 1 ETH -> TEST");
  const got = await pub.readContract({ address: L.token, abi: erc20Abi, functionName: "balanceOf", args: [trader.account.address] });
  console.log("  trader a reçu", formatEther(got), "TEST");
  // valorisation de départ ~3 ETH -> 1 ETH achète une grosse part de la supply
  check(got > parseEther("100000000") && got < parseEther("400000000"), "prix initial cohérent avec START_FDV_ETH=3");

  // 3) réclamation (collecte des frais + libération du séquestre)
  const C = await chain.claimFor(XID, RECIPIENT, [L.token]);
  console.log("  claim tx", C.txHash);
  const recTok = await pub.readContract({ address: L.token, abi: erc20Abi, functionName: "balanceOf", args: [RECIPIENT] });
  const recWeth = await pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [RECIPIENT] });
  const tresWeth = await pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [TREASURY] });
  check(recTok === 0n, "créateur ne reçoit aucun token (que des frais)");
  check(recWeth > parseEther("0.0049") && recWeth <= parseEther("0.005"), `créateur reçoit 50 % des frais (${formatEther(recWeth)} WETH)`);
  check(tresWeth > parseEther("0.0049"), `trésorerie reçoit 50 % des frais (${formatEther(tresWeth)} WETH)`);
  const bound = await pub.readContract({ address: factory, abi: factoryAbi, functionName: "boundWallet", args: [chain.creatorIdOf(XID)] });
  check(bound === RECIPIENT, "wallet lié au compte X");

  // 4) 2e launch du même créateur -> frais versés directement (wallet déjà lié)
  const L2 = await chain.launchToken({ name: "Second", symbol: "TWO", image: "", xId: XID });
  const h2 = await trader.writeContract({
    address: router, abi: routerArt.abi, functionName: "exactInputSingle", value: parseEther("1"),
    args: [{ tokenIn: WETH, tokenOut: L2.token, fee: 10000, recipient: trader.account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: parseEther("1"), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  });
  await pub.waitForTransactionReceipt({ hash: h2 });
  const h3 = await trader.writeContract({ address: factory, abi: factoryAbi, functionName: "collectFees", args: [L2.token] });
  await pub.waitForTransactionReceipt({ hash: h3 });
  const recWeth2 = await pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [RECIPIENT] });
  check(recWeth2 - recWeth > parseEther("0.0049"), "2e token : frais versés directement au wallet lié");

  // 5) sécurité : signature d'un autre que l'attester refusée
  const fake = privateKeyToAccount(K.trader);
  const sig = await fake.signTypedData({
    domain: { name: "XLaunch", version: "1", chainId: 84532, verifyingContract: factory },
    types: { Claim: [{ name: "creatorId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Claim",
    message: { creatorId: chain.creatorIdOf(XID), recipient: fake.address, nonce: 1n, deadline: 9999999999n },
  });
  let rejected = false;
  try {
    await pub.simulateContract({ address: factory, abi: factoryAbi, functionName: "claim", account: fake.address,
      args: [chain.creatorIdOf(XID), fake.address, [WETH], 9999999999n, sig] });
  } catch { rejected = true; }
  check(rejected, "fausse signature refusée");

  // 6) seul le relayer peut lancer
  let blocked = false;
  try {
    await pub.simulateContract({ address: factory, abi: factoryAbi, functionName: "launch", account: fake.address,
      args: ["A", "A", "", chain.creatorIdOf("1"), "0x" + "00".repeat(32) as Hex, 1n << 96n, 0] });
  } catch { blocked = true; }
  check(blocked, "launch réservé au relayer");
} catch (e) {
  console.error(e);
  failed++;
} finally {
  lc?.stop();
}
console.log(failed ? `\n${failed} échec(s)` : "\nTout est vert.");
process.exit(failed ? 1 : 0);
