// Integration 2: scripts/build-champions-data.ts compileShowdownDex, verbatim in its file list and compiler options, with the
// output in the scratch source cache (node_modules is read-only here). Source: the pinned, sha256-verified extraction.
//   node compile-dex.mjs <pinned pokemon-showdown dir> <output dir>
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire("/home/user/pokedrafts/package.json");
const ts = require("typescript");
const [source, output] = process.argv.slice(2);
const files = ["lib/utils.ts", "config/formats.ts"];
for (const directory of ["sim", "data", "data/text", "data/mods/champions"]) {
  const names = await readdir(join(source, directory));
  for (const name of names.sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
    if (directory === "sim" && !/^dex(?:-.*)?\.ts$/.test(name)) continue;
    files.push(`${directory}/${name}`);
  }
}
await mkdir(output, { recursive: true });
for (const entry of await readdir(join(source, "data/mods"), { withFileTypes: true })) {
  if (entry.isDirectory()) await mkdir(join(output, "data/mods", entry.name), { recursive: true });
}
await writeFile(join(output, "package.json"), '{"type":"commonjs"}\n');
for (const file of files.sort()) {
  const code = await readFile(join(source, file), "utf8");
  const result = ts.transpileModule(code, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, sourceMap: false, removeComments: true },
  });
  const destination = join(output, file.replace(/\.ts$/, ".js"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, result.outputText);
}
console.log(`compiled ${files.length} files to ${output}`);
