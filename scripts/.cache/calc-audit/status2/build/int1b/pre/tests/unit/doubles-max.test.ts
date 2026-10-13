import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { MAX_GUARD_PASS, maxGuardAction, painSplitHP, WIRED } from "@/app/lib/battle/doubles-max";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesStep, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleStatus } from "@/app/lib/battle/types";

/**
 * Track M (status2 wave 1b, ADDENDUM2 §4.3 M; T2M §3.19, §3.24): the G-Max effects, Max Guard and Pain Split into a Dynamaxed
 * Pokémon, Sword/Shield. Every expected number is pinned Showdown c23d2e94's, from the oracle cases T2M-GM-01…09, T2M-PS-01/02,
 * IN-STL-04 (2v2/verify/cases-t2m-1b.ts, cases-in.ts) and Track M's own (status2/build/w1b-m/cases-m.ts M-*), which the app agrees
 * with (status2/build/W1B-M.md). Level 50, 31 IVs, 0 EVs, a Serious nature unless set. The parts that need the kernel's lines
 * (doubles-max.ts WIRED) run as `it.fails` until the integrator sets WIRED with the lines: they pass on the scratch tree that has
 * them (status2/build/w1b-m/patch-int.cjs, w1b-m/vitest.int.config.mts).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>; hp?: number; status?: BattleStatus;
  gender?: "M" | "F"; dynamax?: true; gmax?: true; carried?: DoublesCarried; lastItem?: string | null;
};
type Slot = (Mon & { move: string | null; target?: DoublesSlotId }) | null;
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const mon = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, ...extra });
const act = (m: Mon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, move, ...(target ? { target } : {}) });
const idle = (m: Mon): Slot => act(m, null);
/** The oracle's Snorlax stand-in at Speed 50 + n (2v2/verify/case-kit2.ts L). */
const lax = (n: number, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", { evs: { spe: n * 8 }, ...extra });
/** A Gigantamax Pokémon with 252 Speed EVs (male unless set). */
const gmax = (species: string, ability: string, extra: Partial<Mon> = {}) => mon(species, ability, { evs: { spe: 252 }, gender: "M", gmax: true, ...extra });
/** A Dynamaxed Snorlax with 252 Speed EVs: its status move is Max Guard. */
const guard = (extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", { evs: { spe: 252 }, dynamax: true, ...extra });
/** The slowest of a species (case-kit2.ts slowest): a Brave nature, 0 Speed IVs. */
const slowest: Partial<Mon> = { nature: "Brave", ivs: { spe: 0 } };

let swsh: BattleRuntime;
const runtime = async () => (swsh ??= await loadBattleRuntime("sword_shield"));

function buildOf(r: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, r);
  const configuration = { ...base.configuration, ...(m.gmax ? { dynamaxLevel: 10, gigantamax: true } : {}), ...(m.gender ? { gender: m.gender } : {}) };
  return {
    ...base, nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
    native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } }, configuration,
    ...(m.gmax ? { mechanic: "gigantamax" } : m.dynamax ? { mechanic: "dynamax" } : {}),
  } as BattleBuild;
}
function turn(r: BattleRuntime, slots: Slot[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const entry: DoublesPokemonInput = {
      build: buildOf(r, p), contexts: {}, charged: false, action: { moveId: p.move, target: p.target ?? null },
      ...(p.carried ? { carried: p.carried } : {}), ...(p.lastItem !== undefined ? { lastItem: p.lastItem } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime: r, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon, canSwitch: { own: true, opponent: true } };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "not-estimated" ? result.reason : result.status === "issues" ? result.issues : "")).toBe("ready");
  return result as Ready;
}
function reason(input: DoublesTurnInput): string {
  const result = calculateDoublesTurn(input);
  expect(result.status, JSON.stringify(result.status === "issues" ? result.issues : "")).toBe("not-estimated");
  return result.status === "not-estimated" ? result.reason : "";
}
const stepOf = (result: Ready, slot: DoublesSlotId): DoublesStep => result.steps.find((each) => each.slot === slot)!;
const facts = (list: { text: string; chance: number }[] | undefined) => (list ?? []).map((fact) => [fact.text, Number(fact.chance.toFixed(4))]);
const conditions = (result: Ready, slot: DoublesSlotId) => facts(result.hp[slot]!.conditions);
const hp = (result: Ready, slot: DoublesSlotId) => { const h = result.hp[slot]!; return [h.min, h.max, Number(h.average.toFixed(4))]; };
/** E2's chance of a Pokémon state (calculateDoublesOutcomes). */
function e2(input: DoublesTurnInput, test: (mon: NonNullable<Extract<ReturnType<typeof calculateDoublesOutcomes>, { status: "ready" }>["outcomes"][number]["mons"][DoublesSlotId]>) => boolean, slot: DoublesSlotId): number {
  const result = calculateDoublesOutcomes(input);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return NaN;
  return Number(result.outcomes.reduce((sum, outcome) => sum + (outcome.mons[slot] && test(outcome.mons[slot]!) ? outcome.chance : 0), 0).toFixed(6));
}
/** `it` once the integrator's kernel lines for `part` are in (doubles-max.ts WIRED), `it.fails` until then. */
const wired = (part: keyof typeof WIRED) => (WIRED[part] ? it : it.fails);

describe("G-Max effects in the hit (doubles-max.ts maxEffects, in place)", () => {
  it("G-Max Smite and Gold Rush confuse every foe (T2M-GM-01, -02); Misty Terrain, Safeguard and Own Tempo stop it, a Persim Berry cures it (M-GM-12, -12b, -13)", async () => {
    const r = await runtime();
    const smite = ready(turn(r, [act(gmax("hatterene", "magicbounce", { gender: "F" }), "dazzlinggleam", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))]));
    expect(conditions(smite, PL)).toEqual([["Confused.", 1]]);
    expect(conditions(smite, PR)).toEqual([["Confused.", 1]]);
    expect(hp(smite, PR)).toEqual([102, 147, 130.4181]);
    expect(facts(stepOf(smite, OL).facts)).toContainEqual(["G-Max Smite: Snorlax (opponent's, 1) is confused.", 1]);
    const goldRush = ready(turn(r, [act(gmax("meowth", "pickup"), "payday", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))]));
    expect(conditions(goldRush, PL)).toEqual([["Confused.", 1]]);
    expect(conditions(goldRush, PR)).toEqual([["Confused.", 1]]);
    const misty = ready(turn(r, [act(gmax("hatterene", "magicbounce", { gender: "F" }), "dazzlinggleam", PR), idle(lax(1)), idle(mon("slowbro", "owntempo")), idle(lax(3, { item: "persimberry" }))], { terrain: "Misty" }));
    expect(conditions(misty, PL)).toEqual([]);
    expect(conditions(misty, PR)).toEqual([]);
    const tempo = ready(turn(r, [act(gmax("hatterene", "magicbounce", { gender: "F" }), "dazzlinggleam", PR), idle(lax(1)), idle(mon("slowbro", "owntempo")), idle(lax(3, { item: "persimberry" }))]));
    expect(conditions(tempo, PL)).toEqual([]);
    expect(conditions(tempo, PR)).toEqual([["Holds no item.", 1]]);
    expect(facts(stepOf(tempo, OL).hits.find((hit) => hit.slot === PR)!.facts)).toEqual([["G-Max Smite: Snorlax (opponent's) is confused.", 1], ["Snorlax (opponent's) eats its Persim Berry: its confusion ends.", 1]]);
    const safeguard = turn(r, [act(gmax("hatterene", "magicbounce", { gender: "F" }), "dazzlinggleam", PR), idle(lax(1)), idle(lax(2)), idle(lax(3, { item: "persimberry" }))]);
    safeguard.field = { ...safeguard.field, defenderSide: { ...safeguard.field.defenderSide, safeguard: true } };
    const guarded = ready(safeguard);
    expect(conditions(guarded, PL)).toEqual([]);
    expect(conditions(guarded, PR)).toEqual([]);
  });

  it("G-Max Cuddle infatuates the foe of the other gender, Destiny Knot back, Mental Herb ends it; an unset gender is not estimated (T2M-GM-03, M-GM-03b, -14, -15)", async () => {
    const r = await runtime();
    const cuddle = ready(turn(r, [act(gmax("eevee", "runaway"), "bodyslam", PR), idle(lax(1)), idle(lax(2, { gender: "M" })), idle(lax(3, { gender: "F" }))]));
    expect(conditions(cuddle, PR)).toEqual([["Infatuated.", 1]]);
    expect(conditions(cuddle, PL)).toEqual([]);
    expect(hp(cuddle, PR)).toEqual([157, 169, 163.875]);
    const knot = ready(turn(r, [act(gmax("eevee", "runaway"), "bodyslam", PR), act(lax(1), "bodyslam", PL), idle(lax(2, { gender: "M" })), idle(lax(3, { gender: "F", item: "destinyknot" }))]));
    expect(conditions(knot, OL)).toEqual([["Infatuated.", 1]]);
    expect(facts(stepOf(knot, OL).hits.find((hit) => hit.slot === PR)!.facts)).toContainEqual(["Destiny Knot: Eevee becomes infatuated too.", 1]);
    expect(hp(knot, PL)).toEqual([147, 160, 154.0625]);
    const herb = ready(turn(r, [act(gmax("eevee", "runaway"), "bodyslam", PR), idle(lax(1)), idle(lax(2, { gender: "F" })), idle(lax(3, { gender: "F", item: "mentalherb" }))]));
    expect(conditions(herb, PL)).toEqual([["Infatuated.", 1]]);
    expect(conditions(herb, PR)).toEqual([["Holds no item.", 1]]);
    expect(reason(turn(r, [act(gmax("eevee", "runaway"), "bodyslam", PR), idle(lax(1)), idle(lax(2)), idle(lax(3, { gender: "F" }))]))).toBe("G-Max Cuddle needs Snorlax (opponent's, 1)'s gender.");
  });

  it("G-Max Chi Strike gives its side a critical-hit stage: a slower Scope Lens ally's Stone Edge is then always critical (T2M-GM-04)", async () => {
    const r = await runtime();
    const input = turn(r, [act(gmax("machamp", "guts"), "closecombat", PR), act(mon("garchomp", "roughskin", { item: "scopelens", ...slowest }), "stoneedge", PL), idle(lax(2)), idle(lax(3))]);
    const result = ready(input);
    expect(facts(stepOf(result, OL).facts)).toEqual([["G-Max Chi Strike: Machamp's critical-hit ratio rises.", 1], ["G-Max Chi Strike: Garchomp's critical-hit ratio rises.", 1]]);
    expect(stepOf(result, OR).hits[0]).toMatchObject({ slot: PL, min: 110, max: 130 });
    expect(hp(result, PL)).toEqual([105, 125, 115.1875]);
    expect(e2(input, (m) => m.chiStrike === 1, OR)).toBe(1);
  });

  wired("chiStrike")("G-Max Chi Strike on the card and in E2's volatiles (T2M-GM-04)", async () => {
    const r = await runtime();
    const input = turn(r, [act(gmax("machamp", "guts"), "closecombat", PR), act(mon("garchomp", "roughskin", { item: "scopelens", ...slowest }), "stoneedge", PL), idle(lax(2)), idle(lax(3))]);
    const result = ready(input);
    expect(conditions(result, OL)).toEqual([["G-Max Chi Strike +1.", 1]]);
    expect(conditions(result, OR)).toEqual([["G-Max Chi Strike +1.", 1]]);
    expect(e2(input, (m) => !!m.volatiles?.includes("gmaxchistrike"), OL)).toBe(1);
  });

  it("G-Max Finale heals its side a sixth of each maximum (T2M-GM-05); with Life Orb it is not estimated (the heal comes first: M-GM-24)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("alcremie", "sweetveil", { gender: "F" }), "dazzlinggleam", PR), idle(lax(1, { hp: 100 })), idle(lax(2)), idle(lax(3))]));
    expect(hp(result, OR)).toEqual([139, 139, 139]);
    expect(result.hp[OR]!.heals).toEqual(["G-Max Finale: +39 HP."]);
    expect(reason(turn(r, [act(gmax("alcremie", "sweetveil", { gender: "F", item: "lifeorb" }), "dazzlinggleam", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))])))
      .toBe("G-Max Finale with Life Orb is not modelled in 2v2.");
  });

  it("G-Max Wind Rage ends the foe side's Safeguard: a slower Thunder Wave then paralyses (M-GM-10)", async () => {
    const r = await runtime();
    const input = turn(r, [act(gmax("corviknight", "pressure"), "bravebird", PR), act(mon("lanturn", "voltabsorb", slowest), "thunderwave", PL), idle(lax(2)), idle(lax(3))]);
    input.field = { ...input.field, defenderSide: { ...input.field.defenderSide, safeguard: true } };
    const result = ready(input);
    expect(facts(stepOf(result, OL).facts)).toEqual([["G-Max Wind Rage: Safeguard ends on the opponent's side.", 1]]);
    expect(conditions(result, PL)).toEqual([["Paralysed.", 1]]);
  });

  it("G-Max Meltdown uses up a foe's Mental Herb on its Torment; a slower Knock Off finds no item (M-GM-11)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("melmetal", "ironfist", { nature: "Jolly", gender: undefined }), "ironhead", PR), act(mon("bisharp", "defiant", slowest), "knockoff", PR),
      idle(lax(2)), idle(lax(3, { item: "mentalherb" }))]));
    expect(stepOf(result, OR).hits[0]).toMatchObject({ slot: PR, min: 69, max: 82 });
    expect(result.hp[PR]!.koChance).toBeCloseTo(0.27734375, 10);
  });

  it("G-Max Terror traps a foe but not a Ghost type; G-Max Stonesurge sets Stealth Rock (M-GM-22, -23)", async () => {
    const r = await runtime();
    const terror = turn(r, [act(gmax("gengar", "cursedbody"), "shadowball", PL), idle(lax(1)), idle(mon("garchomp", "roughskin")), idle(mon("dusclops", "pressure"))]);
    expect(facts(stepOf(ready(terror), OL).hits[0].facts)).toEqual([["Garchomp can no longer switch out.", 1]]);
    expect(e2(terror, (m) => !!m.volatiles?.includes("trapped"), PL)).toBe(1);
    expect(e2(terror, (m) => !!m.volatiles?.includes("trapped"), PR)).toBe(0);
    const stones = calculateDoublesOutcomes(turn(r, [act(gmax("drednaw", "strongjaw"), "liquidation", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))]));
    expect(stones.status === "ready" && stones.outcomes.every((outcome) => outcome.sides.opponent.hazards?.includes("stealthrock"))).toBe(true);
  });

  it("G-Max Gravitas starts Gravity: a later Earthquake hits the Levitate foe (M-GM-21); G-Max Sweetness cures its ally (M-GM-20)", async () => {
    const r = await runtime();
    const gravitas = ready(turn(r, [act(gmax("orbeetle", "swarm"), "psychic", PR), act(mon("garchomp", "roughskin", slowest), "earthquake"), idle(mon("bronzong", "levitate", slowest)), idle(lax(3))]));
    expect(stepOf(gravitas, OR).hits.find((hit) => hit.slot === PL)).toMatchObject({ min: 102, max: 122 });
    const sweet = ready(turn(r, [act(gmax("appletun", "ripen"), "gigadrain", PR), idle(lax(1, { status: "slp" })), idle(lax(2)), idle(lax(3))]));
    expect(conditions(sweet, OR)).toEqual([["Status cured.", 1]]);
  });

  it("G-Max Replenish needs the last item of a Pokémon of its side that holds nothing", async () => {
    const r = await runtime();
    expect(reason(turn(r, [act(gmax("snorlax", "thickfat"), "bodyslam", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))])))
      .toBe("G-Max Replenish needs Snorlax (yours, 1)'s item from an earlier turn.");
  });
});

describe("G-Max random effects (WIRED.worlds: maxEffects' worlds at its call sites)", () => {
  wired("worlds")("G-Max Befuddle: each foe asleep, paralysed or poisoned, 1/3 each (T2M-GM-06); Electric Terrain and Insomnia keep sleep off (M-GM-16)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("butterfree", "compoundeyes"), "bugbuzz", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))]));
    expect(conditions(result, PL)).toEqual([["Asleep.", 0.3333], ["Paralysed.", 0.3333], ["Poisoned.", 0.3333]]);
    expect(result.endOfTurn.status === "ready" && result.endOfTurn.hp[PR]!.average).toBeCloseTo(156.5833, 3);
    const terrain = ready(turn(r, [act(gmax("butterfree", "compoundeyes"), "bugbuzz", PR), idle(lax(1)), act(mon("noctowl", "insomnia", slowest), "airslash", OL), act(lax(3, { item: "chestoberry" }), "bodyslam", OL)], { terrain: "Electric" }));
    expect(conditions(terrain, PL)).toEqual([["Paralysed.", 0.3333], ["Poisoned.", 0.3333]]);
    expect(hp(terrain, OL)).toEqual([56, 270, 90.6771]);
  });

  wired("worlds")("G-Max Befuddle's sleep and a Chesto Berry; the foes' later moves read the statuses (M-GM-17)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("butterfree", "compoundeyes"), "bugbuzz", PR), idle(lax(1)), act(lax(2), "bodyslam", OL), act(lax(3, { item: "chestoberry" }), "bodyslam", OL)]));
    expect(hp(result, OL)).toEqual([58, 270, 123.5625]);
    expect(facts(stepOf(result, PL).skipped)).toEqual([["Asleep.", 0.3333], ["Fully paralysed.", 0.0833]]);
  });

  wired("worlds")("G-Max Stun Shock: paralysed or poisoned 1/2 each (T2M-GM-07); Poison and Electric types are immune to theirs (M-GM-18)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("toxtricity", "punkrock"), "overdrive", PR), idle(lax(1)), idle(lax(2)), idle(lax(3))]));
    expect(conditions(result, PR)).toEqual([["Paralysed.", 0.5], ["Poisoned.", 0.5]]);
    const immune = ready(turn(r, [act(gmax("toxtricity", "punkrock"), "overdrive", PL), idle(lax(1)), act(mon("garbodor", "stench", slowest), "bodyslam", OL), act(mon("jolteon", "quickfeet", slowest), "pinmissile", OL)]));
    expect(conditions(immune, PL)).toEqual([["Paralysed.", 0.5]]);
    expect(conditions(immune, PR)).toEqual([["Poisoned.", 0.5]]);
    expect(hp(immune, OL)).toEqual([216, 290, 239.6922]);
  });

  wired("worlds")("G-Max Replenish: 1/2 for the move, the side's eaten Berries come back; a due Sitrus Berry is eaten at the hit's Update (T2M-GM-08, M-GM-19)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(gmax("snorlax", "thickfat", { lastItem: "lumberry" }), "bodyslam", PR), idle(lax(1, { lastItem: "sitrusberry" })), idle(lax(2)), idle(lax(3))]));
    expect(conditions(result, OL)).toEqual([["Holds Lum Berry.", 0.5]]);
    expect(conditions(result, OR)).toEqual([["Holds Sitrus Berry.", 0.5]]);
    const sitrus = ready(turn(r, [act(gmax("snorlax", "thickfat", { lastItem: null }), "bodyslam", PR), idle(lax(1, { hp: 90, lastItem: "sitrusberry" })), idle(lax(2)), idle(lax(3))]));
    expect(hp(sitrus, OR)).toEqual([90, 148, 119]);
  });
});

describe("Max Guard (WIRED.maxGuard: a Dynamaxed Pokémon's status move)", () => {
  wired("maxGuard")("blocks a foe's Max Move (T2M-GM-09) and is named as used", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(guard(), "curse"), idle(lax(1)), idle(lax(3)), act(mon("garchomp", "roughskin", { dynamax: true }), "dragonclaw", OL)]));
    expect(stepOf(result, OL)).toMatchObject({ moveId: "curse", effectiveName: "Max Guard" });
    expect(stepOf(result, PR).hits[0]).toMatchObject({ slot: OL, kind: "blocked" });
    expect(hp(result, OL)).toEqual([470, 470, 470]);
  });

  wired("maxGuard")("lets Feint through at full damage and stays up for a later Dragon Claw (M-MG-01)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(guard(), "amnesia"), idle(lax(1)), act(mon("garchomp", "roughskin", slowest), "dragonclaw", OL), act(mon("weavile", "pressure"), "feint", OL)]));
    expect(stepOf(result, PR).hits[0]).toMatchObject({ slot: OL, kind: "calculated", min: 19, max: 23 });
    expect(stepOf(result, PL).hits[0]).toMatchObject({ slot: OL, kind: "blocked" });
    expect(hp(result, OL)).toEqual([447, 451, 449.1875]);
  });

  wired("maxGuard")("blocks a status move with no protect flag read, lets its ally's Coaching through (M-MG-02)", async () => {
    const r = await runtime();
    const result = ready(turn(r, [act(guard(), "amnesia"), act(mon("machamp", "guts", slowest), "coaching"), idle(lax(2)), act(mon("jolteon", "voltabsorb"), "thunderwave", OL)]));
    expect(facts(stepOf(result, PR).hits[0].facts)).toEqual([["Max Guard blocks Thunder Wave.", 1]]);
    expect(facts(stepOf(result, OR).hits.find((hit) => hit.slot === OL)!.facts)).toEqual([["+1 Attack.", 1], ["+1 Defense.", 1]]);
  });

  wired("maxGuard")("rolls the stall counter from last turn: 1/3 with 3 (IN-STL-04, M-MG-03); fails with no Pokémon to move after it (M-MG-04)", async () => {
    const r = await runtime();
    const stall = ready(turn(r, [act(guard({ carried: { stall: 3 } }), "amnesia"), idle(lax(1)), act(mon("garchomp", "roughskin"), "dragonclaw", OL), idle(lax(3))]));
    expect(facts(stepOf(stall, OL).facts)).toEqual([["Max Guard fails.", 0.6667]]);
    expect(hp(stall, OL)).toEqual([374, 470, 411.375]);
    expect(stall.facts).not.toContain("Assumes no protecting move was used last turn.");
    const last = ready(turn(r, [act(guard({ evs: {}, ...slowest }), "amnesia"), null, null, act(mon("jolteon", "voltabsorb", { evs: { spe: 252 } }), "protect")]));
    expect(facts(stepOf(last, OL).facts)).toEqual([["Max Guard fails: no Pokémon moves after it.", 1]]);
    expect(stepOf(last, OL).order).toEqual([{ position: 2, chance: 1 }]);
  });

  wired("maxGuard")("moves at priority 4 (+1 with Prankster): before Fake Out, Quick Attack and a faster Protect (M-MG-05, -07)", async () => {
    const r = await runtime();
    const fast = ready(turn(r, [act(guard({ evs: {} }), "amnesia"), idle(lax(1)), act(mon("incineroar", "blaze", { evs: { spe: 252 } }), "fakeout", OL), act(mon("lucario", "innerfocus", { evs: { spe: 252 } }), "quickattack", OL)]));
    expect(stepOf(fast, OL).order).toEqual([{ position: 1, chance: 1 }]);
    expect(facts(stepOf(fast, PL).hits[0].facts)).toEqual([["Max Guard blocks Fake Out.", 1]]);
    expect(fast.facts).toContain("Assumes no protecting move was used last turn.");
    const prankster = ready(turn(r, [act(mon("whimsicott", "prankster", { dynamax: true }), "tailwind"), idle(lax(1)), act(mon("jolteon", "voltabsorb", { evs: { spe: 252 } }), "protect"), act(mon("garchomp", "roughskin"), "dragonclaw", OL)]));
    expect(stepOf(prankster, OL).order).toEqual([{ position: 1, chance: 1 }]);
  });

  wired("maxGuard")("lets G-Max One Blow through at full damage (M-MG-06); blocks Unseen Fist's Wicked Blow (M-MG-08)", async () => {
    const r = await runtime();
    const blow = ready(turn(r, [act(guard(), "amnesia"), idle(lax(1)), idle(lax(2)), act(mon("urshifu", "unseenfist", { gmax: true }), "wickedblow", OL)]));
    expect(stepOf(blow, PR)).toMatchObject({ effectiveName: "G-Max One Blow" });
    expect(stepOf(blow, PR).hits[0]).toMatchObject({ kind: "calculated", min: 129, max: 153 });
    const fist = ready(turn(r, [act(guard(), "amnesia"), idle(lax(1)), idle(lax(2)), act(mon("urshifu", "unseenfist"), "wickedblow", OL)]));
    expect(facts(stepOf(fist, PR).hits[0].facts)).toEqual([["Max Guard blocks Wicked Blow.", 1]]);
  });
});

describe("Pain Split into a Dynamaxed Pokémon (WIRED.painSplit)", () => {
  it("averages with the target's undynamaxed HP and moves its Dynamaxed HP by the difference (painSplitHP; T2-PS01)", async () => {
    const r = await runtime();
    const hpOf: Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }> = {
      [OL]: { maxHP: 135, baseMaxHP: 135 }, [OR]: { maxHP: 235, baseMaxHP: 235 }, [PL]: { maxHP: 235, baseMaxHP: 235 }, [PR]: { maxHP: 470, baseMaxHP: 235 },
    } as Record<DoublesSlotId, { maxHP: number; baseMaxHP: number }>;
    const kernel = { hp: hpOf } as unknown as TurnKernel;
    const world = { mons: { [PR]: { build: buildOf(r, mon("snorlax", "thickfat", { dynamax: true })) }, [OR]: { build: buildOf(r, lax(1)) } } } as unknown as World;
    expect(painSplitHP(kernel, world, OL, PR, 100, 300)).toEqual([125, 275]);
    expect(painSplitHP(kernel, world, OL, PR, 135, 100)).toEqual([92, 142]);
    expect(painSplitHP(kernel, world, OL, OR, 100, 200)).toEqual([135, 150]);
    expect(painSplitHP(kernel, world, OL, OR, 1, 0)).toEqual([1, 1]);
  });

  wired("painSplit")("in the turn (T2M-PS-01, -02, M-PS-03)", async () => {
    const r = await runtime();
    const one = ready(turn(r, [act(mon("gengar", "cursedbody", { hp: 100, evs: { spe: 252 } }), "painsplit", PR), idle(lax(1)), idle(lax(2)), act(mon("snorlax", "thickfat", { hp: 150, dynamax: true }), "bodyslam", OR)]));
    expect(hp(one, OL)).toEqual([125, 125, 125]);
    expect(hp(one, PR)).toEqual([275, 275, 275]);
    const two = ready(turn(r, [act(mon("gengar", "cursedbody", { evs: { spe: 252 } }), "painsplit", PR), idle(lax(1)), idle(lax(2)), act(mon("snorlax", "thickfat", { hp: 50, dynamax: true }), "bodyslam", OR)]));
    expect(hp(two, OL)).toEqual([92, 92, 92]);
    expect(hp(two, PR)).toEqual([142, 142, 142]);
    const three = ready(turn(r, [act(mon("gengar", "cursedbody", { hp: 37, evs: { spe: 252 } }), "painsplit", PR), idle(lax(1)), idle(lax(2)), act(mon("snorlax", "thickfat", { hp: 151, evs: { hp: 12 }, dynamax: true }), "bodyslam", OR)]));
    expect(hp(three, OL)).toEqual([94, 94, 94]);
    expect(hp(three, PR)).toEqual([245, 245, 245]);
  });
});

describe("Track M's helpers", () => {
  it("Max Guard's pass list is Showdown's 27 moves (PS/data/moves.ts:11183-11185)", () => {
    expect(MAX_GUARD_PASS.size).toBe(27);
    for (const id of ["feint", "gmaxoneblow", "gmaxrapidflow", "coaching", "perishsong", "roar"]) expect(MAX_GUARD_PASS.has(id)).toBe(true);
    for (const id of ["thunderwave", "helpinghand", "teatime", "gearup"]) expect(MAX_GUARD_PASS.has(id)).toBe(false);
  });

  it("a Max Guard action is a Dynamaxed Pokémon's status move as entered", async () => {
    const r = await runtime();
    const input = turn(r, [act(guard(), "amnesia"), act(lax(1), "amnesia"), act(mon("garchomp", "roughskin", { dynamax: true }), "dragonclaw", OL), idle(lax(3))]);
    expect(maxGuardAction(input, OL)).toBe(true);
    expect(maxGuardAction(input, OR)).toBe(false);
    expect(maxGuardAction(input, PL)).toBe(false);
    expect(maxGuardAction(input, PR)).toBe(false);
  });

  it("keeps today's reasons until the kernel lines are in (WIRED false)", async () => {
    const r = await runtime();
    if (WIRED.maxGuard) return;
    expect(reason(turn(r, [act(guard(), "amnesia"), idle(lax(1)), idle(lax(3)), act(mon("garchomp", "roughskin"), "dragonclaw", OL)]))).toBe("Max Guard is not modelled.");
    expect(reason(turn(r, [act(mon("gengar", "cursedbody", { hp: 100 }), "painsplit", PR), idle(lax(1)), idle(lax(2)), idle(mon("snorlax", "thickfat", { dynamax: true }))])))
      .toBe("Pain Split with a Dynamaxed Pokémon is not modelled in 2v2.");
  });
});
