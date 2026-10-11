// Vérification automatique du code source des contrats sur les explorateurs :
//  - Sourcify (gratuit, sans clé) : repris par Blockscout et de nombreux outils ;
//  - Basescan via l'API Etherscan v2 si ETHERSCAN_API_KEY est défini (une clé gratuite suffit).
// Un contrat vérifié affiche son code, ce que regardent les bots, les détecteurs d'arnaques et les acheteurs.
import fs from "node:fs";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { config } from "./config.js";
import { kv, db } from "./db.js";
import { chain } from "./chain.js";

type Bundle = { compilerVersion: string; input: unknown };
let bundle: Bundle | null = null;
try {
  bundle = JSON.parse(fs.readFileSync(new URL("../../contracts/out/verify.json", import.meta.url), "utf8"));
} catch {
  console.warn("contracts/out/verify.json absent : vérification des contrats désactivée");
}
const solcVersion = () => bundle!.compilerVersion.replace(/\.Emscripten.*$/, ""); // 0.8.26+commit.8a97fa7a
const etherscanKey = process.env.ETHERSCAN_API_KEY ?? "";
const enabled = () => !!bundle && !config.factoryPending && (config.chain === "base" || config.chain === "base-sepolia") && process.env.VERIFY_CONTRACTS !== "0";

type Job = { address: Address; id: string; args: Hex; tx: Hex };

async function sourcify(j: Job): Promise<"ok" | "retry" | "fail"> {
  const res = await fetch(`https://sourcify.dev/server/v2/verify/${chain.id}/${j.address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stdJsonInput: bundle!.input, compilerVersion: solcVersion(), contractIdentifier: j.id, creationTransactionHash: j.tx }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { verificationId?: string; customCode?: string; message?: string };
  if (res.status === 409 || body.customCode === "already_verified") return "ok";
  if (!body.verificationId) return res.status >= 500 || res.status === 429 ? "retry" : "fail";
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = (await (await fetch(`https://sourcify.dev/server/v2/verify/${body.verificationId}`, { signal: AbortSignal.timeout(15_000) })).json().catch(() => ({}))) as {
      isJobCompleted?: boolean; contract?: { match?: string | null }; error?: { customCode?: string };
    };
    if (!st.isJobCompleted) continue;
    if (st.contract?.match) return "ok";
    if (st.error?.customCode === "already_verified") return "ok";
    return "fail";
  }
  return "retry";
}

async function etherscan(j: Job): Promise<"ok" | "retry" | "fail"> {
  const base = `https://api.etherscan.io/v2/api?chainid=${chain.id}`;
  const form = new URLSearchParams({
    module: "contract", action: "verifysourcecode", apikey: etherscanKey,
    contractaddress: j.address, sourceCode: JSON.stringify(bundle!.input), codeformat: "solidity-standard-json-input",
    contractname: j.id, compilerversion: "v" + solcVersion(),
    // l'API a longtemps attendu l'orthographe fautive : on envoie les deux
    constructorArguments: j.args.slice(2), constructorArguements: j.args.slice(2), licenseType: "3",
  });
  const r = (await (await fetch(base, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) })).json()) as { status: string; result: string };
  if (r.status !== "1") return /already verified/i.test(r.result) ? "ok" : /unable to locate|not found|pending/i.test(r.result) ? "retry" : "fail";
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const s = (await (await fetch(`${base}&module=contract&action=checkverifystatus&guid=${r.result}&apikey=${etherscanKey}`, { signal: AbortSignal.timeout(15_000) })).json()) as { status: string; result: string };
    if (s.status === "1" || /already verified/i.test(s.result)) return "ok";
    if (/pending/i.test(s.result)) continue;
    return "fail";
  }
  return "retry";
}

async function verifyOne(j: Job) {
  for (const [name, fn, on] of [["sourcify", sourcify, true], ["etherscan", etherscan, !!etherscanKey]] as const) {
    if (!on) continue;
    const key = `verify:${name}:${j.address.toLowerCase()}`;
    const prev = kv.get(key) ?? "";
    if (prev === "ok" || prev === "fail" || Number(prev.split(":")[1] ?? 0) >= 6) continue; // 6 essais max
    let r: "ok" | "retry" | "fail";
    try { r = await fn(j); } catch (e) { r = "retry"; console.warn(`vérification ${name} ${j.address}`, (e as Error).message); }
    kv.set(key, r === "retry" ? `retry:${Number(prev.split(":")[1] ?? 0) + 1}` : r);
    if (r !== "retry") console.log(`vérification ${name} ${j.address} : ${r}`);
  }
}

const TOKEN_CTOR = [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "bytes32" }, { type: "uint256" }] as const;
const SUPPLY = 1_000_000_000n * 10n ** 18n;

/** factory + tokens lancés pas encore vérifiés */
export async function verifyPending(factoryJob?: { tx: Hex; args: Hex }) {
  if (!enabled()) return;
  if (factoryJob) await verifyOne({ address: config.factory, id: "src/XLaunchFactory.sol:XLaunchFactory", ...factoryJob });
  const rows = db.prepare(`SELECT token, tx_hash, name, symbol, image, x_id FROM launches WHERE status='done' ORDER BY id DESC LIMIT 50`).all() as
    { token: Address; tx_hash: Hex; name: string; symbol: string; image: string; x_id: string }[];
  const { creatorIdOf } = await import("./chain.js");
  for (const r of rows) {
    if (!r.token || !r.tx_hash) continue;
    const args = encodeAbiParameters(TOKEN_CTOR, [r.name, r.symbol, r.image, creatorIdOf(r.x_id), SUPPLY]);
    await verifyOne({ address: r.token, id: "src/LaunchToken.sol:LaunchToken", args, tx: r.tx_hash });
  }
}

let running = false;
export function startVerifier(factoryJob?: { tx: Hex; args: Hex }) {
  if (!enabled()) return;
  const loop = async () => {
    if (running) return;
    running = true;
    try { await verifyPending(factoryJob); } catch (e) { console.warn("vérification", (e as Error).message); } finally { running = false; }
  };
  setTimeout(loop, 60_000); // laisse le temps aux explorateurs d'indexer
  setInterval(loop, 120_000);
}
