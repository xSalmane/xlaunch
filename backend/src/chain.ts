import {
  createPublicClient, createWalletClient, http, keccak256, toBytes, getContractAddress, parseEther,
  parseEventLogs, toHex, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import crypto from "node:crypto";
import { config } from "./config.js";
import { factoryAbi } from "./abi.js";

const chain = config.chain === "base" ? base : baseSepolia;
export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const relayer = privateKeyToAccount(config.relayerKey);
const attester = privateKeyToAccount(config.attesterKey);
const wallet = createWalletClient({ chain, account: relayer, transport: http(config.rpcUrl) });

const factory = { address: config.factory, abi: factoryAbi } as const;

// Les tx du relayer partent une par une (évite les collisions de nonce).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** identifiant on-chain d'un compte X : basé sur l'id numérique (stable), jamais sur le @handle */
export const creatorIdOf = (xId: string): Hex => keccak256(toBytes(`x:${xId}`));

// ------------------------------------------------------------------ prix initial
const TICK_SPACING = 200;
const SUPPLY = 1_000_000_000;

/** tickLower et sqrtPriceX96 pour une valorisation de départ donnée (token = token0, prix en WETH/token) */
export function initialPrice(fdvEth = config.startFdvEth) {
  const price = fdvEth / SUPPLY;
  const rawTick = Math.floor(Math.log(price) / Math.log(1.0001));
  const tickLower = Math.floor(rawTick / TICK_SPACING) * TICK_SPACING;
  // un poil SOUS sqrtRatio(tickLower) -> position 100 % token0
  const sqrt = Math.sqrt(Math.pow(1.0001, tickLower)) * 2 ** 96 * (1 - 1e-9);
  return { tickLower, sqrtPriceX96: BigInt(Math.floor(sqrt)) };
}

// ------------------------------------------------------------------ salt CREATE2
/** cherche un salt qui donne une adresse de token < WETH (~26 % de chance par essai) */
export function findSalt(initCodeHash: Hex): { salt: Hex; predicted: Address } {
  const weth = BigInt(config.weth);
  const start = BigInt("0x" + crypto.randomBytes(24).toString("hex")) << 64n;
  for (let i = 0n; i < 10_000n; i++) {
    const salt = toHex(start + i, { size: 32 });
    const predicted = getContractAddress({ opcode: "CREATE2", from: config.factory, salt, bytecodeHash: initCodeHash });
    if (BigInt(predicted) < weth) return { salt, predicted };
  }
  throw new Error("aucun salt trouvé");
}

// ------------------------------------------------------------------ actions
export async function relayerHasFunds(): Promise<boolean> {
  const bal = await publicClient.getBalance({ address: relayer.address });
  return bal >= parseEther(config.minRelayerBalanceEth.toString());
}

export async function launchToken(p: { name: string; symbol: string; image: string; xId: string }) {
  const creatorId = creatorIdOf(p.xId);
  const initCodeHash = await publicClient.readContract({
    ...factory, functionName: "tokenInitCodeHash", args: [p.name, p.symbol, p.image, creatorId],
  });
  const { salt, predicted } = findSalt(initCodeHash);
  const { tickLower, sqrtPriceX96 } = initialPrice();

  return serial(async () => {
    const { request } = await publicClient.simulateContract({
      ...factory, account: relayer, functionName: "launch",
      args: [p.name, p.symbol, p.image, creatorId, salt, sqrtPriceX96, tickLower],
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error("tx revert " + hash);
    const [ev] = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs });
    if (!ev || ev.args.token.toLowerCase() !== predicted.toLowerCase()) throw new Error("event introuvable");
    return {
      token: ev.args.token,
      pool: ev.args.pool,
      txHash: hash,
      block: Number(receipt.blockNumber),
      initPrice: sqrtToPrice(sqrtPriceX96),
    };
  });
}

/** prix en ETH par token à partir d'un sqrtPriceX96 (token = token0, 18 décimales des deux côtés) */
export const sqrtToPrice = (sqrtPriceX96: bigint) => (Number(sqrtPriceX96) / 2 ** 96) ** 2;

let feeBpsCache: number | undefined;
export async function creatorFeeBps(): Promise<number> {
  if (feeBpsCache === undefined) {
    feeBpsCache = Number(await publicClient.readContract({ ...factory, functionName: "creatorFeeBps" }));
  }
  return feeBpsCache;
}

export async function creatorState(xId: string, tokens: Address[]) {
  const creatorId = creatorIdOf(xId);
  const assets = [...tokens, config.weth];
  const [bound, ...balances] = await Promise.all([
    publicClient.readContract({ ...factory, functionName: "boundWallet", args: [creatorId] }),
    ...assets.map((a) => publicClient.readContract({ ...factory, functionName: "escrow", args: [creatorId, a] })),
  ]);
  return {
    boundWallet: bound === "0x0000000000000000000000000000000000000000" ? null : bound,
    escrow: assets.map((asset, i) => ({ asset, amount: (balances[i] as bigint).toString() })),
  };
}

/**
 * Ramasse les frais en attente puis libère le séquestre vers `recipient`.
 * L'attester signe, le relayer soumet : l'utilisateur ne paie aucun gas.
 */
export async function claimFor(xId: string, recipient: Address, tokens: Address[]) {
  const creatorId = creatorIdOf(xId);
  const assets = [...tokens, config.weth];

  return serial(async () => {
    if (tokens.length) {
      const { request } = await publicClient.simulateContract({
        ...factory, account: relayer, functionName: "collectFeesMany", args: [tokens.slice(0, 25)],
      });
      const h = await wallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: h, timeout: 60_000 });
    }

    const nonce = await publicClient.readContract({ ...factory, functionName: "nonces", args: [creatorId] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await attester.signTypedData({
      domain: { name: "XLaunch", version: "1", chainId: chain.id, verifyingContract: config.factory },
      types: {
        Claim: [
          { name: "creatorId", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Claim",
      message: { creatorId, recipient, nonce, deadline },
    });

    const { request } = await publicClient.simulateContract({
      ...factory, account: relayer, functionName: "claim", args: [creatorId, recipient, assets, deadline, signature],
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error("claim revert " + hash);
    return { txHash: hash };
  });
}

export const relayerAddress = relayer.address;
export const attesterAddress = attester.address;
export const chainId = chain.id;
