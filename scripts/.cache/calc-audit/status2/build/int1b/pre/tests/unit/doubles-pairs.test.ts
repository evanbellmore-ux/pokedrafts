import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { WIRED, bandedLoss } from "@/app/lib/battle/doubles-pairs";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * Track W (status2 ADDENDUM2 §2.3 #6, #16-#20, #50; tier2-moves.md §3.5, §3.14-§3.18, §3.27): the pair's environment in the
 * 2v2 turn, against pinned Showdown c23d2e94 (scripts/.cache/calc-audit/status2/build/W1A-W.md: each number below is the
 * oracle's, sim-dfs.ts over the same turn; ids W-… there, T2M-… in V's cases). Level 50, 31 IVs, Serious nature, 0 EVs unless
 * set (Champions: Stat Points). The parts behind a kernel line W asked the integrator for run once its flag is set
 * (doubles-pairs.ts WIRED); until then their fallback keeps today's text.
 */
type P = {
  id: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  hp?: number; status?: BattleStatus; move?: string | null; target?: DoublesSlotId; carried?: DoublesCarried; build?: Partial<BattleBuild>;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = { champions: championsRuntime };
const GAMES = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" } as const;
async function game(id: keyof typeof GAMES) {
  const key = GAMES[id];
  return runtimes[key] ??= await loadBattleRuntime(key);
}
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
function buildOf(p: P, runtime: BattleRuntime): BattleBuild {
  const base = createBuild(p.id, runtime);
  const shared = {
    nature: p.nature ?? "Serious", abilityId: p.ability, abilityActive: defaultAbilityActive(p.ability), itemId: p.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: p.hp ?? null, status: p.status ?? "",
  };
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...p.evs } }
    : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...p.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } };
  return { ...build, ...p.build } as BattleBuild;
}
type Sides = { own?: { safeguard?: boolean }; opponent?: { safeguard?: boolean } };
function turn(runtime: BattleRuntime, slots: Record<DoublesSlotId, P | null>, field: { terrain?: "" | "Psychic" } & Sides = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = { build: buildOf(p, runtime), contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const side = (s?: { safeguard?: boolean }) => ({ ...createSide(), ...(s?.safeguard ? { safeguard: true } : {}) });
  return {
    runtime, pokemon, canSwitch: { own: true, opponent: true },
    field: { ...createConditions(), gameType: "Doubles", terrain: field.terrain ?? "", attackerSide: side(field.own), defenderSide: side(field.opponent) },
  };
}
const lax = (spe: number, extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", evs: { spe }, ...extra });
function ready(input: DoublesTurnInput): Extract<DoublesTurnResult, { status: "ready" }> {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "not-estimated" ? result.reason : result.status === "issues" ? result.issues : "")).toBe("ready");
  return result as Extract<DoublesTurnResult, { status: "ready" }>;
}
function reason(input: DoublesTurnInput): string {
  const result = calculateDoublesTurn(input);
  expect(result.status).toBe("not-estimated");
  return result.status === "not-estimated" ? result.reason : "";
}
/** The HP the oracle gives: start, min, max, KO chance, average (exact over every outcome). */
function hp(result: Extract<DoublesTurnResult, { status: "ready" }>, slot: DoublesSlotId, min: number, max: number, ko: number, average: number) {
  const got = result.hp[slot]!;
  expect([got.min, got.max]).toEqual([min, max]);
  expect(got.koChance).toBeCloseTo(ko, 9);
  expect(got.average).toBeCloseTo(average, 9);
}
/** The mass of the E2 outcomes in which `slot` has `status`. */
function statusMass(input: DoublesTurnInput, slot: DoublesSlotId, status: BattleStatus): number {
  const outcomes = calculateDoublesOutcomes(input);
  expect(outcomes.status).toBe("ready");
  if (outcomes.status !== "ready") return NaN;
  return outcomes.outcomes.reduce((sum, outcome) => sum + (outcome.mons[slot]?.build.status === status ? outcome.chance : 0), 0);
}
const facts = (result: Extract<DoublesTurnResult, { status: "ready" }>, attacker: DoublesSlotId, target: DoublesSlotId) =>
  result.steps.find((step) => step.slot === attacker)!.hits.find((hit) => hit.slot === target)!.facts;

// ---- ally-effect (T2M §3.5): a priority move into the user's own ally ----
describe("a priority move into the user's own ally on Psychic Terrain, the ally with a priority shield", () => {
  it("lands (Psychic Terrain and Armor Tail, Dazzling stop only a foe's: W-ALE-01, -02)", async () => {
    const sv = await game("sv");
    hp(ready(turn(sv, {
      "own-left": { id: "pikachu", ability: "static", evs: { spe: 252 }, move: "quickattack", target: "own-right" }, "own-right": { id: "farigiraf", ability: "armortail" },
      "opponent-left": lax(32), "opponent-right": lax(40),
    }, { terrain: "Psychic" })), "own-right", 179, 182, 0, 180.6875);
    hp(ready(turn(championsRuntime, {
      "own-left": { id: "weavile", ability: "pressure", evs: { spe: 32 }, move: "iceshard", target: "own-right" }, "own-right": { id: "farigiraf", ability: "armortail" },
      "opponent-left": lax(4), "opponent-right": lax(5),
    }, { terrain: "Psychic" })), "own-right", 152, 159, 0, 155.75);
    const usum = await game("usum");
    hp(ready(turn(usum, {
      "own-left": { id: "azumarill", ability: "hugepower", evs: { spe: 252 }, move: "aquajet", target: "own-right" }, "own-right": { id: "bruxish", ability: "dazzling" },
      "opponent-left": lax(32), "opponent-right": lax(40),
    }, { terrain: "Psychic" })), "own-right", 122, 125, 0, 123.625);
  });
});

// ---- focus-band (T2M §3.14) ----
describe("Focus Band", () => {
  it("keeps 1 HP in 1/10 of each knocking hit, in every game (O1, O1b: W-FB-01, -02)", async () => {
    const sv = await game("sv");
    const claw = (runtime: BattleRuntime, points: boolean) => turn(runtime, {
      "own-left": { id: "garchomp", ability: "roughskin", evs: { atk: points ? 32 : 252, spe: points ? 32 : 252 }, move: "dragonclaw", target: "opponent-left" }, "own-right": lax(points ? 3 : 24),
      "opponent-left": lax(points ? 4 : 32, { item: "focusband", hp: 30 }), "opponent-right": lax(points ? 5 : 40),
    });
    for (const [runtime, points] of [[sv, false], [championsRuntime, true]] as const) {
      const result = ready(claw(runtime, points));
      hp(result, "opponent-left", 0, 1, 0.9, 0.1);
      // Its fact: a ninth of the knocked-out mass (kernel line L2).
      if (WIRED.hurt) expect(facts(result, "own-left", "opponent-left")).toContainEqual({ text: "Focus Band: Snorlax (opponent's, 1) keeps 1 HP.", chance: expect.closeTo(0.1, 9) });
    }
    hp(ready(turn(sv, {
      "own-left": { id: "corviknight", ability: "pressure", nature: "Adamant", evs: { atk: 252, spe: 252 }, move: "dualwingbeat", target: "opponent-left" }, "own-right": lax(24),
      "opponent-left": lax(32, { item: "focusband", hp: 20 }), "opponent-right": lax(40),
    })), "opponent-left", 0, 1, 0.99, 0.01);
    const usum = await game("usum");
    hp(ready(turn(usum, {
      "own-left": { id: "hitmonlee", ability: "limber", evs: { atk: 252, spe: 252 }, move: "doublekick", target: "opponent-left" }, "own-right": lax(24),
      "opponent-left": lax(32, { item: "focusband", hp: 12 }), "opponent-right": lax(40),
    })), "opponent-left", 0, 1, 0.99, 0.01);
  });

  it("acts per target of a spread move (W-FB-04)", async () => {
    const result = ready(turn(await game("sv"), {
      "own-left": { id: "garchomp", ability: "roughskin", evs: { atk: 252, spe: 252 }, move: "earthquake" }, "own-right": { id: "corviknight", ability: "pressure" },
      "opponent-left": lax(32, { item: "focusband", hp: 30 }), "opponent-right": lax(40, { item: "focusband", hp: 40 }),
    }));
    hp(result, "opponent-left", 0, 1, 0.9, 0.1);
    hp(result, "opponent-right", 0, 1, 0.9, 0.1);
  });

  it("holds a confusion self-hit 1/10 where it knocks out (T2-FB01: W-FB-03)", async () => {
    const input = (runtime: BattleRuntime) => turn(runtime, {
      "own-left": lax(252, { item: "focusband", hp: 10, move: "bodyslam", target: "opponent-left", carried: { confusion: { attempts: 1 } } }), "own-right": lax(24),
      "opponent-left": lax(32), "opponent-right": lax(40),
    });
    for (const runtime of [await game("sv"), await game("swsh")]) {
      if (!WIRED.selfHitBand) { expect(reason(input(runtime))).toBe("Focus Band is not modelled."); continue; }
      const result = ready(input(runtime));
      hp(result, "own-left", 0, 10, 0.22275, 7.54975);
      expect(result.hp["own-left"]!.losses).toContainEqual({ text: "Focus Band: Snorlax (yours, 1) keeps 1 HP.", chance: expect.closeTo(0.02475, 9) });
    }
  });

  it("bandedLoss: a banded loss (< 0) keeps 1 HP where its damage would knock out", () => {
    expect(bandedLoss(-30, 10, 30)).toBe(9);
    expect(bandedLoss(-5, 10, 5)).toBe(5);
    expect(bandedLoss(30, 10, 30)).toBe(30);
    // After Sturdy at full HP the damage is already hp − 1.
    expect(bandedLoss(-300, 235, 234)).toBe(234);
  });
});

// ---- safeguard-damaging-status (T2M §3.27) ----
describe("Safeguard against a damaging move's status", () => {
  it("set this turn keeps a foe's Nuzzle's paralysis off; an Infiltrator foe's Inferno burns through it (W-SG-01)", async () => {
    const input = turn(await game("sv"), {
      "own-left": { id: "florges", ability: "flowerveil", evs: { spe: 252 }, move: "safeguard" }, "own-right": lax(0),
      "opponent-left": { id: "pachirisu", ability: "runaway", move: "nuzzle", target: "own-right" }, "opponent-right": { id: "chandelure", ability: "infiltrator", move: "inferno", target: "own-left" },
    });
    hp(ready(input), "own-right", 223, 226, 0, 225.0625);
    expect(statusMass(input, "own-right", "par")).toBe(0);
    expect(statusMass(input, "own-left", "brn")).toBeCloseTo(1, 9);
  });

  it("from an earlier turn keeps an ally's move's status off too (target !== source: W-SG-02), and a foe's in Champions (W-SG-03)", async () => {
    const input = turn(await game("sv"), {
      "own-left": { id: "raichu", ability: "static" }, "own-right": { id: "pikachu", ability: "static", evs: { spe: 252 }, move: "nuzzle", target: "own-left" },
      "opponent-left": lax(32), "opponent-right": lax(40),
    }, { own: { safeguard: true } });
    hp(ready(input), "own-left", 128, 129, 0, 128.9375);
    expect(statusMass(input, "own-left", "par")).toBe(0);
    const champions = turn(championsRuntime, {
      "own-left": { id: "pikachu", ability: "static", evs: { spe: 32 }, move: "nuzzle", target: "opponent-left" }, "own-right": { id: "milotic", ability: "marvelscale", move: "scald", target: "opponent-right" },
      "opponent-left": lax(4), "opponent-right": lax(5),
    }, { opponent: { safeguard: true } });
    hp(ready(champions), "opponent-left", 222, 225, 0, 223.4375);
    expect(statusMass(champions, "opponent-left", "par")).toBe(0);
  });
});

describe("Safeguard on the user's side against the target's Spicy Spray", () => {
  it("keeps the burn off the user (spicyspray: source.trySetStatus: W-SGX-01); today's text until the calculation reads the side", () => {
    const input = turn(championsRuntime, {
      "own-left": { id: "garchomp", ability: "roughskin", evs: { spe: 32 }, move: "dragonclaw", target: "opponent-left" }, "own-right": lax(1),
      "opponent-left": { id: "scovillainmega", ability: "spicyspray", item: "scovillainite" }, "opponent-right": lax(2),
    }, { own: { safeguard: true } });
    if (!WIRED.attackerSafeguard) { expect(reason(input)).toBe("Spicy Spray with Safeguard is not modelled in 2v2."); return; }
    ready(input);
    expect(statusMass(input, "own-left", "brn")).toBe(0);
  });
});

// ---- assurance-own-hp (T2M §3.18) ----
describe("Assurance after its target's own move hurt it", () => {
  it("doubles after the target's recoil and its Life Orb (T2-AS01: W-AS-01, -02)", async () => {
    const sv = await game("sv");
    hp(ready(turn(sv, {
      "own-left": lax(0), "own-right": { id: "kingambit", ability: "defiant", move: "assurance", target: "opponent-left" },
      "opponent-left": { id: "arcanine", ability: "intimidate", evs: { spe: 252 }, move: "flareblitz", target: "own-left" }, "opponent-right": lax(32),
    })), "opponent-left", 20, 43, 0, 31.75);
    hp(ready(turn(championsRuntime, {
      "own-left": lax(0), "own-right": { id: "incineroar", ability: "blaze", move: "assurance", target: "opponent-left" },
      "opponent-left": { id: "garchomp", ability: "roughskin", item: "lifeorb", evs: { spe: 32 }, move: "dragonclaw", target: "own-left" }, "opponent-right": lax(4),
    })), "opponent-left", 71, 86, 0, 78.5625);
  });

  it("reads the target's Rocky Helmet, and no loss from a drain with none (W-AS-03, -04; kernel line L2)", async () => {
    const sv = await game("sv");
    const helmet = turn(sv, {
      "own-left": lax(0, { item: "rockyhelmet" }), "own-right": { id: "kingambit", ability: "defiant", move: "assurance", target: "opponent-left" },
      "opponent-left": { id: "garchomp", ability: "roughskin", evs: { spe: 252 }, move: "dragonclaw", target: "own-left" }, "opponent-right": lax(32),
    });
    const drain = turn(sv, {
      "own-left": lax(0), "own-right": { id: "kingambit", ability: "defiant", move: "assurance", target: "opponent-left" },
      "opponent-left": { id: "conkeldurr", ability: "guts", evs: { spe: 252 }, hp: 100, move: "drainpunch", target: "own-left" }, "opponent-right": lax(32),
    });
    if (!WIRED.hurt) {
      // Without the step's target the Pokémon's own record cannot tell: today's text.
      expect(reason(helmet)).toBe("Assurance is not modelled in 2v2.");
      expect(reason(drain)).toBe("Assurance is not modelled in 2v2.");
      return;
    }
    hp(ready(helmet), "opponent-left", 44, 60, 0, 52.625);
    hp(ready(drain), "opponent-left", 153, 157, 0, 155);
  });
});

// ---- gale-wings-gen7 (T2M §3.17) and Gale Wings at the HP it has ----
describe("the priority a Gale Wings move is used with", () => {
  it("USUM keeps the priority sorted at the turn's start (T2-GW01-usum: W-GW-01, -02)", async () => {
    const usum = await game("usum");
    const shielded = turn(usum, {
      "own-left": { id: "talonflame", ability: "galewings", evs: { spe: 252 }, move: "bravebird", target: "opponent-left" }, "own-right": lax(8),
      "opponent-left": { id: "bruxish", ability: "dazzling" }, "opponent-right": { id: "dragonite", ability: "innerfocus", move: "extremespeed", target: "own-left" },
    });
    const healed = turn(usum, {
      "own-left": { id: "talonflame", ability: "galewings", evs: { spe: 252 }, hp: 100, move: "bravebird", target: "opponent-left" }, "own-right": { id: "comfey", ability: "triage", move: "floralhealing", target: "own-left" },
      "opponent-left": lax(0), "opponent-right": lax(8),
    }, { terrain: "Psychic" });
    if (!WIRED.frozenContext) { expect(reason(shielded)).toBe("Gale Wings is not modelled in 2v2."); return; }
    const blocked = ready(shielded);
    hp(blocked, "own-left", 92, 102, 0, 97.0625);
    expect(blocked.hp["opponent-left"]!.max).toBe(blocked.hp["opponent-left"]!.start);
    hp(ready(healed), "opponent-left", 139, 154, 0, 147.0625);
  });

  it("generation 9 re-sorts: a Talonflame hit before it moves has no priority (T2-GW01-sv: W-GW-01-sv, W-GW-03-sv)", async () => {
    if (!WIRED.frozenContext) return;
    const sv = await game("sv");
    hp(ready(turn(sv, {
      "own-left": { id: "talonflame", ability: "galewings", evs: { spe: 252 }, move: "bravebird", target: "opponent-left" }, "own-right": lax(8),
      "opponent-left": { id: "farigiraf", ability: "armortail" }, "opponent-right": { id: "dragonite", ability: "innerfocus", move: "extremespeed", target: "own-left" },
    })), "opponent-left", 104, 119, 0, 111.375);
    hp(ready(turn(sv, {
      "own-left": { id: "talonflame", ability: "galewings", evs: { spe: 252 }, move: "bravebird", target: "opponent-left" }, "own-right": lax(8),
      "opponent-left": lax(0), "opponent-right": { id: "dragonite", ability: "innerfocus", move: "extremespeed", target: "own-left" },
    }, { terrain: "Psychic" })), "opponent-left", 139, 154, 0, 147.0625);
  });
});

// ---- berry-between-hits (T2M §3.15) ----
describe("a Berry between the hits of one move", () => {
  const wingbeat = (runtime: BattleRuntime, target: P, attacker: P = { id: "corviknight", ability: "pressure", nature: "Adamant", evs: { atk: 252, spe: 252 } }) => turn(runtime, {
    "own-left": { ...attacker, move: "dualwingbeat", target: "opponent-left" }, "own-right": lax(8), "opponent-left": target, "opponent-right": lax(16),
  });

  it("is today's text until the continuation's kernel line is in", async () => {
    if (WIRED.continuation) return;
    expect(reason(wingbeat(await game("sv"), lax(0, { item: "ganlonberry", hp: 104 })))).toBe("Ganlon Berry between the hits of Dual Wingbeat is not modelled in 2v2.");
  });

  it("Ganlon after hit 1: hit 2 reads +1 Defense (T2-BE01: W-BE-01), and Bonemerang in USUM (W-BE-03)", async () => {
    if (!WIRED.continuation) return;
    const result = ready(wingbeat(await game("sv"), lax(0, { item: "ganlonberry", hp: 104 })));
    hp(result, "opponent-left", 10, 30, 0, 20.02734375);
    expect(facts(result, "own-left", "opponent-left")).toContainEqual({ text: "Snorlax (opponent's, 1) eats its Ganlon Berry after hit 1: +1 Defense.", chance: expect.closeTo(0.4375, 9) });
    hp(ready(turn(await game("usum"), {
      "own-left": { id: "marowakalola", ability: "rockhead", item: "thickclub", evs: { atk: 252, spe: 252 }, move: "bonemerang", target: "opponent-left" }, "own-right": lax(8),
      "opponent-left": lax(0, { item: "ganlonberry", hp: 100 }), "opponent-right": lax(16),
    })), "opponent-left", 0, 2, 0.98046875, 0.0234375);
  });

  it("Starf after hit 1: one of five stats +2 at random (T2-BE02: W-BE-02)", async () => {
    if (!WIRED.continuation) return;
    const sv = ready(wingbeat(await game("sv"), lax(0, { item: "starfberry", hp: 100 })));
    hp(sv, "opponent-left", 2, 37, 0, 14.375);
    const starf = facts(sv, "own-left", "opponent-left").filter((fact) => fact.text.includes("Starf Berry after hit 1"));
    expect(starf.map((fact) => fact.text.replace(/^.*: /, ""))).toEqual(["+2 Attack.", "+2 Defense.", "+2 Sp. Atk.", "+2 Sp. Def.", "+2 Speed."]);
    for (const fact of starf) expect(fact.chance).toBeCloseTo(0.2, 9);
    hp(ready(wingbeat(await game("swsh"), lax(0, { item: "starfberry", hp: 110 }), { id: "dragonite", ability: "innerfocus", nature: "Adamant", evs: { atk: 252, spe: 252 } })),
      "opponent-left", 0, 27, 0.8, 3.775);
  });

  it("Lansat with Cheek Pouch heals a third between the hits (W-BE-04); Apicot before a knockout (W-BE-05)", async () => {
    if (!WIRED.continuation) return;
    hp(ready(wingbeat(await game("sv"), { id: "dedenne", ability: "cheekpouch", item: "lansatberry", hp: 50 }, { id: "corviknight", ability: "pressure", evs: { spe: 252 } })),
      "opponent-left", 59, 65, 0, 62.375);
    const swsh = wingbeat(await game("swsh"), lax(0, { item: "apicotberry", hp: 110 }), { id: "dragonite", ability: "innerfocus", nature: "Adamant", evs: { atk: 252, spe: 252 } });
    hp(ready(swsh), "opponent-left", 0, 0, 1, 0);
  });

  it("a random hit count: one world per count (T2M-BE-03-usum: Water Shuriken into Apicot at 80 HP)", async () => {
    if (!WIRED.continuation) return;
    hp(ready(turn(await game("usum"), {
      "own-left": { id: "greninja", ability: "torrent", evs: { spa: 252, spe: 252 }, move: "watershuriken", target: "opponent-right" }, "own-right": lax(8),
      "opponent-left": lax(24), "opponent-right": lax(16, { item: "apicotberry", hp: 80 }),
    })), "opponent-right", 24, 60, 0, 46.937109375);
  });

  it("keeps today's text where the stopped hits reach the recoil, a Shell Bell, or a user they knocked out (W-BEX-01, -02, -03)", async () => {
    if (!WIRED.continuation) return;
    expect(reason(turn(await game("usum"), {
      "own-left": { id: "kangaskhanmega", ability: "parentalbond", item: "kangaskhanite", evs: { atk: 252, spe: 252 }, move: "doubleedge", target: "opponent-left" }, "own-right": lax(8),
      "opponent-left": lax(0, { item: "ganlonberry", hp: 200 }), "opponent-right": lax(16),
    }))).toBe("Ganlon Berry between the hits of Double-Edge is not modelled in 2v2.");
    const sv = await game("sv");
    expect(reason(wingbeat(sv, lax(0, { item: "ganlonberry", hp: 100 }), { id: "corviknight", ability: "pressure", item: "shellbell", nature: "Adamant", evs: { atk: 252, spe: 252 }, hp: 100 })))
      .toBe("Ganlon Berry between the hits of Dual Wingbeat is not modelled in 2v2.");
    expect(reason(wingbeat(sv, { id: "garchomp", ability: "roughskin", item: "ganlonberry", hp: 60 }, { id: "corviknight", ability: "pressure", nature: "Adamant", evs: { atk: 252, spe: 252 }, hp: 15 })))
      .toBe("Ganlon Berry between the hits of Dual Wingbeat is not modelled in 2v2.");
  });
});

// ---- aria-faint (T2M §3.16) ----
describe("Sparkling Aria's cure after its user faints", () => {
  const aria = async (user: Partial<P>, target: Partial<P>, single = false) => turn(await game("sv"), {
    "own-left": { id: "primarina", ability: "torrent", evs: { spe: 252 }, move: "sparklingaria", ...user }, "own-right": single ? null : lax(0, { move: "protect" }),
    "opponent-left": lax(32, { status: "brn", ...target }), "opponent-right": single ? null : lax(24, { move: "protect" }),
  });

  it("cures nothing after a faint in the hits: a Rowap Berry with no Life Orb (T2-AR02: W-AR-02), Destiny Bond (W-AR-06)", async () => {
    const rowap = await aria({ hp: 5 }, { item: "rowapberry" });
    hp(ready(rowap), "opponent-left", 159, 171, 0, 165.4375);
    expect(statusMass(rowap, "opponent-left", "brn")).toBeCloseTo(1, 9);
    const bond = turn(await game("sv"), {
      "own-left": { id: "primarina", ability: "torrent", item: "lifeorb", evs: { spe: 252 }, move: "sparklingaria" }, "own-right": lax(0, { move: "protect" }),
      "opponent-left": lax(32, { status: "brn" }), "opponent-right": lax(24, { hp: 10, carried: { destinyBond: true } }),
    });
    const result = ready(bond);
    hp(result, "own-left", 0, 0, 1, 0);
    hp(result, "opponent-left", 169, 180, 0, 175.1875);
    expect(statusMass(bond, "opponent-left", "brn")).toBeCloseTo(1, 9);
  });

  it("cures after a Life Orb knockout, not after a Rowap one, spread or single (T2-AR01: W-AR-01, -03, -04, -05)", async () => {
    const lifeOrb = await aria({ item: "lifeorb", hp: 5 }, {});
    if (!WIRED.faintedInHits) { expect(reason(lifeOrb)).toBe("Sparkling Aria's burn cure after Primarina faints in the move is not modelled in 2v2."); return; }
    hp(ready(lifeOrb), "opponent-left", 136, 152, 0, 144.5);
    expect(statusMass(lifeOrb, "opponent-left", "brn")).toBe(0);
    const spread = await aria({ item: "lifeorb", hp: 5 }, { item: "rowapberry" });
    expect(statusMass(spread, "opponent-left", "brn")).toBeCloseTo(1, 9);
    const after = await aria({ item: "lifeorb", hp: 30 }, { item: "rowapberry" }, true);
    hp(ready(after), "opponent-left", 102, 125, 0, 113.875);
    expect(statusMass(after, "opponent-left", "brn")).toBe(0);
    const inHit = await aria({ item: "lifeorb", hp: 12 }, { item: "rowapberry" }, true);
    expect(statusMass(inHit, "opponent-left", "brn")).toBeCloseTo(1, 9);
  });
});
