// Démo locale complète, sans X ni vrais fonds :
//   chaîne anvil + Uniswap v3 + XLaunchFactory, connexion de démo, tokens d'exemple et trades simulés.
// Usage : ANVIL_BIN=$(which anvil) npm run local        (ajoute --no-seed pour partir de zéro)
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, maxUint256, erc20Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { startLocalChain, KEYS, WETH } from "../test/localchain.js";

const PORT = Number(process.env.PORT ?? 8787);
const seed = !process.argv.includes("--no-seed");
const DB = "./local.db";
for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true });

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
  UPLOAD_DIR: "./uploads-local",
  LAUNCHES_PER_USER_PER_DAY: process.env.LAUNCHES_PER_USER_PER_DAY ?? "5",
  INDEXER_INTERVAL_MS: "1500",
});

const { launchToken } = await import("../src/chain.js");
const { launchesRepo } = await import("../src/db.js");

const pub = createPublicClient({ chain: baseSepolia, transport: http(lc.rpc) });
const trader = createWalletClient({ chain: baseSepolia, account: privateKeyToAccount(KEYS.trader), transport: http(lc.rpc) });

async function swap(token: Address, buy: boolean, amount: bigint) {
  const hash = await trader.writeContract({
    address: lc.router, abi: lc.routerAbi, functionName: "exactInputSingle", value: buy ? amount : 0n,
    args: [{
      tokenIn: buy ? WETH : token, tokenOut: buy ? token : WETH, fee: 10000, recipient: trader.account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: amount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
    }],
  });
  await pub.waitForTransactionReceipt({ hash });
}

const tokens: Address[] = [];
if (seed) {
  const examples = [
    { handle: "maelle_onchain", name: "Croissant", symbol: "CRSNT", description: "Le petit-déj officiel des degens parisiens." },
    { handle: "basedtom", name: "Blue Hour", symbol: "BLUE", description: "Pour ceux qui tradent entre 5 h et 6 h du matin." },
    { handle: "nina_builds", name: "Gas Offert", symbol: "GASOF", description: "" },
    { handle: "lucas_eth", name: "Pétanque", symbol: "BOULE", description: "On tire ou on pointe ?" },
    { handle: "sarah0x", name: "Minuit", symbol: "MNT", description: "" },
  ];
  for (const e of examples) {
    const xId = String(100000 + tokens.length);
    const slot = launchesRepo.reserve({ xId, handle: e.handle, name: e.name, symbol: e.symbol, image: "", description: e.description }, 99, 999);
    if (typeof slot !== "number") continue;
    const r = await launchToken({ name: e.name, symbol: e.symbol, image: "", xId });
    launchesRepo.markDone(slot, r);
    tokens.push(r.token);
    await trader.writeContract({ address: r.token, abi: erc20Abi, functionName: "approve", args: [lc.router, maxUint256] });
  }
  // un peu d'historique
  for (let i = 0; i < 40; i++) {
    const t = tokens[i % tokens.length];
    const buy = Math.random() < 0.7 || i < tokens.length;
    if (buy) await swap(t, true, parseEther((0.02 + Math.random() * 0.4).toFixed(3)));
    else {
      const bal = await pub.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [trader.account.address] });
      if (bal > 0n) await swap(t, false, bal / BigInt(3 + Math.floor(Math.random() * 6)));
    }
  }
  console.log(`${tokens.length} tokens d'exemple et 40 trades créés`);
}

await import("../src/server.js");

// trades simulés en continu pour voir le site vivre
if (seed) {
  setInterval(async () => {
    try {
      const t = tokens[Math.floor(Math.random() * tokens.length)];
      if (Math.random() < 0.65) await swap(t, true, parseEther((0.01 + Math.random() * 0.15).toFixed(3)));
      else {
        const bal = await pub.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [trader.account.address] });
        if (bal > 0n) await swap(t, false, bal / 6n);
      }
    } catch (e) {
      console.error("trade simulé", (e as Error).message);
    }
  }, 6000);
}
