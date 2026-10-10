// Copie l'ABI compilée de la factory dans src/abi.ts (typée "as const" pour viem)
import fs from "node:fs";
const { abi } = JSON.parse(fs.readFileSync(new URL("../../contracts/out/XLaunchFactory.json", import.meta.url)));
fs.writeFileSync(
  new URL("../src/abi.ts", import.meta.url),
  "// généré par scripts/sync-abi.mjs — ne pas éditer\nexport const factoryAbi = " + JSON.stringify(abi, null, 2) + " as const;\n"
);
console.log("abi.ts écrit");
