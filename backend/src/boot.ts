// Point d'entrée en production (Railway). Installation automatique au premier démarrage :
//  1. clés relayer / attester / JWT générées sur le disque persistant (jamais affichées)
//  2. si le contrat n'est pas encore déployé : le site démarre quand même (lancements fermés),
//     et XLaunchFactory se déploie tout seul dès que le wallet de la plateforme reçoit de l'ETH
//  3. démarrage du site
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createPublicClient, createWalletClient, http as rpc, formatEther, parseEther, encodeAbiParameters, type Address, type Hex } from "viem";
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
const POSITION_MANAGER: Record<number, Address> = {
  // https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
  8453: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  84532: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
};
const WETH: Address = "0x4200000000000000000000000000000000000006";
const factoryArgs = () => [
  (env.OWNER_ADDRESS ?? relayer.address) as Address, POSITION_MANAGER[chain.id], WETH, relayer.address, attester.address,
  (env.TREASURY_ADDRESS ?? relayer.address) as Address, Number(env.CREATOR_FEE_BPS ?? 5000),
] as const;
if (!env.FACTORY_ADDRESS && fs.existsSync(factoryFile)) {
  const f = JSON.parse(fs.readFileSync(factoryFile, "utf8"));
  env.FACTORY_ADDRESS = f.address;
  // pour vérifier le code du contrat sur les explorateurs : tx de création et arguments du constructeur
  env.FACTORY_TX = f.tx;
  env.FACTORY_ARGS = f.args ?? encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint16" }],
    factoryArgs()
  );
}

if (!env.FACTORY_ADDRESS) {
  // pas encore de contrat : le site démarre quand même (lancements fermés) et le contrat
  // se déploie tout seul dès que le wallet de la plateforme reçoit de l'ETH
  env.FACTORY_ADDRESS = "0x0000000000000000000000000000000000000000";
  env.FACTORY_PENDING = "1";
  void installFactory();
}
await import("./server.js");

async function installFactory() {
  const NEEDED = parseEther(env.SETUP_MIN_ETH ?? "0.005");
  const pub = createPublicClient({ chain, transport: rpc(env.RPC_URL) });
  const wallet = createWalletClient({ chain, account: relayer, transport: rpc(env.RPC_URL) });
  const artifact = JSON.parse(
    fs.readFileSync(new URL("../../contracts/out/XLaunchFactory.json", import.meta.url), "utf8")
  );
  console.log(`Contrat pas encore déployé : lancements fermés. Il se déploie dès que ${relayer.address} a ${formatEther(NEEDED)} ETH.`);

  for (;;) {
    try {
      const balance = await pub.getBalance({ address: relayer.address });
      if (balance >= NEEDED) {
        const args = factoryArgs();
        const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("déploiement échoué " + hash);
        const encoded = encodeAbiParameters(
          [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint16" }],
          args
        );
        fs.writeFileSync(factoryFile, JSON.stringify({ address: receipt.contractAddress, tx: hash, args: encoded, at: new Date().toISOString() }));
        console.log(`XLaunchFactory déployé : ${receipt.contractAddress} (tx ${hash}). Redémarrage pour ouvrir les lancements.`);
        // la plateforme redémarre (Railway relance le service) et charge le contrat depuis le disque
        process.exit(1);
      }
    } catch (e) {
      console.error("installation", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
