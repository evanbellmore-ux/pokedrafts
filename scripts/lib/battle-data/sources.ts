import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { CACHE, CALC_SOURCE, SHOWDOWN_SOURCE } from "../champions-data/sources.mjs";

export { CALC_SOURCE, SHOWDOWN_SOURCE };
export const loadModule = createRequire(import.meta.url);
export const compact = (value: unknown) => `${JSON.stringify(value)}\n`;
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compare);

/** Object-order independent digest for raw learnsets and engine snapshot data. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => compare(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

type SourcePin = { repo: string; revision: string; sha256: string };
export type SourceFile = { path: string; sha256: string };
export type VerifiedSources = {
  runtime: string;
  files: SourceFile[];
  licenses: { showdown: string; engine: string };
  engineProvenance: { revision: string; sourceArchiveSha256: string; version: string };
};

/** Deliberately NOT ensureSource: no branch in this loader can download anything. */
export async function readVerifiedArchive(pin: SourcePin, cache = CACHE): Promise<Buffer> {
  const filename = `${pin.repo}-${pin.revision}.tar.gz`;
  let archive: Buffer;
  try {
    archive = await readFile(join(cache, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`Offline source archive missing: ${filename}. Restore the pinned cache; this generator never downloads sources.`);
  }
  if (sha256(archive) !== pin.sha256) throw new Error(`Cached source checksum mismatch: ${pin.repo}.`);
  return archive;
}

async function extract(pin: SourcePin, archive: Buffer, stage: string, members: readonly string[] = []): Promise<string> {
  const target = join(stage, pin.repo);
  await mkdir(target);
  // Extract only the verified bytes, staged privately rather than reopening the
  // original archive after verification. Relative paths also work with Git Bash
  // tar on Windows, where a C: archive path is otherwise treated as remote.
  const filename = `${pin.repo}.tar.gz`;
  await writeFile(join(stage, filename), archive);
  const result = spawnSync("tar", ["-xzf", `../${filename}`, "--strip-components=1",
    ...members.map((member) => `${pin.repo}-${pin.revision}/${member}`)], {
    cwd: target, encoding: "utf8", shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cannot extract verified ${pin.repo}: ${result.stderr}`);
  return target;
}

async function compileDex(source: string, output: string): Promise<SourceFile[]> {
  const files = ["lib/utils.ts", "config/formats.ts"];
  // Pinned gen7 -> gen8 -> base(gen9): compile EVERY data table in the chain,
  // including rulesets, formats, learnsets, scripts/init and type chart patches.
  for (const directory of ["sim", "data", "data/text", "data/mods/gen7", "data/mods/gen8"]) {
    for (const name of (await readdir(join(source, directory))).sort(compare)) {
      if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
      if (directory === "sim" && !/^dex(?:-.*)?\.ts$/.test(name)) continue;
      files.push(`${directory}/${name}`);
    }
  }
  await mkdir(output, { recursive: true });
  // Global formats enumerate other mod names, but never load those mods here.
  for (const entry of await readdir(join(source, "data/mods"), { withFileTypes: true })) {
    if (entry.isDirectory()) await mkdir(join(output, "data/mods", entry.name), { recursive: true });
  }
  await writeFile(join(output, "package.json"), '{"type":"commonjs"}\n');
  const hashes: SourceFile[] = [];
  for (const file of sorted(files)) {
    const code = await readFile(join(source, file), "utf8");
    hashes.push({ path: file, sha256: sha256(code) });
    const result = ts.transpileModule(code, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        sourceMap: false,
        removeComments: true,
        newLine: ts.NewLineKind.LineFeed,
      },
    });
    const destination = join(output, file.replace(/\.ts$/, ".js"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, result.outputText);
  }
  return hashes;
}

/** Fresh disposable compilation; neither verified extractions nor engine are changed. */
export async function withVerifiedSources<T>(consume: (sources: VerifiedSources) => Promise<T>): Promise<T> {
  const [showdownArchive, engineArchive] = await Promise.all([
    readVerifiedArchive(SHOWDOWN_SOURCE), readVerifiedArchive(CALC_SOURCE),
  ]);
  const engineProvenance = JSON.parse(await readFile(loadModule.resolve("@smogon/calc/PROVENANCE.json"), "utf8")) as
    VerifiedSources["engineProvenance"];
  if (engineProvenance.revision !== CALC_SOURCE.revision || engineProvenance.sourceArchiveSha256 !== CALC_SOURCE.sha256) {
    throw new Error("Installed calculation engine does not match the pinned source.");
  }
  const stage = await mkdtemp(join(CACHE, "battle-data-"));
  try {
    const showdown = await extract(SHOWDOWN_SOURCE, showdownArchive, stage);
    // At this pin calc/LICENSE -> ../LICENSE (and calc/README.md is also a
    // symlink). Windows bsdtar cannot always create those links, including on
    // OneDrive. Engine tables come from the provenance-checked installed package;
    // extract only the regular license target, still from fully verified bytes.
    const engine = await extract(CALC_SOURCE, engineArchive, stage, ["LICENSE"]);
    const runtime = join(stage, "dex");
    const files = await compileDex(showdown, runtime);
    return await consume({
      runtime, files, engineProvenance,
      licenses: {
        showdown: await readFile(join(showdown, "LICENSE"), "utf8"),
        engine: await readFile(join(engine, "LICENSE"), "utf8"),
      },
    });
  } finally {
    for (const path of Object.keys(loadModule.cache)) {
      const inside = relative(stage, path);
      if (inside && !inside.startsWith(`..${sep}`) && !inside.startsWith("..")) delete loadModule.cache[path];
    }
    await rm(stage, { recursive: true, force: true });
  }
}
