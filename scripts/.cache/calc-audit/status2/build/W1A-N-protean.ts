// Track N: a used Protean (gen 9: abilityState.protean set, its type changed on an earlier turn) attacking with a move of
// another type gets no STAB in pinned Showdown; the app engine (calculate.ts -> @smogon/calc util.js getStabMod) gives a
// Protean or Libero holder STAB on every move. The Showdown side through guards-sim; the app side through the engine the
// tsconfig maps (TSX_TSCONFIG_PATH: W1A-N-int/tsconfig.c.json, Track N's integrator changes applied). From the repo root:
//   TSX_TSCONFIG_PATH=scripts/.cache/calc-audit/status2/build/W1A-N-int/tsconfig.c.json npx --no-install tsx scripts/.cache/calc-audit/status2/build/W1A-N-protean.ts
import { enumerate, report, type Mon } from "../design/guards-sim";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";

const lax = (n: number, name: string): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
for (const used of [true, false]) {
  report(`Showdown sv: Greninja (Protean${used ? ", used: pure Water" : ", unused"}) Dark Pulse into Snorlax`, enumerate({
    game: "sv", rolls: "all", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Greninja", ability: "Protean", moves: ["Dark Pulse"], name: "Greninja" }, lax(1, "Ally"), lax(2, "Target"), lax(3, "Lax")],
    setup: (b) => { if (used) { const g = b.p1.active[0]; g.setType("Water"); g.abilityState.protean = true; } },
  }));
}
(async () => {
  const runtime = await loadBattleRuntime("scarlet_violet");
  const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const build = (species: string, ability: string, spe: number, more: Partial<BattleBuild> = {}): BattleBuild => {
    const base = createBuild(species, runtime);
    return { ...base, nature: "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: null, status: "",
      native: { level: 50, evs: { ...ZERO, spe }, ivs: IV31 }, ...more } as BattleBuild;
  };
  for (const used of [true, false]) {
    const entry = (b: BattleBuild, moveId: string | null, target: DoublesSlotId | null = null): DoublesPokemonInput => ({ build: b, contexts: {}, charged: false, action: { moveId, target } });
    const result = calculateDoublesTurn({
      runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, canSwitch: { own: true, opponent: true },
      pokemon: {
        "own-left": entry(build("greninja", "protean", 0, used ? { abilityActive: false, types: ["Water"] } : {}), "darkpulse", "opponent-right"),
        "own-right": entry(build("snorlax", "thickfat", 8), null), "opponent-left": entry(build("snorlax", "thickfat", 24), null), "opponent-right": entry(build("snorlax", "thickfat", 16), null),
      },
    });
    const hit = result.status === "ready" ? result.steps.find((step) => step.slot === "own-left")?.hits.find((each) => each.slot === "opponent-right") : null;
    console.log(`app sv: Greninja (Protean${used ? ", used: pure Water" : ", unused"}) Dark Pulse into Snorlax: ${result.status}${result.status === "ready" ? ` ${hit?.min}–${hit?.max}` : ` ${"reason" in result ? result.reason : JSON.stringify(result.issues)}`}`);
  }
})();
