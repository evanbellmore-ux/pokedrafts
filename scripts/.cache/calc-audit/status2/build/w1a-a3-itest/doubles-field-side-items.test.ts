import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { mistBlocks, HANDLERS } from "@/app/lib/battle/doubles-field";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesOutcome, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { STATUS_MOVE_TABLE } from "@/app/lib/battle/status-table";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 Track A3 (SPEC2 §2.2's A3 rows, §4.4; ADDENDUM2 §4.2; F3 field-side-items.md): reflection, Snatch, the side and
 * field conditions, the rooms and Sports, the item moves and the party cures in the 2v2 turn. Each scenario is one of
 * Track A3's verification cases (scripts/.cache/calc-audit/status2/build/w1a-a3-cases.ts), whose numbers agree with pinned
 * Showdown c23d2e94 on the oracle (w1a-a3-run.ts); the texts are the app's facts. Level 50, 31 IVs, Serious, 0 EVs (Stat
 * Points in Champions) unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; substitute?: number;
  lastItem?: string | null; firstTurn?: boolean; move: string | null; target?: DoublesSlotId;
  /** Other build fields (the panel's choices, as the cases' appBuild). */
  build?: Partial<BattleBuild>;
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
  // Champions: the numbers are Stat Points (as the verification cases give them), at most 32.
  const evs = base.game === "champions" ? Object.fromEntries(Object.entries(m.evs ?? {}).map(([stat, n]) => [stat, Math.min(32, n)])) : m.evs;
  return { ...(base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...evs }, ivs: { ...IV31 } } }), ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const carried = { ...m.carried, ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(Object.keys(carried).length ? { carried } : {}), ...(m.lastItem !== undefined ? { lastItem: m.lastItem } : {}),
      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true } };
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
const texts = (facts: { text: string }[] | undefined) => (facts ?? []).map((fact) => fact.text);
const stepTexts = (result: Ready, slot: DoublesSlotId) => texts(stepOf(result, slot).facts);
const hitTexts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => texts(hitOf(result, slot, target)?.facts);
const orderOf = (result: Ready, slot: DoublesSlotId) => Object.fromEntries(stepOf(result, slot).order.map((entry) => [entry.position, entry.chance]));
const sideSet = (side: Record<string, unknown>) => Object.fromEntries(Object.entries(side).filter(([key, value]) => value !== false && key !== "faintedThisTurn"));
/** The integrator's lines (W1A-A3.md needsFromIntegrator) are in the frozen kernel. */
const KERNEL = readFileSync("scripts/.cache/calc-audit/status2/build/w1a-a3-itree/app/lib/battle/doubles-turn.ts", "utf8");
const integrated = KERNEL.includes("side.matBlock && slot !== attacker && !passes()");

describe("status2 A3: the classification and the handlers", () => {
  it("every A3 move is M or C with its handler (classify-a3.md), and doubles-field.ts registers each A3 handler key", () => {
    const ids = ["magiccoat", "snatch", "craftyshield", "matblock", "luckychant", "mist", "mudsport", "watersport", "magicroom", "wonderroom", "courtchange", "defog",
      "corrosivegas", "bestow", "recycle", "teatime", "stuffcheeks", "aromatherapy", "healbell", "purify", "psychoshift"];
    for (const id of ids) {
      const entry = STATUS_MOVE_TABLE[id];
      expect(["M", "C"], id).toContain(entry.kind);
      expect(HANDLERS[entry.handler!], `${id} handler ${entry.handler}`).toBeDefined();
    }
    expect(ids.filter((id) => STATUS_MOVE_TABLE[id].kind === "C").sort()).toEqual(["defog", "magicroom", "recycle"]);
    // Safeguard's side condition is A3's too (its clock: F3 §4.3).
    expect(HANDLERS[STATUS_MOVE_TABLE.safeguard.handler!]?.sideOrField).toBeDefined();
  });
});

describe("status2 A3: Magic Coat (SwSh, USUM)", () => {
  it("A3-MC-01: a reflected spread Growl hits both foes; the holder's ally still takes the original (F01)", async () => {
    for (const id of [SWSH, USUM] as const) {
      const runtime = await game(id);
      const input = turn(runtime, [mon("clefable", "magicguard", "magiccoat"), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OR }), mon("jolteon", "voltabsorb", "growl")]);
      const result = ready(input);
      expect(stepTexts(result, OL)).toEqual(["Magic Coat: reflectable moves aimed at Clefable go back to their users this turn."]);
      expect(hitTexts(result, PR, OL)).toEqual(["Magic Coat: Growl goes back to Jolteon."]);
      for (const target of [OR, PL, PR]) expect(hitTexts(result, PR, target), target).toEqual(["−1 Attack."]);
      const out = outcomes(input);
      expect(share(out, (o) => o.mons[PR]!.build.boosts.atk === -1 && o.mons[PL]!.build.boosts.atk === -1 && o.mons[OR]!.build.boosts.atk === -1 && o.mons[OL]!.build.boosts.atk === 0)).toBeCloseTo(1, 9);
    }
  });

  it("A3-MC-02: a Prankster holder's reflection fails on a Dark type (F02); without Prankster it paralyses", async () => {
    const runtime = await game(USUM);
    const slots = (coat: Mon) => [coat, mon("lapras", "shellarmor", null), lax(0), mon("absol", "pressure", "thunderwave", { target: OL })];
    const prankster = ready(turn(runtime, slots(mon("sableye", "prankster", "magiccoat"))));
    expect(hitTexts(prankster, PR, PR)).toEqual(["Prankster: Absol is not affected."]);
    const plain = ready(turn(runtime, slots(mon("clefable", "magicguard", "magiccoat"))));
    expect(hitTexts(plain, PR, PR)).toEqual(["Is paralysed."]);
  });

  it("A3-MC-03, -04: an ally's move comes back too (F05); a hazard lands on its user's side (F04)", async () => {
    const swsh = await game(SWSH);
    const ally = ready(turn(swsh, [mon("clefable", "magicguard", "magiccoat"), mon("togekiss", "serenegrace", "thunderwave", { target: OL }), lax(0), lax(4)]));
    expect(hitTexts(ally, OR, OL)).toEqual(["Magic Coat: Thunder Wave goes back to Togekiss."]);
    expect(hitTexts(ally, OR, OR)).toEqual(["Is paralysed."]);
    const usum = await game(USUM);
    const input = turn(usum, [mon("clefable", "magicguard", "magiccoat"), mon("lapras", "shellarmor", null), lax(0), mon("smeargle", "owntempo", "stealthrock")]);
    expect(stepTexts(ready(input), PR)).toEqual(["Magic Coat: Stealth Rock goes back to Smeargle's side."]);
    expect(share(outcomes(input), (o) => o.sides.opponent.hazards?.[0] === "stealthrock" && !o.sides.own.hazards)).toBeCloseTo(1, 9);
  });

  it("A3-MC-06, -07: a reflected Defog and Purify are the holder's own uses at the original user (F06, F07)", async () => {
    const swsh = await game(SWSH);
    const defog = ready(turn(swsh, [mon("clefable", "magicguard", "magiccoat"), lax(0, "bodyslam", { target: PL }), lax(4), mon("corviknight", "pressure", "defog", { target: OL })],
      { terrain: "Electric", defenderSide: { ...createSide(), reflect: true } }));
    expect(stepTexts(defog, PR)).toEqual(["Defog: Reflect ends on Corviknight's side.", "Defog: the Electric Terrain ends."]);
    expect(hitTexts(defog, PR, PR)).toEqual(["−1 evasion."]);
    const usum = await game(USUM);
    const purify = ready(turn(usum, [mon("clefable", "magicguard", "magiccoat", { hp: 100 }), mon("lapras", "shellarmor", null), lax(0), mon("smeargle", "owntempo", "purify", { status: "psn", target: OL })]));
    expect(hitTexts(purify, PR, PR)).toEqual(["Its poison is cured."]);
  });
});

describe("status2 A3: Snatch (USUM)", () => {
  it("A3-SN-01, -02: the Snatch user takes a foe's Swords Dance and Reflect (F10, F16); the screen runs on a fresh clock", async () => {
    const runtime = await game(USUM);
    const dance = turn(runtime, [mon("absol", "pressure", "snatch"), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OL }), mon("smeargle", "owntempo", "swordsdance")]);
    const result = ready(dance);
    expect(stepTexts(result, OL)).toEqual(["Snatch: Absol takes the next move that can be snatched this turn."]);
    expect(stepTexts(result, PR)).toEqual(["Snatch: Absol takes Swords Dance."]);
    expect(hitTexts(result, PR, OL)).toEqual(["+2 Attack."]);
    expect(share(outcomes(dance), (o) => o.mons[OL]!.build.boosts.atk === 2 && o.mons[PR]!.build.boosts.atk === 0)).toBeCloseTo(1, 9);
    const screen = turn(runtime, [mon("sableye", "keeneye", "snatch"), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OR }), mon("alakazam", "innerfocus", "reflect")]);
    const stolen = ready(screen);
    expect(stepTexts(stolen, PR)).toEqual(["Snatch: Sableye takes Reflect.", "Reflect starts on Sableye's side."]);
    expect(hitOf(stolen, PL, OR)).toMatchObject({ min: 42, max: 50 });
    expect(share(outcomes(screen), (o) => o.sides.own.reflect && o.sides.own.clock?.reflect === "set" && !o.sides.opponent.reflect)).toBeCloseTo(1, 9);
  });

  it("A3-SN-04, -06: Wide Guard and Tailwind (earlyBranch's dispatch) go to the Snatch user's side", async () => {
    const runtime = await game(USUM);
    const guard = ready(turn(runtime, [mon("umbreon", "innerfocus", "snatch"), mon("tyranitar", "unnerve", "rockslide"), lax(0), mon("hariyama", "thickfat", "wideguard")]));
    expect(stepTexts(guard, PR)).toEqual(["Snatch: Umbreon takes Wide Guard."]);
    expect(hitOf(guard, OR, PR).kind).toBe("calculated");
    expect(hitOf(guard, OR, PL).kind).toBe("calculated");
    const wind = ready(turn(runtime, [mon("absol", "pressure", "snatch"), lax(0, "bodyslam", { target: PR }), mon("talonflame", "galewings", "tailwind"), lax(8, "bodyslam", { target: OR })]));
    expect(stepTexts(wind, PL)).toEqual(["Snatch: Absol takes Tailwind.", "Tailwind starts on Absol's side."]);
  });

  it("A3-SN-03: a paralysed Snatch user takes the Substitute only when it moved (3/4); it pays for it (F13, F15)", async () => {
    const runtime = await game(USUM);
    const result = ready(turn(runtime, [mon("absol", "pressure", "snatch", { status: "par" }), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OL }), mon("gengar", "cursedbody", "substitute")]));
    expect(stepOf(result, PR).facts).toEqual([{ text: "Snatch: Absol takes Substitute.", chance: 0.75 }]);
    expect(hitOf(result, PR, OL).facts).toEqual([{ text: "Substitute: 35 HP.", chance: 0.75 }]);
    expect(hitOf(result, PR, PR).facts).toEqual([{ text: "Substitute: 33 HP.", chance: 0.25 }]);
  });

  it("A3-SN-07, -08: two Snatch users at one Speed take it 1/2 each; a stolen Mist protects the Snatch user's side", async () => {
    const runtime = await game(USUM);
    const tie = ready(turn(runtime, [mon("absol", "pressure", "snatch"), lax(0), mon("absol", "pressure", "snatch"), mon("smeargle", "owntempo", "swordsdance")]));
    expect(stepOf(tie, PR).facts).toEqual([{ text: "Snatch: Absol (yours) takes Swords Dance.", chance: 0.5 }, { text: "Snatch: Absol (opponent's) takes Swords Dance.", chance: 0.5 }]);
    const mist = ready(turn(runtime, [mon("absol", "pressure", "snatch"), lax(0), mon("chansey", "naturalcure", "growl"), mon("lapras", "shellarmor", "mist")]));
    expect(stepTexts(mist, PR)).toEqual(["Snatch: Absol takes Mist.", "Mist starts on Absol's side."]);
    expect(hitTexts(mist, PL, OL)).toEqual(["Mist: its stats are not lowered."]);
  });
});

describe("status2 A3: Crafty Shield, Mat Block, Lucky Chant", () => {
  it("A3-CS-01..03: Crafty Shield blocks status moves into its side, not damaging ones; it fails as the last action; it comes before Magic Coat", async () => {
    const swsh = await game(SWSH);
    const shield = ready(turn(swsh, [mon("klefki", "prankster", "craftyshield"), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OR }), mon("jolteon", "voltabsorb", "thunderwave", { target: OR })]));
    expect(stepTexts(shield, OL)).toEqual(["Crafty Shield: status moves aimed at Klefki's side are blocked this turn."]);
    expect(hitOf(shield, PR, OR)).toMatchObject({ kind: "blocked" });
    expect(hitTexts(shield, PR, OR)).toEqual(["Crafty Shield blocks Thunder Wave."]);
    expect(hitOf(shield, PL, OR).kind).toBe("calculated");
    const usum = await game(USUM);
    const last = ready(turn(usum, [mon("klefki", "magician", "craftyshield"), mon("jolteon", "voltabsorb", "protect"), mon("lapras", "shellarmor", "protect"), lax(4, "protect")]));
    expect(stepTexts(last, OL)).toEqual(["Crafty Shield fails: no Pokémon moves after it."]);
    const first = ready(turn(usum, [mon("klefki", "magician", "craftyshield"), mon("clefable", "magicguard", "magiccoat"), lax(0), mon("absol", "pressure", "thunderwave", { target: OR })]));
    expect(hitTexts(first, PR, OR)).toEqual(["Crafty Shield blocks Thunder Wave."]);
  });

  it("A3-MB-03: Mat Block fails after its user's first turn (firstTurn false); on its first turn the existing turn fact is given", async () => {
    const runtime = await game(USUM);
    const late = ready(turn(runtime, [mon("greninja", "torrent", "matblock", { firstTurn: false }), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OR }), lax(4)]));
    expect(stepTexts(late, OL)).toEqual(["Mat Block fails: it is not Greninja's first turn."]);
    const first = ready(turn(runtime, [mon("greninja", "torrent", "matblock"), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OR }), lax(4)]));
    expect(stepTexts(first, OL)).toEqual(["Mat Block: damaging moves aimed at Greninja's side are blocked this turn."]);
    expect(first.facts).toContain("Assumes the attacker's first turn in battle.");
  });

  it.skipIf(!integrated)("A3-MB-01, -02 (after the integrator's hitChecks line): Mat Block blocks a foe's and an ally's damaging moves into its side (F30, F31)", async () => {
    const runtime = await game(USUM);
    const result = ready(turn(runtime, [mon("greninja", "torrent", "matblock"), mon("garchomp", "roughskin", "earthquake"), lax(0, "bodyslam", { target: OR }), lax(4)]));
    expect(hitOf(result, OR, OL).kind).toBe("blocked");
    expect(hitOf(result, PL, OR).kind).toBe("blocked");
    expect(result.hp[OL]).toMatchObject({ min: 147, max: 147 });
  });

  it("A3-LC-01, -02: no critical hit into a Lucky Chant side, a certain one (Frost Breath, Merciless) included (K52, F35)", async () => {
    const runtime = await game(USUM);
    const chant = ready(turn(runtime, [mon("clefable", "magicguard", "luckychant", fast), lax(8), lax(4), mon("articuno", "pressure", "frostbreath", { target: OR })]));
    expect(stepTexts(chant, OL)).toEqual(["Lucky Chant starts on Clefable's side."]);
    expect(hitOf(chant, PR, OR)).toMatchObject({ min: 16, max: 19 });
    // Without it Frost Breath is a certain critical hit.
    const without = ready(turn(runtime, [mon("clefable", "magicguard", null, fast), lax(8), lax(4), mon("articuno", "pressure", "frostbreath", { target: OR })]));
    expect(hitOf(without, PR, OR).min).toBeGreaterThan(19);
    const merciless = ready(turn(runtime, [mon("clefable", "magicguard", "luckychant", fast), lax(0, null, { status: "psn" }), lax(4), mon("toxapex", "merciless", "scald", { target: OR })]));
    const plain = ready(turn(runtime, [mon("clefable", "magicguard", null, fast), lax(0, null, { status: "psn" }), lax(4), mon("toxapex", "merciless", "scald", { target: OR })]));
    expect(hitOf(merciless, PR, OR).max!).toBeLessThan(hitOf(plain, PR, OR).min!);
  });
});

describe("status2 A3: Mist", () => {
  it("A3-MI-01, -04: a damaging move's drop from a foe is stopped in the pair's step (set this turn or from an earlier turn)", async () => {
    for (const set of [true, false]) {
      const runtime = await game(SV);
      const result = ready(turn(runtime, [mon("lapras", "waterabsorb", set ? "mist" : null, fast), mon("gastrodon", "stormdrain", "surf"), lax(4), mon("umbreon", "innerfocus", "snarl")],
        set ? {} : { attackerSide: { ...createSide(), mist: true } }));
      expect(hitOf(result, OR, PR)).toMatchObject({ min: 28, max: 34 });
      expect(hitOf(result, OR, PL)).toMatchObject({ min: 33, max: 40 });
    }
  });

  it("A3-MI-02, -03, -05: Mirror Armor reflects before Mist (F40); Parting Shot drops nothing (F43); an Infiltrator foe's move goes through (F42)", async () => {
    const swsh = await game(SWSH);
    const armor = turn(swsh, [mon("lapras", "waterabsorb", "mist", fast), mon("corviknight", "mirrorarmor", null), lax(0), mon("jolteon", "voltabsorb", "growl")]);
    const result = ready(armor);
    expect(hitTexts(result, PR, OR)).toEqual(["Mirror Armor: the drop goes back to Jolteon."]);
    expect(share(outcomes(armor), (o) => o.mons[PR]!.build.boosts.atk === -1 && o.mons[OL]!.build.boosts.atk === -1)).toBeCloseTo(1, 9);
    const usum = await game(USUM);
    const parting = ready(turn(usum, [mon("lapras", "waterabsorb", "mist", fast), lax(8), lax(4), mon("pangoro", "ironfist", "partingshot", { target: OL })]));
    expect(hitTexts(parting, PR, OL)).toEqual(["Mist: its stats are not lowered."]);
    const infiltrator = ready(turn(usum, [mon("lapras", "waterabsorb", "mist", fast), lax(8), lax(0, "bodyslam", { target: OL }), mon("seviper", "infiltrator", "screech", { target: OL })]));
    expect(hitTexts(infiltrator, PR, OL)).toEqual(["−2 Defense."]);
  });

  it("mistBlocks: a drop from another Pokémon, a foe's infiltrating move aside (not a protecting move's contact effect, nor at the end of turn)", () => {
    const w = { sides: { own: { mist: true }, opponent: {} }, mons: {
      [PL]: { protect: null, build: { abilityId: "innerfocus" } }, [PR]: { protect: null, build: { abilityId: "infiltrator" } }, [OR]: { protect: null, build: { abilityId: "infiltrator" } },
    } } as never;
    const kernel = (inEndOfTurn: boolean) => ({ isFoe: (a: DoublesSlotId, b: DoublesSlotId) => a.split("-")[0] !== b.split("-")[0], inEndOfTurn }) as never;
    expect(mistBlocks(kernel(false), w, OL, PL, { effect: "move" })).toBe(true);
    expect(mistBlocks(kernel(false), w, OL, PR, { effect: "move" })).toBe(false);
    expect(mistBlocks(kernel(true), w, OL, PR, { effect: "move" })).toBe(true);
    expect(mistBlocks(kernel(false), w, OL, PR, { effect: "ability" })).toBe(true);
    expect(mistBlocks(kernel(false), w, OL, OR, { effect: "move" })).toBe(true);
    expect(mistBlocks(kernel(false), w, OL, OL, { effect: "item" })).toBe(false);
    expect(mistBlocks(kernel(false), w, PL, OL, { effect: "move" })).toBe(false);
    const guarded = { sides: { own: { mist: true }, opponent: {} }, mons: { [PR]: { protect: "kingsshield", build: { abilityId: "infiltrator" } } } } as never;
    expect(mistBlocks(kernel(false), guarded, OL, PR, { effect: "move" })).toBe(true);
  });
});

describe("status2 A3: Court Change, Defog", () => {
  it("A3-CC-01: the foe's Tailwind set this turn moves to own side with its fresh clock; the order follows (F50, F51)", async () => {
    for (const id of [SV, CHAMPIONS] as const) {
      const runtime = await game(id);
      const input = turn(runtime, [mon("cinderace", "blaze", "courtchange"), lax(0, "bodyslam", { target: PR }), lax(4, "bodyslam", { target: OR }), mon("talonflame", "galewings", "tailwind", fast)]);
      const result = ready(input);
      expect(stepTexts(result, OL)).toEqual(["Court Change: the two sides' conditions are swapped."]);
      expect(orderOf(result, OR)).toEqual({ 3: 1 });
      expect(orderOf(result, PL)).toEqual({ 4: 1 });
      const [only] = outcomes(input);
      expect(sideSet(only.sides.own)).toEqual({ tailwind: true, clock: { tailwind: "set" }, hazardsFrom: "opponent" });
      expect(sideSet(only.sides.opponent)).toEqual({ hazardsFrom: "own" });
    }
  });

  it("A3-CC-03: a Reflect from an earlier turn moves to own side: the foe's Body Slam is reduced, own Body Slam is not", async () => {
    const result = ready(turn(await game(SV), [mon("cinderace", "blaze", "courtchange"), lax(0, "bodyslam", { target: PL }), lax(4, "bodyslam", { target: OR }), lax(8)],
      { defenderSide: { ...createSide(), reflect: true } }));
    expect(stepTexts(result, OL)).toEqual(["Court Change: the two sides' conditions are swapped."]);
    expect(hitOf(result, PL, OR)).toMatchObject({ min: 50, max: 59 });
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 75, max: 88 });
  });

  it("A3-DF-01, -02: Defog ends the target side's Reflect and, from generation 8, the terrain (F58; K45); the hazards on both sides go", async () => {
    const field = { terrain: "Electric" as const, defenderSide: { ...createSide(), reflect: true } };
    const slots = [mon("corviknight", "pressure", "defog", { ...fast, target: PR }), lax(0, "bodyslam", { target: PR }), lax(4, "thunderbolt", { target: OR }), lax(12)];
    const sv = turn(await game(SV), slots, field);
    const nine = ready(sv);
    expect(stepTexts(nine, OL)).toEqual(["Defog: Reflect ends on Snorlax (opponent's, 2)'s side.", "Defog: the Electric Terrain ends."]);
    expect(hitTexts(nine, OL, PR)).toEqual(["−1 evasion."]);
    expect(hitOf(nine, OR, PR)).toMatchObject({ min: 75, max: 88 });
    expect(hitOf(nine, PL, OR)).toMatchObject({ min: 22, max: 27 });
    const [after] = outcomes(sv);
    expect(after.field.terrain).toBe("");
    expect(after.sides.own.hazardsFrom).toBeNull();
    expect(after.sides.opponent.hazardsFrom).toBeNull();
    const seven = ready(turn(await game(USUM), [mon("togekiss", "serenegrace", "defog", { ...fast, target: PR }), ...slots.slice(1)], field));
    expect(stepTexts(seven, OL)).toEqual(["Defog: Reflect ends on Snorlax (opponent's, 2)'s side."]);
    expect(hitOf(seven, PL, OR)).toMatchObject({ min: 34, max: 40 });
  });

  it("A3-DF-04, -05: behind a Substitute no evasion drop but the screen goes (F56); a terrain-settled holder keeps today's reason until FC", async () => {
    const runtime = await game(SV);
    const sub = ready(turn(runtime, [mon("corviknight", "pressure", "defog", { ...fast, target: PR }), lax(0, "bodyslam", { target: PL }), lax(4), lax(8, null, { substitute: 50 })],
      { defenderSide: { ...createSide(), reflect: true } }));
    expect(stepTexts(sub, OL)).toEqual(["Defog: Reflect ends on Snorlax (opponent's, 2)'s side."]);
    expect(hitTexts(sub, OL, PR)).toEqual([]);
    const quark = calculateDoublesTurn(turn(runtime, [mon("corviknight", "pressure", "defog", { ...fast, target: PR }), mon("ironhands", "quarkdrive", "drainpunch", { target: PR }), lax(0), lax(4)], { terrain: "Electric" }));
    expect(quark).toMatchObject({ status: "not-estimated", reason: REASONS.fieldChange("Quark Drive") });
  });
});

describe("status2 A3: the rooms and the Sports", () => {
  it("A3-MR-01, -04: Magic Room starts (World.fieldSet) and a second use ends it; a restart is fresh (F69)", async () => {
    const sv = await game(SV);
    const start = turn(sv, [mon("smeargle", "owntempo", "magicroom", fast), mon("garchomp", "roughskin", "earthquake", { item: "lifeorb" }), lax(0, null, { item: "sitrusberry", hp: 150 }), lax(4)]);
    expect(stepTexts(ready(start), OL)).toEqual(["Magic Room starts."]);
    expect(share(outcomes(start), (o) => o.field.magicRoom && o.fieldSet?.magicRoom === true)).toBeCloseTo(1, 9);
    const swsh = await game(SWSH);
    const restart = turn(swsh, [mon("alakazam", "innerfocus", "magicroom"), mon("espeon", "synchronize", "magicroom"), lax(0, null, { item: "leftovers", hp: 150 }), lax(4)], { magicRoom: true });
    const result = ready(restart);
    expect(stepTexts(result, OL)).toEqual(["Magic Room ends."]);
    expect(stepTexts(result, OR)).toEqual(["Magic Room starts."]);
    expect(share(outcomes(restart), (o) => o.field.magicRoom && o.fieldSet?.magicRoom === true)).toBeCloseTo(1, 9);
  });

  it("A3-MR-02: Magic Room ending mid-turn: a Sitrus at its line and a Lum against a paralysis from before act at the Update (F65, F143)", async () => {
    const runtime = await game(CHAMPIONS);
    const input = turn(runtime, [mon("gardevoir", "trace", "magicroom", fast), lax(8, null, { item: "lumberry", status: "par" }), lax(4, null, { item: "sitrusberry", hp: 100 }), lax(0, "bodyslam", { target: PL })],
      { magicRoom: true });
    const result = ready(input);
    expect(result.hp[PL]!.heals).toEqual(["Sitrus Berry: +58 HP."]);
    expect(result.hp[PL]).toMatchObject({ min: 70, max: 83 });
    expect(share(outcomes(input), (o) => !o.field.magicRoom && o.mons[OR]!.build.status === "" && o.mons[OR]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("A3-MR-05: Magic Room ending mid-turn: White Herb restores a lowered stat, Mental Herb ends a Taunt; the later Body Slam at +0", async () => {
    const input = turn(await game(SV), [mon("smeargle", "owntempo", "magicroom", fast), lax(0, "bodyslam", { item: "whiteherb", boosts: { atk: -1 }, target: PL }),
      lax(4, null, { item: "mentalherb", carried: { taunt: 2 } }), lax(8)], { magicRoom: true });
    const result = ready(input);
    expect(stepTexts(result, OL)).toEqual(["Magic Room ends.", "White Herb: Snorlax (yours)'s lowered stats are restored.", "Mental Herb: Snorlax (opponent's, 1)'s Taunt ends."]);
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 75, max: 88 });
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.boosts.atk === 0 && o.mons[OR]!.build.itemId === "" && o.mons[PL]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("A3-MR-06: Magic Room ending with a Booster Energy holder whose field is down (it came in under the room): not estimated until FC", async () => {
    const input = turn(await game(SV), [mon("smeargle", "owntempo", "magicroom", fast), mon("ironhands", "quarkdrive", null, { item: "boosterenergy", build: { itemUsedBeforeRoom: false } }), lax(0), lax(4)],
      { magicRoom: true });
    expect(calculateDoublesTurn(input)).toMatchObject({ status: "not-estimated", reason: REASONS.boosterAfterRoom });
  });

  it("A3-WR-01, -02: Wonder Room starts and ends (the later Body Slam reads the swapped, then the own, Defense)", async () => {
    const sv = await game(SV);
    const start = ready(turn(sv, [mon("mismagius", "levitate", "wonderroom", fast), mon("chansey", "naturalcure", null), lax(0, "bodyslam", { target: OR }), lax(4)]));
    expect(stepTexts(start, OL)).toEqual(["Wonder Room starts."]);
    expect(hitOf(start, PL, OR)).toMatchObject({ min: 51, max: 60 });
    const ch = await game(CHAMPIONS);
    const end = ready(turn(ch, [mon("gardevoir", "trace", "wonderroom", fast), mon("clefable", "magicguard", null), lax(0, "bodyslam", { target: OR }), lax(4)], { wonderRoom: true }));
    expect(stepTexts(end, OL)).toEqual(["Wonder Room ends."]);
  });

  it("A3-SP-01: Mud Sport starts (World.fieldSet) and weakens Electric moves; a second Mud Sport fails while up", async () => {
    const runtime = await game(USUM);
    const input = turn(runtime, [mon("excadrill", "sandrush", "mudsport", fast), mon("lapras", "shellarmor", null), lax(4), lax(0, "thunderbolt", { target: OR })]);
    const result = ready(input);
    expect(stepTexts(result, OL)).toEqual(["Mud Sport starts."]);
    expect(hitOf(result, PR, OR)).toMatchObject({ min: 18, max: 22 });
    expect(share(outcomes(input), (o) => o.field.mudSport === true && o.fieldSet?.mudSport === true)).toBeCloseTo(1, 9);
    const again = ready(turn(runtime, [mon("excadrill", "sandrush", "mudsport", fast), mon("lapras", "shellarmor", null), lax(4), lax(0)], { mudSport: true }));
    expect(stepTexts(again, OL)).toEqual(["Mud Sport fails: it is already up."]);
  });
});

describe("status2 A3: the item moves", () => {
  it("A3-CG-01..03: Corrosive Gas takes every adjacent item (its ally's too), not through Sticky Hold or a Substitute (F80-F83)", async () => {
    const ch = await game(CHAMPIONS);
    const gas = ready(turn(ch, [mon("gengar", "cursedbody", "corrosivegas", fast), mon("clefable", "magicguard", null, { item: "sitrusberry" }), lax(0, null, { item: "leftovers", hp: 150 }), lax(4, "bodyslam", { item: "sitrusberry", target: OR })]));
    expect(hitTexts(gas, OL, OR)).toEqual(["Loses its Sitrus Berry."]);
    expect(hitTexts(gas, OL, PL)).toEqual(["Loses its Leftovers."]);
    const swsh = await game(SWSH);
    const hold = turn(swsh, [mon("weezing", "levitate", "corrosivegas", fast), mon("excadrill", "sandrush", "earthquake"), lax(0, null, { item: "airballoon" }), mon("gastrodon", "stickyhold", null, { item: "leftovers" })]);
    const result = ready(hold);
    expect(hitTexts(result, OL, PR)).toEqual(["Sticky Hold: Gastrodon keeps its item."]);
    expect(hitTexts(result, OL, PL)).toEqual(["Loses its Air Balloon."]);
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 76, max: 91 });
    expect(share(outcomes(hold), (o) => o.mons[PR]!.build.itemId === "leftovers" && o.mons[PL]!.build.itemId === "")).toBeCloseTo(1, 9);
    const sub = ready(turn(ch, [mon("gengar", "cursedbody", "corrosivegas", fast), mon("clefable", "magicguard", null), lax(0, null, { item: "leftovers", hp: 150, substitute: 40 }), lax(4, null, { item: "leftovers", hp: 150 })]));
    expect(hitTexts(sub, OL, PL)).toEqual(["Snorlax (1) is behind a Substitute."]);
    expect(hitTexts(sub, OL, OR)).toEqual(["Corrosive Gas fails: Clefable holds no item."]);
  });

  it("A3-BE-01: Bestow gives a Sitrus Berry to an ally at 80 HP, eaten at the action's Update (F88)", async () => {
    const runtime = await game(USUM);
    const result = ready(turn(runtime, [mon("togekiss", "serenegrace", "bestow", { ...fast, item: "sitrusberry", target: OR }), mon("lapras", "shellarmor", null, { hp: 80 }), lax(0, "bodyslam", { target: OR }), lax(4)]));
    expect(stepTexts(result, OL)).toEqual(["Bestow: Lapras gets Sitrus Berry; Togekiss holds no item."]);
    expect(result.hp[OR]!.heals).toEqual(["Sitrus Berry: +51 HP."]);
    expect(result.hp[OR]).toMatchObject({ min: 56, max: 68 });
    const held = ready(turn(runtime, [mon("togekiss", "serenegrace", "bestow", { ...fast, item: "sitrusberry", target: OR }), mon("lapras", "shellarmor", null, { item: "leftovers" }), lax(0), lax(4)]));
    expect(hitTexts(held, OL, OR)).toEqual(["Bestow fails: Lapras already holds an item."]);
  });

  it("A3-RC-01..04: Recycle restores the input's last item or the one used this turn (item history); with none it fails; unknown, not estimated", async () => {
    const ch = await game(CHAMPIONS);
    const input = turn(ch, [lax(0, "recycle", { lastItem: "sitrusberry", hp: 150 }), mon("clefable", "magicguard", null), lax(4), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]);
    expect(stepTexts(ready(input), OL)).toEqual(["Recycle: Snorlax (yours) gets Sitrus Berry back."]);
    const sv = await game(SV);
    const unknown = calculateDoublesTurn(turn(sv, [lax(0, "recycle"), mon("lapras", "shellarmor", null), lax(4), lax(8)]));
    expect(unknown).toMatchObject({ status: "not-estimated", reason: REASONS.needsLastItem("Recycle", "Snorlax (yours)") });
    const history = ready(turn(sv, [lax(0, "recycle", { item: "sitrusberry", hp: 140 }), mon("lapras", "shellarmor", null), lax(4), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]));
    expect(stepTexts(history, OL)).toEqual(["Recycle: Snorlax (yours) gets Sitrus Berry back."]);
    const swsh = await game(SWSH);
    const none = ready(turn(swsh, [lax(0, "recycle", { lastItem: null, item: "leftovers" }), mon("lapras", "shellarmor", null), lax(4), mon("clefable", "magicguard", "knockoff", { target: OL })]));
    expect(hitTexts(none, OL, OL)).toEqual(["Recycle fails: Snorlax (yours) has used no item."]);
    const holding = ready(turn(sv, [lax(0, "recycle", { item: "leftovers", lastItem: "sitrusberry" }), mon("lapras", "shellarmor", null), lax(4), lax(8)]));
    expect(hitTexts(holding, OL, OL)).toEqual(["Recycle fails: Snorlax (yours) holds an item."]);
  });

  it("A3-TT-01..04: Teatime makes every Berry holder eat at once (no line), Good as Gold aside; under Magic Room no effect; Ripen, Cheek Pouch, a Figy's confusion", async () => {
    const sv = await game(SV);
    const tea = ready(turn(sv, [mon("smeargle", "owntempo", "teatime", fast), lax(0, null, { item: "sitrusberry", hp: 150 }), lax(4, null, { item: "lumberry" }), mon("gholdengo", "goodasgold", null, { item: "sitrusberry", hp: 100 })]));
    expect(hitTexts(tea, OL, OR)).toEqual(["Eats its Sitrus Berry."]);
    expect(hitTexts(tea, OL, PL)).toEqual(["Eats its Lum Berry."]);
    expect(hitTexts(tea, OL, PR)).toEqual(["Good as Gold: Gholdengo is not affected."]);
    expect(tea.hp[OR]!.heals).toEqual(["Sitrus Berry: +58 HP."]);
    const ch = await game(CHAMPIONS);
    const room = ready(turn(ch, [mon("polteageist", "cursedbody", "teatime", fast), lax(0, null, { item: "sitrusberry", hp: 100 }), lax(4, "bodyslam", { item: "oranberry", hp: 100, target: OR }), mon("clefable", "magicguard", null)], { magicRoom: true }));
    expect(hitTexts(room, OL, OR)).toEqual(["Eats its Sitrus Berry: no effect (Magic Room)."]);
    expect(room.hp[OR]!.heals).toEqual([]);
    const swsh = await game(SWSH);
    const ripen = ready(turn(swsh, [mon("polteageist", "cursedbody", "teatime", fast), mon("appletun", "ripen", null, { item: "sitrusberry", hp: 100 }), mon("dedenne", "cheekpouch", null, { item: "lumberry", hp: 60 }), lax(4)]));
    expect(ripen.hp[OR]!.heals).toEqual(["Sitrus Berry: +85 HP."]);
    expect(ripen.hp[PL]!.heals).toEqual(["Cheek Pouch: +47 HP."]);
    const figy = ready(turn(sv, [mon("smeargle", "owntempo", "teatime", fast), lax(0, "bodyslam", { item: "figyberry", nature: "Modest", hp: 120, target: PR }), lax(4), lax(12)]));
    expect(hitTexts(figy, OL, OR)).toEqual(["Eats its Figy Berry.", "Figy Berry: it becomes confused."]);
  });

  it("A3-TT-05: Teatime misses a Pokémon in the sky (Fly's charge this turn): it keeps its Berry; its ally eats", async () => {
    const input = turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { ...fast, item: "sitrusberry", hp: 100, target: PR }), lax(0, null, { item: "sitrusberry", hp: 150 }),
      mon("smeargle", "owntempo", "teatime"), lax(4)]);
    const result = ready(input);
    expect(hitOf(result, PL, OL)).toMatchObject({ kind: "blocked" });
    expect(hitTexts(result, PL, OL)).toEqual(["Teatime misses Dragonite."]);
    expect(hitTexts(result, PL, OR)).toEqual(["Eats its Sitrus Berry."]);
    expect(result.hp[OL]).toMatchObject({ min: 100, max: 100 });
    expect(result.hp[OR]!.heals).toEqual(["Sitrus Berry: +58 HP."]);
    expect(share(outcomes(input), (o) => o.mons[OL]!.build.itemId === "sitrusberry" && o.mons[OR]!.build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("A3-SC-01..04: Stuff Cheeks raises Defense by 2 and then eats its Berry; at +6 it eats nothing; under Magic Room no effect; a Pomeg with Cheek Pouch", async () => {
    const sv = await game(SV);
    const cheeks = turn(sv, [mon("greedent", "cheekpouch", "stuffcheeks", { ...fast, item: "sitrusberry", hp: 150 }), mon("lapras", "shellarmor", null), lax(0, "bodyslam", { target: OL }), lax(4)]);
    const result = ready(cheeks);
    expect(hitTexts(result, OL, OL)).toEqual(["+2 Defense.", "Eats its Sitrus Berry."]);
    expect(result.hp[OL]!.heals).toEqual(["Sitrus Berry: +45 HP."]);
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 28, max: 34 });
    const swsh = await game(SWSH);
    const capped = ready(turn(swsh, [mon("greedent", "cheekpouch", "stuffcheeks", { item: "sitrusberry", hp: 100, boosts: { def: 6 } }), mon("lapras", "shellarmor", null), lax(0), lax(4)]));
    expect(hitTexts(capped, OL, OL)).toEqual(["Its Defense cannot go higher."]);
    const ch = await game(CHAMPIONS);
    const room = ready(turn(ch, [mon("swalot", "gluttony", "stuffcheeks", { ...fast, item: "sitrusberry", hp: 100 }), mon("clefable", "magicguard", null), lax(0, "bodyslam", { target: OL }), lax(4)], { magicRoom: true }));
    expect(hitTexts(room, OL, OL)).toEqual(["+2 Defense.", "Eats its Sitrus Berry: no effect (Magic Room)."]);
    const pomeg = ready(turn(sv, [mon("greedent", "cheekpouch", "stuffcheeks", { ...fast, item: "pomegberry", hp: 100 }), mon("lapras", "shellarmor", null), lax(0), lax(4)]));
    expect(pomeg.hp[OL]!.heals).toEqual(["Cheek Pouch: +65 HP."]);
    const none = ready(turn(sv, [mon("greedent", "cheekpouch", "stuffcheeks", { item: "leftovers" }), mon("lapras", "shellarmor", null), lax(0), lax(4)]));
    expect(stepTexts(none, OL)).toEqual(["Stuff Cheeks fails: Greedent holds no Berry."]);
  });

  it("T2M-RI-01, -02: a received Seed in its terrain and Room Service under Trick Room are used at once (T2M §3.21)", async () => {
    const sv = await game(SV);
    const seed = turn(sv, [mon("golurk", "klutz", "trick", { item: "electricseed", evs: { spe: 252 }, target: PR }), lax(8), lax(24), lax(16, null, { item: "leftovers" })], { terrain: "Electric" });
    expect(hitTexts(ready(seed), OL, PR)).toContain("Its Electric Seed is used up on Electric Terrain: +1 Defense.");
    expect(share(outcomes(seed), (o) => o.mons[PR]!.build.boosts.def === 1 && o.mons[PR]!.build.itemId === "")).toBeCloseTo(1, 9);
    const swsh = await game(SWSH);
    const service = turn(swsh, [mon("golurk", "klutz", "trick", { item: "roomservice", target: PR }), lax(8), lax(16), lax(252, null, { item: "leftovers" })], { trickRoom: true });
    expect(hitTexts(ready(service), OL, PR)).toContain("Its Room Service is used up under Trick Room: −1 Speed.");
  });
});

describe("status2 A3: the party cures, Purify, Psycho Shift", () => {
  it("A3-HB-01..03: Heal Bell cures its sleeping ally before it moves, the bench too (benchCured); Soundproof and Good as Gold allies keep theirs", async () => {
    const sv = await game(SV);
    const bell = turn(sv, [mon("chansey", "naturalcure", "healbell", fast), lax(0, "bodyslam", { status: "slp", target: PR, carried: { sleep: { attempts: 0, rest: false } } }), lax(4), lax(12)]);
    const result = ready(bell);
    expect(stepTexts(result, OL)).toEqual(["Heal Bell also cures the statuses of your side's Pokémon not in battle."]);
    expect(hitTexts(result, OL, OR)).toEqual(["Its sleep is cured."]);
    expect(stepOf(result, OR).moves).toBe(1);
    expect(share(outcomes(bell), (o) => o.sides.own.benchCured === true && !o.sides.opponent.benchCured)).toBeCloseTo(1, 9);
    const gold = ready(turn(sv, [mon("chansey", "naturalcure", "healbell"), mon("gholdengo", "goodasgold", null, { status: "brn" }), lax(0), lax(4)]));
    expect(hitTexts(gold, OL, OR)).toEqual(["Good as Gold: Gholdengo is not affected."]);
    const usum = await game(USUM);
    const proof = ready(turn(usum, [mon("chansey", "naturalcure", "healbell"), mon("exploud", "soundproof", null, { status: "brn" }), lax(0), lax(4)]));
    expect(hitTexts(proof, OL, OR)).toEqual(["Soundproof: Exploud is not affected."]);
  });

  it("A3-AR-01: Aromatherapy: a Sap Sipper ally takes the Grass move (+1 Attack at TryHitSide) and keeps its burn (F120)", async () => {
    const runtime = await game(USUM);
    const input = turn(runtime, [mon("blissey", "naturalcure", "aromatherapy", fast), mon("azumarill", "sapsipper", null, { status: "brn" }), lax(4), lax(12)]);
    const result = ready(input);
    expect(stepTexts(result, OL)).toEqual(["Azumarill's Sap Sipper: +1 Attack.", "Aromatherapy also cures the statuses of your side's Pokémon not in battle."]);
    expect(hitTexts(result, OL, OR)).toEqual(["Sap Sipper: Azumarill is not affected."]);
    expect(share(outcomes(input), (o) => o.mons[OR]!.build.status === "brn" && o.mons[OR]!.build.boosts.atk === 1)).toBeCloseTo(1, 9);
  });

  it("A3-PU-01: Purify cures the target and heals its user ceil(maxhp / 2) (K44); a target with no status fails it", async () => {
    const runtime = await game(USUM);
    const result = ready(turn(runtime, [mon("smeargle", "owntempo", "purify", { ...fast, hp: 50, target: PR }), mon("lapras", "shellarmor", null), lax(0), lax(4, null, { status: "psn" })]));
    expect(hitTexts(result, OL, PR)).toEqual(["Its poison is cured."]);
    expect(result.hp[OL]!.heals).toEqual(["Purify: +65 HP."]);
    const clean = ready(turn(runtime, [mon("smeargle", "owntempo", "purify", { ...fast, hp: 50, target: PR }), mon("lapras", "shellarmor", null), lax(0), lax(4)]));
    expect(hitTexts(clean, OL, PR)).toEqual(["Purify fails: Snorlax (2) has no status."]);
  });

  it("A3-PS-01..04: Psycho Shift moves its user's status, then cures it; Safeguard and a type immunity stop it and the user keeps its own (K41, F110-F113)", async () => {
    const usum = await game(USUM);
    const slots = (target: Mon) => [mon("alakazam", "innerfocus", "psychoshift", { ...fast, status: "brn", target: PR }), mon("lapras", "shellarmor", null), lax(0), target];
    const shift = ready(turn(usum, slots(lax(4, "bodyslam", { target: OR }))));
    expect(hitTexts(shift, OL, PR)).toEqual(["Is burned."]);
    expect(stepTexts(shift, OL)).toEqual(["Alakazam's burn is cured."]);
    expect(hitOf(shift, PR, OR)).toMatchObject({ min: 31, max: 37 });
    const safe = ready(turn(usum, slots(lax(4, "bodyslam", { target: OR })), { defenderSide: { ...createSide(), safeguard: true } }));
    expect(hitTexts(safe, OL, PR)).toEqual(["Safeguard: Snorlax (2) is not affected."]);
    expect(stepTexts(safe, OL)).toEqual([]);
    const fire = ready(turn(usum, slots(mon("arcanine", "intimidate", null))));
    expect(hitTexts(fire, OL, PR)).toEqual(["Arcanine is immune."]);
    const swsh = await game(SWSH);
    const sync = ready(turn(swsh, [mon("alakazam", "innerfocus", "psychoshift", { ...fast, status: "tox", target: PR }), mon("lapras", "shellarmor", null), lax(0), mon("espeon", "synchronize", null, { item: "lumberry" })]));
    expect(hitTexts(sync, OL, PR)).toEqual(["Is badly poisoned."]);
    expect(stepTexts(sync, OL)).toEqual(["Alakazam's bad poison is cured."]);
    const bare = ready(turn(usum, [mon("alakazam", "innerfocus", "psychoshift", { ...fast, target: PR }), mon("lapras", "shellarmor", null), lax(0), lax(4)]));
    expect(hitTexts(bare, OL, PR)).toEqual(["Psycho Shift fails: Alakazam has no status."]);
  });
});

describe("status2 A3: the field moves' clocks (F3 §4.3)", () => {
  it("a screen or Tailwind set this turn runs on a fresh clock; Trick Room and Gravity set this turn are World.fieldSet's", async () => {
    const runtime = await game(SV);
    const input = turn(runtime, [mon("talonflame", "galewings", "tailwind", fast), mon("smeargle", "owntempo", "trickroom"), lax(0), lax(4)]);
    const [only] = outcomes(input);
    expect(only.sides.own.clock).toEqual({ tailwind: "set" });
    expect(only.fieldSet).toEqual({ trickRoom: true });
    const safeguard = turn(runtime, [mon("smeargle", "owntempo", "safeguard", fast), lax(0), lax(4), lax(8)]);
    const [guarded] = outcomes(safeguard);
    expect(guarded.sides.own).toMatchObject({ safeguard: true, clock: { safeguard: "set" } });
  });
});
