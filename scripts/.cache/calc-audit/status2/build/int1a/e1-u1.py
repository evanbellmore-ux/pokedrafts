# Integration 1a: E1's doubles-start.ts and doubles-turn.ts lines (W1A-E1.md needsFromIntegrator 3, 4, 5) and U1's Trace
# copied-Intimidate lines (W1A-U1.md needsFromIntegrator; the calculate.ts and roster-prep.ts inclusion tests).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 # E1 3: a carried Embargo ignores the item at the turn's first Update; a carried Heal Block stops an HP Berry (healblock and
 # embargo conditions: onTryEatItem / ignoringItem).
 ("doubles-start.ts", 'import { OWN_STATUS_CURES } from "./hit-loop";', 'import { HEALING_BERRIES, OWN_STATUS_CURES } from "./hit-loop";', "E1: import"),
 ("doubles-start.ts", '''    const ownCure = !!OWN_STATUS_CURES[entered[slot].abilityId]?.includes(entered[slot].status);
    const items = settleItems(entered[slot], entered[reps[slot]] ?? entered[slot], field, runtime, { label: labels[slot] }, names[slot], ownCure);
''', '''    const ownCure = !!OWN_STATUS_CURES[entered[slot].abilityId]?.includes(entered[slot].status);
    // status2 (E1): a carried Embargo ignores the item at this Update (ignoringItem); a carried Heal Block stops an HP Berry.
    const carried = input.pokemon[slot]!.carried;
    const held = entered[slot].itemId;
    const embargoed = carried?.embargo !== undefined;
    const blocked = carried?.healBlock !== undefined && HEALING_BERRIES.has(held);
    const settling = embargoed ? { ...entered[slot], itemSuppressed: true as const } : blocked ? { ...entered[slot], itemId: "" } : entered[slot];
    const settledItems = settleItems(settling, entered[reps[slot]] ?? entered[slot], field, runtime, { label: labels[slot] }, names[slot], ownCure);
    const items = blocked ? { ...settledItems, build: { ...settledItems.build, itemId: held } } : settledItems;
''', "E1: the start settle reads a carried Embargo and Heal Block"),
 ("doubles-start.ts", '''    const itemOn = !field.magicRoom && !klutzActive(build, build);
''', '''    const itemOn = !field.magicRoom && !klutzActive(build, build) && !embargoed;
''', "E1: an embargoed item gives no entry rise"),
 # E1 4: an embargoed Mental Herb could not have cured the carried volatile.
 ("doubles-turn.ts", '''  const mentalHerb = build.itemId === "mentalherb" && !input.field.magicRoom && build.abilityId !== "klutz";''', '''  const mentalHerb = build.itemId === "mentalherb" && !input.field.magicRoom && build.abilityId !== "klutz" && carried.embargo === undefined;''', "E1: Mental Herb under a carried Embargo"),
 # E1 5: applyBoosts' herb option in the kernel's type.
 ("doubles-turn.ts", '''    opts?: { use?: Use; effect?: "move" | "ability" | "item" | null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string }): Partial<Record<Stage, number>>;''', '''    opts?: { use?: Use; effect?: "move" | "ability" | "item" | null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string; herb?: false }): Partial<Record<Stage, number>>;''', "E1: applyBoosts herb option"),
 # U1: a Trace holder whose copied Intimidate is stored on every foe (the 2v2 apply button) is settled, not guarded.
 ("doubles-start.ts", '''      else if (copied === "intimidate") fail("Trace copying Intimidate is not modelled in 2v2.");''', '''      else if (copied === "intimidate" && !copiedIntimidateStored(build, foes(slot).map((foe) => shown[foe]!), runtime)) fail("Trace copying Intimidate is not modelled in 2v2.");''', "U1: Trace's stored Intimidate"),
 ("doubles-start.ts", '''const UNNERVE_ABILITIES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);''', '''const UNNERVE_ABILITIES = new Set(["unnerve", "asoneglastrier", "asonespectrier"]);

/** status2 (U1's apply button): a Trace holder's copied Intimidate already applied to every foe (copiedIntimidateStored lists their intimidatedKey). */
function copiedIntimidateStored(build: BattleBuild, foes: BattleBuild[], runtime: DoublesTurnInput["runtime"]) {
  const keys = build.copiedIntimidateStored?.split(",") ?? [];
  return foes.length > 0 && foes.every((foe) => keys.includes(intimidatedKey(foe, runtime)));
}''', "U1: copiedIntimidateStored helper"),
 ("doubles-start.ts", '''import { atLead, entryBoosts, unknownLeadForms, type IntimidateBattle } from "./intimidate";''', '''import { atLead, entryBoosts, intimidatedKey, unknownLeadForms, type IntimidateBattle } from "./intimidate";''', "U1: import intimidatedKey"),
 ("calculate.ts", '''shown[side].copiedIntimidateStored === intimidatedKey(shown[foeSide], runtime)) continue;''', '''!!shown[side].copiedIntimidateStored?.split(",").includes(intimidatedKey(shown[foeSide], runtime))) continue;''', "U1: calculate.ts settleEntry reads the stored list"),
 ("app/(app)/calculator/roster-prep.ts", '''holder.copiedIntimidateStored !== intimidatedKey(otherBuild, current.runtime)''', '''!holder.copiedIntimidateStored?.split(",").includes(intimidatedKey(otherBuild, current.runtime))''', "U1: roster-prep.ts toggleMatchupMega reads the stored list"),
])
