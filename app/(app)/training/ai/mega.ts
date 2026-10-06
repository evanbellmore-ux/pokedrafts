// Addendum A1.5: the Mega outlook of a decision. For each living Pokémon of either side that can still Mega Evolve (its stone
// held, its side's Mega unused: PS/sim/side.ts:779-781), the Mega form's matchup against the other side's known (and, for
// the player, believed) living team against the base form's: damage rows both ways, the Speed relation, and a weather or
// terrain ability's field effect. The value function's lasting and option terms read its gain; candidates read its rows.
import { turnSpeed } from "@/app/lib/battle/calculate";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import { megaEntries } from "@/app/lib/battle/mega-forms";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import type { AiView, MonKey, MonView } from "../model/ai-view";
import { effectiveAccuracy } from "./accuracy";
import { inForm, megaFormFor } from "./battle-facts";
import { calcBuild, damageRow, foesOfMon, type DamageRow, type RowTable } from "./rows";
import { fieldFavor, fieldOfAbility } from "./field-favor";
import { DEFAULT_WEIGHTS, type Weights } from "./value-weights";

export type MegaEntry = {
  key: MonKey; side: DoublesSideId; formId: string; itemId: string;
  base: BattleBuild; mega: BattleBuild;
  /** matchup(Mega form) − matchup(base form), clamped to [−1, 1]. */
  gain: number;
  /** The gain's parts: offense (best fraction × accuracy out), defense (best fraction in, less is better), Speed, field. */
  parts: { offense: number; defense: number; speed: number; field: number };
  /** The Mega form's rows by foe and move: out of it, and into it. */
  out: Record<MonKey, Record<string, DamageRow | null>>;
  into: Record<MonKey, Record<string, DamageRow | null>>;
};
export type MegaOutlook = Readonly<Record<MonKey, MegaEntry>>;

const living = (mon: MonView) => !mon.fainted && mon.hp > 0;
const neutralField = (field: BattleConditions): BattleConditions => ({ ...field, trickRoom: false, attackerSide: { ...field.attackerSide, tailwind: false }, defenderSide: { ...field.defenderSide, tailwind: false } });

/** The Mega form `mon` would take now, or null: a living Pokémon of a side whose Mega is unused, holding its stone, not already Mega. */
export function megaFormOf(view: AiView, mon: MonView, runtime: BattleRuntime): { formId: string; itemId: string } | null {
  if (!living(mon) || view.megaUsed[mon.side] || megaEntries(mon.build.speciesId, runtime).length) return null;
  // An active's request is the authority for the AI's side (canMegaEvo); the player's comes from belief world 0.
  if (mon.slot !== null && !mon.canMega) return null;
  const formId = megaFormFor(mon.build.speciesId, mon.build.itemId, runtime);
  return formId ? { formId, itemId: mon.build.itemId } : null;
}

type Matchup = { offense: number; defense: number; speed: number; field: number };
function matchup(view: AiView, mon: MonView, build: BattleBuild, rowsOut: (foe: MonView, moveId: string) => DamageRow | null,
  rowsIn: (foe: MonView, moveId: string) => DamageRow | null, runtime: BattleRuntime, weights: Weights): Matchup {
  const foes = foesOfMon(view, mon);
  if (!foes.length) return { offense: 0, defense: 0, speed: 0, field: 0 };
  const field = neutralField(view.field);
  const own = turnSpeed(build, false, field, runtime);
  let total = 0, offense = 0, defense = 0, speed = 0;
  for (const foe of foes) {
    const share = foe.slot !== null ? 1 : 0.5;
    total += share;
    let off = 0, def = 0;
    for (const moveId of mon.moves) {
      const row = rowsOut(foe, moveId);
      if (row) off = Math.max(off, row.fraction * effectiveAccuracy(view, mon.key, moveId, foe.key, runtime));
    }
    for (const moveId of foe.moves) {
      const row = rowsIn(foe, moveId);
      if (row) def = Math.max(def, row.fraction);
    }
    offense += share * off;
    defense += share * def;
    speed += share * Math.sign(own - turnSpeed(calcBuild(foe), false, field, runtime));
  }
  // A weather or terrain ability's field effect for both sides' best moves (ai/field-favor.ts).
  const set = fieldOfAbility(build.abilityId);
  let favor = 0;
  if (set) {
    const team = view.mons.filter((each) => each.side === mon.side && living(each));
    const sign = (each: MonView) => each.side === mon.side ? 1 : -1;
    const counted = [...team, ...foes];
    favor = counted.reduce((sum, each) => sum + sign(each) * fieldFavor(view, each, set, runtime), 0) / Math.max(1, counted.length);
  }
  return { offense: offense / total, defense: defense / total, speed: weights.megaSpeed * speed / total, field: weights.megaField * favor };
}

/** The decision's Mega outlook (A1.5); empty when no living Pokémon can Mega Evolve. */
export function megaOutlook(view: AiView, rows: RowTable, runtime: BattleRuntime, weights: Weights = { ...DEFAULT_WEIGHTS }): MegaOutlook {
  const out: Record<MonKey, MegaEntry> = {};
  for (const mon of view.mons) {
    const form = megaFormOf(view, mon, runtime);
    if (!form) continue;
    const base = calcBuild(mon);
    const mega = inForm(base, form.formId, runtime);
    const megaOut: MegaEntry["out"] = {}, megaInto: MegaEntry["into"] = {};
    const cacheOut = (foe: MonView, moveId: string) => {
      megaOut[foe.key] ??= {};
      if (!(moveId in megaOut[foe.key])) megaOut[foe.key][moveId] = damageRow(view, mon, foe, moveId, runtime, mega, calcBuild(foe));
      return megaOut[foe.key][moveId];
    };
    const cacheIn = (foe: MonView, moveId: string) => {
      megaInto[foe.key] ??= {};
      if (!(moveId in megaInto[foe.key])) megaInto[foe.key][moveId] = damageRow(view, foe, mon, moveId, runtime, calcBuild(foe), mega);
      return megaInto[foe.key][moveId];
    };
    const before = matchup(view, mon, base, (foe, moveId) => rows.get(mon.key, foe.key, moveId), (foe, moveId) => rows.get(foe.key, mon.key, moveId), runtime, weights);
    const after = matchup(view, mon, mega, cacheOut, cacheIn, runtime, weights);
    const parts = {
      offense: after.offense - before.offense, defense: before.defense - after.defense,
      speed: after.speed - before.speed, field: after.field - before.field,
    };
    const gain = Math.max(-1, Math.min(1, parts.offense + parts.defense + parts.speed + parts.field));
    out[mon.key] = { key: mon.key, side: mon.side, formId: form.formId, itemId: form.itemId, base, mega, gain, parts, out: megaOut, into: megaInto };
  }
  return out;
}
