// Compile les contrats avec solc-js et écrit les ABI/bytecode dans out/
import solc from "solc";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(p, "utf8");
const sources = {};
for (const f of fs.readdirSync("src")) sources[`src/${f}`] = { content: read(`src/${f}`) };

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const imported = {};
function findImports(p) {
  const full = path.join("node_modules", p);
  if (!fs.existsSync(full)) return { error: "not found: " + p };
  imported[p] = { content: read(full) };
  return { contents: imported[p].content };
}

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === "error");
for (const e of out.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync("out", { recursive: true });
// entrée « standard JSON » autonome (imports OpenZeppelin inclus) pour vérifier les contrats sur
// Basescan / Sourcify avec exactement ce qui a été compilé
const verifyInput = {
  language: "Solidity",
  sources: { ...sources, ...imported },
  settings: { ...input.settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "metadata"] } } },
};
fs.writeFileSync("out/verify.json", JSON.stringify({ compilerVersion: solc.version(), input: verifyInput }));
for (const [file, contracts] of Object.entries(out.contracts)) {
  if (!file.startsWith("src/")) continue;
  for (const [name, c] of Object.entries(contracts)) {
    fs.writeFileSync(
      `out/${name}.json`,
      JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
    );
    console.log(`ok ${name} (${c.evm.bytecode.object.length / 2} bytes)`);
  }
}
