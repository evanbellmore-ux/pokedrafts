import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import * as hidden from "@/app/lib/battle/doubles-hidden";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesOutcomesResult, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { MonState, PendingAction, World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * Track H (status2 ADDENDUM2 §4.2 H; T2M §3.1, C20, C21, C24, C27, C38): the hidden state of Fly, Bounce, Dig, Dive, Phantom
 * Force, Shadow Force and Sky Drop, against pinned Showdown c23d2e94. The numbers are the oracle's (sim-dfs.ts on the
 * scenarios of scripts/.cache/calc-audit/status2/build/w1a-h-cases.ts, which w1a-h-run.ts compares field by field), the
 * texts the app's facts. Level 50, 31 IVs, Serious, 0 EVs (Stat Points in Champions) unless set. The Sky Drop and
 * end-of-turn tests need integration 1a's kernel lines (W1A-H.md): they run once Sky Drop is modelled (WIRED); until then
 * Sky Drop keeps its guard (tested below).
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; substitute?: number;
  build?: Partial<BattleBuild>; move: string | null; target?: DoublesSlotId;
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
const slow = { ivs: { spe: 0 }, nature: "Brave" };

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...trained, ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: (Mon | null)[], field: Partial<BattleConditions> = {}, extra: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    if (!m) return [slot, null];
    const carried = { ...m.carried, ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(Object.keys(carried).length ? { carried } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return {
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon,
    canSwitch: { own: true, opponent: true }, ...extra,
  };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
function outcomes(input: DoublesTurnInput): Extract<DoublesOutcomesResult, { status: "ready" }> {
  const out = calculateDoublesOutcomes(input);
  if (out.status !== "ready") throw new Error(`${out.status}: ${"reason" in out ? out.reason : ""}`);
  return out;
}
const reasonOf = (input: DoublesTurnInput) => { const result = calculateDoublesTurn(input); return result.status === "not-estimated" ? result.reason : result.status; };
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)!;
const texts = (facts: { text: string }[] | undefined) => (facts ?? []).map((fact) => fact.text);
/** Integration 1a's kernel lines are in (W1A-H.md I1–I4, I6, I7, one change): Sky Drop is modelled. */
const WIRED = reasonOf(turn(await game(USUM), [mon("braviary", "keeneye", "skydrop", { target: PR }), lax(8), lax(24), mon("clefairy", "friendguard", null)])) !== REASONS.notIn2v2("Sky Drop");
/** The E2 mixture of one field of a slot. */
function mixture(out: ReturnType<typeof outcomes>, slot: DoublesSlotId, key: (m: NonNullable<ReturnType<typeof outcomes>["outcomes"][number]["mons"][DoublesSlotId]>) => string) {
  const map = new Map<string, number>();
  for (const o of out.outcomes) { const m = o.mons[slot]; if (m) map.set(key(m), (map.get(key(m)) ?? 0) + o.chance); }
  return Object.fromEntries([...map].map(([k, v]) => [k, +v.toFixed(9)]));
}

describe("Track H: the invulnerability step of damaging moves (T2M-SI)", () => {
  it("Dig: the ally's Earthquake hits the digger at 2x (138–164), the foes at 0.75 (93–109); E2 charging dig (T2-SI01)", async () => {
    const runtime = await game(SV);
    const input = turn(runtime, [mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, nature: "Jolly", target: PL }), mon("excadrill", "moldbreaker", "earthquake", { evs: { atk: 252, spe: 96 } }), lax(32), lax(64)]);
    const result = ready(input);
    expect(hitOf(result, OR, OL)).toMatchObject({ kind: "calculated", min: 138, max: 164 });
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 93, max: 109 });
    expect(texts(stepOf(result, OL).facts)).toEqual(["Dig: Garchomp charges this turn."]);
    expect(result.facts).toContain("Assumes Garchomp did not charge Dig last turn.");
    expect(mixture(outcomes(input), OL, (m) => m.charging ?? "")).toEqual({ dig: 1 });
  });

  it("Dig in a Sandstorm: a foe's Body Slam misses it; the other foe's Earthquake hits it at 2x (98–116) (T2-SI02)", async () => {
    const runtime = await game(SV);
    const result = ready(turn(runtime, [mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: PL }), lax(8),
      lax(16, "bodyslam", { target: OL }), mon("hippowdon", "sandstream", "earthquake")], { weather: "Sand" }, { weatherTurns: 3 }));
    expect(hitOf(result, PL, OL)).toMatchObject({ kind: "blocked" });
    expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Body Slam misses Garchomp (Dig)."]);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 98, max: 116 });
  });

  it("Fly: Hurricane (60–72) and a 2x Gust (44–54) hit it (T2-SI03); Thunderbolt misses it (Champions)", async () => {
    const sv = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, target: PL }), lax(1),
      mon("pelipper", "keeneye", "hurricane", { target: OL }), mon("drifblim", "aftermath", "gust", { ...slow, target: OL })]));
    expect(hitOf(sv, PL, OL)).toMatchObject({ min: 60, max: 72 });
    expect(hitOf(sv, PR, OL)).toMatchObject({ min: 44, max: 54 });
    const champions = ready(turn(await game(CHAMPIONS), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 32 }, target: PL }), lax(1),
      mon("pelipper", "keeneye", "hurricane", { target: OL }), mon("raichu", "static", "thunderbolt", { target: OL })]));
    expect(texts(hitOf(champions, PR, OL).facts)).toEqual(["Thunderbolt misses Dragonite (Fly)."]);
  });

  it("Fly: a spread Rock Slide misses it and still hits its ally at 0.75 (58–69) (T2-SI04)", async () => {
    const result = ready(turn(await game(CHAMPIONS), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 32 }, target: PL }), lax(1), mon("tyranitar", "unnerve", "rockslide"), lax(2)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ kind: "blocked" });
    expect(hitOf(result, PL, OR)).toMatchObject({ min: 58, max: 69 });
  });

  it("Bounce: Gust doubles its power (36–43), Twister too (34–42); the ally takes Twister normally (16–19) (T2-SI05)", async () => {
    const result = ready(turn(await game(USUM), [mon("lopunny", "limber", "bounce", { evs: { spe: 252 }, target: PL }), lax(8),
      mon("pidgeot", "keeneye", "gust", { target: OL }), mon("dragonite", "innerfocus", "twister")]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 36, max: 43 });
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 34, max: 42 });
    expect(hitOf(result, PR, OR)).toMatchObject({ min: 16, max: 19 });
  });

  it("Dive: a foe's Surf hits it at 2x (20–24) (T2-SI06)", async () => {
    const input = turn(await game(USUM), [mon("kingdra", "swiftswim", "dive", { evs: { spe: 252 }, target: PL }), lax(8), mon("starmie", "illuminate", "surf"), lax(16)]);
    expect(hitOf(ready(input), PL, OL)).toMatchObject({ min: 20, max: 24 });
    expect(mixture(outcomes(input), OL, (m) => m.charging ?? "")).toEqual({ dive: 1 });
  });

  it("Phantom Force: Earthquake misses it; a No Guard Crunch hits it (88–104) (T2-SI07)", async () => {
    const result = ready(turn(await game(SV), [mon("dragapult", "clearbody", "phantomforce", { evs: { spe: 252 }, target: PL }), lax(8),
      mon("garchomp", "roughskin", "earthquake"), mon("lycanrocmidnight", "noguard", "crunch", { target: OL })]));
    expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Earthquake misses Dragapult (Phantom Force)."]);
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "calculated", min: 88, max: 104 });
  });

  it("Lightning Rod takes a Thunderbolt into its digging holder, which then misses: no Sp. Atk rise (T2-SI10)", async () => {
    for (const id of [USUM, SWSH] as const) {
      const result = ready(turn(await game(id), [mon("marowakalola", "lightningrod", "dig", { evs: { spe: 252 }, nature: "Jolly", target: PL }), lax(8),
        mon("raichu", "static", "thunderbolt", { ...slow, target: OR }), lax(16)]));
      expect(texts(stepOf(result, PL).facts)).toEqual(["Lightning Rod: Marowak-Alola takes Thunderbolt."]);
      expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Thunderbolt misses Marowak-Alola (Dig)."]);
    }
  });

  it("Dragon Darts at a Fly user: both darts into its ally (102–122)", async () => {
    const result = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, nature: "Jolly", target: PL }), lax(8),
      mon("dragapult", "clearbody", "dragondarts", { ...slow, target: OL }), lax(16)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ kind: "blocked" });
    expect(hitOf(result, PL, OR)).toMatchObject({ min: 102, max: 122 });
  });

  it("Lock-On from last turn: its user's Body Slam hits the digger (55–66); the other foe's misses", async () => {
    const result = ready(turn(await game(SV), [mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: PL }), lax(8),
      lax(4, "bodyslam", { target: OL, carried: { lockOn: OL } }), lax(0, "bodyslam", { target: OL })]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 55, max: 66 });
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "blocked" });
  });

  it("High Jump Kick misses a Fly user and crashes: 62 of 125 HP (T2-CR01, FX-CR-06)", async () => {
    const result = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, target: PL }), lax(4), mon("hitmonlee", "limber", "highjumpkick", { target: OL }), lax(8)]));
    expect(texts(result.hp[PL]!.losses)).toEqual(["Hitmonlee loses 62 HP (High Jump Kick)."]);
    expect(result.hp[PL]).toMatchObject({ min: 63, max: 63 });
  });
});

describe("Track H: status moves and field moves into a hidden Pokémon (T2-SI08, SI11)", () => {
  it("Toxic from a Poison type hits a Fly user; a Breloom's misses (SV, USUM)", async () => {
    for (const id of [SV, USUM] as const) {
      const result = ready(turn(await game(id), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, target: PL }), lax(8),
        mon("toxapex", "regenerator", "toxic", { evs: { spe: 24 }, target: OL }), mon("breloom", "effectspore", "toxic", { ...slow, target: OL })]));
      expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Is badly poisoned."]);
      expect(texts(hitOf(result, PR, OL).facts)).toEqual(["Toxic misses Dragonite (Fly)."]);
    }
  });

  it("Thunder Wave and a spread Growl miss a Fly user; Growl lowers its ally", async () => {
    const result = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, nature: "Jolly", target: PL }), lax(8),
      mon("raichu", "static", "thunderwave", { ...slow, target: OL }), mon("clefable", "magicguard", "growl")]));
    expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Thunder Wave misses Dragonite (Fly)."]);
    expect(texts(hitOf(result, PR, OL).facts)).toEqual(["Growl misses Dragonite (Fly)."]);
    expect(texts(hitOf(result, PR, OR).facts)).toEqual(["−1 Attack."]);
  });

  it("Perish Song misses a Fly user (its own check), Haze reaches it, its ally's Pollen Puff misses it (T2-SI11b)", async () => {
    const input = turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 252 }, nature: "Jolly", boosts: { atk: 2 }, hp: 100, target: PL }),
      mon("amoonguss", "regenerator", "pollenpuff", { target: OL }), mon("clodsire", "waterabsorb", "haze", { evs: { spe: 64 } }), mon("gengar", "cursedbody", "perishsong")]);
    const result = ready(input);
    expect(texts(hitOf(result, PR, OL).facts)).toEqual(["Perish Song misses Dragonite (Fly)."]);
    expect(texts(hitOf(result, OR, OL).facts)).toEqual(["Pollen Puff misses Dragonite (Fly)."]);
    const out = outcomes(input);
    expect(mixture(out, OL, (m) => String(m.build.boosts.atk))).toEqual({ 0: 1 });
    expect(mixture(out, OL, (m) => (m.volatiles ?? []).includes("perishsong") ? "yes" : "no")).toEqual({ no: 1 });
    expect(mixture(out, OR, (m) => (m.volatiles ?? []).includes("perishsong") ? "yes" : "no")).toEqual({ yes: 1 });
  });
});

describe("Track H: the release from last turn (C38, IN-CHG-01, T2M-SI-13)", () => {
  it("a carried Dig: a faster Night Slash misses it; the release hits (81–96)", async () => {
    for (const id of [SV, CHAMPIONS] as const) {
      const fast = id === CHAMPIONS ? 32 : 252;
      const result = ready(turn(await game(id), [mon("weavile", "pressure", "nightslash", { evs: { spe: fast }, target: PR }), lax(0, "earthquake"),
        lax(id === CHAMPIONS ? 1 : 8), mon("garchomp", "roughskin", "dig", { target: OL, carried: { charging: "dig" } })]));
      expect(texts(hitOf(result, OL, PR).facts)).toEqual(["Night Slash misses Garchomp (Dig)."]);
      expect(hitOf(result, PR, OL)).toMatchObject({ min: 81, max: 96 });
      expect(result.facts.some((text) => text.includes("did not charge"))).toBe(false);
    }
  });

  it("a carried Fly is out of reach from the turn's start and released at its action: the release (52–62), then a slower Body Slam hits it (55–66)", async () => {
    const result = ready(turn(await game(CHAMPIONS), [mon("dragonite", "innerfocus", "fly", { evs: { spe: 10 }, target: PL, carried: { charging: "fly" } }), lax(1),
      mon("raichu", "static", "thunderbolt", { evs: { spe: 32 }, target: OL }), lax(0, "bodyslam", { target: OL })]));
    expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Thunderbolt misses Dragonite (Fly)."]);
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 52, max: 62 });
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "calculated", min: 55, max: 66 });
  });

  it("a carried Fly fully paralysed: its hidden state ends at the stopped BeforeMove (MoveAborted); a slower Body Slam hits it in every world (60–72)", async () => {
    const result = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { status: "par", evs: { spe: 252 }, nature: "Jolly", target: PL, carried: { charging: "fly" } }), lax(8),
      lax(16), mon("snorlax", "thickfat", "bodyslam", { ...slow, target: OL })]));
    expect(texts(stepOf(result, OL).skipped)).toEqual(["Fully paralysed."]);
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "calculated", reached: 1, min: 60, max: 72 });
  });

  it("a carried release with no Pokémon to aim at is not estimated", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { carried: { charging: "fly" } }), lax(8), null, null]));
    expect(reason).toBe("Fly with no Pokémon to aim at is not modelled in 2v2.");
    expect(REASONS.combo("Fly", "no Pokémon to aim at")).toBe(reason);
  });
});

describe("Track H: landing (Gravity, Smack Down) and E2 (T2-SI09, T2E-SI-01)", () => {
  it("Gravity lands a Fly user charging this turn (E2: no charging), not a Dig user (E2: charging dig)", async () => {
    const input = turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { target: PL }), mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: PL }),
      mon("bronzong", "levitate", "gravity", { evs: { spe: 32 } }), lax(64)]);
    const out = outcomes(input);
    expect(mixture(out, OL, (m) => m.charging ?? "")).toEqual({ "": 1 });
    expect(mixture(out, OR, (m) => m.charging ?? "")).toEqual({ dig: 1 });
  });

  it("Gravity cancels a carried Fly (its skip fact); the slower Thunderbolt hits Dragonite (136–141 left)", async () => {
    const result = ready(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { ...slow, target: PL, carried: { charging: "fly" } }), lax(8),
      mon("bronzong", "levitate", "gravity", { evs: { spe: 252 } }), lax(0, "thunderbolt", { target: OL })]));
    expect(texts(stepOf(result, OL).skipped)).toEqual(["Dragonite falls to the ground (Gravity): Fly is cancelled."]);
    expect(stepOf(result, OL).moves).toBe(0);
    expect(stepOf(result, PR).order).toEqual([{ position: 3, chance: 1 }]);
    expect(result.hp[OL]).toMatchObject({ min: 136, max: 141 });
  });

  it("a charge of any damaging two-turn move: E2 charging and the turn fact; none for a release", async () => {
    const runtime = await game(SV);
    const charge = turn(runtime, [mon("venusaur", "overgrow", "solarbeam", { target: PL }), lax(8), lax(4), lax(0)]);
    expect(ready(charge).facts).toContain("Assumes Venusaur did not charge Solar Beam last turn.");
    expect(mixture(outcomes(charge), OL, (m) => m.charging ?? "")).toEqual({ solarbeam: 1 });
    const release = turn(runtime, [mon("venusaur", "overgrow", "solarbeam", { target: PL, carried: { charging: "solarbeam" } }), lax(8), lax(4), lax(0)]);
    expect(ready(release).facts.some((text) => text.includes("did not charge"))).toBe(false);
    expect(mixture(outcomes(release), OL, (m) => m.charging ?? "")).toEqual({ "": 1 });
  });

  it("Cramorant's Dive: Gulping Cramorant above half its HP, Gorging at half (PS/data/moves.ts dive onTryMove)", async () => {
    const runtime = await game(SV);
    const form = (hp?: number) => mixture(outcomes(turn(runtime, [mon("cramorant", "gulpmissile", "dive", { evs: { spe: 252 }, hp, target: PL }), lax(8), lax(4), lax(0)])), OL, (m) => m.build.speciesId);
    expect(form()).toEqual({ cramorantgulping: 1 });
    expect(form(70)).toEqual({ cramorantgorging: 1 });
    // With a Power Herb its form changes and Dive hits at once (no charge turn): not followed.
    expect(reasonOf(turn(runtime, [mon("cramorant", "gulpmissile", "dive", { item: "powerherb", target: PL }), lax(8), lax(4), lax(0)]))).toBe("Gulp Missile changing Cramorant's form is not modelled in 2v2.");
  });
});

describe("Track H: the corners the calculation does not read (not estimated)", () => {
  it("Grassy Terrain: Earthquake into a digger is not halved in Showdown", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: PL }), mon("rillaboom", "grassysurge", "earthquake"), lax(4), lax(0)], { terrain: "Grassy" }));
    expect(reason).toBe("Earthquake with Grassy Terrain and Garchomp's Dig is not modelled in 2v2.");
  });

  it("Psychic Terrain: a No Guard priority move into a hidden Pokémon on the ground is not stopped in Showdown", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("dragapult", "clearbody", "phantomforce", { target: PL, carried: { charging: "phantomforce" } }), lax(8),
      mon("lycanrocmidnight", "noguard", "suckerpunch", { target: OL }), lax(0)], { terrain: "Psychic" }));
    expect(reason).toBe("Sucker Punch with Psychic Terrain and Dragapult's Phantom Force is not modelled in 2v2.");
  });

  it("Misty Terrain: a No Guard move into a hidden Pokémon on the ground", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("dragapult", "clearbody", "phantomforce", { evs: { spe: 252 }, target: PL }), lax(8),
      mon("lycanrocmidnight", "noguard", "crunch", { target: OL }), lax(0)], { terrain: "Misty" }));
    expect(reason).toBe("Crunch with Misty Terrain and Dragapult's Phantom Force is not modelled in 2v2.");
  });

  it("Gulp Missile does not hit back while its holder is under water", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("cramorant", "gulpmissile", "dive", { evs: { spe: 252 }, target: PL }), mon("azumarill", "thickfat", "surf"), lax(4), lax(0)]));
    expect(reason).toBe("Surf with Cramorant's Gulp Missile is not modelled in 2v2.");
  });

  it("a one-hit KO move that gets through (Lock-On) into a hidden Pokémon", async () => {
    const reason = reasonOf(turn(await game(SV), [mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: PL }), lax(8),
      mon("mamoswine", "oblivious", "fissure", { target: OL, carried: { lockOn: OL } }), lax(0)]));
    expect(reason).toBe("Fissure with Garchomp's Dig is not modelled in 2v2.");
  });

  it("Smack Down into a Fly user already on the ground (Iron Ball): it lands and its Fly is cancelled (integration 1b, INT-SMK-01)", async () => {
    const result = calculateDoublesTurn(turn(await game(SV), [mon("dragonite", "innerfocus", "fly", { item: "ironball", target: PL, carried: { charging: "fly" } }), lax(8),
      mon("tyranitar", "sandstream", "smackdown", { target: OL }), lax(0, "bodyslam", { target: OL })]));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const fly = result.steps.find((step) => step.slot === OL)!;
    expect(fly.skipped.map((fact) => fact.text)).toContain("Dragonite falls to the ground (Smack Down): Fly is cancelled.");
    expect(result.steps.find((step) => step.slot === PR)!.hits.find((hit) => hit.slot === OL)!.kind).toBe("calculated");
  });

  it("a hazard into a Magic Bounce side while a Pokémon of that side can be hidden", async () => {
    const runtime = await game(SV);
    const reason = reasonOf(turn(runtime, [mon("tyranitar", "sandstream", "stealthrock"), lax(8), mon("espeon", "magicbounce", null), mon("garchomp", "roughskin", "dig", { evs: { spe: 252 }, target: OL })]));
    expect(reason).toBe("Stealth Rock with Espeon's Magic Bounce is not modelled in 2v2.");
    // With no Pokémon of that side able to be hidden, the bounce is today's model.
    expect(calculateDoublesTurn(turn(runtime, [mon("tyranitar", "sandstream", "stealthrock"), lax(8), mon("espeon", "magicbounce", null), lax(0)])).status).toBe("ready");
  });

  it("generation 7: a Protean user's Toxic into a hidden Pokémon (Showdown reads its types before Protean)", async () => {
    const reason = reasonOf(turn(await game(USUM), [mon("dragonite", "innerfocus", "fly", { target: PL, carried: { charging: "fly" } }), lax(8), mon("greninja", "protean", "toxic", { target: OL }), lax(0)]));
    expect(reason).toBe("Toxic with Protean is not modelled in 2v2.");
  });
});

describe("Track H: Sky Drop (C21, CQ-SKD)", () => {
  const braviary = (extra: Partial<Mon> = {}) => mon("braviary", "keeneye", "skydrop", { evs: { spe: 252 }, target: PR, ...extra });

  it.skipIf(WIRED)("before integration 1a's kernel lines: Sky Drop keeps today's guard", async () => {
    const reason = reasonOf(turn(await game(USUM), [braviary(), lax(8), lax(24, "tackle", { target: OL }), mon("clefairy", "friendguard", "pound", { evs: { spe: 4 }, target: OL })]));
    expect(reason).toBe("Sky Drop is not modelled in 2v2.");
  });

  it.runIf(WIRED)("CQ-SKD-01: Sky Drop lifts Clefairy: its Pound never runs; its partner's Tackle at Braviary misses; E2", async () => {
    const input = turn(await game(USUM), [braviary(), lax(8), lax(24, "tackle", { target: OL }), mon("clefairy", "friendguard", "pound", { evs: { spe: 4 }, target: OL })]);
    const result = ready(input);
    expect(texts(stepOf(result, OL).facts)).toEqual(["Sky Drop: Braviary lifts Clefairy into the air."]);
    expect(texts(stepOf(result, PR).skipped)).toEqual(["Lifted by Braviary (Sky Drop)."]);
    expect(texts(hitOf(result, PL, OL).facts)).toEqual(["Tackle misses Braviary (Sky Drop)."]);
    const out = outcomes(input);
    expect(mixture(out, OL, (m) => `${m.charging}|${(m.volatiles ?? []).join(",")}`)).toEqual({ "skydrop|skydrop,twoturnmove": 1 });
    expect(mixture(out, PR, (m) => (m.volatiles ?? []).join(","))).toEqual({ "": 1 });
  });

  it.runIf(WIRED)("CQ-SKD-02: its partner's Gust hits Braviary unboosted (Braviary 148–153)", async () => {
    const result = ready(turn(await game(USUM), [braviary(), lax(8), mon("pidgeot", "keeneye", "gust", { evs: { spe: 0 }, target: OL }), mon("clefairy", "friendguard", "pound", { evs: { spe: 4 }, target: OL })]));
    expect(result.hp[OL]).toMatchObject({ min: 148, max: 153 });
  });

  it.runIf(WIRED)("fails into a 200 kg Pokémon, which then acts; Spiky Shield blocks it with no contact damage", async () => {
    const runtime = await game(USUM);
    const heavy = ready(turn(runtime, [braviary(), lax(8), lax(24), lax(4, "bodyslam", { target: OL })]));
    expect(texts(stepOf(heavy, OL).facts)).toEqual(["Sky Drop fails: Snorlax (opponent's, 2) weighs 200 kg or more."]);
    expect(heavy.hp[OL]).toMatchObject({ min: 96, max: 108 });
    const shield = ready(turn(runtime, [braviary(), lax(8), lax(24), mon("chesnaught", "bulletproof", "spikyshield")]));
    expect(texts(hitOf(shield, OL, PR).facts)).toEqual(["Spiky Shield blocks Sky Drop."]);
    expect(shield.hp[OL]).toMatchObject({ min: 175, max: 175 });
  });

  it.runIf(WIRED)("Gravity frees the lifted Pokémon, whose slower Body Slam then hits Braviary (135–141)", async () => {
    const result = ready(turn(await game(USUM), [braviary(), lax(8), mon("bronzong", "levitate", "gravity", { evs: { spe: 252 } }), mon("clefable", "magicguard", "bodyslam", { ...slow, target: OL })]));
    expect(result.hp[OL]).toMatchObject({ min: 135, max: 141 });
  });

  it.runIf(WIRED)("a lifted Rage Powder user draws no move; a Sky Drop user knocked out frees its target, whose Pound then runs", async () => {
    const runtime = await game(USUM);
    const powder = ready(turn(runtime, [braviary(), lax(0, "tackle", { target: PL }), lax(24), mon("amoonguss", "regenerator", "ragepowder")]));
    expect(hitOf(powder, OR, PL)).toMatchObject({ kind: "calculated" });
    const freed = ready(turn(runtime, [braviary({ hp: 40 }), lax(8), mon("raichu", "static", "thunder", { evs: { spa: 252 }, target: OL }), mon("clefable", "magicguard", "pound", { ...slow, target: OR })]));
    expect(freed.hp[OR]).toMatchObject({ min: 213, max: 217 });
  });

  it.runIf(WIRED)("Sky Drop keeps its chosen target past a Follow Me (tracksTarget)", async () => {
    const result = ready(turn(await game(USUM), [braviary({ target: PL }), lax(8), mon("clefairy", "friendguard", "pound", { evs: { spe: 4 }, target: OL }), mon("clefable", "magicguard", "followme")]));
    expect(texts(stepOf(result, OL).facts)).toEqual(["Sky Drop: Braviary lifts Clefairy into the air."]);
    expect(texts(stepOf(result, PL).skipped)).toEqual(["Lifted by Braviary (Sky Drop)."]);
  });

  it.runIf(WIRED)("a sleeping lifted Pokémon's counter does not move (its BeforeMove is null before sleep's)", async () => {
    const input = turn(await game(USUM), [braviary(), lax(8), lax(24), mon("clefable", "magicguard", "moonblast", { status: "slp", target: OL, carried: { sleep: { attempts: 1, rest: false } } })]);
    // One BeforeMove spent asleep before this turn: still 2 expected turns left (S uniform on 2–4, E[S − 1 | S > 1]).
    expect(mixture(outcomes(input), PR, (m) => `${m.build.status} ${m.sleepTurns}`)).toEqual({ "slp 2": 1 });
  });

  it.runIf(WIRED)("a carried Dive stopped by a full paralysis is no longer under water at the end of turn: the Sandstorm hits it in every world", async () => {
    const result = ready(turn(await game(SV), [mon("dewgong", "thickfat", "dive", { status: "par", evs: { spe: 252 }, target: PL, carried: { charging: "dive" } }), lax(8), lax(4), lax(0)],
      { weather: "Sand" }, { weatherTurns: 3 }));
    const eot = result.endOfTurn;
    expect(eot.status === "ready" && eot.hp[OL]).toMatchObject({ min: 155, max: 155 });
  });
});

// ---- The hooks on hand-made worlds (the wired kernel calls them as below) ----
const monState = (extra: Partial<MonState> = {}): MonState => ({
  build: { speciesId: "snorlax", abilityId: "thickfat", itemId: "" } as BattleBuild, fainted: false, moved: false, flinched: null, focusLost: false, charged: false,
  protect: null, centre: null, helpingHand: 0, hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {}, ...extra,
});
function world(mons: Partial<Record<DoublesSlotId, MonState>>, remaining: PendingAction[] = []): World {
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
  return { mass: 1, mons, sides: { own: { ...side }, opponent: { ...side } }, field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining, executed: 0, factors: [] };
}
function stubKernel() {
  const skipped: string[] = [];
  const names = { "own-left": "Braviary", "own-right": "Ally", "opponent-left": "Partner", "opponent-right": "Clefairy" } as Record<DoublesSlotId, string>;
  const kernel = {
    names, moveName: (id: string) => ({ skydrop: "Sky Drop", fly: "Fly", gravity: "Gravity", smackdown: "Smack Down" } as Record<string, string>)[id] ?? id,
    skipFact: (_action: PendingAction, text: string) => { skipped.push(text); },
    alive: (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted,
  } as unknown as TurnKernel;
  return { kernel, skipped };
}
const action = (slot: DoublesSlotId, moveId: string | null): PendingAction => ({ index: 0, slot, moveId, target: null, fractional: 0 });

describe("Track H: the hooks the kernel lines call", () => {
  it("beforeMove: a lifted Pokémon does nothing while its user holds it; freed once the user has fainted; a carried release's hidden state ends", () => {
    const { kernel, skipped } = stubKernel();
    const lifted = world({ [OL]: monState({ eot: { hidden: "skydrop" } }), [PR]: monState({ eot: { hidden: "skydrop", lifted: OL } }) });
    expect(hidden.beforeMove(kernel, lifted, action(PR, "pound"))).toEqual({ go: [], stopped: [lifted] });
    expect(skipped).toEqual(["Lifted by Braviary (Sky Drop)."]);
    const freed = world({ [OL]: monState({ fainted: true, eot: { hidden: "skydrop" } }), [PR]: monState({ eot: { hidden: "skydrop", lifted: OL } }) });
    expect(hidden.beforeMove(kernel, freed, action(PR, "pound"))).toBeNull();
    expect(freed.mons[PR]!.eot).toEqual({});
    const release = world({ [OL]: monState({ vol: { locked: "fly" }, eot: { hidden: "fly" } }) });
    expect(hidden.beforeMove(kernel, release, action(OL, "fly"))).toBeNull();
    expect(release.mons[OL]!.eot.hidden).toBeUndefined();
    expect(hidden.semiInvulnerable(lifted, PR) && hidden.skyDropped(lifted, OL)).toBe(true);
  });

  it("fainted: a fainting Sky Drop user frees its target; its own hidden state and charge go", () => {
    const { kernel } = stubKernel();
    const w = world({ [OL]: monState({ fainted: true, vol: { charging: "skydrop" }, eot: { hidden: "skydrop" } }), [PR]: monState({ eot: { hidden: "skydrop", lifted: OL } }) });
    hidden.fainted(kernel, w, OL);
    expect(w.mons[PR]!.eot).toEqual({});
    expect(w.mons[OL]!.eot).toEqual({});
    expect(w.mons[OL]!.vol.charging).toBeUndefined();
  });

  it("land: Gravity lands Fly and Sky Drop's user (freeing its target) and cancels a queued release; Smack Down does not end Sky Drop", () => {
    const { kernel, skipped } = stubKernel();
    const queued = action(OL, "fly");
    const fly = world({ [OL]: monState({ vol: { locked: "fly" }, eot: { hidden: "fly" } }) }, [queued]);
    fly.field.gravity = true;
    hidden.land(kernel, fly, OL);
    expect(fly.mons[OL]!.eot.hidden).toBeUndefined();
    expect(fly.remaining).toEqual([]);
    expect([fly.mons[OL]!.moved, fly.executed]).toEqual([true, 1]);
    expect(skipped).toEqual(["Braviary falls to the ground (Gravity): Fly is cancelled."]);
    const pair = () => world({ [OL]: monState({ vol: { charging: "skydrop" }, eot: { hidden: "skydrop" } }), [PR]: monState({ eot: { hidden: "skydrop", lifted: OL } }) });
    const smacked = pair();
    hidden.land(kernel, smacked, OL);
    expect(smacked.mons[OL]!.eot.hidden).toBe("skydrop");
    const gravity = pair();
    gravity.field.gravity = true;
    hidden.land(kernel, gravity, PR);
    expect(gravity.mons[PR]!.eot.hidden).toBe("skydrop");
    hidden.land(kernel, gravity, OL);
    expect([gravity.mons[OL]!.eot.hidden, gravity.mons[OL]!.vol.charging, gravity.mons[PR]!.eot.hidden]).toEqual([undefined, undefined, undefined]);
  });

  it("hiddenKind: a carried release that has moved, or a lifted Pokémon whose user no longer holds it, is not hidden", () => {
    const moved = world({ [OL]: monState({ moved: true, vol: { locked: "dig" }, eot: { hidden: "dig" } }) });
    expect(hidden.hiddenKind(moved, OL)).toBeNull();
    const charged = world({ [OL]: monState({ moved: true, vol: { charging: "dig" }, eot: { hidden: "dig" } }) });
    expect(hidden.hiddenKind(charged, OL)).toBe("dig");
    const landed = world({ [OL]: monState(), [PR]: monState({ eot: { hidden: "skydrop", lifted: OL } }) });
    expect(hidden.hiddenKind(landed, PR)).toBeNull();
  });
});
