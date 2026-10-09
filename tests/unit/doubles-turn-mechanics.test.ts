import { describe, expect, it } from "vitest";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleStatus, MoveContext, StatTable } from "@/app/lib/battle/types";

/**
 * How the turn behaves (SPEC §2–§4): validation, No move, order, skipped and failed moves, the turn facts and the 1v1 turn-order
 * assumptions a turn never prints. Values cite the pinned Showdown oracle case (scripts/.cache/calc-audit/2v2/verify/cases.ts,
 * results/<id>.json). Level 50, 31 IVs, Serious nature, 0 EVs / Stat Points unless set.
 */
type P = {
  id: string; ability?: string; item?: string; nature?: string; evs?: Partial<StatTable>; hp?: number; status?: BattleStatus;
  boosts?: Partial<BattleBuild["boosts"]>; move?: string | null; target?: DoublesSlotId; contexts?: Record<string, MoveContext>; build?: Partial<BattleBuild>;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
function turn(runtime: BattleRuntime, slots: Record<DoublesSlotId, P | null>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const trained = base.game === "champions" ? { points: { ...zero, ...p.evs } } : { native: { ...base.native!, evs: { ...zero, ...p.evs } } };
    const build = {
      ...base, ...trained, nature: p.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? base.itemId,
      currentHP: p.hp ?? null, status: p.status ?? "", boosts: { ...base.boosts, ...p.boosts }, ...p.build,
    } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: p.contexts ?? {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null } };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
function ready(result: DoublesTurnResult) {
  expect(result.status, result.status === "not-estimated" ? result.reason : result.status === "issues" ? JSON.stringify(result.issues) : "").toBe("ready");
  if (result.status !== "ready") throw new Error("not ready");
  return result;
}
const step = (result: Extract<DoublesTurnResult, { status: "ready" }>, slot: DoublesSlotId): DoublesStep => {
  const found = result.steps.find((s) => s.slot === slot);
  expect(found, `step ${slot}`).toBeDefined();
  return found!;
};
const texts = (facts: { text: string; chance: number }[]) => facts.map((f) => f.text);

const TURN_FACT = "Every move hits; no critical hits; added effects below 100% do not happen.";
const CRIT_FACT = "Every move hits and every damaging hit is critical; added effects below 100% do not happen.";
/** Step 0's stub fact, gone now that the end of turn is applied (status-eot SPEC §2.5). */
const END_FACT = "End-of-turn effects are not applied.";
const PROTECT_FACT = "Assumes no protecting move was used last turn.";
const FIRST_TURN_FACT = "Assumes the attacker's first turn in battle.";
const TRICK_ROOM_FACT = "Trick Room: slower Pokémon move first.";
/** 1v1 turn-order assumptions (calculate.ts turnOrderAgainstTarget, the Payback-after-Protect shortcut, Analytic's needs-context). */
const ONE_V_ONE = ["Assumes the target uses a 0-priority move.", "Payback: doubled power (the target protected first).", "Analytic: needs the Doubles turn order."];

// Champions defaults: Garchomp 122, Charizard 120, Venusaur 104 (4 Speed points), Blastoise 98, Snorlax 54.
const venusaur = (extra: Partial<P> = {}): P => idle("venusaur", { ability: "overgrow", evs: { spe: 4 }, ...extra });
const blastoise = (extra: Partial<P> = {}): P => idle("blastoise", { ability: "torrent", ...extra });

describe("validation (SPEC §4.1)", () => {
  const base = { "own-right": idle("charizard"), "opponent-left": venusaur(), "opponent-right": blastoise() };

  it("rejects a move the Pokémon does not learn, and a target that does not fit the move's rule", () => {
    const unlearned = calculateDoublesTurn(turn(championsRuntime, { "own-left": { id: "garchomp", move: "moonblast", target: "opponent-right" }, ...base }));
    expect(unlearned.status).toBe("issues");
    if (unlearned.status === "issues") expect(unlearned.issues.actions.map((a) => a.slot)).toContain("own-left");
    // Dragon Claw chooses a target: none given, itself, or a target on an automatic move are all issues.
    for (const action of [{ move: "dragonclaw" }, { move: "dragonclaw", target: "own-left" as const }, { move: "earthquake", target: "opponent-right" as const }]) {
      const result = calculateDoublesTurn(turn(championsRuntime, { "own-left": { id: "garchomp", ...action }, ...base }));
      expect(result.status, JSON.stringify(action)).toBe("issues");
      if (result.status === "issues") expect(result.issues.actions.map((a) => a.slot)).toContain("own-left");
    }
  });

  it("returns build and field issues per slot", () => {
    const result = calculateDoublesTurn(turn(championsRuntime, { "own-left": idle("garchomp", { hp: 999 }), ...base }));
    expect(result.status).toBe("issues");
    if (result.status === "issues") expect(result.issues.pokemon["own-left"]?.map((issue) => issue.field)).toContain("currentHP");
  });
});

describe("No move (SPEC C13)", () => {
  it("is ready with no steps when no slot has a move, every Pokémon at its start HP", () => {
    const result = ready(calculateDoublesTurn(turn(championsRuntime, { "own-left": idle("garchomp"), "own-right": idle("charizard"), "opponent-left": venusaur(), "opponent-right": blastoise() })));
    expect(result.steps).toEqual([]);
    for (const slot of SLOTS) {
      const hp = result.hp[slot]!;
      expect({ low: hp.low, high: hp.high, min: hp.min, max: hp.max, average: hp.average, koChance: hp.koChance }).toEqual({ low: hp.start, high: hp.start, min: hp.start, max: hp.start, average: hp.start, koChance: 0 });
    }
    expect(result.facts).toContain(TURN_FACT);
    expect(result.facts).not.toContain(END_FACT);
  });

  it("is not an attacking move for Sucker Punch (V17b)", () => {
    const result = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "kingambit", ability: "defiant", move: "suckerpunch", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": venusaur(), "opponent-right": idle("garchomp", { ability: "sandveil" }),
    })));
    expect(texts(step(result, "own-left").facts)).toContain("Sucker Punch fails: Garchomp has no attacking move.");
    expect(result.hp["opponent-right"]).toMatchObject({ low: 183, high: 183, koChance: 0 });
  });

  it("still acts at priority 0, so a Protect before it has an action after it (V36f, V36g)", () => {
    // Garchomp's No move is queued: Blastoise (98), the slowest Protect user, still protects.
    const kept = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "charizard", move: "protect" }, "own-right": idle("garchomp"), "opponent-left": venusaur({ move: "protect" }), "opponent-right": blastoise({ move: "protect" }),
    })));
    expect(kept.steps.map((s) => [s.slot, s.order])).toEqual([
      ["own-left", [{ position: 1, chance: 1 }]], ["opponent-left", [{ position: 2, chance: 1 }]], ["opponent-right", [{ position: 3, chance: 1 }]],
    ]);
    // Four Protects: Blastoise's is the last action of the turn and fails (data/moves.ts protect onPrepareHit queue.willAct()).
    const last = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "charizard", move: "protect" }, "own-right": { id: "garchomp", move: "protect" }, "opponent-left": venusaur({ move: "protect" }), "opponent-right": blastoise({ move: "protect" }),
    })));
    expect(step(last, "opponent-right").order).toEqual([{ position: 4, chance: 1 }]);
    expect(step(last, "opponent-right").facts.length).toBeGreaterThan(0);
    expect(step(kept, "opponent-right").facts.map((f) => f.text)).not.toEqual(step(last, "opponent-right").facts.map((f) => f.text));
  });
});

describe("order", () => {
  it("splits a speed tie evenly (V11)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const band = { id: "garchomp", ability: "sandveil", item: "choiceband", nature: "Jolly", evs: { atk: 252, spe: 252 } };
    const result = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...band, move: "dragonclaw", target: "opponent-right" }, "own-right": idle("snorlax", { ability: "thickfat", evs: { spe: 4 } }),
      "opponent-left": idle("venusaur", { ability: "overgrow", evs: { spe: 4 } }), "opponent-right": { ...band, move: "dragonclaw", target: "own-left" },
    })));
    for (const slot of ["own-left", "opponent-right"] as const) {
      expect(step(result, slot).order).toEqual([{ position: 1, chance: 0.5 }, { position: 2, chance: 0.5 }]);
      expect(step(result, slot).moves).toBeCloseTo(0.5, 12);
      expect(step(result, slot).skipped).toEqual([{ text: "Faints before it moves.", chance: 0.5 }]);
      // Half the time it faints, else it is untouched: low (ties to the higher HP) 183, high (ties to the lower) 0.
      expect(result.hp[slot]).toMatchObject({ start: 183, low: 183, high: 0, min: 0, max: 183, average: 91.5, koChance: 0.5, faintsBeforeMoving: 0.5 });
    }
  });

  it("re-sorts after every action from generation 8, and keeps the start order in generation 7 (V13)", async () => {
    for (const [game, airSlash, dragonClaw] of [["scarlet_violet", 2, 3], ["ultra_sun_ultra_moon", 3, 2]] as const) {
      const runtime = await loadBattleRuntime(game);
      const result = ready(calculateDoublesTurn(turn(runtime, {
        "own-left": { id: "whimsicott", ability: "prankster", move: "tailwind" }, "own-right": { id: "charizard", ability: "blaze", move: "airslash", target: "opponent-right" },
        "opponent-left": venusaur({ evs: { spe: 4 } }), "opponent-right": { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "own-right" },
      })));
      expect(step(result, "own-left").order, game).toEqual([{ position: 1, chance: 1 }]);
      expect(step(result, "own-right").order, game).toEqual([{ position: airSlash, chance: 1 }]);
      expect(step(result, "opponent-right").order, game).toEqual([{ position: dragonClaw, chance: 1 }]);
      expect(result.steps.map((s) => s.slot), game).toEqual(game === "scarlet_violet" ? ["own-left", "own-right", "opponent-right"] : ["own-left", "opponent-right", "own-right"]);
    }
  });
});

describe("Low and High are whole-turn scenarios (SPEC C9)", () => {
  it("can leave a Pokémon lower at Low than at High (V18a)", async () => {
    // Garchomp's lowest Dragon Claw (97) leaves the Quick Claw Snorlax at 100 HP alive, so its Body Slam hits back;
    // the highest (115) knocks it out first unless Quick Claw (20%) lets it move first.
    const sv = await loadBattleRuntime("scarlet_violet");
    const result = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "snorlax", ability: "thickfat", item: "quickclaw", hp: 100, evs: { spe: 4 }, move: "bodyslam", target: "opponent-right" },
      "own-right": idle("venusaur", { ability: "overgrow", evs: { spe: 4 } }), "opponent-left": idle("charizard", { ability: "blaze", nature: "Timid", evs: { spa: 252, spe: 252 } }),
      "opponent-right": { id: "garchomp", ability: "roughskin", nature: "Jolly", evs: { atk: 252, spe: 252 }, move: "dragonclaw", target: "own-left" },
    })));
    expect(result.hp["opponent-right"]).toMatchObject({ start: 183, low: 128, high: 183, min: 117, max: 183 });
    expect(result.hp["opponent-right"]!.average).toBeCloseTo(161.95625, 9);
    expect(result.hp["own-left"]!.koChance).toBeCloseTo(1, 12);
    expect(result.hp["own-left"]!.faintsBeforeMoving).toBeCloseTo(0.65, 9);
    expect(step(result, "own-left").order).toEqual([{ position: 1, chance: expect.closeTo(0.2, 9) }, { position: 2, chance: expect.closeTo(0.8, 9) }]);
  });
});

describe("skipped and failed moves", () => {
  it("names the reason a move is not used, with its chance", async () => {
    // V16g: Fake Out flinches Garchomp. V19a / V19b: full paralysis is 1/8 in Champions, 1/4 in SV.
    const fakeOut = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "incineroar", ability: "blaze", move: "fakeout", target: "opponent-right" }, "own-right": idle("charizard"),
      "opponent-left": venusaur(), "opponent-right": { id: "garchomp", ability: "sandveil", move: "dragonclaw", target: "own-right" },
    })));
    expect(step(fakeOut, "opponent-right").skipped).toEqual([{ text: "Flinches (Fake Out).", chance: 1 }]);
    expect(step(fakeOut, "opponent-right").moves).toBe(0);
    expect(fakeOut.hp["own-right"]).toMatchObject({ low: 153, high: 153, koChance: 0 });
    expect(fakeOut.facts).toContain(FIRST_TURN_FACT);
    const sv = await loadBattleRuntime("scarlet_violet");
    for (const [runtime, chance] of [[championsRuntime, 0.125], [sv, 0.25]] as const) {
      const result = ready(calculateDoublesTurn(turn(runtime, {
        "own-left": { id: "garchomp", ability: "sandveil", status: "par", move: "dragonclaw", target: "opponent-right" }, "own-right": idle("snorlax", { evs: { spe: 4 } }),
        "opponent-left": venusaur(), "opponent-right": blastoise(),
      })));
      expect(step(result, "own-left").skipped).toEqual([{ text: "Fully paralysed.", chance }]);
      expect(step(result, "own-left").moves).toBeCloseTo(1 - chance, 12);
    }
  });

  it("retargets a move aimed at a fainted foe, and fails one aimed at a fainted ally (V04, V05)", () => {
    const retarget = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "garchomp", ability: "sandveil", move: "dragonclaw", target: "opponent-left" }, "own-right": { id: "charizard", move: "flamethrower", target: "opponent-left" },
      "opponent-left": venusaur({ hp: 1 }), "opponent-right": blastoise(),
    })));
    expect(texts(step(retarget, "own-right").facts)).toContain("Venusaur fainted: Flamethrower hits Blastoise.");
    expect(step(retarget, "own-right").hits.map((h) => [h.slot, h.reached])).toEqual([["opponent-right", 1]]);
    expect(retarget.hp["opponent-right"]).toMatchObject({ low: 128, high: 123, min: 123, max: 128 });
    const ally = ready(calculateDoublesTurn(turn(championsRuntime, {
      "own-left": { id: "snorlax", ability: "thickfat", evs: { spe: 4 }, move: "bodyslam", target: "own-right" }, "own-right": idle("gengar", { hp: 1 }),
      "opponent-left": venusaur(), "opponent-right": { id: "weavile", ability: "pressure", move: "nightslash", target: "own-right" },
    })));
    expect(step(ally, "own-left").hits).toEqual([]);
    expect(ally.hp["own-right"]!.koChance).toBeCloseTo(1, 12);
  });
});

describe("turn facts (SPEC §2.3)", () => {
  const field = { "own-left": { id: "charizard", move: "flamethrower", target: "opponent-right" as const }, "own-right": idle("garchomp"), "opponent-left": venusaur(), "opponent-right": blastoise() };

  it("states the turn's assumptions once, each only when it applies", () => {
    const plain = ready(calculateDoublesTurn(turn(championsRuntime, field)));
    expect(plain.facts).toContain(TURN_FACT);
    expect(plain.facts).not.toContain(END_FACT);
    for (const absent of [CRIT_FACT, PROTECT_FACT, FIRST_TURN_FACT, TRICK_ROOM_FACT]) expect(plain.facts).not.toContain(absent);
    const crit = ready(calculateDoublesTurn(turn(championsRuntime, field, { critical: true })));
    expect(crit.facts).toContain(CRIT_FACT);
    expect(crit.facts).not.toContain(TURN_FACT);
    const protect = ready(calculateDoublesTurn(turn(championsRuntime, { ...field, "opponent-right": blastoise({ move: "protect" }) })));
    expect(protect.facts).toContain(PROTECT_FACT);
    const room = ready(calculateDoublesTurn(turn(championsRuntime, field, { trickRoom: true })));
    expect(room.facts).toContain(TRICK_ROOM_FACT);
    // V36a: Alakazam sets Trick Room (-7) after every other action.
    const set = ready(calculateDoublesTurn(turn(championsRuntime, { ...field, "opponent-left": { id: "alakazam", ability: "innerfocus", move: "trickroom" } })));
    expect(set.facts).toContain(TRICK_ROOM_FACT);
    expect(set.hp["opponent-right"]).toMatchObject({ low: 128, high: 123 });
    for (const result of [plain, crit, protect, room, set]) expect(new Set(result.facts).size).toBe(result.facts.length);
  });
});

describe("turn rows never carry a 1v1 turn-order assumption", () => {
  it("passes the turn order and the doubling event to Payback, Analytic, Assurance and Bolt Beak", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const turns = [
      // V27a: Garchomp moves before Dusknoir, so Payback doubles; V27b: Magnezone moves after every other Pokémon.
      turn(sv, { "own-left": { id: "dusknoir", ability: "pressure", move: "payback", target: "opponent-right" }, "own-right": idle("snorlax", { evs: { spe: 4 } }), "opponent-left": idle("venusaur", { evs: { spe: 4 } }), "opponent-right": { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "own-right" } }),
      turn(sv, { "own-left": { id: "magnezone", ability: "analytic", move: "flashcannon", target: "opponent-right" }, "own-right": idle("garchomp", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "opponent-left": idle("weavile", { ability: "pressure" }), "opponent-right": idle("charizard", { nature: "Timid", evs: { spa: 252, spe: 252 } }) }),
      turn(sv, { "own-left": { id: "garchomp", nature: "Jolly", evs: { atk: 252, spe: 252 }, move: "dragonclaw", target: "opponent-right" }, "own-right": { id: "kingambit", ability: "defiant", move: "assurance", target: "opponent-right" }, "opponent-left": idle("venusaur", { evs: { spe: 4 } }), "opponent-right": idle("snorlax", { evs: { spe: 4 } }) }),
      // Payback into a Protecting target: the turn order, not the 1v1 shortcut, says whether it moved first.
      turn(sv, { "own-left": { id: "dusknoir", ability: "pressure", move: "payback", target: "opponent-right" }, "own-right": idle("snorlax", { evs: { spe: 4 } }), "opponent-left": idle("venusaur", { evs: { spe: 4 } }), "opponent-right": { id: "garchomp", move: "protect" } }),
    ];
    const swsh = await loadBattleRuntime("sword_shield");
    turns.push(turn(swsh, { "own-left": { id: "dracovish", ability: "strongjaw", move: "fishiousrend", target: "opponent-right" }, "own-right": idle("snorlax"), "opponent-left": idle("venusaur"), "opponent-right": { id: "garchomp", move: "dragonclaw", target: "own-right" } }));
    for (const input of turns) {
      const result = ready(calculateDoublesTurn(input));
      for (const s of result.steps) {
        for (const hit of s.hits) {
          const row = hit.row;
          if (!row) continue;
          for (const text of ONE_V_ONE) {
            expect(row.assumptions, `${s.moveId}`).not.toContain(text);
            expect(row.reason ?? "", `${s.moveId}`).not.toBe(text);
            expect(row.description, `${s.moveId}`).not.toContain(text);
          }
        }
      }
    }
  });
});

describe("empty slots and Dynamax HP", () => {
  it("gives an empty slot no HP and a lone target no spread modifier (V10b)", () => {
    const result = ready(calculateDoublesTurn(turn(championsRuntime, { "own-left": { id: "garchomp", ability: "sandveil", move: "earthquake" }, "own-right": null, "opponent-left": null, "opponent-right": blastoise() })));
    expect(result.hp["own-right"]).toBeNull();
    expect(result.hp["opponent-left"]).toBeNull();
    expect(result.hp["opponent-right"]).toMatchObject({ start: 154, low: 82, high: 69, min: 69, max: 82, koChance: 0 });
    expect(step(result, "own-left").hits.map((h) => h.slot)).toEqual(["opponent-right"]);
  });

  it("reports a Dynamaxed Pokémon in Dynamax HP (V31a)", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const result = ready(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "charizard", ability: "blaze", nature: "Timid", evs: { spa: 252, spe: 252 }, move: "airslash", target: "opponent-right", build: { mechanic: "dynamax" } },
      "own-right": { id: "garchomp", ability: "roughskin", move: "dragonclaw", target: "opponent-left" },
      "opponent-left": { id: "weavile", ability: "pressure", move: "nightslash", target: "own-right" }, "opponent-right": idle("snorlax", { evs: { spe: 4 } }),
    })));
    expect(result.hp["own-left"]).toMatchObject({ start: 306, maximum: 306, low: 306, high: 306 });
    // Max Airstream raises Garchomp to 183 Speed: it moves before Weavile (145) after the re-sort.
    expect(step(result, "own-left").effectiveName).toBe("Max Airstream");
    expect(step(result, "own-right").order).toEqual([{ position: 2, chance: 1 }]);
    expect(step(result, "opponent-left").order).toEqual([{ position: 3, chance: 1 }]);
  });
});

describe("a Berry an Unnerve or As One holder stopped, once that holder's HP reaches 0", () => {
  // sim/side.ts allies() keeps only Pokémon with HP, so the holder's onFoeTryEatItem stops nothing at the next Update.
  const chomp = { id: "garchomp", ability: "roughskin", nature: "Jolly", evs: { atk: 252, spe: 252 } };
  const lax = (extra: Partial<P> = {}): P => idle("snorlax", { ability: "thickfat", evs: { spe: 4 }, ...extra });
  const tyranitar = (extra: Partial<P> = {}): P => idle("tyranitar", { ability: "unnerve", ...extra });

  it("a third Pokémon's Unnerve: the target eats once the holder faints (M29a), or a spread move's other target (M29b)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const third = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, move: "dragonclaw", target: "opponent-left" }, "own-right": tyranitar({ hp: 1 }),
      "opponent-left": lax({ item: "sitrusberry", hp: 120 }), "opponent-right": venusaur({ move: "energyball", target: "own-right" }),
    })));
    expect(third.hp["opponent-left"]).toMatchObject({ start: 120, low: 81, high: 63, min: 63, max: 81 });
    expect(third.hp["opponent-left"]!.average).toBeCloseTo(72.125, 9);
    expect(third.hp["opponent-left"]!.heals).toEqual(["Sitrus Berry: +58 HP."]);
    const spread = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, move: "rockslide" }, "own-right": lax(), "opponent-left": tyranitar({ hp: 1 }), "opponent-right": lax({ item: "sitrusberry", hp: 140 }),
    })));
    expect(spread.hp["opponent-right"]).toMatchObject({ start: 140, low: 153, high: 144, min: 144, max: 153 });
    expect(spread.hp["opponent-right"]!.average).toBeCloseTo(148.5625, 9);
  });

  it("the holder faints from its own recoil: its target eats at the next Update (M29d)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const result = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "tyranitar", ability: "unnerve", hp: 10, move: "doubleedge", target: "opponent-left" }, "own-right": venusaur(),
      "opponent-left": lax({ item: "sitrusberry", hp: 200 }), "opponent-right": blastoise(),
    })));
    expect(result.hp["own-left"]!.koChance).toBe(1);
    expect(result.hp["opponent-left"]).toMatchObject({ start: 200, low: 118, high: 161, min: 118, max: 175 });
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(164.875, 9);
  });

  it("the attacker that KOs the holder eats after the hit; with recoil after it, not estimated (M29e, M29f, M29c)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const plain = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, item: "sitrusberry", hp: 80, move: "dragonclaw", target: "opponent-left" }, "own-right": venusaur(), "opponent-left": tyranitar({ hp: 1 }), "opponent-right": blastoise(),
    })));
    expect(plain.hp["own-left"]).toMatchObject({ start: 80, low: 125, high: 125, min: 125, max: 125 });
    // Rocky Helmet's 30 comes in the hit, before the Update that eats the Berry: 100 - 30 + 45.
    const helmet = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, item: "sitrusberry", hp: 100, move: "dragonclaw", target: "opponent-left" }, "own-right": venusaur(),
      "opponent-left": tyranitar({ hp: 1, item: "rockyhelmet" }), "opponent-right": blastoise(),
    })));
    expect(helmet.hp["own-left"]).toMatchObject({ start: 100, low: 115, high: 115, min: 115, max: 115 });
    const recoil = calculateDoublesTurn(turn(sv, {
      "own-left": { ...chomp, item: "sitrusberry", hp: 80, move: "doubleedge", target: "opponent-left" }, "own-right": venusaur(), "opponent-left": tyranitar({ hp: 30 }), "opponent-right": blastoise(),
    }));
    expect(recoil.status).toBe("not-estimated");
    if (recoil.status === "not-estimated") expect(recoil.reason).toBe("Unnerve is not modelled in 2v2.");
  });

  it("As One (Glastrier): the foe it stopped eats once Foul Play KOs Calyrex (M21a)", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const result = ready(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "calyrexice", ability: "asoneglastrier", nature: "Quiet", move: "glaciallance" }, "own-right": lax(),
      "opponent-left": venusaur({ hp: 1 }), "opponent-right": { id: "sableye", ability: "keeneye", item: "sitrusberry", move: "foulplay", target: "own-left" },
    }, { trickRoom: true })));
    expect(result.hp["own-left"]!.koChance).toBeCloseTo(0.875, 9);
    expect(result.hp["opponent-right"]).toMatchObject({ start: 125, low: 48, high: 0, min: 0, max: 48 });
    expect(result.hp["opponent-right"]!.average).toBeCloseTo(35.3125, 9);
    expect(result.hp["opponent-right"]!.koChance).toBeCloseTo(0.125, 9);
  });
});

describe("a protecting move's contact effect on a spread move comes before its hits", () => {
  // sim/battle-actions.ts trySpreadMoveHit runs every target's TryHit (hitStepTryHitEvent) before hitStepMoveHitLoop.
  const lax = idle("snorlax", { ability: "thickfat", evs: { spe: 4 } });
  const hit = (result: Extract<DoublesTurnResult, { status: "ready" }>, slot: DoublesSlotId, into: DoublesSlotId) => {
    const found = step(result, slot).hits.find((h) => h.slot === into);
    return found && { kind: found.kind, min: found.min, max: found.max };
  };

  it("keeps Baneful Bunker's poison for a later Venoshock (M28b) and burns before the hits (M28e)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const poison = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "sandaconda", ability: "shedskin", move: "brutalswing" }, "own-right": lax,
      "opponent-left": { id: "toxapex", ability: "regenerator", move: "banefulbunker" }, "opponent-right": { id: "amoonguss", ability: "regenerator", move: "venoshock", target: "own-left" },
    })));
    expect(hit(poison, "opponent-right", "own-left")).toEqual({ kind: "calculated", min: 42, max: 51 });
    expect(poison.hp["own-left"]).toMatchObject({ start: 147, low: 105, high: 96, min: 96, max: 105 });
    const burn = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "sandaconda", ability: "shedskin", move: "brutalswing" }, "own-right": lax,
      "opponent-left": { id: "gougingfire", ability: "protosynthesis", move: "burningbulwark" }, "opponent-right": venusaur(),
    })));
    expect(hit(burn, "own-left", "own-right")).toEqual({ kind: "calculated", min: 13, max: 15 });
    expect(hit(burn, "own-left", "opponent-right")).toEqual({ kind: "calculated", min: 10, max: 12 });
  });

  it("lowers Attack before the hits for King's Shield (M28d)", async () => {
    const swsh = await loadBattleRuntime("sword_shield");
    const result = ready(calculateDoublesTurn(turn(swsh, {
      "own-left": { id: "conkeldurr", ability: "ironfist", move: "brutalswing" }, "own-right": lax,
      "opponent-left": { id: "aegislash", ability: "stancechange", move: "kingsshield" }, "opponent-right": blastoise(),
    })));
    expect(hit(result, "own-left", "own-right")).toEqual({ kind: "calculated", min: 21, max: 25 });
    expect(hit(result, "own-left", "opponent-right")).toEqual({ kind: "calculated", min: 16, max: 19 });
  });

  it("takes Spiky Shield's damage with no Update before the hits: a Liechi Berry after them (M28c)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const result = ready(calculateDoublesTurn(turn(sv, {
      "own-left": { id: "sandaconda", ability: "shedskin", item: "liechiberry", hp: 50, move: "brutalswing" }, "own-right": lax,
      "opponent-left": { id: "chesnaught", ability: "bulletproof", move: "spikyshield" }, "opponent-right": venusaur(),
    })));
    expect(result.hp["own-left"]).toMatchObject({ start: 50, low: 32, high: 32, min: 32, max: 32 });
    expect(hit(result, "own-left", "own-right")).toEqual({ kind: "calculated", min: 26, max: 31 });
    expect(hit(result, "own-left", "opponent-right")).toEqual({ kind: "calculated", min: 21, max: 25 });
  });
});
