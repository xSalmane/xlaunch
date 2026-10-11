// Chaîne locale (anvil) avec le vrai Uniswap v3 + WETH à son adresse Base + XLaunchFactory.
// Utilisée par le test e2e et par le mode démo (npm run local).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const require = createRequire(import.meta.url);

export const WETH: Address = "0x4200000000000000000000000000000000000006";
// comptes de test publics d'anvil (ne jamais utiliser ailleurs)
export const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  relayer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  attester: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb47e8b51fb04e2",
  trader: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

export type LocalChain = {
  rpc: string;
  factory: Address;
  router: Address;
  routerAbi: Abi;
  treasury: Address;
  usdc: Address; // faux USDC (6 décimales), minter = relayer
  uniFactory: Address;
  npm: Address;
  stop: () => void;
};

export async function startLocalChain(opts: { port?: number; treasury?: Address; creatorFeeBps?: number; blockTime?: number } = {}): Promise<LocalChain> {
  const port = opts.port ?? 8546;
  const rpc = `http://127.0.0.1:${port}`;
  const args = ["--port", String(port), "--chain-id", "84532", "--silent"];
  if (opts.blockTime) args.push("--block-time", String(opts.blockTime));
  const anvil: ChildProcess = spawn(process.env.ANVIL_BIN ?? "anvil", args, { stdio: "ignore" });
  anvil.on("error", (e) => {
    console.error("Impossible de lancer anvil (installe Foundry ou définis ANVIL_BIN) :", e.message);
    process.exit(1);
  });

  const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  for (let i = 0; i < 50; i++) {
    try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const deployer = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(KEYS.deployer), transport: http(rpc) });

  async function deploy(abi: Abi, bytecode: Hex, args: unknown[] = []) {
    const hash = await deployer.deployContract({ abi, bytecode, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  }
  const art = (p: string) => JSON.parse(fs.readFileSync(require.resolve(p), "utf8"));

  // WETH placé à 0x4200…0006 comme sur Base
  const solc = require("../../contracts/node_modules/solc");
  const src = fs.readFileSync(new URL("./WETH9.sol", import.meta.url), "utf8");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity", sources: { "W.sol": { content: src } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const W = out.contracts["W.sol"].WETH9;
  const tmp = await deploy(W.abi, ("0x" + W.evm.bytecode.object) as Hex);
  await pub.request({ method: "anvil_setCode" as never, params: [WETH, await pub.getCode({ address: tmp })] as never });

  const uf = art("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
  const npmArt = art("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
  const routerArt = art("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json");
  const uniFactory = await deploy(uf.abi, uf.bytecode);
  const npm = await deploy(npmArt.abi, npmArt.bytecode, [uniFactory, WETH, "0x0000000000000000000000000000000000000001"]);
  const router = await deploy(routerArt.abi, routerArt.bytecode, [uniFactory, WETH]);

  const fx = JSON.parse(fs.readFileSync(new URL("../../contracts/out/XLaunchFactory.json", import.meta.url), "utf8"));
  const treasury = opts.treasury ?? "0x000000000000000000000000000000000000bEEF";
  // owner = relayer, comme l'installation automatique en production (il gère la liste des paires)
  const factory = await deploy(fx.abi, fx.bytecode, [
    privateKeyToAccount(KEYS.relayer).address, npm, WETH,
    privateKeyToAccount(KEYS.relayer).address, privateKeyToAccount(KEYS.attester).address,
    treasury, opts.creatorFeeBps ?? 5000,
  ]);

  const mock = JSON.parse(fs.readFileSync(new URL("../../contracts/out/MockAsset.json", import.meta.url), "utf8"));
  const usdc = await deploy(mock.abi, mock.bytecode, ["USD Coin (test)", "USDC", 6, privateKeyToAccount(KEYS.relayer).address]);

  return { rpc, factory, router, routerAbi: routerArt.abi, treasury, usdc, uniFactory, npm, stop: () => anvil.kill() };
}
