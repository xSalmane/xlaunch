import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Address, Hex } from "viem";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}
const num = (name: string, def: number) => (process.env[name] ? Number(process.env[name]) : def);

export const config = {
  port: num("PORT", 8787),
  publicUrl: req("PUBLIC_URL").replace(/\/$/, ""), // https://ton-domaine.xyz
  xSite: process.env.X_SITE ?? "@xlaunch",

  // chaîne
  chain: (process.env.CHAIN ?? "base-sepolia") as "base" | "base-sepolia",
  rpcUrl: req("RPC_URL"),
  factory: req("FACTORY_ADDRESS") as Address,
  weth: "0x4200000000000000000000000000000000000006" as Address,
  relayerKey: req("RELAYER_PRIVATE_KEY") as Hex,
  attesterKey: req("ATTESTER_PRIVATE_KEY") as Hex, // clé DIFFÉRENTE du relayer
  minRelayerBalanceEth: num("MIN_RELAYER_BALANCE_ETH", 0.003),
  startFdvUsd: num("START_FDV_USD", 10_000), // valorisation de départ en dollars, quelle que soit la paire
  // USDC : adresses officielles Circle (https://developers.circle.com/stablecoins/usdc-contract-addresses)
  usdc: (process.env.USDC_ADDRESS ??
    ((process.env.CHAIN ?? "base-sepolia") === "base"
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      : "0x036CbD53842c5426634e7929541eC2318f3dCF7e")) as Address,
  // actions tokenisées Coinbase sur Base (liste + prix de référence), API publique sans clé
  stocksApi: process.env.STOCKS_API ?? "https://api.coinbase.com/v1/tokenized-stocks",
  // fausses actions de test (testnet / local) : créées et enregistrées dans ce dossier
  dataDir: process.env.DATA_DIR ?? "./data",
  mockStocks: (process.env.MOCK_STOCKS ?? ((process.env.CHAIN ?? "base-sepolia") === "base" ? "0" : "1")) === "1",

  // auth X (OAuth 2.0, client confidentiel)
  // vides tant que l'app X n'est pas configurée : la connexion X affiche alors un message clair
  xClientId: process.env.X_CLIENT_ID ?? "",
  xClientSecret: process.env.X_CLIENT_SECRET ?? "",
  jwtSecret: new TextEncoder().encode(req("JWT_SECRET")),

  // anti-spam
  minAccountAgeDays: num("MIN_ACCOUNT_AGE_DAYS", 30),
  minFollowers: num("MIN_FOLLOWERS", 50),
  launchesPerUserPerDay: num("LAUNCHES_PER_USER_PER_DAY", 1),
  globalLaunchesPerHour: num("GLOBAL_LAUNCHES_PER_HOUR", 30),
  claimMaxAuthAgeSec: num("CLAIM_MAX_AUTH_AGE_SEC", 15 * 60),
  // parrainage : part de la plateforme reversée au parrain (2000 = 20 %), versée en ETH depuis le wallet de la plateforme
  referralBps: num("REFERRAL_BPS", 2000),
  referralMinPayoutUsd: num("REFERRAL_MIN_PAYOUT_USD", process.env.CHAIN === "base" ? 5 : 0.01),
  // sur le mainnet, les versements automatiques ne s'activent que si on le demande explicitement
  referralPayouts: (process.env.REFERRAL_PAYOUTS ?? (process.env.CHAIN === "base" ? "0" : "1")) === "1",

  dbPath: process.env.DB_PATH ?? "./xlaunch.db",
};

export const blocklist: string[] = (() => {
  const p = path.resolve(process.env.BLOCKLIST_PATH ?? "./blocklist.txt");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
})();

export const explorer = config.chain === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
