// Copie les ABI compilées dans src/abi.ts (typées "as const" pour viem)
import fs from "node:fs";
const read = (n) => JSON.parse(fs.readFileSync(new URL(`../../contracts/out/${n}.json`, import.meta.url)));
const factory = read("XLaunchFactory");
const mock = read("MockAsset");
fs.writeFileSync(
  new URL("../src/abi.ts", import.meta.url),
  "// généré par scripts/sync-abi.mjs — ne pas éditer\n" +
    "export const factoryAbi = " + JSON.stringify(factory.abi, null, 2) + " as const;\n\n" +
    "// actif de test (testnet / local uniquement)\n" +
    "export const mockAssetAbi = " + JSON.stringify(mock.abi) + " as const;\n" +
    `export const mockAssetBytecode = "${mock.bytecode}" as const;\n`
);
console.log("abi.ts écrit");
