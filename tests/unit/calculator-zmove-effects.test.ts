import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { Z_MOVE_EFFECTS } from "@/app/lib/battle/stat-moves";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat, MoveContext, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * A damaging move's Z-Move or Max Move runs none of its base move's own effects, against pinned Showdown c23d2e94.
 * sim/battle-actions.ts getActiveZMove / getActiveMaxMove (1425-1513) make it the generic move of its type (Inferno
 * Overdrive, All-Out Pummeling, Max Flare...) with only the base move's zMove / maxMove power, category and priority, or
 * a signature Z-Move (zMoveFrom) with its own data: no Inferno burn, Nuzzle paralysis, Close Combat drops, Mind Blown cost,
 * charge turn, trap, Focus Punch focus (sim/battle-queue.ts: no priorityChargeCallback with action.zmove / maxMove), Smack
 * Down grounding, Sucker Punch onTry, Snipe Shot tracksTarget (sim/pokemon.ts getMoveTargets reads the move used); a
 * signature Z-Move keeps its own (data/moves.ts: Stoked Sparksurfer's paralysis, Clangorous Soulblaze's selfBoost, Genesis
 * Supernova's Psychic Terrain, Splintered Stormshards' terrain clear). Singles values: the exact Uses oracle
 * scripts/.cache/calc-audit/bugbite/verify/u-oracle.ts through zmove/verify/z1v1.ts (probes zmove-status/fix/p1v1.ts).
 * 2v2 values: the exact oracle scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases ZS01-ZS24 (zmove-status/fix/cases-zs.ts).
 * Level 50, 31 IVs, 0 EVs, Serious nature unless set.
 */

type Mon = { id: string; ability: string; item?: string; hp?: number; status?: BattleBuild["status"]; boosts?: Partial<Record<CombatStat, number>> };
function build(runtime: Awaited<ReturnType<typeof loadBattleRuntime>>, m: Mon, extra: Partial<BattleBuild> = {}): BattleBuild {
  return {
    ...createBuild(m.id, runtime), nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, ...(m.hp !== undefined ? { currentHP: m.hp } : {}), ...(m.status ? { status: m.status } : {}), ...extra,
  } as BattleBuild;
}
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, options: { z?: boolean; field?: Partial<BattleConditions>; extra?: Partial<BattleBuild> } = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const contexts: Record<string, MoveContext> = options.z ? { [moveId]: { useZ: true } } : {};
  const out = calculateMatchup(build(runtime, attacker, options.extra), build(runtime, defender), { ...createConditions(), gameType: "Singles", ...options.field }, contexts, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const U: BattleGame = "ultra_sun_ultra_moon";
const single = (koChance: number) => ({ kind: "single-use", reason: "Z-Moves are once per battle", koChance });
const blissey = (patch: Partial<Mon> = {}): Mon => ({ id: "blissey", ability: "naturalcure", ...patch });

describe("signature Z-Moves' own effects (stat-moves.ts Z_MOVE_EFFECTS)", () => {
  it("are Clangorous Soulblaze's selfBoost, Genesis Supernova's terrain and Splintered Stormshards' terrain clear", () => {
    expect(Z_MOVE_EFFECTS).toEqual({
      "Clangorous Soulblaze": { user: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } },
      "Genesis Supernova": { terrain: "Psychic" },
      "Splintered Stormshards": { clearsTerrain: true },
    });
  });
});

describe("a Z-Move runs none of its base move's effects in 1v1 (Ultra Sun / Ultra Moon)", () => {
  it("Inferno Overdrive burns nothing: the target's end of turn takes no burn", async () => {
    // p1v1 S01: Typhlosion's Z-Inferno into Blissey at 110: 84-100, 10-26 left, out by the end of the turn at 0 (was 0.6875).
    const z = await row(U, "inferno", { id: "typhlosion", ability: "blaze", item: "firiumz" }, blissey({ hp: 110 }), { z: true });
    expect(z).toMatchObject({ effectiveName: "Inferno Overdrive", min: 84, max: 100 });
    expect(z.usesToKO).toEqual(single(0));
    expect(z.afterUse).toMatchObject({ start: 110, low: 26, high: 10, min: 10, max: 26, koChance: 0 });
    expect(z.afterUse!.average).toBeCloseTo(18.125, 12);
    // S04: Inferno itself burns (the target is out in 2 uses).
    const plain = await row(U, "inferno", { id: "typhlosion", ability: "blaze" }, blissey({ hp: 110 }));
    expect(plain.usesToKO).toMatchObject({ kind: "uses", guaranteed: 2, fewest: 2, carried: ["Its burn damages the target at the end of each turn."] });
    // S03: no status for Arbok's Shed Skin to cure: 133-157 into 135 HP, out at 0.9375.
    const shed = await row(U, "inferno", { id: "typhlosion", ability: "blaze", item: "firiumz" }, { id: "arbok", ability: "shedskin" }, { z: true });
    expect(shed.usesToKO).toEqual(single(0.9375));
  });

  it("Bloom Doom and Supersonic Skystrike hit at once: no charge turn before the end of turn", async () => {
    // C01: a poisoned Charizard at 70 takes 30-36 and one poison turn (19): 15-21 left, never out.
    const bloom = await row(U, "solarbeam", { id: "venusaur", ability: "overgrow", item: "grassiumz" }, { id: "charizard", ability: "blaze", hp: 70, status: "psn" }, { z: true });
    expect(bloom).toMatchObject({ effectiveName: "Bloom Doom", min: 30, max: 36 });
    expect(bloom.usesToKO).toEqual(single(0));
    // C02: a poisoned Snorlax at 160 takes 121-144, then 29 poison: out at 0.5625 (a charge turn made it 1).
    const sky = await row(U, "fly", { id: "charizard", ability: "blaze", item: "flyiniumz" }, { id: "snorlax", ability: "thickfat", hp: 160, status: "psn" }, { z: true });
    expect(sky).toMatchObject({ effectiveName: "Supersonic Skystrike", min: 121, max: 144 });
    expect(sky.usesToKO).toEqual(single(0.5625));
  });

  it("estimates the Z-Move where its base move's trap, delay, form or ability change, or Endeavor's floor stopped it", async () => {
    // T01, F01, R01, R03: one use each, nothing left after it.
    expect((await row(U, "firespin", { id: "charizard", ability: "blaze", item: "firiumz" }, blissey({ hp: 120 }), { z: true })).usesToKO).toEqual(single(0));
    expect((await row(U, "futuresight", { id: "alakazam", ability: "magicguard", item: "psychiumz" }, blissey({ hp: 150 }), { z: true })).usesToKO).toEqual(single(0));
    expect((await row(U, "relicsong", { id: "meloetta", ability: "serenegrace", item: "normaliumz" }, blissey(), { z: true })).usesToKO).toEqual(single(0));
    expect((await row(U, "coreenforcer", { id: "zygarde", ability: "aurabreak", item: "dragoniumz" }, blissey(), { z: true })).usesToKO).toEqual(single(0));
    // R02: Never-Ending Nightmare steals no boosts: 150-176 into a +1 Defense Slowbro (170), out at 0.25.
    const thief = await row(U, "spectralthief", { id: "marshadow", ability: "technician", item: "ghostiumz" }, { id: "slowbro", ability: "oblivious", boosts: { def: 1 } }, { z: true });
    expect(thief).toMatchObject({ effectiveName: "Never-Ending Nightmare", min: 150, max: 176 });
    expect(thief.usesToKO).toEqual(single(0.25));
    // H01: no status read by Never-Ending Nightmare (no "Sleep wears off at random"): 270-320 into a sleeping Slowbro at 150.
    expect((await row(U, "hex", { id: "gengar", ability: "cursedbody", item: "ghostiumz" }, { id: "slowbro", ability: "oblivious", hp: 150, status: "slp" }, { z: true })).usesToKO).toEqual(single(1));
    // E01: Breakneck Blitz from Endeavor is no Endeavor: 345-406 knocks Blissey out (was "never").
    const endeavor = await row(U, "endeavor", { id: "kangaskhan", ability: "scrappy", item: "normaliumz" }, blissey(), { z: true });
    expect(endeavor).toMatchObject({ effectiveName: "Breakneck Blitz", min: 345, max: 406 });
    expect(endeavor.usesToKO).toEqual(single(1));
  });

  it("Continental Crush grounds nothing: a Flying target gets no Grassy Terrain heal before its poison", async () => {
    // G01: Skarmory at 80, poisoned: 55-66, then poison (17) with no heal: out at 0.3125 (grounded, the heal kept it in).
    const z = await row(U, "smackdown", { id: "tyranitar", ability: "sandstream", item: "rockiumz" }, { id: "skarmory", ability: "sturdy", hp: 80, status: "psn" }, { z: true, field: { terrain: "Grassy" } });
    expect(z).toMatchObject({ effectiveName: "Continental Crush", min: 55, max: 66 });
    expect(z.usesToKO).toEqual(single(0.3125));
  });

  it("a signature Z-Move's own field change acts before the end of turn", async () => {
    // Z01: Genesis Supernova's Psychic Terrain replaces Grassy Terrain: Blissey at 120, poisoned, 82-97, no heal: out for certain.
    const genesis = await row(U, "psychic", { id: "mew", ability: "synchronize", item: "mewniumz" }, blissey({ hp: 120, status: "psn" }), { z: true, field: { terrain: "Grassy" } });
    expect(genesis).toMatchObject({ effectiveName: "Genesis Supernova", min: 82, max: 97 });
    expect(genesis.usesToKO).toEqual(single(1));
    // Z02: Splintered Stormshards ends Grassy Terrain: Steelix at 34, poisoned, 16-19, no heal: out for certain.
    const shards = await row(U, "stoneedge", { id: "lycanroc", ability: "keeneye", item: "lycaniumz" }, { id: "steelix", ability: "rockhead", hp: 34, status: "psn" }, { z: true, field: { terrain: "Grassy" } });
    expect(shards).toMatchObject({ effectiveName: "Splintered Stormshards", min: 16, max: 19 });
    expect(shards.usesToKO).toEqual(single(1));
  });

  it("a Max Move still runs none of its base move's effects; the move itself does once Dynamax ends (Sword / Shield)", async () => {
    // X01: Max Flare from Inferno burns nothing for 3 turns, then Inferno does: out in 5 uses, in 4 at 0.03009033203125.
    const max = await row("sword_shield", "inferno", { id: "charizard", ability: "blaze" }, { id: "snorlax", ability: "thickfat" }, { extra: { mechanic: "dynamax" } });
    expect(max).toMatchObject({ effectiveName: "Max Flare", min: 37, max: 45 });
    expect(max.usesToKO).toMatchObject({ kind: "uses", guaranteed: 5, fewest: 4, fasterChance: 0.03009033203125 });
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId; z?: boolean; evs?: Partial<Record<"spe", number>>; dynamax?: boolean; absent?: boolean };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => {
    if (m.absent) return [slot, null];
    const base = build(runtime, m, m.dynamax ? { mechanic: "dynamax" } : {});
    const withSpeed = m.evs ? { ...base, native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } } : base;
    return [slot, {
      build: withSpeed as BattleBuild, contexts: m.z && m.move ? { [m.move]: { useZ: true } } : {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
    } satisfies DoublesPokemonInput];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
  const result = calculateDoublesTurn(input);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.status);
  return result;
}
const hit = (result: Awaited<ReturnType<typeof turn>>, from: DoublesSlotId, to: DoublesSlotId) => result.steps.find((step) => step.slot === from)?.hits.find((each) => each.slot === to);
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const blastoise: Slot = { id: "blastoise", ability: "torrent" };
const snorlax: Slot = { id: "snorlax", ability: "thickfat" };
const bodySlam = (target: DoublesSlotId): Slot => ({ ...snorlax, move: "bodyslam", target });

describe("a Z-Move runs none of its base move's effects in the 2v2 turn (oracle cases ZS01-ZS24, Ultra Sun / Ultra Moon)", () => {
  it("no burn, paralysis, self drop or self cost for the turn's later moves", async () => {
    // ZS01: Snorlax is not burned: its Body Slam deals 64-76 (the bug halved it: 32-38); Typhlosion 153 → 77-89, average 83.4375.
    const burn = await turn(U, { "own-left": { id: "typhlosion", ability: "blaze", item: "firiumz", z: true, move: "inferno", target: "opponent-left" }, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(hit(burn, "opponent-left", "own-left")).toMatchObject({ min: 64, max: 76 });
    expect(burn.hp["own-left"]).toMatchObject({ start: 153, low: 89, high: 77, min: 77, max: 89, average: 83.4375, koChance: 0 });
    // ZS02: All-Out Pummeling lowers no Defense: Body Slam 67-79 into Heracross 155 → 76-88, average 82.4375.
    const drops = await turn(U, { "own-left": { id: "heracross", ability: "guts", item: "fightiniumz", z: true, move: "closecombat", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "toxapex", ability: "regenerator" }, "opponent-right": bodySlam("own-left") });
    expect(hit(drops, "opponent-right", "own-left")).toMatchObject({ min: 67, max: 79 });
    expect(drops.hp["own-left"]).toMatchObject({ low: 88, high: 76, average: 82.4375 });
    // ZS03: Gigavolt Havoc paralyses nothing: Snorlax always moves; Pikachu 110 → 0-5, out at 0.6875, average 0.8125.
    const par = await turn(U, { "own-left": { id: "pikachu", ability: "static", item: "electriumz", z: true, move: "nuzzle", target: "opponent-left" }, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(par.hp["own-left"]).toMatchObject({ start: 110, min: 0, max: 5, average: 0.8125, koChance: 0.6875 });
    // ZS12: Inferno Overdrive from Mind Blown costs no HP: Blacephalon stays at 60.
    const cost = await turn(U, { "own-left": { id: "blacephalon", ability: "beastboost", item: "firiumz", hp: 60, z: true, move: "mindblown", target: "opponent-left" }, "own-right": venusaur, "opponent-left": blissey(), "opponent-right": snorlax });
    expect(cost.hp["own-left"]).toMatchObject({ start: 60, low: 60, high: 60, koChance: 0 });
  });

  it("no Focus Punch focus, Smack Down grounding or Sucker Punch onTry", async () => {
    // ZS07: Garchomp's Dragon Claw first; All-Out Pummeling (-3) still lands: Garchomp 183 → 20-45, average 32.8125.
    const focus = await turn(U, { "own-left": { id: "hariyama", ability: "thickfat", item: "fightiniumz", z: true, move: "focuspunch", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "own-left" }, "opponent-right": blastoise });
    expect(hit(focus, "own-left", "opponent-left")).toMatchObject({ min: 138, max: 163 });
    expect(focus.hp["opponent-left"]).toMatchObject({ min: 20, max: 45, average: 32.8125 });
    // ZS17: and no focus to stop a faster Fake Out's flinch: Hariyama flinches, Kangaskhan untouched.
    const flinch = await turn(U, { "own-left": { id: "hariyama", ability: "thickfat", item: "fightiniumz", z: true, move: "focuspunch", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "kangaskhan", ability: "scrappy", move: "fakeout", target: "own-left" }, "opponent-right": blastoise });
    expect(flinch.hp["opponent-left"]).toMatchObject({ start: 180, low: 180, high: 180 });
    // ZS13: Continental Crush grounds nothing (was not estimated): the partner's Earth Power has no effect on Skarmory 140 → 74-85.
    const grounded = await turn(U, { "own-left": { id: "tyranitar", ability: "unnerve", item: "rockiumz", z: true, move: "smackdown", target: "opponent-left" }, "own-right": { id: "swampert", ability: "torrent", move: "earthpower", target: "opponent-left" }, "opponent-left": { id: "skarmory", ability: "keeneye" }, "opponent-right": snorlax });
    expect(hit(grounded, "own-right", "opponent-left")).toMatchObject({ kind: "no-damage" });
    expect(grounded.hp["opponent-left"]).toMatchObject({ min: 74, max: 85, average: 79.875 });
    // ZS22: Black Hole Eclipse hits a Slowbro that does not attack: 186-218 knocks it out.
    const sucker = await turn(U, { "own-left": { id: "absol", ability: "pressure", item: "darkiniumz", z: true, move: "suckerpunch", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "slowbro", ability: "oblivious" }, "opponent-right": snorlax });
    expect(hit(sucker, "own-left", "opponent-left")).toMatchObject({ min: 186, max: 218 });
    expect(sucker.hp["opponent-left"]).toMatchObject({ low: 0, koChance: 1 });
    // ZS08: Breakneck Blitz from Fake Out (+3) flinches nothing and needs no first turn: Snorlax's Body Slam 63-75 still lands.
    const kangaskhan: Slot = { id: "kangaskhan", ability: "scrappy", move: "fakeout", target: "opponent-left" };
    const fakeOut = await turn(U, { "own-left": { ...kangaskhan, item: "normaliumz", z: true }, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(hit(fakeOut, "opponent-left", "own-left")).toMatchObject({ min: 63, max: 75 });
    expect(fakeOut.facts).not.toContain("Assumes the attacker's first turn in battle.");
    const plain = await turn(U, { "own-left": kangaskhan, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(plain.facts).toContain("Assumes the attacker's first turn in battle.");
  });

  it("keeps a signature Z-Move's own effects: paralysis, selfBoost and terrain", async () => {
    // ZS21: Stoked Sparksurfer paralyses: Snorlax is fully paralysed a quarter of the time: Raichu 135 → 29-135, average 61.78125.
    const surfer = await turn(U, { "own-left": { id: "raichualola", ability: "surgesurfer", item: "aloraichiumz", z: true, move: "thunderbolt", target: "opponent-left" }, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(surfer.hp["own-left"]).toMatchObject({ start: 135, min: 29, max: 135, average: 61.78125 });
    // ZS09: Clangorous Soulblaze +1 every stat: Venusaur's Sludge Bomb deals 33-40 into Kommo-o 150 → 110-117.
    const soulblaze = await turn(U, { "own-left": { id: "kommoo", ability: "overcoat", item: "kommoniumz", z: true, move: "clangingscales" }, "own-right": snorlax, "opponent-left": { id: "venusaur", ability: "overgrow", move: "sludgebomb", target: "own-left" }, "opponent-right": blissey() });
    expect(hit(soulblaze, "opponent-left", "own-left")).toMatchObject({ min: 33, max: 40 });
    expect(soulblaze.hp["own-left"]).toMatchObject({ low: 117, high: 110, average: 113.5 });
    // ZS10 / ZS18: Genesis Supernova sets Psychic Terrain, also as it knocks its target out: Slowbro's Psychic 70-84 (1.5x).
    const slowbro: Slot = { id: "slowbro", ability: "oblivious", move: "psychic", target: "opponent-right" };
    const mew: Slot = { id: "mew", ability: "synchronize", item: "mewniumz", z: true, move: "psychic", target: "opponent-left" };
    const genesis = await turn(U, { "own-left": mew, "own-right": slowbro, "opponent-left": blissey(), "opponent-right": snorlax });
    expect(hit(genesis, "own-right", "opponent-right")).toMatchObject({ min: 70, max: 84 });
    expect(genesis.hp["opponent-right"]).toMatchObject({ min: 151, max: 165, average: 158.25 });
    const knocked = await turn(U, { "own-left": mew, "own-right": slowbro, "opponent-left": { id: "venusaur", ability: "overgrow", hp: 40 }, "opponent-right": snorlax });
    expect(hit(knocked, "own-right", "opponent-right")).toMatchObject({ min: 70, max: 84 });
    // ZS11: Splintered Stormshards ends Psychic Terrain: Slowbro's Psychic 48-57.
    const shards = await turn(U, { "own-left": { id: "lycanroc", ability: "keeneye", item: "lycaniumz", z: true, move: "stoneedge", target: "opponent-left" }, "own-right": slowbro, "opponent-left": { id: "toxapex", ability: "regenerator" }, "opponent-right": snorlax }, { terrain: "Psychic" });
    expect(hit(shards, "own-right", "opponent-right")).toMatchObject({ min: 48, max: 57 });
    expect(shards.hp["opponent-right"]).toMatchObject({ min: 178, max: 187, average: 183.1875 });
  });

  it("a Max Move: no burn from Max Flare, no onTry for Max Darkness, no tracksTarget for Max Geyser (Sword / Shield)", async () => {
    const S: BattleGame = "sword_shield";
    // ZS14: Snorlax's Body Slam 64-76 into the Dynamaxed Charizard.
    const flare = await turn(S, { "own-left": { id: "charizard", ability: "blaze", dynamax: true, move: "inferno", target: "opponent-left" }, "own-right": venusaur, "opponent-left": bodySlam("own-left"), "opponent-right": blastoise });
    expect(hit(flare, "opponent-left", "own-left")).toMatchObject({ min: 64, max: 76 });
    // ZS23: Max Darkness lands on the idle Slowbro: 156-186, out at 0.5625.
    const darkness = await turn(S, { "own-left": { id: "absol", ability: "pressure", dynamax: true, move: "suckerpunch", target: "opponent-left" }, "own-right": venusaur, "opponent-left": { id: "slowbro", ability: "oblivious" }, "opponent-right": snorlax });
    expect(hit(darkness, "own-left", "opponent-left")).toMatchObject({ min: 156, max: 186 });
    expect(darkness.hp["opponent-left"]!.koChance).toBeCloseTo(0.5625, 12);
    // ZS24: Gastrodon's Storm Drain takes Max Geyser (+1 Sp. Atk); Snorlax is not hit.
    const geyser = await turn(S, { "own-left": { id: "inteleon", ability: "torrent", dynamax: true, move: "snipeshot", target: "opponent-left" }, "own-right": venusaur, "opponent-left": snorlax, "opponent-right": { id: "gastrodon", ability: "stormdrain" } });
    expect(hit(geyser, "own-left", "opponent-right")).toMatchObject({ kind: "blocked" });
    expect(geyser.hp["opponent-left"]).toMatchObject({ start: 235, low: 235, high: 235 });
  });
});
