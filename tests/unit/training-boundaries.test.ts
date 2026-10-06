import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SPEC §14.6 S2 (+ addendum A1.1): who may import what in the Training tab, read from the files on disk. Value imports are
 * followed transitively (an `import type` or an all-`type` specifier list is erased by TypeScript and bundles no code);
 * direct imports of the simulator, `sim/*` and `ai/*` from page files are refused even when type-only.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRAINING = join(ROOT, "app", "(app)", "training");
const rel = (file: string) => relative(ROOT, file).split(sep).join("/");
const T = "app/(app)/training/";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const code = (file: string) => /\.(ts|tsx|mts|mjs)$/.test(file) && !file.endsWith(".d.ts");
const trainingFiles = walk(TRAINING).filter(code);

type Import = { spec: string; typeOnly: boolean; target: string | null };
const PACKAGE = "@pokedrafts/showdown-sim";
const IMPORT = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
const cache = new Map<string, Import[]>();
function importsOf(file: string): Import[] {
  const known = cache.get(file);
  if (known) return known;
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const found: Import[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[4] ?? match[5] ?? match[6];
    const clause = match[3] ?? "";
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    const allTypes = !!named && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
    const typeOnly = !!match[2] || allTypes;
    found.push({ spec, typeOnly, target: resolveSpec(file, spec) });
  }
  cache.set(file, found);
  return found;
}
/** Every module (file path, or the package name) reachable from `entry` through value imports. */
function valueClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!code(file)) continue;
    for (const each of importsOf(file)) {
      if (each.typeOnly) continue;
      if (each.spec === PACKAGE || each.spec.startsWith(`${PACKAGE}/`)) seen.add(PACKAGE);
      else if (each.target) stack.push(each.target);
    }
  }
  return seen;
}
const names = (set: Set<string>) => [...set].map((entry) => entry === PACKAGE ? PACKAGE : rel(entry));

const WORKER_SIDE_DIRS = ["model/", "sim/", "worker/", "ai/", "usage/"];
/** The page bundle: everything in the route folder that is not worker-side (the log's protocol readers run in the worker). */
const WORKER_LOG_FILES = ["log/protocol-text.ts", "log/protocol-steps.ts"];
const pageFiles = trainingFiles.filter((file) => {
  const path = rel(file).slice(T.length);
  return !WORKER_SIDE_DIRS.some((dir) => path.startsWith(dir)) && !WORKER_LOG_FILES.includes(path);
});
const inDir = (dir: string) => trainingFiles.filter((file) => rel(file).startsWith(`${T}${dir}`));

/** Forbidden in the page's value-import closure (SPEC §3 rules, §14.6 S2, addendum A1.1). */
function pageForbidden(path: string): boolean {
  if (path === PACKAGE) return true;
  if (path === "app/lib/battle/doubles-turn.ts" || path === "app/lib/battle/calculate.ts") return true;
  if (path === "data/champions/training-usage.json" || path === `${T}usage/training-usage.ts`) return true;
  if (WORKER_LOG_FILES.some((file) => path === `${T}${file}`)) return true;
  if (!path.startsWith(T)) return false;
  const local = path.slice(T.length);
  if (local === "worker/worker-transport.ts") return false;
  return local.startsWith("sim/") || local.startsWith("ai/") || local.startsWith("worker/");
}

describe("training boundaries (SPEC §14.6 S2)", () => {
  it("resolves the route folder's imports (the walker sees model/view-types → doubles-types)", () => {
    const viewTypes = join(TRAINING, "model", "view-types.ts");
    expect(importsOf(viewTypes).some((each) => each.target && rel(each.target) === "app/lib/battle/doubles-types.ts" && !each.typeOnly)).toBe(true);
    expect(valueClosure(viewTypes).has(join(ROOT, "app", "lib", "battle", "doubles-types.ts"))).toBe(true);
    // Negative controls: the walker does see a forbidden module where one is reached.
    expect(names(valueClosure(join(ROOT, "app", "(app)", "calculator", "CalculatorClient.tsx")))).toContain("app/lib/battle/calculate.ts");
    expect(names(valueClosure(join(TRAINING, "sim", "sim.ts")))).toContain(PACKAGE);
    expect(pageForbidden(`${T}sim/battle-host.ts`) && pageForbidden(PACKAGE) && pageForbidden("data/champions/training-usage.json")).toBe(true);
    expect(pageForbidden(`${T}worker/worker-transport.ts`) || pageForbidden(`${T}model/info.ts`)).toBe(false);
  });

  it("model/* takes values only from model/ or doubles-types (no simulator, engine, JSON or React)", () => {
    for (const file of inDir("model/")) {
      const bad = names(valueClosure(file)).filter((path) => path !== rel(file) && !path.startsWith(`${T}model/`) && path !== "app/lib/battle/doubles-types.ts");
      expect(bad, rel(file)).toEqual([]);
    }
  });

  it("page files never reach the simulator, the turn engine, the calculator engine, sim/*, ai/*, the worker's own modules, protocol-text or the usage data", () => {
    const offenders: string[] = [];
    for (const file of pageFiles) {
      for (const path of names(valueClosure(file))) if (pageForbidden(path)) offenders.push(`${rel(file)} → ${path}`);
    }
    expect(offenders).toEqual([]);
  });

  it("page files import nothing from the simulator, sim/* or ai/* even as types, and only worker/worker-transport.ts of worker/*", () => {
    const offenders: string[] = [];
    for (const file of pageFiles) {
      for (const each of importsOf(file)) {
        const path = each.target ? rel(each.target) : each.spec;
        if (path === PACKAGE || path.startsWith(`${T}sim/`) || path.startsWith(`${T}ai/`)) offenders.push(`${rel(file)} → ${path}`);
        if (path.startsWith(`${T}worker/`) && path !== `${T}worker/worker-transport.ts`) offenders.push(`${rel(file)} → ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Your trends and the battle-end comparison read habits through model/habits-data.ts, never ai/habits.ts", () => {
    const files = ["setup/habit-trends.ts", "setup/HabitTrends.tsx", "setup/TeamSetup.tsx", "end/BattleEnd.tsx", "training-session.ts"];
    for (const file of files) {
      const full = join(TRAINING, ...file.split("/"));
      expect(pageFiles, file).toContain(full);
      const closure = names(valueClosure(full));
      expect(closure.filter(pageForbidden), file).toEqual([]);
      expect(closure.filter((path) => path.startsWith(`${T}ai/`)), file).toEqual([]);
      expect(importsOf(full).filter((each) => each.target && rel(each.target).startsWith(`${T}ai/`)), file).toEqual([]);
    }
    expect(names(valueClosure(join(TRAINING, "setup", "habit-trends.ts")))).toContain(`${T}model/habits-data.ts`);
    // One parser for the AI and the page: ai/habits.ts takes the data type and parser from the model.
    expect(importsOf(join(TRAINING, "ai", "habits.ts")).some((each) => each.target && rel(each.target) === `${T}model/habits-data.ts` && !each.typeOnly)).toBe(true);
  });

  it("worker/worker-transport.ts constructs the one module worker and reaches no simulator or AI code", () => {
    const transport = join(TRAINING, "worker", "worker-transport.ts");
    if (!existsSync(transport)) return;
    const text = readFileSync(transport, "utf8");
    expect(text).toMatch(/new Worker\(\s*new URL\(\s*["']\.\/training\.worker\.ts["']\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type:\s*["']module["']\s*\}\s*\)/);
    expect(names(valueClosure(transport)).filter((path) => path !== rel(transport) && pageForbidden(path))).toEqual([]);
    const constructs = trainingFiles.filter((file) => /new Worker\(/.test(readFileSync(file, "utf8"))).map(rel);
    expect(constructs).toEqual([`${T}worker/worker-transport.ts`]);
  });

  it("ai/* never reaches the simulator package, sim/*, worker/* or the usage loader (usage comes in ctx.usage)", () => {
    const offenders: string[] = [];
    for (const file of inDir("ai/")) {
      for (const path of names(valueClosure(file))) {
        if (path === PACKAGE || path.startsWith(`${T}sim/`) || path.startsWith(`${T}worker/`)
          || path === "data/champions/training-usage.json" || path === `${T}usage/training-usage.ts`) offenders.push(`${rel(file)} → ${path}`);
      }
      for (const each of importsOf(file)) {
        const path = each.target ? rel(each.target) : each.spec;
        if (path === PACKAGE || path.startsWith(`${T}sim/`)) offenders.push(`${rel(file)} → ${path} (type)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only usage/training-usage.ts imports data/champions/training-usage.json inside the route folder", () => {
    const importers = trainingFiles.filter((file) => importsOf(file).some((each) => each.target && rel(each.target) === "data/champions/training-usage.json")).map(rel);
    expect(importers.filter((path) => path !== `${T}usage/training-usage.ts`)).toEqual([]);
  });

  it("only the battle host's readers touch the real battle (SPEC I10)", () => {
    const allowed = new Set([`${T}sim/battle-host.ts`, `${T}sim/board.ts`, `${T}sim/inputs.ts`, `${T}worker/worker-handler.ts`,
      "scripts/training/lib/match.ts", "scripts/training/lib/oracle.ts"]);
    const scripts = walk(join(ROOT, "scripts", "training")).filter(code);
    const offenders: string[] = [];
    for (const file of [...trainingFiles, ...scripts]) {
      const path = rel(file);
      if (allowed.has(path)) continue;
      const text = readFileSync(file, "utf8");
      const importsHost = importsOf(file).some((each) => each.target && rel(each.target) === `${T}sim/battle-host.ts` && !each.typeOnly);
      if (importsHost || /\bhost\??\.battle\b/.test(text) || /\bnew BattleHost\b/.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("the belief-battle side (tracker, belief battles, services) never reaches the host, the board or the worker handler", () => {
    const AI_SIDE = ["tracker", "belief-battle", "effects", "observe", "bridge", "splits", "prelude", "rollout", "residual", "services"];
    const refused = new Set([`${T}sim/battle-host.ts`, `${T}sim/board.ts`, `${T}worker/worker-handler.ts`]);
    const offenders: string[] = [];
    for (const name of AI_SIDE) {
      const file = join(TRAINING, "sim", `${name}.ts`);
      if (!existsSync(file)) continue;
      for (const path of names(valueClosure(file))) if (refused.has(path)) offenders.push(`${rel(file)} → ${path}`);
      if (/\bhost\??\.battle\b|\bBattleHost\b|\bcreateTestOracle\b/.test(readFileSync(file, "utf8"))) offenders.push(`${rel(file)} names the host or the test oracle`);
    }
    expect(offenders).toEqual([]);
  });

  it("no console.log in the route folder (docs/release-architecture.md:229)", () => {
    const offenders = trainingFiles.filter((file) => /\bconsole\.log\s*\(/.test(readFileSync(file, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});
