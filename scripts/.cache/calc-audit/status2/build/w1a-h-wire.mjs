// Track H (wave 1a): the integrator's lines for H (W1A-H.md "needsFromIntegrator"), applied to a copy of app/lib/battle, so
// the wired turn can be checked before integration 1a. One snapshot of app/lib/battle gives three copies under
// scripts/.cache/calc-audit/status2/build/h-<copy>/app/lib/battle:
//   base:  doubles-hidden.ts as Step 1 left it (w1a-h-step1-doubles-hidden.ts.txt), the other files as they are now;
//   new:   this tree's files (Track H's doubles-hidden.ts, no kernel line);
//   wired: new plus the integrator's lines (PATCHES). Each patch is an exact string replacement that must match once.
// Run from the repo root: node scripts/.cache/calc-audit/status2/build/w1a-h-wire.mjs
// then run a checker with TSX_TSCONFIG_PATH=scripts/.cache/calc-audit/status2/build/h-<copy>/tsconfig.json (its `@/` first
// resolves to the copy, then to the repo).
import fs from "node:fs";
import path from "node:path";

const BUILD = path.resolve("scripts/.cache/calc-audit/status2/build");
const SRC = path.resolve("app/lib/battle");

/** The integrator's changes: [file, before, after, what]. */
export const PATCHES = [
  ["doubles-status.ts",
    "  hook(guardHooks.beforeFirst);\n  hook(historyHooks.beforeMoveStart);\n",
    "  hook(guardHooks.beforeFirst);\n  // 12: a Pokémon Sky Drop lifted does nothing; a carried hidden release's state ends (H's doubles-hidden.ts beforeMove).\n  hook(hiddenHooks.beforeMove);\n  hook(historyHooks.beforeMoveStart);\n",
    "I1: BeforeMove priority 12 (Sky Drop's lifted Pokémon; a carried release ends at TryMove or MoveAborted)"],
  ["doubles-turn.ts",
    "  if (check.block) return blockedHit(ctx, w0, action, info, check);\n  // A damaging move with an effect of its own on this target instead of damage",
    "  if (check.block) return blockedHit(ctx, w0, action, info, check);\n  // Sky Drop's charge turn lifts its target (H's doubles-hidden.ts skyDropHit; null for any other move).\n  const lifted = hiddenHooks.skyDropHit(kernel, w0, action, info, check);\n  if (lifted) return lifted;\n  // A damaging move with an effect of its own on this target instead of damage",
    "I2: singleStep, Sky Drop's charge at the hit"],
  ["doubles-turn.ts",
    "    // The presence moves (PR) and Sky Drop (H).\n    presenceHooks.movesGuard(kernel, w, slot, move);\n    hiddenHooks.skyDrop(kernel, w, slot);\n",
    "    // The presence moves (PR).\n    presenceHooks.movesGuard(kernel, w, slot, move);\n",
    "I3: presenceGuards, Sky Drop's guard removed (modelled)"],
  ["doubles-actions.ts",
    'export const TRACKS_TARGET_MOVES: ReadonlySet<string> = new Set(["snipeshot"]);',
    'export const TRACKS_TARGET_MOVES: ReadonlySet<string> = new Set(["snipeshot", "skydrop"]);',
    "I4: Sky Drop keeps its target (PS/data/moves.ts:16694 tracksTarget: no RedirectTarget)"],
  ["doubles-turn.ts",
    "  // Commander's pair (PR; a stub).\n  presenceHooks.onFaint(kernelOf(ctx), w, slot);\n}",
    "  // Commander's pair (PR; a stub).\n  presenceHooks.onFaint(kernelOf(ctx), w, slot);\n  // Its hidden state and charge go; a Sky Drop user frees the Pokémon it held (H's doubles-hidden.ts fainted).\n  hiddenHooks.fainted(kernelOf(ctx), w, slot);\n}",
    "I6: faint, the hidden state and Sky Drop's lifted Pokémon"],
  ["doubles-turn.ts",
    '...(e.volatiles ?? []), ...(mon.vol.substitute ? ["substitute"] : [])])].sort();',
    '...(e.volatiles ?? []), ...(mon.vol.substitute ? ["substitute"] : []), ...(mon.vol.charging && !mon.fainted ? ["twoturnmove", mon.vol.charging] : [])])].sort();',
    "I7: outcomeOf, a charged two-turn move's volatiles (twoturnmove and the move's own: H03)"],
];

if (process.argv[1]?.replace(/\\/g, "/").endsWith("w1a-h-wire.mjs")) {
  const snapshot = new Map(fs.readdirSync(SRC).filter((file) => fs.statSync(path.join(SRC, file)).isFile()).map((file) => [file, fs.readFileSync(path.join(SRC, file))]));
  const step1 = fs.readFileSync(path.join(BUILD, "w1a-h-step1-doubles-hidden.ts.txt"), "utf8");
  for (const copy of ["base", "new", "wired"]) {
    const root = path.join(BUILD, `h-${copy}`);
    const dest = path.join(root, "app/lib/battle");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const [file, bytes] of snapshot) fs.writeFileSync(path.join(dest, file), bytes);
    if (copy === "base") fs.writeFileSync(path.join(dest, "doubles-hidden.ts"), step1);
    if (copy === "wired") {
      for (const [file, before, after, what] of PATCHES) {
        const target = path.join(dest, file);
        const text = fs.readFileSync(target, "utf8");
        // The working tree may hold CRLF (core.autocrlf): the anchors are written with LF.
        const eol = text.includes("\r\n") ? "\r\n" : "\n";
        const [from, to] = [before, after].map((part) => part.replace(/\n/g, eol));
        const count = text.split(from).length - 1;
        if (count !== 1) throw new Error(`${what}: the anchor in ${file} matches ${count} times`);
        fs.writeFileSync(target, text.replace(from, () => to));
        console.log(`applied ${what}`);
      }
    }
    const repo = path.relative(root, process.cwd()).replace(/\\/g, "/");
    fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2017", module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, esModuleInterop: true, strict: true, allowJs: true, baseUrl: ".", paths: { "@/*": ["./*", `${repo}/*`] } },
    }, null, 1));
    console.log(`copy ${copy} at ${dest}`);
  }
}

