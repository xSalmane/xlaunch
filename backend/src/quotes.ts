import fs from "node:fs";
import path from "node:path";
import { erc20Abi, getAddress, parseUnits, type Address } from "viem";
import { config } from "./config.js";
import { publicClient, wallet, relayer, serial, factory, chain } from "./chain.js";
import { mockAssetAbi, mockAssetBytecode } from "./abi.js";

/**
 * Actifs avec lesquels un token peut être apparié : ETH (WETH), USDC et les actions tokenisées
 * de Coinbase sur Base. Sur le testnet, les actions sont remplacées par de fausses actions de test.
 * Chaque actif doit aussi être autorisé dans le contrat (liste blanche de l'owner).
 */
export type Quote = {
  address: Address;
  symbol: string;
  name: string;
  kind: "eth" | "stable" | "stock";
  decimals: number;
  usd: number; // prix de référence en dollars d'une unité
  icon: string;
  mock: boolean;
  paused: boolean;
};

// Actions tokenisées sur Base mainnet — adresses publiées sur https://www.base.org/assets.
// `ref` n'est qu'un prix de secours si l'API Coinbase ne répond pas.
const STOCKS: { symbol: string; name: string; address: Address; ref: number }[] = [
  { symbol: "AAPLc", name: "Apple", address: "0xb200000000000000000000C2e324d24d7eEcd1fb", ref: 230 },
  { symbol: "AMZNc", name: "Amazon", address: "0xb200000000000000000000d9192b6B456483C2E8", ref: 220 },
  { symbol: "GOOGLc", name: "Alphabet", address: "0xb2000000000000000000002D0BA3164cc74f58B7", ref: 200 },
  { symbol: "METAc", name: "Meta", address: "0xb2000000000000000000008bC8786B856E61707C", ref: 700 },
  { symbol: "MSFTc", name: "Microsoft", address: "0xB200000000000000000000Ab99cFa739E253872B", ref: 500 },
  { symbol: "MSTRc", name: "Strategy", address: "0xb2000000000000000000004884b426556b92883d", ref: 350 },
  { symbol: "NVDAc", name: "NVIDIA", address: "0xb20000000000000000000078ee7ce2fE4908108C", ref: 180 },
  { symbol: "SNDKc", name: "SanDisk", address: "0xb200000000000000000000397293Cb8cda9a10c5", ref: 60 },
  { symbol: "SPCXc", name: "SpaceX", address: "0xb2000000000000000000007b9fcbd005511aCBd5", ref: 200 },
  { symbol: "TSLAc", name: "Tesla", address: "0xb2000000000000000000001e800a7f5189430cD0", ref: 400 },
];

let quotes: Quote[] = [];
const byAddr = new Map<string, Quote>();

export const getQuotes = () => quotes;
export const quoteOf = (addr: string) => byAddr.get(addr.toLowerCase());
export const quoteUsd = (addr: string) => byAddr.get(addr.toLowerCase())?.usd ?? 0;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function hasCode(addr: Address) {
  const code = await publicClient.getCode({ address: addr }).catch(() => undefined);
  return !!code && code !== "0x";
}

// ------------------------------------------------------------------ fausses actions (testnet)
async function loadOrDeployMocks(): Promise<Record<string, Address>> {
  const file = path.resolve(config.dataDir, `mock-stocks-${chain.id}.json`);
  let saved: Record<string, Address> = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}

  const out: Record<string, Address> = {};
  for (const s of STOCKS) {
    const sym = "t" + s.symbol.replace(/c$/, "");
    if (saved[sym] && (await hasCode(saved[sym]))) { out[sym] = saved[sym]; continue; }
    const addr = await serial(async () => {
      const hash = await wallet.deployContract({
        abi: mockAssetAbi, bytecode: mockAssetBytecode,
        args: [`${s.name} (action de test)`, sym, 18, relayer.address],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return r.contractAddress!;
    });
    out[sym] = addr;
    console.log(`Action de test ${sym} déployée : ${addr}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...saved, ...out }, null, 2));
  }
  return out;
}

// ------------------------------------------------------------------ initialisation
export async function initQuotes() {
  const list: Quote[] = [
    { address: config.weth, symbol: "ETH", name: "Ether", kind: "eth", decimals: 18, usd: 3000, icon: "", mock: false, paused: false },
  ];

  if (await hasCode(config.usdc)) {
    list.push({ address: config.usdc, symbol: "USDC", name: "USD Coin", kind: "stable", decimals: 6, usd: 1, icon: "", mock: false, paused: false });
  } else {
    console.warn(`USDC introuvable à ${config.usdc} sur cette chaîne : paire USDC désactivée`);
  }

  if (config.chain === "base") {
    // chaque action doit exister on-chain : une adresse vide donnerait une pool où aucun swap ne passe
    const live = await Promise.all(STOCKS.map((s) => hasCode(s.address)));
    STOCKS.forEach((s, i) => {
      if (!live[i]) { console.warn(`${s.symbol} introuvable à ${s.address} : paire désactivée`); return; }
      list.push({ address: s.address, symbol: s.symbol, name: s.name, kind: "stock", decimals: 18, usd: s.ref, icon: "", mock: false, paused: false });
    });
  } else if (config.mockStocks) {
    const mocks = await loadOrDeployMocks();
    for (const s of STOCKS) {
      const sym = "t" + s.symbol.replace(/c$/, "");
      if (mocks[sym]) {
        list.push({ address: mocks[sym], symbol: sym, name: `${s.name} (test)`, kind: "stock", decimals: 18, usd: s.ref, icon: "", mock: true, paused: false });
      }
    }
  }

  // décimales réelles lues sur la chaîne (les actions B20 exposent decimals())
  await Promise.all(list.map(async (q) => {
    if (q.kind === "eth") return;
    try { q.decimals = Number(await publicClient.readContract({ address: q.address, abi: erc20Abi, functionName: "decimals" })); } catch {}
  }));

  // liste blanche du contrat : on autorise ce qui manque (le relayer est owner par défaut)
  const allowed = config.factoryPending ? list.map(() => true) : await Promise.all(list.map((q) =>
    publicClient.readContract({ ...factory, functionName: "quoteAllowed", args: [q.address] }).catch(() => false)
  ));
  const missing = list.filter((_, i) => !allowed[i]).map((q) => q.address);
  if (missing.length) {
    try {
      await serial(async () => {
        const { request } = await publicClient.simulateContract({
          ...factory, account: relayer, functionName: "setQuotes", args: [missing, true],
        });
        const hash = await wallet.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      });
      missing.length = 0;
      console.log(`Paires autorisées dans le contrat : ${list.map((q) => q.symbol).join(", ")}`);
    } catch (e) {
      console.warn("Impossible d'autoriser certaines paires (le relayer n'est pas owner ?) :", (e as Error).message);
    }
  }
  const missingSet = new Set(missing.map((a) => a.toLowerCase()));
  quotes = list.filter((q) => !missingSet.has(q.address.toLowerCase()));
  byAddr.clear();
  for (const q of quotes) byAddr.set(q.address.toLowerCase(), q);

  await refreshPrices();
  setInterval(refreshPrices, 60_000).unref();
}

/** prix en dollars : ETH via Coinbase, actions via l'API des actions tokenisées (valeur de référence) */
async function refreshPrices() {
  try {
    const r = await fetchJson("https://api.coinbase.com/v2/prices/ETH-USD/spot");
    const v = Number(r?.data?.amount);
    if (v > 0) for (const q of quotes) if (q.kind === "eth") q.usd = v;
  } catch {}
  try {
    const r = await fetchJson(config.stocksApi);
    const tokens: any[] = r?.tokens ?? [];
    for (const q of quotes) {
      if (q.kind !== "stock") continue;
      const base = q.symbol.replace(/^t/, "").replace(/c$/, "").toUpperCase();
      const t = q.mock
        ? tokens.find((x) => String(x.symbol).replace(/c$/, "").toUpperCase() === base)
        : tokens.find((x) => x.contract_address && getAddress(x.contract_address) === getAddress(q.address));
      if (!t) continue;
      if (Number(t.nav_price) > 0) q.usd = Number(t.nav_price);
      if (t.icon_url) q.icon = String(t.icon_url);
      if (!q.mock) q.paused = Array.isArray(t.paused_features) && t.paused_features.length > 0;
    }
  } catch {}
}

// ------------------------------------------------------------------ robinet de test
/** envoie 10 unités de chaque fausse action à une adresse (testnet uniquement) */
export async function mintTestStocks(to: Address) {
  const mocks = quotes.filter((q) => q.mock);
  return serial(async () => {
    for (const q of mocks) {
      const hash = await wallet.writeContract({
        address: q.address, abi: mockAssetAbi, functionName: "mint", args: [to, parseUnits("10", q.decimals)],
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    }
    return mocks.map((q) => q.symbol);
  });
}
