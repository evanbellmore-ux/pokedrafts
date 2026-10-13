import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { CRASH_MOVES } from "@/app/lib/battle/status-table";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 Step 1 (SPEC2 §8.2, ADDENDUM2 §8.2): the engine's correctness fixes, each on the oracle case that reproduced it
 * (scripts/.cache/calc-audit/2v2/verify/cases-status2-step1.ts, against pinned Showdown c23d2e94: the numbers are the
 * oracle's, the texts the app's facts). The generated tests/unit/doubles-turn-showdown.test.ts holds every case's whole
 * turn; these pin each fix's own point. Level 50, 31 IVs, Serious, 0 EVs (Stat Points in Champions) unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; substitute?: number;
  build?: Partial<BattleBuild>; earlierThisTurn?: DoublesPokemonInput["earlierThisTurn"]; switchedIn?: true;
  move: string | null; target?: DoublesSlotId;
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

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...trained, ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const carried = { ...m.carried, ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(Object.keys(carried).length ? { carried } : {}), ...(m.earlierThisTurn ? { earlierThisTurn: m.earlierThisTurn } : {}), ...(m.switchedIn ? { switchedIn: true as const } : {}),
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
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)!;
const texts = (facts: { text: string }[] | undefined) => (facts ?? []).map((fact) => fact.text);
const orderOf = (result: Ready, slot: DoublesSlotId) => Object.fromEntries(stepOf(result, slot).order.map((entry) => [entry.position, entry.chance]));

describe("status2 Step 1: the engine's correctness fixes", () => {
  it("#2 G4-SFL-01-champions: a Sheer Force Crunch into a Berserk Sitrus holder, then a later hit on it (status2 D: ready, as pinned Showdown)", async () => {
    const runtime = await game(CHAMPIONS);
    const drampa = mon("drampa", "berserk", "dragonpulse", { item: "sitrusberry", hp: 140, target: PR });
    const result = ready(turn(runtime, [drampa, mon("venusaur", "overgrow", null, { evs: { spe: 4 } }),
      mon("feraligatr", "sheerforce", "crunch", { evs: { atk: 32, spe: 32 }, target: OL }), mon("snorlax", "thickfat", "bodyslam", { target: OL })]));
    // The stored oracle (G4-SFL-01-champions): Crunch 59–70, then Body Slam 60–72 into the locked holder.
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 59, max: 70 });
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 60, max: 72 });
    expect(REASONS.berryLockedSheerForce("Berserk", "Sitrus Berry")).toBe("Sitrus Berry held by Berserk after a Sheer Force hit is not modelled in 2v2.");
  });

  it("#2 G4-SFL-02b-champions (E2): the lock stands to the end of the turn: the Sitrus Berry is still held (Showdown: 1)", async () => {
    const runtime = await game(CHAMPIONS);
    const input = turn(runtime, [mon("drampa", "berserk", null, { item: "sitrusberry", hp: 100 }), mon("venusaur", "overgrow", null, { evs: { spe: 4 } }),
      mon("steelix", "sheerforce", "crunch", { evs: { atk: 32 }, target: OL }), lax(8)]);
    expect(hitOf(ready(input), PL, OL)).toMatchObject({ min: 51, max: 61 });
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.reduce((sum, o) => sum + (o.mons[OL]?.build.itemId === "sitrusberry" ? o.chance : 0), 0)).toBeCloseTo(1, 9);
  });

  it("#3 F2-CC1/CC2-usum: Color Change makes Kecleon Electric after Thunderbolt (Earthquake 140–168, a KO); not behind a Substitute", async () => {
    const runtime = await game(USUM);
    const slots = (kecleon: Mon) => [mon("jolteon", "voltabsorb", "thunderbolt", { evs: { spe: 252 }, target: PL }), mon("chansey", "naturalcure", null), kecleon, mon("garchomp", "roughskin", "earthquake")];
    const changed = ready(turn(runtime, slots(mon("kecleon", "colorchange", null))));
    expect(texts(hitOf(changed, OL, PL).facts)).toContain("Color Change: Kecleon becomes Electric type.");
    expect(hitOf(changed, PR, PL)).toMatchObject({ min: 140, max: 168, koChance: 1 });
    const behind = ready(turn(runtime, slots(mon("kecleon", "colorchange", null, { substitute: 33 }))));
    expect(texts(hitOf(behind, OL, PL).facts).some((text) => text.startsWith("Color Change"))).toBe(false);
    expect(behind.hp[PL]).toMatchObject({ min: 51, max: 65 });
  });

  it("#4 G4-TRC-01-sv: Trace's copied Insomnia cures its holder: the cure fact, no lost-sleep-turns assumption", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("gardevoir", "trace", "psychic", { status: "slp", evs: { spe: 252 }, target: PL, build: { tracedAbility: "insomnia" } }),
      mon("snorlax", "thickfat", null, { evs: { spe: 4 } }), mon("hypno", "insomnia", null), mon("hypno", "insomnia", null, { evs: { spe: 8 } })]));
    expect(result.facts).toContain("Insomnia: Gardevoir is cured of its sleep as the turn starts.");
    expect(result.facts.some((text) => text.startsWith("Assumes Gardevoir lost no turns to sleep"))).toBe(false);
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 27, max: 33 });
  });

  it("#5 G4-CRS-01-sv: Ghost Curse's cost is a loss on its user's card and its faint a step fact", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("gengar", "cursedbody", "curse", { hp: 60, evs: { spe: 252 }, target: PL }), lax(4), lax(8), lax(12)]));
    expect(texts(result.hp[OL]!.losses)).toEqual(["Gengar loses 67 HP (Curse)."]);
    expect(texts(stepOf(result, OL).facts)).toContain("Gengar faints.");
    expect(texts(stepOf(result, OL).facts).some((text) => text.startsWith("Curse:"))).toBe(false);
    expect(result.hp[OL]).toMatchObject({ min: 0, max: 0 });
  });

  it("#6 canStatus: the type immunity comes before Comatose (a Steel-Terastallized Komala against Toxic)", async () => {
    const runtime = await game(SV);
    const komala = mon("komala", "comatose", null, { build: { mechanic: "tera", configuration: { teraType: "Steel" } } as Partial<BattleBuild> });
    const result = ready(turn(runtime, [mon("smeargle", "owntempo", "toxic", { evs: { spe: 252 }, target: PL }), lax(4), komala, lax(12)]));
    const said = [...texts(stepOf(result, OL).facts), ...stepOf(result, OL).hits.flatMap((hit) => texts(hit.facts))];
    expect(said.join(" | ")).toMatch(/Komala is immune\./);
    expect(said.join(" | ")).not.toMatch(/Comatose/);
  });

  it("#9 T2P-UNB-01-sv / -02-usum / -05-usum: Unburden at the first Update; USUM's order reads the status the Lum Berry cured", async () => {
    const holder = (species: string, move: string) => mon(species, "unburden", move, { item: "lumberry", status: "par", target: PR });
    const sv = ready(turn(await game(SV), [holder("sneasler", "poisonjab"), lax(8), lax(16), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]));
    expect(orderOf(sv, OL)).toEqual({ 1: 1 });
    expect(sv.hp[OL]).toMatchObject({ min: 34, max: 51 });
    const usum = ready(turn(await game(USUM), [holder("hawlucha", "tackle"), lax(8), lax(16), mon("garchomp", "roughskin", "dragonclaw", { target: OL })]));
    expect(orderOf(usum, PR)).toEqual({ 1: 1 });
    expect(orderOf(usum, OL)).toEqual({ 2: 1 });
    expect(usum.hp[OL]).toMatchObject({ min: 49, max: 62 });
    // T2P-UNB-05-usum: the burn the Lum Berry cures is on Jolteon as USUM sorts: Quick Feet's 225 before Crobat's 182.
    const feet = ready(turn(await game(USUM), [mon("jolteon", "quickfeet", "thunderbolt", { item: "lumberry", status: "brn", target: PR }), lax(8), lax(16),
      mon("crobat", "innerfocus", "bravebird", { evs: { spe: 252 }, target: OL })]));
    expect(orderOf(feet, OL)).toEqual({ 1: 1 });
    expect(orderOf(feet, PR)).toEqual({ 2: 1 });
  });

  it("#10 FX-CR-01-sv: High Jump Kick into Protect: the kicker loses half its maximum HP (62 of 125)", async () => {
    expect([...CRASH_MOVES].sort()).toEqual(["axekick", "highjumpkick", "jumpkick", "supercellslam"]);
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("dragonite", "innerfocus", "protect", { evs: { spe: 252 } }), lax(4), mon("hitmonlee", "limber", "highjumpkick", { target: OL }), lax(8)]));
    expect(texts(result.hp[PL]!.losses)).toEqual(["Hitmonlee loses 62 HP (High Jump Kick)."]);
    expect(result.hp[PL]).toMatchObject({ start: 125, min: 63, max: 63 });
  });

  it("#12 FX-BJ-01-sv: Burning Jealousy burns the foe whose Attack rose this turn; a raise from before the turn is an assumption", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("torkoal", "whitesmoke", "burningjealousy"), lax(20), mon("lucario", "innerfocus", "swordsdance", { evs: { spe: 252 } }), lax(24)]));
    expect(texts(hitOf(result, OL, PL).facts)).toContain("Burning Jealousy: Lucario is burned.");
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 68, max: 84 });
    expect(result.endOfTurn.status === "ready" && result.endOfTurn.hp[PL]).toMatchObject({ min: 52, max: 68 });
    // A stage given before the turn without earlierThisTurn: the app assumes no rise this turn (no burn), and says so.
    const before = ready(turn(runtime, [mon("torkoal", "whitesmoke", "burningjealousy"), lax(20), mon("lucario", "innerfocus", null, { evs: { spe: 252 }, boosts: { atk: 2 } }), lax(24)]));
    expect(before.facts).toContain("Assumes Lucario's stats did not rise earlier this turn.");
    expect(texts(hitOf(before, OL, PL).facts).some((text) => text.startsWith("Burning Jealousy"))).toBe(false);
    // The same with earlierThisTurn.statsRaised (CQ-ETT-01): burned, no assumption.
    const raised = ready(turn(runtime, [mon("torkoal", "whitesmoke", "burningjealousy"), lax(20), mon("lucario", "innerfocus", null, { evs: { spe: 252 }, boosts: { atk: 2 }, earlierThisTurn: { statsRaised: true } }), lax(24)]));
    expect(raised.facts.some((text) => text.startsWith("Assumes"))).toBe(false);
    expect(texts(hitOf(raised, OL, PL).facts)).toContain("Burning Jealousy: Lucario is burned.");
  });

  it("#13 FX-ST-01-swsh (E2): Spectral Thief takes the target's +2 Attack before the hit", async () => {
    const runtime = await game(SWSH);
    const input = turn(runtime, [mon("marshadow", "technician", "spectralthief", { evs: { spe: 252 }, target: PL }), lax(20), mon("lucario", "justified", null, { boosts: { atk: 2 }, evs: { spe: 100 } }), lax(24)]);
    const result = ready(input);
    expect(texts(hitOf(result, OL, PL).facts)).toContain("Spectral Thief: Marshadow takes Lucario's +2 Attack.");
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 163, max: 193, koChance: 1 });
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.reduce((sum, o) => sum + (o.mons[OL]?.build.boosts.atk === 2 ? o.chance : 0), 0)).toBeCloseTo(1, 9);
  });

  it("#8 (engine side): Stored Power with an evasion stage from an earlier turn counts it (status2 D; G4-STP cases agree)", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("espathra", "opportunist", "storedpower", { target: PL, carried: { stages: { evasion: 1 } } }), lax(4), lax(8), lax(12)]));
    // +1 evasion: Stored Power at 40, as +1 Attack would give it (one positive stage).
    const atk = ready(turn(runtime, [mon("espathra", "opportunist", "storedpower", { target: PL, boosts: { atk: 1 } }), lax(4), lax(8), lax(12)]));
    expect(hitOf(result, OL, PL)).toMatchObject({ min: hitOf(atk, OL, PL).min, max: hitOf(atk, OL, PL).max });
  });

  it("#14 IN-SW02-sv: Payback into a Pokémon that switched in this turn is not doubled (51–61); it takes no action", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("tyranitar", "unnerve", "payback", { target: PL }), lax(28), lax(12, null, { switchedIn: true }), lax(24)]));
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 51, max: 61 });
    expect(result.steps.map((step) => step.slot)).toEqual([OL]);
    expect(result.facts).toContain("Snorlax (opponent's, 1) switched in this turn and takes no action.");
  });

  it("#11 CQ-ETT-02-sv: Lash Out after a drop earlier this turn is doubled (93–111)", async () => {
    const runtime = await game(SV);
    const lasher = (earlier: boolean) => mon("grimmsnarl", "pickpocket", "lashout", { boosts: { atk: -1 }, target: OR, ...(earlier ? { earlierThisTurn: { statsLowered: true } } : {}) });
    const slots = (earlier: boolean) => [mon("incineroar", "intimidate", null, { evs: { spe: 252 } }), lax(28), mon("kingambit", "defiant", null, { evs: { spe: 4 }, boosts: { atk: 1 } }), lasher(earlier)];
    expect(hitOf(ready(turn(runtime, slots(true))), PR, OR)).toMatchObject({ min: 93, max: 111 });
    const plain = hitOf(ready(turn(runtime, slots(false))), PR, OR);
    expect(plain.max).toBeLessThan(93);
  });
});
