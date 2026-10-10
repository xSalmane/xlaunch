// Point d'entrée en production (Railway). Installation automatique au premier démarrage :
//  1. clés relayer / attester / JWT générées sur le disque persistant (jamais affichées)
//  2. si le contrat n'est pas encore déployé : page d'installation qui affiche l'adresse
//     à approvisionner, puis déploiement automatique de XLaunchFactory dès que l'ETH arrive
//  3. démarrage du site
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { createPublicClient, createWalletClient, http as rpc, formatEther, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const DATA = path.resolve(process.env.DATA_DIR ?? "./data");
fs.mkdirSync(DATA, { recursive: true });

const env = process.env;
env.CHAIN ??= "base-sepolia";
const chain = env.CHAIN === "base" ? base : baseSepolia;
env.RPC_URL ??= env.CHAIN === "base" ? "https://mainnet.base.org" : "https://sepolia.base.org";
// v2 (paires multiples) : nouvelle base et nouveau contrat, les tokens de la v1 restent sur l'ancien contrat
env.DB_PATH ??= path.join(DATA, "xlaunch-v2.db");
env.UPLOAD_DIR ??= path.join(DATA, "uploads");
if (!env.PUBLIC_URL && env.RAILWAY_PUBLIC_DOMAIN) env.PUBLIC_URL = `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
env.PUBLIC_URL ??= `http://localhost:${env.PORT ?? 8787}`;

// ------------------------------------------------------------------ clés
type Keys = { relayer: Hex; attester: Hex; jwt: string };
const keysFile = path.join(DATA, "keys.json");
let keys: Keys;
if (fs.existsSync(keysFile)) {
  keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));
} else {
  keys = { relayer: generatePrivateKey(), attester: generatePrivateKey(), jwt: crypto.randomBytes(32).toString("hex") };
  fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
  console.log("Nouvelles clés générées et enregistrées sur le disque persistant.");
}
env.RELAYER_PRIVATE_KEY ??= keys.relayer;
env.ATTESTER_PRIVATE_KEY ??= keys.attester;
env.JWT_SECRET ??= keys.jwt;
const relayer = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
const attester = privateKeyToAccount(env.ATTESTER_PRIVATE_KEY as Hex);
console.log(`Chaîne ${env.CHAIN} — relayer (paie le gas) : ${relayer.address}`);

// ------------------------------------------------------------------ contrat
const factoryFile = path.join(DATA, `factory-v2-${chain.id}.json`);
if (!env.FACTORY_ADDRESS && fs.existsSync(factoryFile)) {
  env.FACTORY_ADDRESS = JSON.parse(fs.readFileSync(factoryFile, "utf8")).address;
}

if (!env.FACTORY_ADDRESS) {
  await installFactory();
}
await import("./server.js");

async function installFactory() {
  const POSITION_MANAGER: Record<number, Address> = {
    // https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
    8453: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    84532: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
  };
  const WETH: Address = "0x4200000000000000000000000000000000000006";
  const NEEDED = parseEther(env.SETUP_MIN_ETH ?? "0.005");
  const pub = createPublicClient({ chain, transport: rpc(env.RPC_URL) });
  const wallet = createWalletClient({ chain, account: relayer, transport: rpc(env.RPC_URL) });
  const artifact = JSON.parse(
    fs.readFileSync(new URL("../../contracts/out/XLaunchFactory.json", import.meta.url), "utf8")
  );

  let balance = 0n;
  let status = "En attente d'ETH sur le wallet relayer.";

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>XLaunch — installation</title>
<body style="font-family:system-ui;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5;color:#0b1b3f;background:#f3f6fc">
<h1 style="margin-bottom:4px">XLaunch s'installe</h1>
<p style="color:#5a6a8a;margin-top:0">${chain.name}. Cette page se met à jour toute seule.</p>
<p><b>${status}</b></p>
<p>Envoie au moins <b>${formatEther(NEEDED)} ETH ${chain.id === 84532 ? "de test (Base Sepolia)" : "sur Base"}</b> à cette adresse. Elle paie le déploiement du contrat puis le gas des lancements :</p>
<p style="font:16px ui-monospace,monospace;background:#fff;border:1px solid #d5deee;padding:12px;border-radius:8px;word-break:break-all">${relayer.address}</p>
<p>Solde actuel : <b>${formatEther(balance)} ETH</b></p>
${chain.id === 84532 ? `<p style="color:#5a6a8a">ETH de test gratuit : faucet Coinbase Developer Platform (choisis Base Sepolia).</p>` : ""}
</body></html>`);
  });
  const port = Number(env.PORT ?? 8787);
  await new Promise<void>((r) => server.listen(port, r));
  console.log(`Installation : envoie ${formatEther(NEEDED)} ETH à ${relayer.address} (page sur le port ${port})`);

  for (;;) {
    try {
      balance = await pub.getBalance({ address: relayer.address });
      if (balance >= NEEDED) {
        status = "ETH reçu. Déploiement du contrat en cours…";
        const owner = (env.OWNER_ADDRESS ?? relayer.address) as Address;
        const treasury = (env.TREASURY_ADDRESS ?? relayer.address) as Address;
        const hash = await wallet.deployContract({
          abi: artifact.abi,
          bytecode: artifact.bytecode,
          args: [owner, POSITION_MANAGER[chain.id], WETH, relayer.address, attester.address, treasury, Number(env.CREATOR_FEE_BPS ?? 5000)],
        });
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("déploiement échoué " + hash);
        fs.writeFileSync(factoryFile, JSON.stringify({ address: receipt.contractAddress, tx: hash, at: new Date().toISOString() }));
        env.FACTORY_ADDRESS = receipt.contractAddress;
        console.log(`XLaunchFactory déployé : ${receipt.contractAddress} (tx ${hash})`);
        break;
      }
    } catch (e) {
      status = "Erreur temporaire, nouvelle tentative dans 15 s.";
      console.error("installation", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
