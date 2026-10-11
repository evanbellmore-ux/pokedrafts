// Replays the reference fuzz of tests/unit/doubles-turn-reference.test.ts and prints each turn whose optimised result
// differs from DOUBLES_REFERENCE (with USES_REFERENCE): its four actions and the first differing fields.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/reference-repro.ts [turns=8]
import { readFileSync, writeFileSync } from "node:fs";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame } from "@/app/lib/battle/types";
import { USES_REFERENCE } from "@/app/lib/battle/uses-to-ko";
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ITEMS = ["sitrusberry", "lifeorb", "focussash", "choiceband", "choicespecs", "rockyhelmet", "leftovers", "assaultvest", "shellbell", "occaberry", ""];
const SPREAD = new Set(["allAdjacent", "allAdjacentFoes"]);

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sets(runtime: BattleRuntime): Map<string, string[]> {
  if (runtime.profile.id === "champions") {
    const usage = JSON.parse(readFileSync("data/champions/move-usage.json", "utf8")) as { formats: { Doubles: { species: Record<string, string[]> } } };
    return new Map(Object.entries(usage.formats.Doubles.species));
  }
  // The generation 7 and 8 catalogs carry Random Battle Singles sets only.
  const formats = (runtime.catalog as { randomBattle?: { formats: Partial<Record<"Singles" | "Doubles", { species: Record<string, string[]> }>> } }).randomBattle?.formats;
  return new Map(Object.entries(formats?.Doubles?.species ?? formats?.Singles?.species ?? {}));
}
/** A typical turn: four set Pokémon, each with one of its moves (at most two spread moves) or No move, an item, some HP lost. */
function fuzzTurn(runtime: BattleRuntime, random: () => number): DoublesTurnInput {
  const pool = sets(runtime);
  const ids = [...pool.keys()].filter((id) => runtime.speciesById.get(id) && !runtime.speciesById.get(id)!.unsupported.length);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  let spread = 0;
  const pokemon = {} as Record<DoublesSlotId, DoublesPokemonInput | null>;
  for (const slot of SLOTS) {
    const id = pick(ids);
    const species = runtime.speciesById.get(id)!;
    const moves = pool.get(id)!.filter((m) => {
      const move = runtime.movesById.get(m);
      return move && species.moves.includes(m) && !move.unsupported.length && (spread < 2 || !SPREAD.has(move.target));
    });
    const moveId = moves.length && random() < 0.9 ? pick(moves) : null;
    if (moveId && SPREAD.has(runtime.movesById.get(moveId)!.target)) spread++;
    const base = createBuild(id, runtime);
    const abilities = species.abilities.filter((a) => !runtime.abilitiesById.get(a)?.unsupported.length);
    const abilityId = abilities.length ? pick(abilities) : base.abilityId;
    const item = base.itemId || pick(ITEMS.filter((i) => !i || runtime.itemsById.has(i)));
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: item } as BattleBuild;
    pokemon[slot] = { build, contexts: {}, charged: false, action: { moveId, target: null } };
  }
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
  for (const slot of SLOTS) {
    const entry = pokemon[slot]!;
    if (!entry.action.moveId) continue;
    const rule = doublesTargetRule(input, slot, entry.action.moveId);
    if (rule.kind === "choose") entry.action = { ...entry.action, target: pick(rule.options) };
  }
  return input;
}

function diff(a: unknown, b: unknown, path: string, out: string[]) {
  if (out.length > 6) return;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} vs ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} vs ${b.length}`);
    a.forEach((v, i) => diff(v, b[i], `${path}[${i}]`, out));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
(async () => {
  const turns = Number(process.argv[2] ?? 8);
  const games: BattleGame[] = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"];
  const report: unknown[] = [];
  for (const game of games) {
    const runtime = await loadBattleRuntime(game);
    const random = rng(games.indexOf(game) + 1);
    for (let i = 0; i < turns; i++) {
      const input = fuzzTurn(runtime, random);
      const fast = calculateDoublesTurn(input);
      DOUBLES_REFERENCE.on = true; USES_REFERENCE.on = true;
      let slow: DoublesTurnResult;
      try { slow = calculateDoublesTurn(input); } finally { DOUBLES_REFERENCE.on = false; USES_REFERENCE.on = false; }
      const out: string[] = [];
      diff(fast, slow, "result", out);
      const actions = SLOTS.map((slot) => { const p = input.pokemon[slot]!; return `${slot} ${p.build.speciesId} (${p.build.abilityId}, ${p.build.itemId || "no item"}) ${p.action.moveId ?? "No move"}${p.action.target ? ` → ${p.action.target}` : ""}`; });
      console.log(`${game} turn ${i}: ${fast.status}${fast.status === "not-estimated" ? ` (${fast.reason})` : ""} ${out.length ? "DIFFERS" : "equal"}`);
      if (out.length) { console.log(`  ${actions.join("\n  ")}`); for (const d of out) console.log(`    ${d}`); report.push({ game, turn: i, actions, diffs: out }); }
    }
  }
  writeFileSync("scripts/.cache/calc-audit/2v2/verify/results/reference-diffs.json", JSON.stringify(report, null, 1));
})();
