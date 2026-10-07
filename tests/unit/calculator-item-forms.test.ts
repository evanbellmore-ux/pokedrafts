import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive, heldItemForm, validateBuild } from "@/app/lib/battle/model";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Showdown's team validator gives a base-species set the forcedForme of the item it holds (pinned Showdown c23d2e94
 * sim/team-validator.ts: "assign the right forme to a set with the base species (Arceus/Genesect/Giratina/Silvally)";
 * data/items.ts forcedForme): Giratina holding a Griseous Orb (generations 7 and 8; data/mods/gen8/items.ts) or a Griseous
 * Core (generation 9) battles as Giratina-Origin, Dialga holding an Adamant Crystal and Palkia a Lustrous Globe as their
 * Origin forms, Ogerpon holding a mask as that mask's form, and Genesect holding a Drive as that Drive's form (its types stay
 * Bug/Steel; Techno Blast takes the Drive's type, data/moves.ts technoblast). In generation 9 the Griseous, Adamant and
 * Lustrous Orbs change no form (itemUser only). As for Arceus's Plates (calculator-arceus-forms.test.ts), the base form
 * holding the item is flagged, an import takes the form, and the form then calculates as Showdown does. Singles values: the
 * exact Uses oracle scripts/.cache/calc-audit/zmove-status/verify/u-oracle2.ts through zmove-status/verify/run.ts (cases
 * forms-iceface-fling/fix/cases-1v1.json); 2v2 values: scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases IF01-IF08
 * (forms-iceface-fling/fix/cases-fif.ts). Level 50, 31 IVs, 0 EVs, Serious nature unless set.
 */

type Runtime = Awaited<ReturnType<typeof loadBattleRuntime>>;
type Mon = { id: string; ability: string; item?: string; evs?: Partial<Record<CombatStat, number>>; boosts?: Partial<Record<CombatStat, number>>; dynamax?: true };
function build(runtime: Runtime, m: Mon): BattleBuild {
  const base = createBuild(m.id, runtime);
  return {
    ...base, nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, ...(m.evs ? { native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } } : {}),
    ...(m.dynamax ? { mechanic: "dynamax" } : {}),
  } as BattleBuild;
}
const singles = (field: Partial<BattleConditions> = {}): BattleConditions => ({ ...createConditions(), gameType: "Singles", ...field });
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const out = calculateMatchup(build(runtime, attacker), build(runtime, defender), singles(), {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const SV: BattleGame = "scarlet_violet", SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon";
const snorlax: Mon = { id: "snorlax", ability: "thickfat" };
const blissey: Mon = { id: "blissey", ability: "naturalcure" };
const garchomp: Mon = { id: "garchomp", ability: "roughskin" };

/** Every (base species, catalog item) pair whose base species has an item form, other than Arceus's and Silvally's. */
function itemForms(runtime: Runtime): string[] {
  const bases = new Set([...runtime.speciesById.values()].filter((form) => form.requiredItems?.length && form.baseSpecies !== form.id).map((form) => form.baseSpecies));
  const out: string[] = [];
  for (const base of bases) {
    if (base === "arceus" || base === "silvally" || !runtime.speciesById.has(base)) continue;
    for (const item of runtime.itemsById.keys()) {
      const form = heldItemForm(base, item, runtime);
      if (form) out.push(`${base}+${item}=${form}`);
    }
  }
  return out.sort();
}

describe("the form a held item gives (mechanics.ts heldItemForm)", () => {
  it("is the item's forcedForme in each game's catalog, and nothing for a battle-only form's item", async () => {
    const [champions, sv, sw, us] = await Promise.all([loadBattleRuntime("champions"), loadBattleRuntime(SV), loadBattleRuntime(SW), loadBattleRuntime(US)]);
    // Each game's pinned Showdown Dex (scripts/.cache/calc-audit/forms-iceface-fling/fix/q-forced.ts): these and the Arceus,
    // Silvally and Crowned forms are every catalog item with a forcedForme.
    expect(itemForms(sv)).toEqual([
      "dialga+adamantcrystal=dialgaorigin", "giratina+griseouscore=giratinaorigin", "ogerpon+cornerstonemask=ogerponcornerstone",
      "ogerpon+hearthflamemask=ogerponhearthflame", "ogerpon+wellspringmask=ogerponwellspring", "palkia+lustrousglobe=palkiaorigin",
      "zacian+rustedsword=zaciancrowned", "zamazenta+rustedshield=zamazentacrowned",
    ]);
    expect(itemForms(sw)).toEqual([
      "genesect+burndrive=genesectburn", "genesect+chilldrive=genesectchill", "genesect+dousedrive=genesectdouse", "genesect+shockdrive=genesectshock",
      "giratina+griseousorb=giratinaorigin", "zacian+rustedsword=zaciancrowned", "zamazenta+rustedshield=zamazentacrowned",
    ]);
    expect(itemForms(us)).toEqual([
      "genesect+burndrive=genesectburn", "genesect+chilldrive=genesectchill", "genesect+dousedrive=genesectdouse", "genesect+shockdrive=genesectshock",
      "giratina+griseousorb=giratinaorigin",
    ]);
    expect(itemForms(champions)).toEqual([]);
    // Generation 9's Orbs boost their holder without a form; Primal Reversion, Mega Evolution and Ultra Burst are battle-only.
    for (const [species, item] of [["giratina", "griseousorb"], ["dialga", "adamantorb"], ["palkia", "lustrousorb"], ["giratinaorigin", "griseouscore"], ["ogerponwellspring", "wellspringmask"]]) {
      expect(heldItemForm(species, item, sv)).toBeNull();
    }
    for (const [species, item] of [["kyogre", "blueorb"], ["groudon", "redorb"], ["necrozmadawnwings", "ultranecroziumz"], ["charizard", "charizarditex"], ["genesectdouse", "dousedrive"]]) {
      expect(heldItemForm(species, item, us)).toBeNull();
    }
    expect(heldItemForm("charizard", "charizarditex", champions)).toBeNull();
  });

  it("flags the base form holding the item, and the form without it requires it", async () => {
    const [sv, sw, us] = await Promise.all([loadBattleRuntime(SV), loadBattleRuntime(SW), loadBattleRuntime(US)]);
    const issues = (runtime: Runtime, id: string, ability: string, item: string) => validateBuild(build(runtime, { id, ability, item }), runtime);
    const held = (message: string) => [{ field: "itemId", message }];
    expect(issues(sv, "giratina", "pressure", "griseouscore")).toEqual(held("Giratina holding Griseous Core battles as Giratina-Origin."));
    expect(issues(sw, "giratina", "pressure", "griseousorb")).toEqual(held("Giratina holding Griseous Orb battles as Giratina-Origin."));
    expect(issues(us, "giratina", "pressure", "griseousorb")).toEqual(held("Giratina holding Griseous Orb battles as Giratina-Origin."));
    expect(issues(sv, "dialga", "pressure", "adamantcrystal")).toEqual(held("Dialga holding Adamant Crystal battles as Dialga-Origin."));
    expect(issues(sv, "palkia", "pressure", "lustrousglobe")).toEqual(held("Palkia holding Lustrous Globe battles as Palkia-Origin."));
    expect(issues(sv, "ogerpon", "defiant", "wellspringmask")).toEqual(held("Ogerpon holding Wellspring Mask battles as Ogerpon-Wellspring."));
    expect(issues(sv, "ogerpon", "defiant", "hearthflamemask")).toEqual(held("Ogerpon holding Hearthflame Mask battles as Ogerpon-Hearthflame."));
    expect(issues(sv, "ogerpon", "defiant", "cornerstonemask")).toEqual(held("Ogerpon holding Cornerstone Mask battles as Ogerpon-Cornerstone."));
    expect(issues(sw, "genesect", "download", "dousedrive")).toEqual(held("Genesect holding Douse Drive battles as Genesect-Douse."));
    expect(issues(us, "genesect", "download", "chilldrive")).toEqual(held("Genesect holding Chill Drive battles as Genesect-Chill."));
    // Each form holding its item, and generation 9's Griseous Orb on Giratina, are as Showdown accepts them.
    for (const [runtime, id, ability, item] of [
      [sv, "giratinaorigin", "levitate", "griseouscore"], [sw, "giratinaorigin", "levitate", "griseousorb"], [sv, "dialgaorigin", "pressure", "adamantcrystal"],
      [sv, "palkiaorigin", "pressure", "lustrousglobe"], [sv, "ogerponwellspring", "waterabsorb", "wellspringmask"], [us, "genesectdouse", "download", "dousedrive"],
      [sv, "giratina", "pressure", "griseousorb"], [sv, "ogerpon", "defiant", "leftovers"],
    ] as const) expect(issues(runtime, id, ability, item)).toEqual([]);
    expect(issues(sv, "giratinaorigin", "levitate", "griseousorb")).toEqual(held("Giratina-Origin requires Griseous Core."));
    expect(issues(us, "genesectdouse", "download", "leftovers")).toEqual(held("Genesect-Douse requires Douse Drive."));
    expect(issues(sv, "ogerponwellspring", "waterabsorb", "")).toEqual(held("Ogerpon-Wellspring requires Wellspring Mask."));
    // The matchup is not calculated until the form is selected.
    const out = calculateMatchup(build(sv, { id: "giratina", ability: "pressure", item: "griseouscore" }), build(sv, snorlax), singles(), {}, sv);
    expect(out.issues.attacker).toEqual(held("Giratina holding Griseous Core battles as Giratina-Origin."));
    expect(out.results).toEqual([]);
  });

  it("is the form an import takes, with an info line, and the pasted ability is checked against it", async () => {
    const [sv, sw, us] = await Promise.all([loadBattleRuntime(SV), loadBattleRuntime(SW), loadBattleRuntime(US)]);
    const member = (paste: string, runtime: Runtime) => parseTeamImport(paste, "traditional", runtime).members[0];
    const lines = (m: ReturnType<typeof member>) => m.diagnostics.filter((entry) => !/omitted: using Serious|Training omitted|Unlisted IVs|Full HP|move slots/.test(entry.message));
    const core = member("Giratina @ Griseous Core\nLevel: 50\n- Dragon Claw\n- Shadow Ball", sv);
    expect(core).toMatchObject({ speciesId: "giratinaorigin", build: { speciesId: "giratinaorigin", itemId: "griseouscore", abilityId: "levitate" } });
    expect(lines(core)).toEqual([
      { line: 1, severity: "info", message: "Giratina holding Griseous Core battles as Giratina-Origin." },
      { line: 1, severity: "info", message: "Ability omitted: using Levitate, the form's first ability." },
    ]);
    // Showdown rejects base Giratina's Pressure once the set is Giratina-Origin ("Giratina can't have Pressure.").
    const orb = member("Giratina @ Griseous Orb\nAbility: Pressure\nLevel: 50\n- Dragon Claw", sw);
    expect(orb).toMatchObject({ speciesId: "giratinaorigin", build: { itemId: "griseousorb", abilityId: "pressure" } });
    expect(lines(orb)).toEqual([
      { line: 1, severity: "info", message: "Giratina holding Griseous Orb battles as Giratina-Origin." },
      { line: 2, severity: "error", message: "Select an ability available to this Pokémon in Sword and Shield." },
    ]);
    expect(member("Giratina @ Griseous Orb\nAbility: Levitate\nLevel: 50\n- Dragon Claw", us)).toMatchObject({ speciesId: "giratinaorigin", build: { abilityId: "levitate" } });
    const mask = member("Ogerpon @ Wellspring Mask\nAbility: Water Absorb\nLevel: 50\n- Ivy Cudgel", sv);
    expect(mask).toMatchObject({ speciesId: "ogerponwellspring", build: { speciesId: "ogerponwellspring", itemId: "wellspringmask", abilityId: "waterabsorb" } });
    expect(lines(mask)).toEqual([{ line: 1, severity: "info", message: "Ogerpon holding Wellspring Mask battles as Ogerpon-Wellspring." }]);
    expect(member("Dialga @ Adamant Crystal\nAbility: Pressure\nLevel: 50\n- Flash Cannon", sv)).toMatchObject({ speciesId: "dialgaorigin" });
    expect(member("Palkia @ Lustrous Globe\nAbility: Pressure\nLevel: 50\n- Hydro Pump", sv)).toMatchObject({ speciesId: "palkiaorigin" });
    const drive = member("Genesect @ Douse Drive\nAbility: Download\nLevel: 50\n- Techno Blast", us);
    expect(drive).toMatchObject({ speciesId: "genesectdouse", build: { itemId: "dousedrive" } });
    expect(lines(drive)).toEqual([{ line: 1, severity: "info", message: "Genesect holding Douse Drive battles as Genesect-Douse." }]);
    // Generation 9's Griseous Orb keeps Giratina; a pasted form needs no line.
    expect(member("Giratina @ Griseous Orb\nAbility: Pressure\nLevel: 50\n- Dragon Claw", sv)).toMatchObject({ speciesId: "giratina" });
    for (const [paste, runtime] of [["Giratina @ Griseous Orb\nAbility: Pressure\nLevel: 50\n- Dragon Claw", sv], ["Giratina-Origin @ Griseous Orb\nAbility: Levitate\nLevel: 50\n- Dragon Claw", sw]] as const) {
      expect(member(paste, runtime).diagnostics.some((entry) => entry.message.includes("battles as"))).toBe(false);
    }
  });
});

describe("the item's form in 1v1, as pinned Showdown", () => {
  it("Giratina-Origin: its Attack, Sp. Atk and Levitate, and the Orb or Core's 1.2x on Ghost and Dragon moves", async () => {
    for (const [game, item] of [[SV, "griseouscore"], [SW, "griseousorb"], [US, "griseousorb"]] as const) {
      const origin: Mon = { id: "giratinaorigin", ability: "levitate", item };
      const claw = await row(game, "dragonclaw", origin, snorlax);
      expect(claw).toMatchObject({ min: 90, max: 106 });
      expect(claw.usesToKO).toMatchObject({ kind: "uses", guaranteed: 3, fewest: 3 });
      expect(claw.afterUse).toMatchObject({ start: 235, low: 145, high: 129, average: 137.375 });
      if (game !== SW) expect(await row(game, "shadowball", origin, garchomp)).toMatchObject({ min: 73, max: 87 });
      if (game !== US) expect(await row(game, "dragonclaw", garchomp, origin)).toMatchObject({ min: 116, max: 138, usesToKO: { kind: "uses", guaranteed: 2, fewest: 2 } });
    }
    expect((await row(SV, "earthquake", garchomp, { id: "giratinaorigin", ability: "levitate", item: "griseouscore" })).usesToKO).toEqual({ kind: "no-damage" });
    // Dynamaxed: Max Wyrmwind 145-172, out in 2.
    const wyrmwind = await row(SW, "dragonclaw", { id: "giratinaorigin", ability: "levitate", item: "griseousorb", dynamax: true }, snorlax);
    expect(wyrmwind).toMatchObject({ effectiveName: "Max Wyrmwind", min: 145, max: 172, usesToKO: { kind: "uses", guaranteed: 2, fewest: 2 } });
    expect(wyrmwind.afterUse).toMatchObject({ start: 235, low: 90, high: 63, average: 76.4375 });
  });

  it("Dialga- and Palkia-Origin: their stats and their Crystal's and Globe's 1.2x", async () => {
    const dialga: Mon = { id: "dialgaorigin", ability: "pressure", item: "adamantcrystal" }, palkia: Mon = { id: "palkiaorigin", ability: "pressure", item: "lustrousglobe" };
    const cannon = await row(SV, "flashcannon", dialga, snorlax);
    expect(cannon).toMatchObject({ min: 72, max: 85 });
    expect(cannon.usesToKO).toMatchObject({ kind: "uses", guaranteed: 4, fewest: 3 });
    expect((cannon.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.50439453125, 15);
    expect(await row(SV, "dragonclaw", garchomp, dialga)).toMatchObject({ min: 49, max: 58, usesToKO: { kind: "uses", guaranteed: 4, fewest: 4 } });
    const pump = await row(SV, "hydropump", palkia, snorlax);
    expect(pump).toMatchObject({ min: 97, max: 115, afterUse: { start: 235, low: 138, high: 120, average: 129.125 } });
    expect(pump.usesToKO).toMatchObject({ kind: "uses", guaranteed: 3, fewest: 3 });
    for (const form of [dialga, palkia]) {
      const pulse = await row(SV, "dragonpulse", form, blissey);
      expect(pulse).toMatchObject({ min: 64, max: 76, usesToKO: { kind: "uses", guaranteed: 6, fewest: 5 } });
    }
    expect(await row(SV, "dragonclaw", garchomp, palkia)).toMatchObject({ min: 116, max: 138, afterUse: { start: 165, low: 49, high: 27, average: 39.125 } });
  });

  it("Ogerpon's mask forms: Ivy Cudgel takes the form's type with the mask's 1.2x, and the form's types take hits", async () => {
    for (const [id, item, ability, type] of [["ogerponwellspring", "wellspringmask", "waterabsorb", "Water"], ["ogerponhearthflame", "hearthflamemask", "moldbreaker", "Fire"], ["ogerponcornerstone", "cornerstonemask", "sturdy", "Rock"]] as const) {
      const cudgel = await row(SV, "ivycudgel", { id, ability, item }, snorlax);
      expect(cudgel).toMatchObject({ min: 111, max: 132, effectiveType: type, afterUse: { start: 235, low: 124, high: 103, average: 113.8125 } });
      expect(cudgel.usesToKO).toMatchObject({ kind: "uses", guaranteed: 3, fewest: 2 });
      expect((cudgel.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.80078125, 15);
    }
    // Grass/Water takes Fire neutrally; Grass/Fire takes Dragon Claw neutrally.
    expect(await row(SV, "flamethrower", { id: "charizard", ability: "blaze" }, { id: "ogerponwellspring", ability: "waterabsorb", item: "wellspringmask" })).toMatchObject({ min: 58, max: 69 });
    expect(await row(SV, "dragonclaw", garchomp, { id: "ogerponhearthflame", ability: "moldbreaker", item: "hearthflamemask" })).toMatchObject({ min: 66, max: 78 });
    expect(await row(SV, "hornleech", { id: "ogerponwellspring", ability: "waterabsorb", item: "wellspringmask" }, blissey)).toMatchObject({ min: 237, max: 279, usesToKO: { kind: "uses", guaranteed: 2, fewest: 2 } });
  });

  it("Genesect's Drive forms: Techno Blast takes the Drive's type, Genesect stays Bug/Steel", async () => {
    // Download raises the stat the move does not use against these targets (the oracle resets entry stages).
    const douse = await row(SW, "technoblast", { id: "genesectdouse", ability: "download", item: "dousedrive" }, snorlax);
    expect(douse).toMatchObject({ min: 49, max: 58, effectiveType: "Water", usesToKO: { kind: "uses", guaranteed: 5, fewest: 5 } });
    const burn = await row(SW, "technoblast", { id: "genesectburn", ability: "download", item: "burndrive" }, snorlax);
    expect(burn).toMatchObject({ min: 25, max: 30, effectiveType: "Fire", usesToKO: { kind: "uses", guaranteed: null, fewest: 8 } });
    // Dynamaxed, Techno Blast is Max Flare (the Drive's type): 29-35, out in 6 to 7.
    const flare = await row(SW, "technoblast", { id: "genesectburn", ability: "download", item: "burndrive", dynamax: true }, snorlax);
    expect(flare).toMatchObject({ effectiveName: "Max Flare", min: 29, max: 35, usesToKO: { kind: "uses", guaranteed: 7, fewest: 6 } });
    expect((flare.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.661358118057251, 12);
    expect(await row(US, "technoblast", { id: "genesectshock", ability: "download", item: "shockdrive" }, blissey)).toMatchObject({ min: 41, max: 49, effectiveType: "Electric" });
    expect(await row(US, "technoblast", { id: "genesectchill", ability: "download", item: "chilldrive" }, { id: "dragonite", ability: "innerfocus" })).toMatchObject({ min: 212, max: 252, effectiveType: "Ice", usesToKO: { kind: "uses", guaranteed: 1, fewest: 1 } });
    expect(await row(US, "ironhead", { id: "genesectdouse", ability: "download", item: "dousedrive" }, garchomp)).toMatchObject({ min: 55, max: 66, usesToKO: { kind: "uses", guaranteed: 4, fewest: 3 } });
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
  return calculateDoublesTurn(input);
}
async function ready(game: BattleGame, slots: Record<DoublesSlotId, Slot>) {
  const result = await turn(game, slots);
  if (result.status !== "ready") throw new Error(result.status);
  return result;
}
const hit = (result: Awaited<ReturnType<typeof ready>>, from: DoublesSlotId, to: DoublesSlotId) => result.steps.find((step) => step.slot === from)?.hits.find((each) => each.slot === to);
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const foeSnorlax: Slot = { ...snorlax, evs: { spe: 4 } };
const dragonClaw: Slot = { ...garchomp, move: "dragonclaw", target: "own-left" };

describe("the item's form in the 2v2 turn (oracle cases IF01-IF08)", () => {
  it("Giratina-, Dialga- and Palkia-Origin", async () => {
    // IF01: Shadow Ball 73-87 into Garchomp; Garchomp's Dragon Claw 116-138 into Giratina-Origin first.
    const core = await ready(SV, { "own-left": { id: "giratinaorigin", ability: "levitate", item: "griseouscore", move: "shadowball", target: "opponent-right" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": dragonClaw });
    expect(hit(core, "own-left", "opponent-right")).toMatchObject({ min: 73, max: 87 });
    expect(hit(core, "opponent-right", "own-left")).toMatchObject({ min: 116, max: 138 });
    expect(core.hp["own-left"]).toMatchObject({ start: 225, low: 109, high: 87, average: 99.125 });
    // IF02: Dragon Claw 90-106 into Snorlax; Earthquake misses the Levitate Giratina.
    const orb = await ready(SW, { "own-left": { id: "giratinaorigin", ability: "levitate", item: "griseousorb", move: "dragonclaw", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": { ...garchomp, move: "earthquake" } });
    expect(hit(orb, "own-left", "opponent-left")).toMatchObject({ min: 90, max: 106 });
    expect(hit(orb, "opponent-right", "own-left")).toMatchObject({ kind: "no-damage" });
    expect(orb.hp["opponent-left"]).toMatchObject({ start: 235, low: 70, high: 41, average: 56.4375 });
    // IF03 and IF04.
    const dialga = await ready(SV, { "own-left": { id: "dialgaorigin", ability: "pressure", item: "adamantcrystal", move: "flashcannon", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": dragonClaw });
    expect(hit(dialga, "own-left", "opponent-left")).toMatchObject({ min: 72, max: 85 });
    expect(dialga.hp["own-left"]).toMatchObject({ start: 175, low: 126, high: 117, average: 121.875 });
    const palkia = await ready(SV, { "own-left": { id: "palkiaorigin", ability: "pressure", item: "lustrousglobe", move: "hydropump", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": dragonClaw });
    expect(hit(palkia, "own-left", "opponent-left")).toMatchObject({ min: 97, max: 115 });
    expect(palkia.hp["own-left"]).toMatchObject({ start: 165, low: 49, high: 27, average: 39.125 });
  });

  it("Ogerpon's mask forms and Genesect's Drive forms", async () => {
    // IF05: Water Ivy Cudgel 111-132 into Snorlax; Flamethrower 58-69 (neutral) into Grass/Water Ogerpon.
    const wellspring = await ready(SV, {
      "own-left": { id: "ogerponwellspring", ability: "waterabsorb", item: "wellspringmask", move: "ivycudgel", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax,
      "opponent-right": { id: "charizard", ability: "blaze", move: "flamethrower", target: "own-left" },
    });
    expect(hit(wellspring, "own-left", "opponent-left")).toMatchObject({ min: 111, max: 132 });
    expect(wellspring.hp["own-left"]).toMatchObject({ start: 155, low: 97, high: 86, average: 92.0625 });
    // IF06: Fire Ivy Cudgel 186-218 into Venusaur: out.
    const hearthflame = await ready(SV, { "own-left": { id: "ogerponhearthflame", ability: "moldbreaker", item: "hearthflamemask", move: "ivycudgel", target: "opponent-left" }, "own-right": foeSnorlax, "opponent-left": venusaur, "opponent-right": { id: "blastoise", ability: "torrent" } });
    expect(hit(hearthflame, "own-left", "opponent-left")).toMatchObject({ min: 186, max: 218, koChance: 1 });
    // IF07: Water Techno Blast 49-58 into Snorlax (Download's +1 Attack); Water Pulse 33-39 into Genesect.
    const douse = await ready(SW, {
      "own-left": { id: "genesectdouse", ability: "download", item: "dousedrive", boosts: { atk: 1 }, move: "technoblast", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax,
      "opponent-right": { id: "blastoise", ability: "torrent", move: "waterpulse", target: "own-left" },
    });
    expect(hit(douse, "own-left", "opponent-left")).toMatchObject({ min: 49, max: 58 });
    expect(douse.hp["own-left"]).toMatchObject({ start: 146, low: 113, high: 107, average: 110.875 });
    // IF08: Electric Techno Blast 102-122 into Blastoise.
    const shock = await ready(US, { "own-left": { id: "genesectshock", ability: "download", item: "shockdrive", boosts: { atk: 1 }, move: "technoblast", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "blastoise", ability: "torrent" }, "opponent-right": foeSnorlax });
    expect(hit(shock, "own-left", "opponent-left")).toMatchObject({ min: 102, max: 122 });
    expect(shock.hp["opponent-left"]).toMatchObject({ start: 154, low: 52, high: 32, average: 42.125 });
  });

  it("flags the base form holding the item on its card", async () => {
    const result = await turn(SV, { "own-left": { id: "giratina", ability: "pressure", item: "griseouscore", move: "dragonclaw", target: "opponent-left" }, "own-right": venusaur, "opponent-left": foeSnorlax, "opponent-right": dragonClaw });
    expect(result.status).toBe("issues");
    if (result.status !== "issues") return;
    expect(result.issues.pokemon["own-left"]).toContainEqual({ field: "itemId", message: "Giratina holding Griseous Core battles as Giratina-Origin." });
  });
});
