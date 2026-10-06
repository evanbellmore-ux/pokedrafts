// Source patches for bundling the pinned Showdown simulator (c23d2e94) for browsers, workers and Node without a file
// system. They touch Node module loading only (no battle logic); each must match exactly once or the build fails.
// Prototype: scripts/.cache/training/design/probe/build-sim.mjs.
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const posix = (path) => path.split("\\").join("/");

/** [from, to] per pinned source file (paths relative to the extracted archive). */
export const PATCHES = {
  "sim/dex.ts": [
    ["import * as fs from 'fs';\n", ""],
    ["import * as path from 'path';\n", ""],
    ["const DATA_DIR = path.resolve(__dirname, '../data');", "const DATA_DIR = 'data';"],
    ["const MODS_DIR = path.resolve(DATA_DIR, './mods');", "const MODS_DIR = 'data/mods';"],
    // sim/dex.ts:450 loadDataFile
    ["const dataObject = require(filePath);", "const dataObject = __psRequire(filePath);"],
    // sim/dex.ts:475 includeMods
    ["for (const mod of fs.readdirSync(MODS_DIR)) {", "for (const mod of __PS_MODS__) {"],
    // sim/dex.ts:593 loadAliases
    ["const exported = require(path.resolve(DATA_DIR, 'aliases'));", "const exported = __psRequire('data/aliases');"],
  ],
  "sim/dex-formats.ts": [
    // sim/dex-formats.ts:637,646 (config/custom-formats is absent: MODULE_NOT_FOUND, which the loader already catches)
    ["customFormats = require(`${__dirname}/../config/custom-formats`).Formats;", "customFormats = __psRequire('config/custom-formats').Formats;"],
    ["let Formats: AnyObject[] = require(`${__dirname}/../config/formats`).Formats;", "let Formats: AnyObject[] = __psRequire('config/formats').Formats;"],
  ],
  "sim/dex-text.ts": [
    // Text tables are not bundled: dex.text throws MODULE_NOT_FOUND (only "Broken Record Mod" reads them, data/rulesets.ts:2454).
    ["import * as path from 'path';\n", ""],
    ["const TEXT_DIR = path.resolve(__dirname, '../data/text');", "const TEXT_DIR = 'data/text';"],
    ["require.resolve(filePath);", "__psRequire.resolve(filePath);"],
    ["return require(filePath)[exportName];", "return __psRequire(filePath)[exportName];"],
  ],
  "sim/prng.ts": [
    // sim/prng.ts:215: browsers, workers and Node >= 19 have Web Crypto.
    ["if (typeof crypto === 'undefined') globalThis.crypto = require('node:crypto');", "if (typeof crypto === 'undefined') throw new Error('Web Crypto is required.');"],
  ],
  "sim/teams.ts": [
    // sim/teams.ts:634-645: the random-team require chain would pull all of data/random-battles.
    [/\t\tif \(mod === 'gen9ssb'\) \{[\s\S]*?\n\t\t\}\n\n\t\treturn new TeamGenerator\(format, seed\);/, "\t\tthrow new Error('Random team generators are not bundled.');"],
  ],
};

/** The patch list as PROVENANCE records it. */
export function describePatches() {
  return Object.entries(PATCHES).flatMap(([file, list]) => list.map(([from, to]) => ({ file, from: String(from), to })));
}

/**
 * esbuild plugin: resolves ts-chacha20 to the verified extraction and node:util to the generated stand-in, and applies
 * PATCHES (prepending the registry import) to the pinned source files. `applied` collects the patch counts per file.
 */
export function createPatchPlugin({ source, registryFile, chachaEntry, nodeUtilFile, applied }) {
  const prelude = `import { psRequire as __psRequire, PS_MODS as __PS_MODS__ } from ${JSON.stringify(posix(registryFile))};\n`;
  return {
    name: "pinned-showdown-browser",
    setup(build) {
      build.onResolve({ filter: /^ts-chacha20$/ }, () => ({ path: resolve(chachaEntry) }));
      build.onResolve({ filter: /^node:util$/ }, () => ({ path: resolve(nodeUtilFile) }));
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        const rel = posix(relative(source, args.path));
        const patches = PATCHES[rel];
        if (!patches) return undefined;
        let code = await readFile(args.path, "utf8");
        for (const [from, to] of patches) {
          const count = typeof from === "string" ? code.split(from).length - 1 : (code.match(new RegExp(from.source, "g")) ?? []).length;
          if (count !== 1) throw new Error(`Patch for ${rel} matched ${count} times: ${String(from).slice(0, 80)}`);
          code = code.replace(from, to);
        }
        applied[rel] = patches.length;
        return { contents: prelude + code, loader: "ts" };
      });
    },
  };
}
