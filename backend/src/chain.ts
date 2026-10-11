import {
  createPublicClient, createWalletClient, http, fallback, keccak256, toBytes, getContractAddress, parseEther,
  parseEventLogs, parseAbiItem, toHex, WaitForTransactionReceiptTimeoutError, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import crypto from "node:crypto";
import { config } from "./config.js";
import { factoryAbi } from "./abi.js";

export const chain = config.chain === "base" ? base : baseSepolia;
// RPC principal puis RPC de secours : si l'un sature ou tombe, la requête part sur le suivant
const rpcUrls = [...new Set([config.rpcUrl, ...config.rpcFallbacks])];
const transport = rpcUrls.length > 1
  ? fallback(rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 1 })), { retryCount: 1 })
  : http(config.rpcUrl);
export const publicClient = createPublicClient({ chain, transport });
export const relayer = privateKeyToAccount(config.relayerKey);
const attester = privateKeyToAccount(config.attesterKey);
export const wallet = createWalletClient({ chain, account: relayer, transport });

export const factory = { address: config.factory, abi: factoryAbi } as const;

// Les tx du relayer partent une par une (évite les collisions de nonce).
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** identifiant on-chain d'un compte X : basé sur l'id numérique (stable), jamais sur le @handle */
export const creatorIdOf = (xId: string): Hex => keccak256(toBytes(`x:${xId}`));

/** ce qu'il faut savoir d'un actif de paire pour fixer le prix */
export type PairAsset = { address: Address; decimals: number; usd: number };

// ------------------------------------------------------------------ prix
const TICK_SPACING = 200;
const SUPPLY = 1_000_000_000;
const TOKEN_DECIMALS = 18;

/**
 * Prix de départ de la pool pour une valorisation en dollars, quel que soit l'actif de la paire.
 * La pool cote token1/token0 en unités brutes. Le token lancé peut être token0 ou token1 selon
 * les adresses : on place le prix juste hors de la plage de liquidité pour qu'elle soit 100 % token.
 */
export function initialPrice(quote: PairAsset, tokenIsToken0: boolean, fdvUsd = config.startFdvUsd) {
  const tokenUsd = fdvUsd / SUPPLY;
  const humanPrice = tokenUsd / quote.usd; // actif de paire par token
  const rawPrice = humanPrice * 10 ** (quote.decimals - TOKEN_DECIMALS); // unités brutes
  const poolPrice = tokenIsToken0 ? rawPrice : 1 / rawPrice; // token1 / token0
  const rawTick = Math.floor(Math.log(poolPrice) / Math.log(1.0001));
  const tickBound = Math.floor(rawTick / TICK_SPACING) * TICK_SPACING;
  const atBound = Math.sqrt(Math.pow(1.0001, tickBound)) * 2 ** 96;
  // token0 : un poil SOUS la borne basse ; token1 : un poil AU-DESSUS de la borne haute
  const sqrt = atBound * (tokenIsToken0 ? 1 - 1e-9 : 1 + 1e-9);
  return { tickBound, sqrtPriceX96: BigInt(Math.floor(sqrt)) };
}

/** prix humain (actif de paire par token) à partir d'un sqrtPriceX96 de la pool */
export function sqrtToPrice(sqrtPriceX96: bigint, tokenIsToken0: boolean, quoteDecimals: number) {
  const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // token1 / token0, unités brutes
  const raw = tokenIsToken0 ? p : 1 / p; // actif brut par token brut
  return raw * 10 ** (TOKEN_DECIMALS - quoteDecimals);
}

// ------------------------------------------------------------------ actions
export async function relayerHasFunds(): Promise<boolean> {
  const bal = await publicClient.getBalance({ address: relayer.address });
  return bal >= parseEther(config.minRelayerBalanceEth.toString());
}

export async function launchToken(p: { name: string; symbol: string; image: string; xId: string; quote: PairAsset; onSent?: (hash: Hex) => void }) {
  const creatorId = creatorIdOf(p.xId);
  const initCodeHash = await publicClient.readContract({
    ...factory, functionName: "tokenInitCodeHash", args: [p.name, p.symbol, p.image, creatorId],
  });
  const salt = toHex(crypto.randomBytes(32));
  const predicted = getContractAddress({ opcode: "CREATE2", from: config.factory, salt, bytecodeHash: initCodeHash });
  const tokenIsToken0 = BigInt(predicted) < BigInt(p.quote.address);
  const { tickBound, sqrtPriceX96 } = initialPrice(p.quote, tokenIsToken0);

  return serial(async () => {
    const { request } = await publicClient.simulateContract({
      ...factory, account: relayer, functionName: "launch",
      args: [p.name, p.symbol, p.image, creatorId, salt, p.quote.address, sqrtPriceX96, tickBound],
    });
    const hash = await wallet.writeContract(request);
    p.onSent?.(hash); // la tx est partie : si l'attente échoue, on la rapprochera plus tard au lieu de la croire ratée
    let receipt: TransactionReceipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    } catch (e) {
      if (e instanceof WaitForTransactionReceiptTimeoutError) throw new LaunchPending(hash);
      throw e;
    }
    const r = launchFromReceipt(receipt, p.quote.decimals);
    if (r.token.toLowerCase() !== predicted.toLowerCase()) throw new Error("event introuvable");
    return r;
  });
}

/** la tx de lancement est envoyée mais pas encore confirmée */
export class LaunchPending extends Error {
  constructor(public hash: Hex) { super("launch pending " + hash); }
}

const INITIALIZE = parseAbiItem("event Initialize(uint160 sqrtPriceX96, int24 tick)");
/** lit le résultat d'un lancement dans le reçu (token, pool, prix de départ) */
export function launchFromReceipt(receipt: TransactionReceipt, quoteDecimals: number) {
  if (receipt.status !== "success") throw new Error("tx revert " + receipt.transactionHash);
  const [ev] = parseEventLogs({ abi: factoryAbi, eventName: "TokenLaunched", logs: receipt.logs });
  if (!ev) throw new Error("event introuvable");
  const [init] = parseEventLogs({ abi: [INITIALIZE], logs: receipt.logs.filter((l) => l.address.toLowerCase() === ev.args.pool.toLowerCase()) });
  return {
    token: ev.args.token,
    pool: ev.args.pool,
    txHash: receipt.transactionHash,
    block: Number(receipt.blockNumber),
    tokenIsToken0: ev.args.tokenIsToken0,
    initPrice: init ? sqrtToPrice(init.args.sqrtPriceX96, ev.args.tokenIsToken0, quoteDecimals) : 0,
  };
}

/** ramasse les frais de trading de ces tokens (le relayer paie le gas) et renvoie les événements FeesCollected */
export async function collectFees(tokens: Address[]) {
  if (config.factoryPending || !tokens.length) return [];
  return serial(async () => {
    const out = [];
    for (let i = 0; i < tokens.length; i += 25) {
      const { request } = await publicClient.simulateContract({
        ...factory, account: relayer, functionName: "collectFeesMany", args: [tokens.slice(i, i + 25)],
      });
      const h = await wallet.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
      out.push(...parseEventLogs({ abi: factoryAbi, eventName: "FeesCollected", logs: receipt.logs }));
    }
    return out;
  });
}

let feeBpsCache: number | undefined;
export async function creatorFeeBps(): Promise<number> {
  if (config.factoryPending) return Number(process.env.CREATOR_FEE_BPS ?? 5000);
  if (feeBpsCache === undefined) {
    feeBpsCache = Number(await publicClient.readContract({ ...factory, functionName: "creatorFeeBps" }));
  }
  return feeBpsCache;
}

/** séquestre du créateur pour chaque actif demandé (ses tokens + les actifs de paire utilisés) */
export async function creatorState(xId: string, assets: Address[]) {
  if (config.factoryPending) return { boundWallet: null, escrow: assets.map((asset) => ({ asset, amount: "0" })) };
  const creatorId = creatorIdOf(xId);
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
export async function claimFor(xId: string, recipient: Address, tokens: Address[], assets: Address[]) {
  if (config.factoryPending) throw new Error("Nothing to claim yet.");
  const creatorId = creatorIdOf(xId);

  return serial(async () => {
    for (let i = 0; i < tokens.length; i += 25) {
      const { request } = await publicClient.simulateContract({
        ...factory, account: relayer, functionName: "collectFeesMany", args: [tokens.slice(i, i + 25)],
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

/**
 * Envoi d'ETH depuis le wallet de la plateforme (versements de parrainage).
 * La tx est signée localement et son hash enregistré AVANT la diffusion : même si le RPC
 * répond mal, on sait qu'elle a pu partir et on ne la compte jamais comme échouée.
 */
export async function sendEth(to: Address, wei: bigint, onSent: (hash: Hex) => void): Promise<{ txHash: Hex }> {
  return serial(async () => {
    const req = await wallet.prepareTransactionRequest({ to, value: wei });
    const raw = await relayer.signTransaction({ ...req, chainId: chain.id } as never);
    const hash = keccak256(raw);
    onSent(hash); // à partir d'ici, l'argent est peut-être parti
    await publicClient.sendRawTransaction({ serializedTransaction: raw }).catch((e) => {
      // "already known" / "nonce too low" : la même tx a déjà été diffusée, on attend son reçu
      if (!/already known|nonce too low|known transaction/i.test(String(e?.message))) throw e;
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("transfer revert " + hash);
    return { txHash: hash };
  });
}
export async function relayerBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: relayer.address });
}
