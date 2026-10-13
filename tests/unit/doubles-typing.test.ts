import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { HANDLERS } from "@/app/lib/battle/doubles-typing";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { STATUS_MOVE_TABLE } from "@/app/lib/battle/status-table";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * status2 Track A2's doubles-typing.ts (SPEC2 §4.3, ADDENDUM2 §4.2): its status-table rows and handlers, Protean and Libero at
 * PrepareHit (proteanGuard), the combinations the turn does not follow (comboGuard), the inputs Conversion and Conversion 2
 * read, and the Electrify / Ion Deluge / -ate guards that stay until the integrator's kernel changes (build/W1A-A2.md P1–P3).
 * Numbers marked with a case id are pinned Showdown c23d2e94's (scripts/.cache/calc-audit/status2/build/a2/cases-a2.ts);
 * the turns are built as the verify harness's app-turn.ts builds them. Level 50, 31 IVs, Serious, 0 EVs unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type CaseMon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; gender?: "M" | "F"; teraType?: string; choice?: "terastallize"; types?: string[]; addedType?: string;
  carried?: DoublesCarried; moves?: string[]; rawMoves?: string[]; lastMove?: string | null; build?: Partial<BattleBuild>;
};
type Slot = CaseMon & { action: { move: string | null; target?: DoublesSlotId } };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", USUM = "ultra_sun_ultra_moon";
const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const fast = { evs: { spe: 252 } };

function buildOf(runtime: BattleRuntime, m: CaseMon): BattleBuild {
  const base = createBuild(toID(m.species), runtime);
  const abilityId = toID(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toID(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : {};
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  return { ...build, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...typed, ...m.build } as BattleBuild;
}
/** app-turn.ts caseInput (`rawMoves`: move slots exactly as given, not the action's move first). */
function turn(runtime: BattleRuntime, slots: Slot[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = slots[i];
    const moveId = m.action.move === null ? null : toID(m.action.move);
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId, target: m.action.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toID(m.lastMove) } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toID)])] } : {}),
      ...(m.rawMoves ? { moves: m.rawMoves.map(toID) } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  const input: DoublesTurnInput = {
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true },
  };
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry.action.moveId && entry.action.target && doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(result: DoublesTurnResult): Ready {
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
const calc = async (id: BattleGame, slots: Slot[], field: Partial<BattleConditions> = {}) => calculateDoublesTurn(turn(await game(id), slots, field));
const run = async (id: BattleGame, slots: Slot[], field: Partial<BattleConditions> = {}) => ready(await calc(id, slots, field));
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)!;
const range = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => { const hit = hitOf(result, slot, target); return [hit.min, hit.max]; };
const texts = (facts: { text: string }[] | undefined) => (facts ?? []).map((fact) => fact.text);
const hitTexts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => texts(hitOf(result, slot, target).facts);

/** classify-a2.md: the family's 22 moves (M: modelled, C: modelled with a condition the input must give). */
const A2_ROWS: Record<string, [kind: "M" | "C", handler: string]> = {
  soak: ["M", "soak"], magicpowder: ["M", "magicPowder"], forestscurse: ["M", "addType"], trickortreat: ["M", "addType"], reflecttype: ["M", "reflectType"],
  conversion: ["C", "conversion"], conversion2: ["C", "conversion2"], camouflage: ["M", "camouflage"], electrify: ["M", "electrify"], iondeluge: ["M", "ionDeluge"],
  tarshot: ["M", "tarShot"], foresight: ["M", "foresight"], odorsleuth: ["M", "foresight"], miracleeye: ["M", "miracleEye"], telekinesis: ["M", "telekinesis"],
  embargo: ["M", "embargo"], healblock: ["M", "healBlock"], nightmare: ["M", "nightmare"], octolock: ["M", "octolock"], attract: ["C", "attract"],
  captivate: ["C", "captivate"], powder: ["M", "powder"],
};

describe("doubles-typing.ts: the status table's A2 rows and HANDLERS", () => {
  it("each of the 22 moves is modelled (M) or conditional (C) and names its handler", () => {
    for (const [id, [kind, handler]] of Object.entries(A2_ROWS)) {
      expect(STATUS_MOVE_TABLE[id], id).toMatchObject({ kind, handler });
    }
    expect(STATUS_MOVE_TABLE.electrify.fails).toBe("electrify");
  });

  it("every handler key the rows name is one of HANDLERS', and no HANDLERS key is unused", () => {
    const keys = new Set(Object.values(A2_ROWS).map(([, handler]) => handler));
    for (const key of keys) expect(HANDLERS[key], key).toBeDefined();
    expect(Object.keys(HANDLERS).sort()).toEqual([...keys].sort());
  });
});

describe("doubles-typing.ts proteanGuard: Protean and Libero at PrepareHit", () => {
  it("A2-PR4-sv (TV22c): a Terastallized user keeps its Tera type (Flamethrower into Water 0.5x, 33–40)", async () => {
    const result = await run(SV, [act(mon("Greninja", "Protean", { teraType: "Water", choice: "terastallize" }), "Ice Beam", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(range(result, OL, PL)).toEqual([17, 20]);
    expect(range(result, PR, OL)).toEqual([33, 40]);
  });
});

describe("doubles-typing.ts comboGuard and colorChange: the combinations the turn does not follow", () => {
  it("Synchronoise from a two-type user with an added type (the engine reads two types of the user)", async () => {
    const result = await calc(USUM, [act(mon("Xatu", "Synchronize", { addedType: "Grass" }), "Synchronoise"), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), idle(mon("Shuckle", "Sturdy"))]);
    expect(result).toMatchObject({ status: "not-estimated", reason: REASONS.combo("Synchronoise", "an added type") });
    expect(REASONS.combo("Synchronoise", "an added type")).toBe("Synchronoise with an added type is not modelled in 2v2.");
  });

  it("Natural Gift with a carried Embargo, or a Heal Block on a healing Berry's holder", async () => {
    const embargo = await calc(USUM, [act(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry", carried: { embargo: 3 } }), "Natural Gift", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Shuckle", "Sturdy")), idle(mon("Blissey", "Natural Cure"))]);
    expect(embargo).toMatchObject({ status: "not-estimated", reason: "Natural Gift with Embargo is not modelled in 2v2." });
    const healBlock = await calc(USUM, [act(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry", carried: { healBlock: 2 } }), "Natural Gift", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Shuckle", "Sturdy")), idle(mon("Blissey", "Natural Cure"))]);
    expect(healBlock).toMatchObject({ status: "not-estimated", reason: "Natural Gift with Heal Block is not modelled in 2v2." });
  });

  it("generation 7: Color Change (Role Play's, an earlier turn) making a Curse user Ghost before its Curse (Showdown's random foe there needs a world per foe)", async () => {
    const result = await calc(USUM, [act(mon("Gengar", "Cursed Body", fast), "Shadow Ball", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Quagsire", "Color Change", { build: { abilityChanged: true } }), "Curse"), idle(mon("Shuckle", "Sturdy"))]);
    expect(result).toMatchObject({ status: "not-estimated", reason: "Curse with Color Change is not modelled in 2v2." });
  });
});

describe("doubles-typing.ts: the inputs Conversion, Conversion 2, Attract and Captivate read", () => {
  it("Conversion: its first move slot's type (PS/data/moves.ts conversion: moveSlots[0]); none given: needs it", async () => {
    const electric = await run(SV, [act(mon("Porygon2", "Download", { rawMoves: ["Thunderbolt", "Conversion"] }), "Conversion"), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), idle(mon("Blissey", "Natural Cure"))]);
    expect(hitTexts(electric, OL, OL)).toEqual(["Becomes Electric type."]);
    expect(electric.facts).toContain("Assumes Thunderbolt is Porygon2's first move.");
    const none = await calc(SV, [act(mon("Porygon2", "Download"), "Conversion"), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), idle(mon("Blissey", "Natural Cure"))]);
    expect(none).toMatchObject({ status: "not-estimated", reason: REASONS.needsFirstMove("Porygon2") });
    expect(REASONS.needsFirstMove("Porygon2")).toBe("Conversion needs Porygon2's first move.");
  });

  it("Conversion 2 with no move this turn: its target's last move before the turn (none given, none, typed as used, Normal)", async () => {
    const c2 = (lastMove?: string | null) => calc(SV, [act(mon("Porygon-Z", "Adaptability"), "Conversion 2", PL), idle(mon("Chansey", "Natural Cure")),
      idle(mon("Snorlax", "Thick Fat", lastMove === undefined ? {} : { lastMove })), idle(mon("Blissey", "Natural Cure"))]);
    expect(await c2()).toMatchObject({ status: "not-estimated", reason: "Conversion 2 needs Snorlax's move from the last turn." });
    expect(await c2("Weather Ball")).toMatchObject({ status: "not-estimated", reason: REASONS.needsLastMoveType("Conversion 2", "Snorlax") });
    expect(REASONS.needsLastMoveType("Conversion 2", "Snorlax")).toBe("Conversion 2 needs the type of Snorlax's last move.");
    const none = ready(await c2(null));
    expect(hitTexts(none, OL, PL)).toEqual(["Conversion 2 fails: Snorlax has used no move."]);
    // Normal resisted or not taken: Ghost, Rock, Steel (A2-C22-sv's three, from a Normal move used this turn).
    const normal = ready(await c2("Body Slam"));
    expect(hitOf(normal, OL, PL).facts.map((fact) => [fact.text, +fact.chance.toFixed(6)])).toEqual([["Porygon-Z becomes Ghost type.", 0.333333], ["Porygon-Z becomes Rock type.", 0.333333], ["Porygon-Z becomes Steel type.", 0.333333]]);
  });

  it("Attract and Captivate on a species of both genders with none set: needs it (USER-DECISIONS Q10)", async () => {
    const attract = await calc(SV, [act(mon("Milotic", "Competitive", { gender: "F", ...fast }), "Attract", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(attract).toMatchObject({ status: "not-estimated", reason: REASONS.needsGender("Attract", "Snorlax") });
    expect(REASONS.needsGender("Attract", "Snorlax")).toBe("Attract needs Snorlax's gender.");
    const own = await calc(SV, [act(mon("Milotic", "Competitive", fast), "Attract", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat", { gender: "M" }), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(own).toMatchObject({ status: "not-estimated", reason: REASONS.needsGender("Attract", "Milotic") });
    const captivate = await calc(USUM, [act(mon("Clefable", "Magic Guard", { gender: "F", ...fast }), "Captivate"), idle(mon("Chansey", "Natural Cure")), act(mon("Alakazam", "Synchronize"), "Psychic", OR), idle(mon("Magnezone", "Sturdy"))]);
    expect(captivate).toMatchObject({ status: "not-estimated", reason: REASONS.needsGender("Captivate", "Alakazam") });
  });

  it("Telekinesis: Mega Gengar is immune by its form (PS/data/moves.ts telekinesis onTry)", async () => {
    const result = await run(USUM, [act(mon("Alakazam", "Synchronize"), "Telekinesis", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Gengar-Mega", "Shadow Tag", { item: "Gengarite" })), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitTexts(result, OL, PL)).toEqual(["Gengar-Mega is immune."]);
  });
});
