// Track N: N10 on the app (the engine the tsconfig maps, or the live tree): Greninja (Protean, unused) Protect with stall 3, Jolteon's Thunderbolt.
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild } from "@/app/lib/battle/types";

(async () => {
  const runtime = await loadBattleRuntime("scarlet_violet");
  const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const build = (species: string, ability: string, spe: number): BattleBuild => ({
    ...createBuild(species, runtime), nature: "Serious", abilityId: ability, abilityActive: defaultAbilityActive(ability), itemId: "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: null, status: "", native: { level: 50, evs: { ...ZERO, spe }, ivs: IV31 },
  } as BattleBuild);
  const entry = (b: BattleBuild, moveId: string | null, target: DoublesSlotId | null = null, more: Partial<DoublesPokemonInput> = {}): DoublesPokemonInput => ({ build: b, contexts: {}, charged: false, action: { moveId, target }, ...more });
  const result = calculateDoublesTurn({
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, canSwitch: { own: true, opponent: true },
    pokemon: {
      "own-left": entry(build("greninja", "protean", 0), "protect", null, { carried: { stall: 3 } }), "own-right": entry(build("snorlax", "thickfat", 8), null),
      "opponent-left": entry(build("snorlax", "thickfat", 16), null), "opponent-right": entry(build("jolteon", "voltabsorb", 0), "thunderbolt", "own-left"),
    },
  });
  console.log(result.status, result.status === "ready" ? JSON.stringify({ ko: result.hp["own-left"]!.koChance, min: result.hp["own-left"]!.min, max: result.hp["own-left"]!.max }) : ("reason" in result ? result.reason : JSON.stringify(result.issues)));
})();
