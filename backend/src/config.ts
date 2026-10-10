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
  startFdvEth: num("START_FDV_ETH", 3), // valorisation de départ en ETH

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
