// EOT fixer: the eval gate "Reads you − Plays safe, both vs HabitBot" (scripts/training/eval-ai.ts gates(), unchanged) on
// the seeds of a given run name, without writing into scripts/.cache/training/eval/<run>/. Spawns eval-ai.ts --child
// shards (the same child path eval-ai's playRun uses) for safe-habitbot-open and reads-habitbot-open (400 battles each,
// pools S,V, info open), from `--root` (the repo, or a `git archive main` copy with node_modules joined).
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-habitbot.ts --run trackb-final [--root <dir>] [--label x] [--shards 8]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((out, arg, i, all) => (arg.startsWith("--") ? [...out, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : out), []));
const run = String(args.run ?? "trackb-final");
const root = resolve(String(args.root ?? process.cwd()));
const shards = Number(args.shards ?? 8);
const label = String(args.label ?? `${run}-${root === resolve(process.cwd()) ? "branch" : "other"}`);
const dir = resolve("scripts/.cache/calc-audit/status-eot/build/fix-eot-results/habitbot", label);
mkdirSync(dir, { recursive: true });

type Spec = { name: string; p2: string; p1: string; battles: number; pools: string; info: string; run: string };
const specs: Spec[] = [
  { name: "safe-habitbot-open", p2: "safe", p1: "habitbot", battles: 400, pools: "S,V", info: "open", run },
  { name: "reads-habitbot-open", p2: "reads", p1: "habitbot", battles: 400, pools: "S,V", info: "open", run },
];

async function playRun(spec: Spec): Promise<{ index: number; score: number }[]> {
  const files = Array.from({ length: shards }, (_, shard) => join(dir, `${spec.name}.shard-${shard}.json`));
  await Promise.all(files.map((file, shard) => new Promise<void>((done, fail) => {
    const specFile = `${file}.spec.json`;
    writeFileSync(specFile, JSON.stringify(spec));
    const child = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--tsconfig", "tsconfig.json", "scripts/training/eval-ai.ts", "--child", specFile, "--shard", `${shard}/${shards}`, "--file", file], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => code === 0 ? done() : fail(new Error(`${spec.name} shard ${shard} exited ${code}: ${stderr.slice(-2000)}`)));
  })));
  return files.flatMap((file) => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as { index: number; score: number }[] : []).sort((a, b) => a.index - b.index);
}

(async () => {
  const { pairedDifference, pointsText, wilson } = await import(pathToFileURL(join(process.cwd(), "scripts", "training", "lib", "report.ts")).href);
  const scores: Record<string, number[]> = {};
  for (const spec of specs) {
    const started = Date.now();
    const battles = await playRun(spec);
    scores[spec.name] = battles.map((battle) => battle.score);
    const total = scores[spec.name].reduce((sum, x) => sum + x, 0);
    const rate = wilson(total, scores[spec.name].length);
    console.log(`${spec.name} (run ${run}, root ${root}): n=${battles.length} score ${total} (${(rate.estimate * 100).toFixed(1)}%), ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  const diff = pairedDifference(scores["reads-habitbot-open"], scores["safe-habitbot-open"]);
  const line = `Reads you − Plays safe, both vs HabitBot (run ${run}, ${label}): ${pointsText(diff)} → ${diff.estimate >= 0.05 ? "PASS" : "FAIL"} (≥ +5 points)`;
  console.log(line);
  writeFileSync(join(dir, "result.txt"), `${line}\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
