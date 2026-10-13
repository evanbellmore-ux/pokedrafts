import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { changed, itemsAfterField, settleHolder, stepEnv } from "@/app/lib/battle/doubles-fieldchange";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesOutcome, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 Track FC (ADDENDUM2 §2.3 #45, #53, #54, §4.3 FC; tier2-presence.md §5.2-§5.3): a weather, effective-weather or
 * terrain change re-settles every holder (Protosynthesis, Quark Drive, Forecast, Flower Gift, Ice Face, Mimicry, the Seeds,
 * Booster Energy at the Update), Tailwind starting runs Wind Rider and Wind Power, a pseudo-weather starting under Trick Room
 * uses Room Service, and Magic Room's end uses a due Booster Energy. Each scenario is one of V2's T2P-FLD / T2P-ACT cases or
 * FC's own (scripts/.cache/calc-audit/status2/build/w1b-fc/cases.ts), whose numbers agree with pinned Showdown c23d2e94 on
 * the oracle (w1b-fc/run.ts); the texts are the app's facts. The parts that need the integrator's lines (W1B-FC.md: the
 * action for the facts, the step's and faint's hooks, Defog's field) or E2's (the end of turn's) run once those lines are in.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried;
  move: string | null; target?: DoublesSlotId; build?: Partial<BattleBuild>;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon", CHAMPIONS = "champions";

const mon = (species: string, ability: string, move: string | null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
const lax = (spe: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", move, { evs: { spe }, ...extra });
const fast = { evs: { spe: 252 } };

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const evs = base.game === "champions" ? Object.fromEntries(Object.entries(m.evs ?? {}).map(([stat, n]) => [stat, Math.min(32, n)])) : m.evs;
  return { ...(base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...evs }, ivs: { ...IV31, ...m.ivs } } }), ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[], field: Partial<BattleConditions> = {}, extra: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null }, ...(m.carried ? { carried: m.carried } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true }, ...extra };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
function outcomes(input: DoublesTurnInput): DoublesOutcome[] {
  const out = calculateDoublesOutcomes(input);
  if (out.status !== "ready") throw new Error(`${out.status}: ${"reason" in out ? out.reason : ""}`);
  return out.outcomes;
}
const share = (list: DoublesOutcome[], test: (o: DoublesOutcome) => boolean) => list.reduce((sum, o) => sum + (test(o) ? o.chance : 0), 0);
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)!;
const range = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => { const hit = hitOf(result, slot, target); return [hit.min, hit.max]; };
const stepTexts = (result: Ready, slot: DoublesSlotId) => stepOf(result, slot).facts.map((fact) => fact.text);
const hitTexts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => (hitOf(result, slot, target)?.facts ?? []).map((fact) => fact.text);

/** The lines FC asks of the integrator and of E2 (W1B-FC.md), as they read once in. */
const source = (file: string) => readFileSync(new URL(`../../app/lib/battle/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const FIELD = source("doubles-field.ts"), KERNEL = source("doubles-turn.ts"), EOT = source("doubles-eot.ts");
const withAction = FIELD.includes("fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action)");
const withDefog = FIELD.includes("fieldChangeHooks.changed(kernel, w, { weather: w.field.weather, terrain }, use)");
const withStep = KERNEL.includes("fieldChangeHooks.stepEnv(kernel, w, attacker, target, moveId, spread)") && KERNEL.includes("fieldChangeHooks.stepField(kernel, next, w.field, action)");
const withFaint = KERNEL.includes("fieldChangeHooks.fainted(kernelOf(ctx), w, slot)");
const withRoom = FIELD.includes("fieldChangeHooks.itemsAfterField(kernel, world, slot, use)");
const withEnd = EOT.includes("fieldChangeHooks.eotField(kernel, w, { weather") && EOT.includes("fieldChangeHooks.itemsAfterField(kernel, w, slot");

describe("status2 FC: a field move's weather or terrain re-settles the holders (afterFieldMove)", () => {
  it("T2P-FLD-01: Sunny Day starts a Protosynthesis Great Tusk's boost (its Attack) before its Headlong Rush", async () => {
    const input = turn(await game(SV), [mon("torkoal", "shellarmor", "sunnyday", fast), mon("greattusk", "protosynthesis", "headlongrush", { target: PR }), lax(16), lax(8)]);
    const result = ready(input);
    expect(range(result, OR, PR)).toEqual([120, 142]);
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.settledBoostedStat === "atk")).toBeCloseTo(1, 9);
  });

  it.skipIf(!withAction)("T2P-FLD-01's facts: the boost is a fact of Sunny Day's step, naming the Pokémon", async () => {
    const result = ready(turn(await game(SV), [mon("torkoal", "shellarmor", "sunnyday", fast), mon("greattusk", "protosynthesis", "headlongrush", { target: PR }), lax(16), lax(8)]));
    expect(stepTexts(result, OL)).toEqual(expect.arrayContaining(["The weather becomes Sun.", "Great Tusk's Protosynthesis boosts its Attack."]));
  });

  it("T2P-FLD-04: Grassy Terrain uses each Grassy Seed in it (+1 Defense, the item gone, Unburden on)", async () => {
    const input = turn(await game(SV), [mon("rillaboom", "overgrow", "grassyterrain", fast), lax(8, null, { item: "grassyseed" }), lax(16), mon("hawlucha", "unburden", null, { item: "grassyseed" })]);
    const out = outcomes(input);
    expect(share(out, (o) => o.mons[OR]!.build.itemId === "" && o.mons[OR]!.build.boosts.def === 1)).toBeCloseTo(1, 9);
    expect(share(out, (o) => o.mons[PR]!.build.itemId === "" && o.mons[PR]!.build.boosts.def === 1 && o.mons[PR]!.build.abilityActive)).toBeCloseTo(1, 9);
    if (withAction) {
      expect(stepTexts(ready(input), OL)).toEqual(expect.arrayContaining(["Hawlucha's Grassy Seed is used up on Grassy Terrain: +1 Defense.", "Snorlax (yours)'s Grassy Seed is used up on Grassy Terrain: +1 Defense."]));
    }
  });

  it("FC-CNT-01, -02: a Contrary Malamar's Grassy Seed lowers its Defense; from a Mold Breaker user's Grassy Terrain it raises it", async () => {
    const sv = await game(SV);
    const malamar = mon("malamar", "contrary", null, { item: "grassyseed" });
    const plain = turn(sv, [mon("rillaboom", "overgrow", "grassyterrain", fast), lax(8, "bodyslam", { target: PR }), lax(16), malamar]);
    expect(range(ready(plain), OR, PR)).toEqual([87, 103]);
    expect(share(outcomes(plain), (o) => o.mons[PR]!.build.boosts.def === -1)).toBeCloseTo(1, 9);
    const broken = turn(sv, [mon("ogerponhearthflame", "moldbreaker", "grassyterrain", { ...fast, item: "hearthflamemask" }), lax(8, "bodyslam", { target: PR }), lax(16), malamar]);
    expect(range(ready(broken), OR, PR)).toEqual([40, 48]);
    expect(share(outcomes(broken), (o) => o.mons[PR]!.build.boosts.def === 1)).toBeCloseTo(1, 9);
  });

  it("FC-QDS-01: Electric Terrain runs Quark Drive before the same Pokémon's Electric Seed (Attack, not the Defense the Seed would have made best)", async () => {
    const input = turn(await game(SV), [mon("pincurchin", "lightningrod", "electricterrain", fast), lax(8), lax(16, "bodyslam", { target: PR }),
      mon("ironhands", "quarkdrive", "drainpunch", { target: OR, item: "electricseed", nature: "Brave", ivs: { spe: 0 } })]);
    const result = ready(input);
    expect(range(result, PR, OR)).toEqual([228, 270]);
    expect(range(result, PL, PR)).toEqual([33, 40]);
    expect(share(outcomes(input), (o) => o.mons[PR]!.build.settledBoostedStat === "atk" && o.mons[PR]!.build.boosts.def === 1 && o.mons[PR]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("FC-PSY-01: Psychic Terrain replacing Electric Terrain ends Quark Drive (from the terrain) and uses a Psychic Seed", async () => {
    const input = turn(await game(SV), [mon("indeedee", "innerfocus", "psychicterrain", fast), lax(8, null, { item: "psychicseed" }), lax(16), mon("ironhands", "quarkdrive", "drainpunch", { target: OR })],
      { terrain: "Electric" });
    expect(range(ready(input), PR, OR)).toEqual([162, 192]);
    const out = outcomes(input);
    expect(share(out, (o) => !o.mons[PR]!.build.settledBoostedStat)).toBeCloseTo(1, 9);
    expect(share(out, (o) => o.mons[OR]!.build.boosts.spd === 1 && o.mons[OR]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("T2P-FLD-05, FC-MLD-01: Snowscape gives Eiscue-Noice its face back; not from a Mold Breaker Basculegion (Ice Face is breakable)", async () => {
    const sv = await game(SV);
    const restored = turn(sv, [mon("abomasnow", "soundproof", "snowscape", fast), lax(8), lax(16), mon("eiscuenoice", "iceface", null)]);
    expect(share(outcomes(restored), (o) => o.mons[PR]!.build.speciesId === "eiscue")).toBeCloseTo(1, 9);
    const broken = turn(sv, [mon("basculegion", "moldbreaker", "snowscape", fast), lax(8, "bodyslam", { target: PR }), lax(16), mon("eiscuenoice", "iceface", null)]);
    expect(range(ready(broken), OR, PR)).toEqual([48, 57]);
    expect(share(outcomes(broken), (o) => o.mons[PR]!.build.speciesId === "eiscuenoice")).toBeCloseTo(1, 9);
  });

  it("T2P-FLD-06: Grassy Terrain makes a Mimicry Stunfisk-Galar Grass type (Champions)", async () => {
    const input = turn(await game(CHAMPIONS), [mon("rillaboom", "overgrow", "grassyterrain", { evs: { spe: 32 } }), lax(1), lax(2), mon("stunfiskgalar", "mimicry", null)]);
    expect(share(outcomes(input), (o) => o.mons[PR]!.build.types?.join() === "Grass")).toBeCloseTo(1, 9);
  });

  it("T2P-FLD-07, -11: Rain Dance makes Castform Castform-Rainy (Champions, USUM)", async () => {
    for (const id of [CHAMPIONS, USUM] as const) {
      const input = turn(await game(id), [mon("pelipper", "keeneye", "raindance", { evs: { spe: id === CHAMPIONS ? 32 : 252 } }), lax(id === CHAMPIONS ? 1 : 8), lax(id === CHAMPIONS ? 2 : 16), mon("castform", "forecast", null)]);
      expect(share(outcomes(input), (o) => o.mons[PR]!.build.speciesId === "castformrainy"), id).toBeCloseTo(1, 9);
    }
  });

  it("T2P-FLD-08, FC-MLD-02: Sunny Day makes Cherrim Cherrim-Sunshine; a Mold Breaker Haxorus's leaves it Cherrim, its ally's 1.5x Attack either way (SwSh)", async () => {
    const swsh = await game(SWSH);
    const sunshine = turn(swsh, [mon("torkoal", "whitesmoke", "sunnyday", fast), lax(8), lax(0, "bodyslam", { target: OL }), mon("cherrim", "flowergift", null)]);
    expect(range(ready(sunshine), PL, OL)).toEqual([58, 70]);
    expect(share(outcomes(sunshine), (o) => o.mons[PR]!.build.speciesId === "cherrimsunshine")).toBeCloseTo(1, 9);
    const broken = turn(swsh, [mon("haxorus", "moldbreaker", "sunnyday", fast), lax(8), lax(0, "bodyslam", { target: OL }), mon("cherrim", "flowergift", null)]);
    expect(range(ready(broken), PL, OL)).toEqual([85, 102]);
    expect(share(outcomes(broken), (o) => o.mons[PR]!.build.speciesId === "cherrim")).toBeCloseTo(1, 9);
  });
});

describe("status2 FC: Tailwind, Trick Room and the Update after a field change", () => {
  it("T2P-ACT-01: Tailwind charges its side's Wind Power Kilowattrel: its later Thunderbolt at 2x", async () => {
    const result = ready(turn(await game(SV), [mon("talonflame", "flamebody", "tailwind", fast), mon("kilowattrel", "windpower", "thunderbolt", { target: PR }), lax(16), lax(8)]));
    expect(range(result, OR, PR)).toEqual([99, 117]);
    if (withAction) expect(stepTexts(result, OL)).toContain("Wind Power: Kilowattrel is charged.");
  });

  it("T2P-ACT-02, FC-MLD-03: Tailwind raises its side's Wind Rider (+1 Attack), not a foe's; a Teravolt Zekrom's raises none", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("talonflame", "flamebody", "tailwind", fast), mon("brambleghast", "windrider", null), lax(16), mon("brambleghast", "windrider", null)]);
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.boosts.atk === 1 && o.mons[PR]!.build.boosts.atk === 0)).toBeCloseTo(1, 9);
    const broken = turn(sv, [mon("zekrom", "teravolt", "tailwind", fast), mon("brambleghast", "windrider", null), lax(16), lax(8)]);
    expect(share(outcomes(broken), (o) => o.mons[OR]!.build.boosts.atk === 0)).toBeCloseTo(1, 9);
  });

  it("T2P-ACT-03, -05: Trick Room starting uses a foe's Room Service (−1 Speed from itself: Clear Body does not stop it; Unburden on)", async () => {
    const sv = await game(SV);
    const hawlucha = turn(sv, [mon("hatterene", "magicbounce", "trickroom"), lax(8), lax(16), mon("hawlucha", "unburden", null, { item: "roomservice" })]);
    expect(share(outcomes(hawlucha), (o) => o.mons[PR]!.build.boosts.spe === -1 && o.mons[PR]!.build.itemId === "" && o.mons[PR]!.build.abilityActive)).toBeCloseTo(1, 9);
    if (withAction) expect(stepTexts(ready(hawlucha), OL)).toContain("Hawlucha's Room Service is used up under Trick Room: −1 Speed.");
    const metagross = turn(sv, [mon("hatterene", "magicbounce", "trickroom"), lax(8), lax(16), mon("metagross", "clearbody", null, { item: "roomservice" })]);
    expect(share(outcomes(metagross), (o) => o.mons[PR]!.build.boosts.spe === -1 && o.mons[PR]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("FC-MRB-01: under Magic Room, Rain Dance ends the sun (the Booster Energy ignored); Magic Room's end uses it: the boost for the Headlong Rush", async () => {
    const input = turn(await game(SV), [mon("torkoal", "drought", null), mon("greattusk", "protosynthesis", "headlongrush", { target: PL, item: "boosterenergy" }),
      mon("delphox", "blaze", "magicroom"), mon("pelipper", "keeneye", "raindance", { nature: "Timid", evs: { spe: 252 } })], { weather: "Sun", magicRoom: true });
    const result = ready(input);
    expect(range(result, OR, PL)).toEqual([288, 342]);
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.itemId === "" && o.mons[OR]!.build.settledBoostedStat === "atk")).toBeCloseTo(1, 9);
    if (withAction) expect(stepTexts(result, PR)).toContain("Great Tusk's Protosynthesis ends.");
  });

  it("A3-MR-06's scenario: Magic Room's end with a Booster Energy holder that came in under it (its field down): the Energy is used", async () => {
    const input = turn(await game(SV), [mon("smeargle", "owntempo", "magicroom", fast), mon("ironhands", "quarkdrive", null, { item: "boosterenergy", build: { itemUsedBeforeRoom: false } }), lax(0), lax(4)],
      { magicRoom: true });
    const result = ready(input);
    if (withRoom) expect(stepTexts(result, OL)).toContain("Iron Hands's Booster Energy is used up: Quark Drive boosts its Attack.");
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.itemId === "" && o.mons[OR]!.build.settledBoostedStat === "atk")).toBeCloseTo(1, 9);
  });
});

describe("status2 FC: the changes outside a field move (the integrator's and E2's lines)", () => {
  it.skipIf(!withStep)("FC-STP-01, -02: Ice Spinner ends Electric Terrain after its hit: Quark Drive from the terrain ends; one from Booster Energy stays", async () => {
    const sv = await game(SV);
    const field = { terrain: "Electric" as const };
    const plain = ready(turn(sv, [mon("chienpao", "swordofruin", "icespinner", { ...fast, target: PR }), lax(8), lax(16), mon("ironhands", "quarkdrive", "drainpunch", { target: OR })], field));
    expect(range(plain, PR, OR)).toEqual([212, 252]);
    expect(hitTexts(plain, OL, PR)).toContain("Iron Hands's Quark Drive ends.");
    const booster = ready(turn(sv, [mon("chienpao", "swordofruin", "icespinner", { ...fast, target: PR }), lax(8), lax(16),
      mon("ironhands", "quarkdrive", "drainpunch", { target: OR, item: "boosterenergy", build: { itemUsedBeforeField: true } })], field));
    expect(range(booster, PR, OR)).toEqual([276, 326]);
  });

  it.skipIf(!withFaint)("FC-CLD-01: a Cloud Nine Golduck fainting under sun starts Great Tusk's Protosynthesis: its later Headlong Rush is boosted", async () => {
    const result = ready(turn(await game(SV), [mon("garchomp", "roughskin", "dragonclaw", { ...fast, target: PR }), mon("greattusk", "protosynthesis", "headlongrush", { target: PL }),
      lax(16), mon("golduck", "cloudnine", null, { hp: 1 })], { weather: "Sun" }));
    expect(range(result, OR, PL)).toEqual([156, 184]);
  });

  it.skipIf(!withDefog)("FS08e, FC-DEF-01: Defog's terrain end ends Quark Drive (SV) and gives Mimicry its types back (Champions)", async () => {
    const sv = ready(turn(await game(SV), [mon("corviknight", "pressure", "defog", { ...fast, target: PR }), mon("ironhands", "quarkdrive", "drainpunch", { target: PR }), lax(0), lax(16)],
      { terrain: "Electric" }));
    expect(range(sv, OR, PR)).toEqual([162, 192]);
    const champions = turn(await game(CHAMPIONS), [mon("corviknight", "pressure", "defog", { evs: { spe: 32 }, target: PR }), lax(1, "thunderbolt", { target: PR }), lax(2),
      mon("stunfiskgalar", "mimicry", null)], { terrain: "Grassy" });
    expect(hitOf(ready(champions), OR, PR).kind).toBe("no-damage");
    expect(share(outcomes(champions), (o) => !o.mons[PR]!.build.types)).toBeCloseTo(1, 9);
  });

  it.skipIf(!withEnd)("T2P-FLD-03: the sun ending at the end of turn ends Protosynthesis; a held Booster Energy is used at the final Update", async () => {
    const input = turn(await game(SV), [mon("torkoal", "drought", null), mon("greattusk", "protosynthesis", null, { item: "boosterenergy" }), lax(8), lax(16)],
      { weather: "Sun" }, { weatherTurns: 1 });
    expect(ready(input).endOfTurn.status).toBe("ready");
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.itemId === "" && o.mons[OR]!.build.settledBoostedStat === "atk")).toBeCloseTo(1, 9);
  });
});

describe("status2 FC: the hooks' own rules", () => {
  /** A kernel with what the hooks below read: the living holders, the field-settled sets, the move data. */
  const fake = (runtime: BattleRuntime, builds: Partial<Record<DoublesSlotId, Partial<BattleBuild>>>) => {
    const w = { mass: 1, mons: Object.fromEntries(Object.entries(builds).map(([slot, build]) => [slot, { fainted: false, build: { itemId: "", abilityId: "", ...build }, vol: {}, eot: {} }])),
      field: { weather: "", terrain: "" } } as unknown as World;
    const kernel = {
      runtime, inEndOfTurn: false, input: { pokemon: {} }, names: { [OL]: "Castform", [OR]: "", [PL]: "", [PR]: "" },
      alive: (world: World, slot: DoublesSlotId) => !!world.mons[slot] && !world.mons[slot]!.fainted,
      fieldSettledAbilities: new Set(["protosynthesis", "quarkdrive", "mimicry", "forecast", "flowergift", "iceface"]),
      fieldSettledItems: new Set(["electricseed", "grassyseed", "psychicseed", "mistyseed", "boosterenergy"]),
      abilityName: (id: string) => runtime.abilitiesById.get(id)?.name ?? id, itemName: (id: string) => runtime.itemsById.get(id)?.name ?? id,
      itemWorks: () => true, effectiveWeather: (world: World) => world.field.weather,
      notEstimated: (reason: string) => { throw new Error(reason); },
    } as unknown as TurnKernel;
    return { w, kernel };
  };

  it("a caller that does not give the field before the change keeps today's guard (REASONS.fieldChange)", async () => {
    const { w, kernel } = fake(await game(SV), { [OL]: { abilityId: "quarkdrive" }, [OR]: {} });
    expect(() => changed(kernel, w)).toThrow(REASONS.fieldChange("Quark Drive"));
    // With the field before it, nothing changed: nothing to re-settle.
    expect(() => changed(kernel, w, { weather: "", terrain: "" })).not.toThrow();
  });

  it("stepEnv follows the step's field change only with a holder in, not for a spread move nor a repeated hit into Seed Sower or Sand Spit", async () => {
    const sv = await game(SV);
    const none = fake(sv, { [OL]: {}, [PR]: {} });
    expect(stepEnv(none.kernel, none.w, OL, PR, "icespinner", false)).toEqual({});
    const holder = fake(sv, { [OL]: {}, [OR]: { abilityId: "quarkdrive" }, [PR]: {} });
    expect(stepEnv(holder.kernel, holder.w, OL, PR, "icespinner", false)).toEqual({ fieldFollowed: true });
    expect(stepEnv(holder.kernel, holder.w, OL, PR, "icespinner", true)).toEqual({});
    const sower = fake(sv, { [OL]: {}, [OR]: { abilityId: "quarkdrive" }, [PR]: { abilityId: "seedsower" } });
    expect(stepEnv(sower.kernel, sower.w, OL, PR, "bulletseed", false)).toEqual({});
    expect(stepEnv(sower.kernel, sower.w, OL, PR, "icespinner", false)).toEqual({ fieldFollowed: true });
  });

  it("settleHolder: Forecast gained by Castform in the rain gives it Castform-Rainy (A1's Start table)", async () => {
    const { w, kernel } = fake(await game(USUM), { [OL]: { speciesId: "castform", abilityId: "forecast" } });
    w.field = { ...w.field, weather: "Rain" };
    expect(settleHolder(kernel, w, OL)).toEqual([w]);
    expect(w.mons[OL]!.build.speciesId).toBe("castformrainy");
  });

  it("probe RS3: Wonder Room starting while Trick Room is up uses a held Room Service (it came in under Magic Room, which ended this turn)", async () => {
    const input = turn(await game(SV), [mon("mismagius", "levitate", "wonderroom"), lax(8), mon("delphox", "blaze", "magicroom", { nature: "Brave", ivs: { spe: 0 } }),
      mon("hawlucha", "unburden", null, { item: "roomservice", build: { itemUsedBeforeRoom: false } })], { trickRoom: true, magicRoom: true });
    expect(share(outcomes(input), (o) => o.mons[PR]!.build.itemId === "" && o.mons[PR]!.build.boosts.spe === -1 && o.mons[PR]!.build.abilityActive)).toBeCloseTo(1, 9);
  });

  it("itemsAfterField does nothing to a Pokémon whose Booster Energy is not due (its field up, no paradox ability)", async () => {
    const sv = await game(SV);
    const { w, kernel } = fake(sv, { [OL]: { abilityId: "thickfat", itemId: "boosterenergy" } });
    expect(itemsAfterField(kernel, w, OL)).toEqual([w]);
    expect(w.mons[OL]!.build.itemId).toBe("boosterenergy");
  });
});
