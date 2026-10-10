// Déploie XLaunchFactory.  Usage : npm run deploy
// Variables : DEPLOYER_PRIVATE_KEY, RPC_URL, CHAIN, RELAYER_PRIVATE_KEY, ATTESTER_PRIVATE_KEY,
//             TREASURY_ADDRESS, OWNER_ADDRESS (défaut : déployeur),
//             CREATOR_FEE_BPS (défaut 5000 = 50 % des frais de trading au créateur)
import "dotenv/config";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const POSITION_MANAGER: Record<string, Address> = {
  // https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  "base-sepolia": "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
};
const WETH: Address = "0x4200000000000000000000000000000000000006";

const net = process.env.CHAIN ?? "base-sepolia";
const chain = net === "base" ? base : baseSepolia;
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error("manque " + k);
  return v;
};

const deployer = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY") as Hex);
const relayer = privateKeyToAccount(env("RELAYER_PRIVATE_KEY") as Hex).address;
const attester = privateKeyToAccount(env("ATTESTER_PRIVATE_KEY") as Hex).address;
if (relayer === attester) throw new Error("relayer et attester doivent être deux clés différentes");

const { abi, bytecode } = JSON.parse(
  fs.readFileSync(new URL("../../contracts/out/XLaunchFactory.json", import.meta.url), "utf8")
);

const pub = createPublicClient({ chain, transport: http(env("RPC_URL")) });
const wallet = createWalletClient({ chain, account: deployer, transport: http(env("RPC_URL")) });

const args = [
  (process.env.OWNER_ADDRESS ?? deployer.address) as Address,
  POSITION_MANAGER[net],
  WETH,
  relayer,
  attester,
  env("TREASURY_ADDRESS") as Address,
  Number(process.env.CREATOR_FEE_BPS ?? 5000),
] as const;

console.log(`Déploiement sur ${net} avec`, args);
const hash = await wallet.deployContract({ abi, bytecode, args });
const r = await pub.waitForTransactionReceipt({ hash });
console.log("\nFACTORY_ADDRESS=" + r.contractAddress);
