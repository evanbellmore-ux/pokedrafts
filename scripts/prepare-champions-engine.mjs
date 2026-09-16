import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ts from "typescript";
import { CALC_SOURCE, CACHE, ROOT, ensureSource, run } from "./lib/champions-data/sources.mjs";

const source = await ensureSource(CALC_SOURCE);
const stage = join(CACHE, `engine-package-${CALC_SOURCE.revision}`);
const vendor = join(ROOT, "vendor");
await mkdir(stage, { recursive: true });
await mkdir(vendor, { recursive: true });

// Compile only the runtime. Upstream's old ES3/Jest build settings are not
// needed by our modern browser bundle; no battle logic is changed here.
const rootDir = join(source, "calc/src");
const files = ts.sys.readDirectory(rootDir, [".ts"], ["**/test/**"], ["**/*.ts"]);
const options = {
  rootDir,
  outDir: join(stage, "dist"),
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  declaration: true,
  esModuleInterop: true,
  downlevelIteration: true,
  strict: true,
  skipLibCheck: true,
  noEmitOnError: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  newLine: ts.NewLineKind.LineFeed,
  types: ["node"],
};
const program = ts.createProgram(files, options);
const emit = program.emit();
const errors = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
if (errors.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else {
  // TypeScript 5 hoists CommonJS function exports. The upstream legacy
  // script-tag shim otherwise captures calculate itself and recurses. This
  // package is module-only, so use its imported implementation directly.
  const entryPath = join(stage, "dist/index.js");
  const entry = await readFile(entryPath, "utf8");
  const shim = "const Acalculate = exports.calculate;";
  if (entry.split(shim).length !== 2) throw new Error("Unexpected upstream entrypoint shim.");
  await writeFile(entryPath, entry.replace(shim, "const Acalculate = undefined;"));

  const version = `0.11.0-champions.${CALC_SOURCE.revision.slice(0, 8)}.1`;
  const provenance = {
    package: "@smogon/calc",
    version,
    upstreamVersion: "0.11.0",
    source: `https://github.com/smogon/damage-calc/tree/${CALC_SOURCE.revision}/calc`,
    revision: CALC_SOURCE.revision,
    sourceArchiveSha256: CALC_SOURCE.sha256,
    compiler: `typescript@${ts.version}`,
    runtimeChanges: ["Module-entrypoint compatibility: disable the legacy script-tag exports.calculate capture, which self-recurses with TypeScript 5 CommonJS export hoisting. Battle logic and data are unchanged."],
    build: "npm run prepare:champions-engine",
    notes: "Runtime-only CommonJS/ES2017 compilation of the pinned calc/src; tests, source maps and upstream build scripts are not distributed.",
  };
  await writeFile(join(stage, "package.json"), JSON.stringify({
    name: "@smogon/calc",
    version,
    description: "Pinned upstream Pokémon Champions damage engine",
    license: "MIT",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    files: ["dist", "LICENSE", "PROVENANCE.json"],
    repository: { type: "git", url: "https://github.com/smogon/damage-calc.git" },
  }, null, 2) + "\n");
  await copyFile(join(source, "LICENSE"), join(stage, "LICENSE"));
  await copyFile(join(source, "LICENSE"), join(vendor, "smogon-calc.LICENSE"));
  await writeFile(join(stage, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");

  const npm = process.env.npm_execpath || join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  await access(npm);
  run(process.execPath, [npm, "pack", "--ignore-scripts", "--pack-destination", vendor], stage);
  const archive = `smogon-calc-${version}.tgz`;
  const sha256 = createHash("sha256").update(await readFile(join(vendor, archive))).digest("hex");
  await writeFile(join(vendor, "smogon-calc.provenance.json"), JSON.stringify({ ...provenance, archive, sha256 }, null, 2) + "\n");
  console.log(`Prepared ${archive} (${sha256}).`);
}
