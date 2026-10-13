import { describe, expect, it } from "vitest";
import { tracksItems } from "@/app/lib/battle/doubles-guards";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 wave 1a, Track D (SPEC2 §4.5, ADDENDUM2 §4.2; guards.md §4.4–§4.6, §6): the hidden accuracy and evasion stages in
 * Stored Power, Power Trip and Punishment; Glaive Rush's ×2 until its holder's next BeforeMove (C5); Ripen's weakened Berry
 * used up by one hit; an Encore that changes the queued move (PS/sim/battle-actions.ts:223-234); the one-hit KO moves'
 * immunities; Fling's own failures; the item history's readers. Every number is the pinned Showdown oracle's
 * (scripts/.cache/calc-audit/status2/build/w1a-d-cases.ts).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; hp?: number; evs?: Partial<Record<Stat, number>>; boosts?: Partial<Record<CombatStat, number>>;
  carried?: DoublesCarried; move: string | null; target?: DoublesSlotId; lastMove?: string | null; moves?: string[];
} | null;
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));

function buildOf(runtime: BattleRuntime, m: NonNullable<Mon>): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts },
    currentHP: m.hp ?? null, status: "",
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[]): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    if (!m) return [slot, null];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}), ...(m.lastMove !== undefined ? { lastMove: m.lastMove } : {}), ...(m.moves ? { moves: m.moves } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number, extra: Partial<NonNullable<Mon>> = {}): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null, ...extra });
const ready = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  return result;
};
const hitOf = (input: DoublesTurnInput, slot: DoublesSlotId, target: DoublesSlotId) => ready(input).steps.find((step) => step.slot === slot)!.hits.find((each) => each.slot === target)!;
const stepFacts = (input: DoublesTurnInput, slot: DoublesSlotId) => ready(input).steps.find((step) => step.slot === slot)!.facts.map((fact) => fact.text);

describe("status2 D: the hidden accuracy and evasion stages (guards.md §4.4)", () => {
  it("G4-STP-01-sv: Stored Power with +2 evasion from an earlier turn is 60 power (33–39)", async () => {
    const runtime = await game("scarlet_violet");
    const hit = hitOf(turn(runtime, [{ species: "espathra", ability: "opportunist", carried: { stages: { evasion: 2 } }, move: "storedpower", target: "opponent-left" }, lax(0), lax(4), lax(8)]), "own-left", "opponent-left");
    expect([hit.min, hit.max]).toEqual([33, 39]);
  });

  it("G4-STP-03-usum: Punishment counts the target's +2 evasion (100–118)", async () => {
    const runtime = await game("ultra_sun_ultra_moon");
    const hit = hitOf(turn(runtime, [{ species: "absol", ability: "justified", move: "punishment", target: "opponent-left" }, lax(0), lax(4, { carried: { stages: { evasion: 2 } } }), lax(8)]), "own-left", "opponent-left");
    expect([hit.min, hit.max]).toEqual([100, 118]);
  });

  it("G4-STP-04-swsh: Power Trip with +1 accuracy (37–45)", async () => {
    const runtime = await game("sword_shield");
    const hit = hitOf(turn(runtime, [{ species: "krookodile", ability: "intimidate", carried: { stages: { accuracy: 1 } }, move: "powertrip", target: "opponent-left" }, lax(0), lax(4), lax(8)]), "own-left", "opponent-left");
    expect([hit.min, hit.max]).toEqual([37, 45]);
  });
});

describe("status2 D: Glaive Rush (C5) and Ripen's weakened Berry", () => {
  it("G4-GLV-01-sv: after Glaive Rush, a slower foe's Body Slam deals 2x (114–134)", async () => {
    const runtime = await game("scarlet_violet");
    const hit = hitOf(turn(runtime, [{ species: "baxcalibur", ability: "thermalexchange", evs: { spe: 252 }, move: "glaiverush", target: "opponent-left" }, lax(0), lax(4), lax(8, { move: "bodyslam", target: "own-left" })]), "opponent-right", "own-left");
    expect([hit.min, hit.max]).toEqual([114, 134]);
  });

  it("G4-GLV-02-sv: a Glaive Rush from last turn: 2x before its BeforeMove (Thunderbolt 62–74), normal after it (Body Slam 57–67)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "baxcalibur", ability: "thermalexchange", carried: { glaiveRush: true }, move: "dragonclaw", target: "opponent-left" }, lax(0),
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, move: "thunderbolt", target: "own-left" }, lax(4, { move: "bodyslam", target: "own-left" }),
    ]);
    const bolt = hitOf(input, "opponent-left", "own-left"), slam = hitOf(input, "opponent-right", "own-left");
    expect([bolt.min, bolt.max]).toEqual([62, 74]);
    expect([slam.min, slam.max]).toEqual([57, 67]);
  });

  it("D-RIP-01-sv: a weakened Berry from before halves the first hit only (Tackle 6–8, then 30–36)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "appletun", ability: "ripen", carried: { berryWeaken: true }, move: null }, lax(0),
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, move: "tackle", target: "own-left" }, lax(4, { move: "tackle", target: "own-left" }),
    ]);
    const first = hitOf(input, "opponent-left", "own-left"), second = hitOf(input, "opponent-right", "own-left");
    expect([first.min, first.max]).toEqual([6, 8]);
    expect([second.min, second.max]).toEqual([30, 36]);
  });
});

describe("status2 D: an Encore that changes the queued move (guards.md §6)", () => {
  it("G4-ENC-01-sv: Prankster Encore on a foe whose last move was Protect: it uses Protect (at its Thunderbolt's priority)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "whimsicott", ability: "prankster", move: "encore", target: "opponent-left" }, lax(0, { move: "bodyslam", target: "opponent-left" }),
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, lastMove: "protect", moves: ["protect"], move: "thunderbolt", target: "own-left" }, lax(4),
    ]);
    expect(stepFacts(input, "opponent-left")).toContain("Encore: Jolteon uses Protect.");
    const slam = hitOf(input, "own-right", "opponent-left");
    expect(slam.kind).toBe("blocked");
    expect(ready(input).hp["opponent-left"]!.min).toBe(ready(input).hp["opponent-left"]!.start);
  });

  it("G4-ENC-02-sv: with one foe left the encored Ice Beam goes to it (94–112)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "whimsicott", ability: "prankster", move: "encore", target: "opponent-left" }, null,
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, lastMove: "icebeam", moves: ["icebeam"], move: "thunderbolt", target: "own-left" }, lax(4),
    ]);
    expect(stepFacts(input, "opponent-left")).toContain("Encore: Jolteon uses Ice Beam.");
    const beam = hitOf(input, "opponent-left", "own-left");
    expect([beam.min, beam.max]).toEqual([94, 112]);
  });

  it("an encored single-target move with two foes to pick from: one world per foe (integration 1a: the kernel runs every rewrite)", async () => {
    const runtime = await game("scarlet_violet");
    const result = calculateDoublesTurn(turn(runtime, [
      { species: "whimsicott", ability: "prankster", move: "encore", target: "opponent-left" }, lax(0),
      { species: "jolteon", ability: "voltabsorb", evs: { spe: 252 }, lastMove: "icebeam", moves: ["icebeam"], move: "thunderbolt", target: "own-left" }, lax(4),
    ]));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const step = result.steps.find((each) => each.slot === "opponent-left")!;
    // getRandomTarget: either living foe at 1/2 (G4-ENC-01-sv agrees with pinned Showdown).
    expect(step.hits.find((hit) => hit.slot === "own-left")!.reached).toBeCloseTo(0.5, 9);
    expect(step.hits.find((hit) => hit.slot === "own-right")!.reached).toBeCloseTo(0.5, 9);
  });
});

describe("status2 D: one-hit KO moves' immunities (guards.md §4.6) and Fling's own Try (§4.5)", () => {
  it("G4-OHK-02-sv: Sheer Cold into an Ice type is [ohko] immune", async () => {
    const runtime = await game("scarlet_violet");
    const hit = hitOf(turn(runtime, [{ species: "lapras", ability: "waterabsorb", move: "sheercold", target: "opponent-left" }, lax(0), { species: "glalie", ability: "innerfocus", move: null }, lax(8)]), "own-left", "opponent-left");
    expect(hit.kind).toBe("no-damage");
    expect(hit.facts.map((fact) => fact.text)).toContain("Glalie is immune to Sheer Cold.");
  });

  it("D-OHK-STURDY-sv: Sturdy stops a one-hit KO move in TryHit", async () => {
    const runtime = await game("scarlet_violet");
    const hit = hitOf(turn(runtime, [{ species: "excadrill", ability: "sandrush", move: "fissure", target: "opponent-left" }, lax(0), { species: "bastiodon", ability: "sturdy", move: null }, lax(8)]), "own-left", "opponent-left");
    expect(hit.facts.map((fact) => fact.text)).toContain("Sturdy: Bastiodon is immune.");
  });

  it("D-OHK-LEVITATE-usum: Fissure into Levitate and Horn Drill into a Ghost type: immune", async () => {
    const runtime = await game("ultra_sun_ultra_moon");
    const input = turn(runtime, [
      { species: "rhydon", ability: "lightningrod", move: "fissure", target: "opponent-left" }, { species: "rhydon", ability: "lightningrod", move: "horndrill", target: "opponent-right" },
      { species: "bronzong", ability: "levitate", move: null }, { species: "gengar", ability: "cursedbody", move: null },
    ]);
    expect(hitOf(input, "own-left", "opponent-left").facts.map((fact) => fact.text)).toContain("Bronzong is immune to Fissure.");
    expect(hitOf(input, "own-right", "opponent-right").facts.map((fact) => fact.text)).toContain("Gengar is immune to Horn Drill.");
  });

  it("D-FLG-01-sv: Fling fails with Klutz and with no item", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "golurk", ability: "klutz", item: "lifeorb", move: "fling", target: "opponent-left" }, { species: "sneasler", ability: "poisontouch", move: "fling", target: "opponent-right" },
      lax(4), lax(8),
    ]);
    expect(stepFacts(input, "own-left")).toContain("Fling fails: Golurk has Klutz.");
    expect(stepFacts(input, "own-right")).toContain("Fling fails: Sneasler has no item.");
  });
});

describe("status2 D: the item history's readers (SPEC2 §4.9)", () => {
  it("tracksItems: a Harvest, Pickup, Symbiosis or Cud Chew holder, a Recycle or Fling user; none otherwise", async () => {
    const runtime = await game("scarlet_violet");
    const plain = [lax(0), lax(4), lax(8), lax(12)];
    expect(tracksItems(turn(runtime, plain))).toBe(false);
    expect(tracksItems(turn(runtime, [{ species: "exeggutor", ability: "harvest", move: null }, lax(4), lax(8), lax(12)]))).toBe(true);
    expect(tracksItems(turn(runtime, [lax(0), lax(4), { species: "tauros", ability: "cudchew", move: null }, lax(12)]))).toBe(true);
    expect(tracksItems(turn(runtime, [lax(0), lax(4), lax(8, { move: "recycle" }), lax(12)]))).toBe(true);
  });
});
