import { describe, expect, it } from "vitest";
import { abilityEntry, abilityFlag } from "@/app/lib/battle/ability-table";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { ABILITY_ENDS, ABILITY_STARTS, abilityEnd, conditions, HANDLERS, outcomeMon, realAbility, trapAfterHit } from "@/app/lib/battle/doubles-abilities";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { STATUS_MOVE_TABLE } from "@/app/lib/battle/status-table";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 Track A1 (SPEC2 §2.2's A1 rows, §4.2; ADDENDUM2 §4.2): the thirty status moves of stats, abilities and Transform,
 * Spit Up, and the ability changes' Starts and Ends, each on a turn whose numbers are pinned Showdown c23d2e94's (the oracle
 * runs of scripts/.cache/calc-audit/status2/build/a1-cases.ts, ids A1-…, through a1-run.ts: the same inputs; the walks'
 * hits, HP and orders here), and the facts the app gives. Level 50, 31 IVs, Serious, 0 EVs (Stat Points in Champions) unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; evs?: Partial<Record<Stat, number>>; hp?: number; status?: BattleStatus;
  boosts?: Partial<Record<CombatStat, number>>; carried?: DoublesCarried; substitute?: number; build?: Partial<BattleBuild>;
  move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", USUM = "ultra_sun_ultra_moon", SWSH = "sword_shield", CHAMPIONS = "champions";

const mon = (species: string, ability: string, move: string | null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
const lax = (spe: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", move, { evs: { spe }, ...extra });
const smeargle = (move: string, target?: DoublesSlotId, extra: Partial<Mon> = {}) => mon("smeargle", "owntempo", move, { evs: { spe: 252 }, target, ...extra });

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31 } } };
  return { ...trained, ...m.build } as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const carried = { ...m.carried, ...(m.substitute !== undefined ? { substitute: m.substitute } : {}) };
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(Object.keys(carried).length ? { carried } : {}),
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
const said = (result: Ready, slot: DoublesSlotId) => [...texts(stepOf(result, slot).facts), ...stepOf(result, slot).hits.flatMap((hit) => texts(hit.facts))];
const orderOf = (result: Ready, slot: DoublesSlotId) => Object.fromEntries(stepOf(result, slot).order.map((entry) => [entry.position, +entry.chance.toFixed(9)]));
async function outcomes(input: DoublesTurnInput) {
  const out = calculateDoublesOutcomes(input);
  if (out.status !== "ready") throw new Error(out.status);
  return out.outcomes;
}
const share = (list: Awaited<ReturnType<typeof outcomes>>, test: (o: (typeof list)[number]) => boolean) => list.reduce((sum, o) => sum + (test(o) ? o.chance : 0), 0);

describe("status2 A1: the status moves are modelled (status-table.ts kinds)", () => {
  it("gives the thirty A1 moves kind M or C with their handler keys (classify-a1.md)", () => {
    const m = "acupressure psychup powerswap guardswap heartswap speedswap powersplit guardsplit powertrick powershift topsyturvy stockpile swallow tidyup noretreat autotomize minimize geomancy gearup magneticflux flowershield rototiller".split(" ");
    const c = "skillswap roleplay entrainment simplebeam worryseed gastroacid doodle transform".split(" ");
    for (const id of m) expect([id, STATUS_MOVE_TABLE[id].kind, !!STATUS_MOVE_TABLE[id].handler]).toEqual([id, "M", true]);
    for (const id of c) expect([id, STATUS_MOVE_TABLE[id].kind, !!STATUS_MOVE_TABLE[id].handler]).toEqual([id, "C", true]);
  });
});

describe("status2 A1: stat stages (boost() and direct writes; F1 §3.1)", () => {
  it("A1-ACU-1: Acupressure on the ally: seven worlds of 1/7; the Speed world moves it before the foe in SV only", async () => {
    const slots = [smeargle("acupressure", OR), lax(0, "bodyslam", { target: PL }), lax(8, "bodyslam", { target: OR }), lax(16)];
    const sv = ready(turn(await game(SV), slots));
    expect(orderOf(sv, OR)).toEqual({ 2: +(1 / 7).toFixed(9), 3: +(6 / 7).toFixed(9) });
    expect(hitOf(sv, OR, PL)).toMatchObject({ min: 75, max: 174 });
    expect(sv.hp[PL]).toMatchObject({ min: 61, max: 160 });
    const usum = ready(turn(await game(USUM), slots));
    expect(orderOf(usum, OR)).toEqual({ 3: 1 });
  });

  it("A1-PSY-1: Psych Up through Protect copies +2 Atk −2 Def; White Herb restores the Def at AfterMove (the later hit 114–135)", async () => {
    const result = ready(turn(await game(SV), [smeargle("psychup", PL, { item: "whiteherb" }), lax(0), lax(32, "protect", { boosts: { atk: 2, def: -2 } }), lax(8, "bodyslam", { target: OL })]));
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 114, max: 135 });
    expect(said(result, OL)).toContain("Smeargle copies Snorlax (opponent's, 1)'s stat changes.");
    expect(said(result, OL)).toContain("Smeargle's White Herb: its lowered stats are restored.");
  });

  it("A1-SWP-1: Heart Swap with a −2 Def Snorlax: Smeargle takes −2 Def (460–543 from Snorlax's Body Slam)", async () => {
    const result = ready(turn(await game(SV), [smeargle("heartswap", PL, { boosts: { atk: 2 } }), lax(0), lax(16, "bodyslam", { target: OL, item: "whiteherb", boosts: { def: -2, spa: 1 } }), lax(8)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 460, max: 543 });
    expect(texts(stepOf(result, OL).facts)).toContain("Smeargle and Snorlax (opponent's, 1) swap their stat changes.");
  });

  it("A1-STK-4: Swallow with 2 layers heals half, then its Stockpile's End lowers Def and Sp. Def by 2 (the Body Slam after: 61–73)", async () => {
    const result = ready(turn(await game(SV), [mon("swalot", "liquidooze", "swallow", { hp: 60, boosts: { def: 2, spd: 2 }, evs: { spe: 252 }, carried: { stockpile: { layers: 2, def: -2, spd: -2 } } }),
      lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 61, max: 73 });
    expect(result.hp[OL]).toMatchObject({ min: 74, max: 86 });
    expect(said(result, OL)).toEqual(expect.arrayContaining(["Its Stockpile ends.", "−2 Defense.", "−2 Sp. Def."]));
  });

  it("A1-STK-5/7: Swallow and Spit Up with no Stockpile fail, with the turn fact", async () => {
    const runtime = await game(SV);
    const swallow = ready(turn(runtime, [mon("swalot", "liquidooze", "swallow", { hp: 60, evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(texts(stepOf(swallow, OL).facts)).toContain("Swallow fails: Swalot has not stockpiled.");
    expect(swallow.facts).toContain("Assumes Swalot has not stockpiled.");
    const spit = ready(turn(runtime, [mon("swalot", "liquidooze", "spitup", { evs: { spe: 252 }, target: PL }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(texts(stepOf(spit, OL).facts)).toContain("Spit Up fails: Swalot has not stockpiled.");
  });

  it("A1-STK-6 (E2): Spit Up into Protect: the Stockpile still ends at AfterMove (Def and Sp. Def back to 0; the Body Slam after 61–73)", async () => {
    const input = turn(await game(SV), [mon("swalot", "liquidooze", "spitup", { boosts: { def: 3, spd: 3 }, evs: { spe: 252 }, target: PL, carried: { stockpile: { layers: 3, def: -3, spd: -3 } } }),
      lax(0), lax(16, "protect"), lax(8, "bodyslam", { target: OL })]);
    const result = ready(input);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 61, max: 73 });
    expect(texts(stepOf(result, OL).facts)).toEqual(expect.arrayContaining(["Swalot's Stockpile ends.", "Swalot: −3 Defense.", "Swalot: −3 Sp. Def."]));
    const list = await outcomes(input);
    expect(share(list, (o) => o.mons[OL]!.build.boosts.def === 0 && o.mons[OL]!.build.boosts.spd === 0 && !o.mons[OL]!.stockpile)).toBeCloseTo(1, 9);
  });

  it("A1-STK-1 (E2): a third layer: +1/+1, Stockpile 3 with counts −3, −3", async () => {
    const input = turn(await game(SV), [mon("swalot", "liquidooze", "stockpile", { boosts: { def: 2, spd: 2 }, evs: { spe: 252 }, carried: { stockpile: { layers: 2, def: -2, spd: -2 } } }),
      lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]);
    const list = await outcomes(input);
    expect(share(list, (o) => JSON.stringify(o.mons[OL]!.stockpile) === JSON.stringify({ layers: 3, def: -3, spd: -3 }) && o.mons[OL]!.build.boosts.def === 3)).toBeCloseTo(1, 9);
  });

  it("A1-MIN-1: Minimize, then Body Slam into it: double damage in the final chain (120–144)", async () => {
    const result = ready(turn(await game(SV), [mon("qwilfish", "swiftswim", "minimize", { evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 120, max: 144 });
  });

  it("A1-TID-1: Tidy Up removes the foe's Substitute (the ally's Body Slam lands: 75–88), +1 Atk +1 Spe", async () => {
    const result = ready(turn(await game(SV), [mon("maushold", "technician", "tidyup", { evs: { spe: 252 } }), lax(8, "bodyslam", { target: PL }), lax(0, null, { substitute: 50 }), lax(16)]));
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 75, max: 88 });
    expect(texts(stepOf(result, OL).facts)).toContain("Tidy Up: Snorlax (opponent's, 1)'s Substitute is removed.");
  });

  it("A1-NRT-1/2: No Retreat raises all five (the hit after: 36–43); with its volatile from an earlier turn it fails", async () => {
    const runtime = await game(SV);
    const fresh = ready(turn(runtime, [mon("falinks", "battlearmor", "noretreat", { evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(hitOf(fresh, PL, OL)).toMatchObject({ min: 36, max: 43 });
    expect(fresh.facts).toContain("Assumes Falinks has not used No Retreat.");
    const again = ready(turn(runtime, [mon("falinks", "battlearmor", "noretreat", { evs: { spe: 252 }, carried: { noRetreat: true } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(texts(stepOf(again, OL).facts)).toContain("No Retreat fails: it is already up on Falinks.");
  });

  it("A1-AUT-1: Autotomize (100 kg lighter): Low Kick 204–244 into Aggron (Sturdy keeps 1 HP)", async () => {
    const result = ready(turn(await game(USUM), [mon("aggron", "sturdy", "autotomize", { evs: { spe: 252 } }), lax(0), mon("machamp", "guts", "lowkick", { evs: { spe: 4 }, target: OL }), lax(8)]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 204, max: 244 });
    expect(said(result, OL)).toContain("Autotomize: Aggron weighs 260.0 kg.");
  });

  it("A1-GEO-2 (E2): Geomancy without Power Herb charges (no boosts); with it, it acts at once", async () => {
    const runtime = await game(USUM);
    const charge = turn(runtime, [smeargle("geomancy"), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]);
    const result = ready(charge);
    expect(texts(stepOf(result, OL).facts)).toContain("Smeargle charges Geomancy.");
    expect(result.facts).toContain("Assumes Smeargle did not charge Geomancy last turn.");
    // Integration 1a (H's faint hook): the charge goes with a faint (Showdown clears the volatiles), so it is the living share.
    const all = await outcomes(charge);
    const alive = share(all, (o) => o.mons[OL]!.hp.some((h) => h.hp > 0));
    expect(alive).toBeGreaterThan(0);
    expect(share(all, (o) => o.mons[OL]!.charging === "geomancy" && o.mons[OL]!.build.boosts.spa === 0)).toBeCloseTo(alive, 9);
    const herb = ready(turn(runtime, [smeargle("geomancy", undefined, { item: "powerherb" }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(texts(stepOf(herb, OL).facts)).toContain("Power Herb: Smeargle uses Geomancy at once.");
  });

  it("A1-PLM-1 / A1-FLS-1 / A1-ROT-1: Magnetic Flux, Flower Shield, Rototiller reach their holders (an airborne Grass type is immune)", async () => {
    const flux = ready(turn(await game(SV), [mon("magnezone", "magnetpull", "magneticflux", { evs: { spe: 252 } }), mon("toxtricitylowkey", "minus", null), lax(16, "bodyslam", { target: OR }), lax(8)]));
    expect(texts(hitOf(flux, OL, OR).facts)).toEqual(expect.arrayContaining(["+1 Defense.", "+1 Sp. Def."]));
    expect(texts(stepOf(flux, OL).facts)).not.toContain("Magnetic Flux fails: no Pokémon on Magnezone's side has Plus or Minus.");
    const till = ready(turn(await game(USUM), [mon("diggersby", "hugepower", "rototiller", { evs: { spe: 252 } }), mon("venusaur", "overgrow", null), mon("tropius", "chlorophyll", null), lax(8, "bodyslam", { target: OR })]));
    expect(texts(hitOf(till, OL, PL).facts)).toContain("Tropius is immune.");
    expect(texts(hitOf(till, OL, OR).facts)).toEqual(expect.arrayContaining(["+1 Attack.", "+1 Sp. Atk."]));
  });
});

describe("status2 A1: stored stats (F1 §3.2, §4.2)", () => {
  it("A1-SPD-1: Speed Swap: SV re-sorts after it (the foe moves second), USUM keeps the turn's order", async () => {
    const slots = [smeargle("speedswap", PL), lax(24, "bodyslam", { target: PL }), lax(0, "bodyslam", { target: OR }), lax(8)];
    const sv = ready(turn(await game(SV), slots));
    expect([orderOf(sv, OR), orderOf(sv, PL)]).toEqual([{ 3: 1 }, { 2: 1 }]);
    const usum = ready(turn(await game(USUM), slots));
    expect([orderOf(usum, OR), orderOf(usum, PL)]).toEqual([{ 2: 1 }, { 3: 1 }]);
    expect(texts(stepOf(sv, OL).facts)).toContain("Smeargle now has 50 Speed, Snorlax (opponent's, 1) 127.");
  });

  it("A1-SPL-2 (E2): Guard Split averages the stored Defenses (floor): the Body Slam into Smeargle after 73–87", async () => {
    const input = turn(await game(SV), [smeargle("guardsplit", PL), lax(0), lax(16, null, { evs: { def: 252, spe: 16 } }), lax(8, "bodyslam", { target: OL })]);
    const result = ready(input);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 73, max: 87 });
    const list = await outcomes(input);
    const def = list[0].mons[OL]!.build.storedStats?.def;
    expect(list.every((o) => o.mons[OL]!.build.storedStats?.def === def && o.mons[PL]!.build.storedStats?.def === def)).toBe(true);
  });

  it("A1-TRK-1/2: Power Trick swaps the stored Attack and Defense (the Body Slam 29–34); a second use swaps them back", async () => {
    const runtime = await game(SV);
    const trick = ready(turn(runtime, [mon("forretress", "sturdy", "powertrick", { evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(hitOf(trick, PL, OL)).toMatchObject({ min: 29, max: 34 });
    expect(trick.facts).toContain("Assumes Forretress has no Power Trick from an earlier turn.");
    const back = ready(turn(runtime, [mon("forretress", "sturdy", "powertrick", { evs: { spe: 252 }, carried: { powerTrick: true } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(said(back, OL).some((text) => text.startsWith("Power Trick ends: Forretress's Attack is"))).toBe(true);
  });
});

describe("status2 A1: ability changes (F1 §3.4; SA14, SA15, SA16, SA17, SA27)", () => {
  it("A1-SKS-1: Skill Swap moves Levitate: Bronzong is hit by Earthquake (92–110), Smeargle is immune", async () => {
    const result = ready(turn(await game(SV), [smeargle("skillswap", PL), lax(0), mon("bronzong", "levitate", null), mon("garchomp", "roughskin", "earthquake")]));
    expect(hitOf(result, PR, PL)).toMatchObject({ min: 92, max: 110 });
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "no-damage" });
    expect(texts(stepOf(result, OL).facts)).toContain("Smeargle gets Levitate; Bronzong gets Own Tempo.");
  });

  it("A1-SKS-7: Skill Swap gives Smeargle Intimidate: both foes −1 Atk (their Body Slams 76–90, 39–46)", async () => {
    const result = ready(turn(await game(SV), [smeargle("skillswap", OR), mon("incineroar", "intimidate", null), lax(16, "bodyslam", { target: OL }), lax(8, "bodyslam", { target: OR })]));
    expect(hitOf(result, PL, OL)).toMatchObject({ min: 76, max: 90 });
    expect(hitOf(result, PR, OR)).toMatchObject({ min: 39, max: 46 });
    // Only the foes are Snorlax, so their names carry the number alone.
    expect(texts(stepOf(result, OL).facts)).toEqual(["Smeargle gets Intimidate; Incineroar gets Own Tempo.", "Smeargle's Intimidate activates.", "Snorlax (2): −1 Attack.", "Snorlax (1): −1 Attack."]);
  });

  it("A1-INT-1: an Intimidate copied by Role Play: Guard Dog turns it into +1 Atk, Inner Focus blocks it (generation 8 on)", async () => {
    const result = ready(turn(await game(SV), [smeargle("roleplay", OR), mon("incineroar", "intimidate", null), mon("mabosstiff", "guarddog", "bodyslam", { target: OL }), mon("lucario", "innerfocus", "closecombat", { target: OL })]));
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 320, max: 378 });
    expect(hitOf(result, PL, OR)).toMatchObject({ min: 62, max: 73 });
    expect(texts(stepOf(result, OL).facts)).toEqual(expect.arrayContaining(["Mabosstiff's Guard Dog: +1 Attack.", "Lucario's Inner Focus: its Attack is not lowered."]));
  });

  it("A1-INT-3 (E2): the copied Intimidate: a Substitute holder is immune; an Adrenaline Orb holder −1 Atk then +1 Spe, the Orb used", async () => {
    const input = turn(await game(SV), [smeargle("roleplay", PL), lax(0), mon("incineroar", "intimidate", null, { substitute: 40 }), lax(16, null, { item: "adrenalineorb" })]);
    const result = ready(input);
    expect(said(result, OL)).toEqual(expect.arrayContaining(["Incineroar is behind a Substitute.", "Snorlax (opponent's): −1 Attack.", "Snorlax (opponent's)'s Adrenaline Orb: +1 Speed."]));
    const list = await outcomes(input);
    expect(share(list, (o) => o.mons[PR]!.build.boosts.atk === -1 && o.mons[PR]!.build.boosts.spe === 1 && o.mons[PR]!.build.itemId === "" && o.mons[PL]!.build.boosts.atk === 0)).toBeCloseTo(1, 9);
  });

  it("A1-RPL-1: Role Play copies a protecting Incineroar's Intimidate (no protect flag)", async () => {
    const result = ready(turn(await game(SV), [smeargle("roleplay", PL), lax(0), mon("incineroar", "intimidate", "protect"), lax(8, "bodyslam", { target: OL })]));
    expect(texts(stepOf(result, OL).facts)).toEqual(expect.arrayContaining(["Smeargle gets Intimidate.", "Smeargle's Intimidate activates."]));
  });

  it("A1-STR-8 / -9 / -10: Starts that change the field: Drought over the rain (Flamethrower 37–45), Electric Surge (Thunderbolt 51–61), Cloud Nine in rain (Water Pulse 34–42)", async () => {
    const runtime = await game(SV);
    const sun = ready(turn(runtime, [smeargle("roleplay", PL), mon("arcanine", "flashfire", "flamethrower", { target: PR }), mon("torkoal", "drought", null), lax(0)], { weather: "Rain" }));
    expect(hitOf(sun, OR, PR)).toMatchObject({ min: 37, max: 45 });
    expect(texts(stepOf(sun, OL).facts)).toContain("Smeargle's Drought: the weather becomes Sun.");
    const surge = ready(turn(runtime, [smeargle("roleplay", PL), mon("jolteon", "voltabsorb", "thunderbolt", { target: PR }), mon("pincurchin", "electricsurge", null), lax(0)], { terrain: "Psychic" }));
    expect(hitOf(surge, OR, PR)).toMatchObject({ min: 51, max: 61 });
    const nine = ready(turn(runtime, [smeargle("roleplay", PL), mon("vaporeon", "waterabsorb", "waterpulse", { target: PR }), mon("altaria", "cloudnine", null), lax(0)], { weather: "Rain" }));
    expect(hitOf(nine, OR, PR)).toMatchObject({ min: 34, max: 42 });
  });

  it("A1-STR-3: Role Play copies Hospitality: its ally at 100 HP is healed a quarter (158)", async () => {
    const result = ready(turn(await game(SV), [smeargle("roleplay", PL), lax(0, null, { hp: 100 }), mon("sinistcha", "hospitality", null), lax(8)]));
    expect(result.hp[OR]).toMatchObject({ min: 158, max: 158 });
  });

  it("A1-STR-5: Intrepid Sword gained mid-turn: +1 Atk, once a battle in SV (the fact), every time in SwSh", async () => {
    const sv = ready(turn(await game(SV), [smeargle("roleplay", PL), lax(0), mon("zacian", "intrepidsword", null), lax(8)]));
    expect(sv.facts).toContain("Assumes Smeargle has not had Intrepid Sword before in this battle.");
    expect(texts(stepOf(sv, OL).facts)).toContain("Smeargle's Intrepid Sword: +1 Attack.");
    const swsh = ready(turn(await game(SWSH), [mon("absol", "pressure", "roleplay", { evs: { spe: 252 }, target: PL }), lax(0), mon("zacian", "intrepidsword", null), lax(8)]));
    expect(swsh.facts.some((text) => text.includes("before in this battle"))).toBe(false);
  });

  it("A1-END-1: Simple Beam ends a foe's Unnerve: the user's ally eats its Sitrus at the Update (90 → 148)", async () => {
    const result = ready(turn(await game(SV), [smeargle("simplebeam", PL), lax(0, null, { item: "sitrusberry", hp: 90 }), mon("houndoom", "unnerve", null), lax(8)]));
    expect(result.hp[OR]).toMatchObject({ min: 148, max: 148 });
  });

  it("A1-GAS-1/2: Gastro Acid suppresses Levitate (Earthquake 92–110) and Cloud Nine in rain (Water Pulse 52–63)", async () => {
    const runtime = await game(SV);
    const levitate = ready(turn(runtime, [smeargle("gastroacid", PL), lax(0), mon("bronzong", "levitate", null), mon("garchomp", "roughskin", "earthquake")]));
    expect(hitOf(levitate, PR, PL)).toMatchObject({ min: 92, max: 110 });
    expect(texts(hitOf(levitate, OL, PL).facts)).toContain("Its Levitate is suppressed.");
    const rain = ready(turn(runtime, [smeargle("gastroacid", PL), mon("vaporeon", "waterabsorb", "waterpulse", { target: PR }), mon("altaria", "cloudnine", null), lax(0)], { weather: "Rain" }));
    expect(hitOf(rain, OR, PR)).toMatchObject({ min: 52, max: 63 });
  });

  it("A1-WSD-1 / -2: Worry Seed cures a sleeping target (its Body Slam lands: 114–135); Insomnia is immune", async () => {
    const runtime = await game(SV);
    const cured = ready(turn(runtime, [smeargle("worryseed", PL), lax(0), lax(16, "bodyslam", { status: "slp", target: OL, carried: { sleep: { attempts: 0, rest: true } } }), lax(8)]));
    expect(hitOf(cured, PL, OL)).toMatchObject({ min: 114, max: 135 });
    const immune = ready(turn(runtime, [smeargle("worryseed", PL), lax(0), mon("hypno", "insomnia", null), lax(8)]));
    expect(texts(hitOf(immune, OL, PL).facts)).toContain("Hypno is immune.");
  });

  it("A1-SKS-5: Skill Swap into an Ability Shield holder is blocked (Bronzong keeps Levitate)", async () => {
    const result = ready(turn(await game(SV), [smeargle("skillswap", PL), lax(0), mon("bronzong", "levitate", null, { item: "abilityshield" }), mon("garchomp", "roughskin", "earthquake")]));
    expect(said(result, OL)).toContain("Ability Shield: Bronzong keeps Levitate.");
    expect(hitOf(result, PR, PL)).toMatchObject({ kind: "no-damage" });
  });

  it("A1-TRC-1: Trace gained by Skill Swap copies the one copyable foe ability (Flash Fire absorbs the later Flamethrower)", async () => {
    const result = ready(turn(await game(SV), [mon("smeargle", "receiver", "skillswap", { evs: { spe: 252 }, target: PL, build: { abilityChanged: true } }), mon("passimian", "receiver", null),
      mon("gardevoir", "trace", null), mon("arcanine", "flashfire", "flamethrower", { target: OL })]));
    expect(texts(stepOf(result, OL).facts)).toContain("Smeargle's Trace copies Flash Fire from Arcanine.");
    expect(hitOf(result, PR, OL)).toMatchObject({ kind: "blocked" });
  });
});

describe("status2 A1: Transform (F1 §3.5 with C2)", () => {
  it("A1-TRF-1: Ditto Transforms into a +2 Def Snorlax: the Body Slam into it 37–45", async () => {
    const result = ready(turn(await game(SV), [mon("ditto", "limber", "transform", { evs: { spe: 252 }, target: PL }), lax(0), lax(16, null, { boosts: { def: 2 } }), lax(8, "bodyslam", { target: OL })]));
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 37, max: 45 });
    expect(texts(stepOf(result, OL).facts)).toContain("Ditto transforms into Snorlax (opponent's, 1).");
  });

  it("A1-TRF-4 (E2): Transform into a Gastro Acid'd Gyarados copies its own Intimidate, active, which starts", async () => {
    const input = turn(await game(SV), [mon("ditto", "limber", "transform", { evs: { spe: 252 }, target: PL }), lax(0), mon("gyarados", "intimidate", null, { carried: { gastroAcid: true } }), lax(8, "bodyslam", { target: OL })]);
    const result = ready(input);
    expect(texts(stepOf(result, OL).facts)).toContain("Ditto's Intimidate activates.");
    const list = await outcomes(input);
    expect(share(list, (o) => o.mons[OL]!.build.abilityId === "intimidate" && o.mons[OL]!.build.speciesId === "gyarados" && !!o.mons[OL]!.build.transformedFrom)).toBeCloseTo(1, 9);
  });

  it("transformMax and the narrow texts", () => {
    expect(REASONS.transformMax("Garchomp")).toBe("Transform into a Dynamaxed Garchomp is not modelled in 2v2.");
    expect(REASONS.abilityStart("Supreme Overlord", "Kingambit")).toBe("Supreme Overlord starting on Kingambit is not modelled in 2v2.");
  });
});

describe("status2 A1: the ability table and the Start / End lists (ability-table.ts)", () => {
  it("reads the per-game flags (Gulp Missile's failskillswap is Sword/Shield's only; noreceiver for K)", () => {
    expect(abilityFlag("gulpmissile", "sword_shield", "failskillswap")).toBe(true);
    expect(abilityFlag("gulpmissile", "scarlet_violet", "failskillswap")).toBe(false);
    expect(abilityFlag("gulpmissile", "scarlet_violet", "cantsuppress")).toBe(true);
    expect(abilityFlag("trace", "champions", "noreceiver")).toBe(true);
    expect(abilityEntry("intimidate", "ultra_sun_ultra_moon").start).toBe(true);
    expect(abilityEntry("imposter", "scarlet_violet")).toMatchObject({ switchIn: true });
    expect(abilityEntry("imposter", "scarlet_violet").start).toBeUndefined();
  });
  it("classifies Supreme Overlord's Start as guarded and Zen Mode's End", () => {
    expect(ABILITY_STARTS.supremeoverlord).toBe("guard");
    expect(ABILITY_ENDS.zenmode).toBe("guard");
    expect(ABILITY_STARTS.intimidate).toBe("acts");
  });
});

describe("status2 A1: the E2 outcome part and the card's conditions (outcomeMon, conditions)", () => {
  // A minimal kernel and world: the two readers take names, the input's moves and the world's Pokémon.
  const kernel = {
    names: { "own-left": "Ditto", "own-right": "Swalot", "opponent-left": "Gyarados", "opponent-right": "Snorlax" },
    input: { pokemon: { "own-left": { build: { abilityId: "limber" } }, "own-right": { build: { abilityId: "liquidooze" } }, "opponent-left": { build: { abilityId: "intimidate" }, moves: ["waterfall", "dragondance"] }, "opponent-right": { build: { abilityId: "thickfat" } } } },
    abilityName: (id: string) => ({ intimidate: "Intimidate", levitate: "Levitate" } as Record<string, string>)[id] ?? id,
    moveName: (id: string) => ({ geomancy: "Geomancy" } as Record<string, string>)[id] ?? id,
    gas: null,
  } as unknown as TurnKernel;
  const at = (build: Partial<BattleBuild>, vol: Record<string, unknown> = {}) => ({ build: { abilityId: "x", boosts: {}, ...build }, vol, eot: {}, fainted: false });
  it("lists the volatiles, the own ability behind the stand-in, the stages and a transformed Pokémon's moves", () => {
    const w = {
      mons: {
        "own-left": at({ abilityId: "intimidate", speciesId: "gyarados", transformedFrom: { speciesId: "ditto", baseHP: 48 } }, { transform: { into: "opponent-left" }, stages: { evasion: 2 } }),
        "own-right": at({ abilityId: "runaway" }, { gastroAcid: "levitate", stockpile: { layers: 1, def: -1, spd: -1 }, minimize: true, charging: "geomancy" }),
      },
    } as unknown as World;
    expect(outcomeMon(kernel, w, "own-left")).toEqual({ volatiles: ["transform"], fields: { stages: { evasion: 2 }, moves: ["waterfall", "dragondance"] } });
    const swalot = outcomeMon(kernel, w, "own-right");
    expect(swalot.volatiles).toEqual(["stockpile", "minimize", "gastroacid", "twoturnmove", "geomancy"]);
    expect(swalot.build?.abilityId).toBe("levitate");
    expect(realAbility(kernel, w, "own-right")).toBe("levitate");
    expect(conditions(kernel, w, "own-left")).toEqual(["Transformed into Gyarados."]);
    expect(conditions(kernel, w, "own-right")).toEqual(["Stockpile 1.", "Minimized.", "Ability suppressed.", "Charging Geomancy."]);
  });
});

describe("status2 A1: the trapped volatile and Opportunist's End on a world (fake kernel)", () => {
  const facts: string[] = [];
  const kernel = {
    names: { "own-left": "Falinks", "own-right": "Gengar", "opponent-left": "Bronzong", "opponent-right": "Espathra" },
    alive: (w: World, slot: DoublesSlotId) => !!w.mons[slot] && !w.mons[slot]!.fainted,
    typesIn: (w: World, slot: DoublesSlotId) => (w.mons[slot]!.build as BattleBuild & { types?: string[] }).types ?? [],
    hitFact: (_a: unknown, slot: DoublesSlotId, text: string) => facts.push(`hit ${slot}: ${text}`),
    stepFact: (_a: unknown, text: string) => facts.push(`step: ${text}`),
    effectiveWeather: () => "", runtime: { profile: { generation: 9, id: "scarlet_violet" } },
  } as unknown as TurnKernel;
  const at = (types: string[], vol: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ build: { abilityId: "x", boosts: {}, types }, vol, eot: {}, fainted: false, ...extra });
  const world = () => ({
    mass: 1, field: { weather: "", terrain: "" },
    mons: { "own-left": at(["Fighting"]), "own-right": at(["Ghost", "Poison"]), "opponent-left": at(["Steel", "Psychic"]), "opponent-right": at(["Psychic"]) },
  }) as unknown as World;
  const use = (user: DoublesSlotId, name: string) => ({ user, move: { name }, action: {}, reached: new Set(SLOTS) }) as never;
  it("Block (the trap handler) traps a non-Ghost once; a Ghost type and one already trapped fail; No Retreat then adds no volatile", () => {
    facts.length = 0;
    const w = world();
    HANDLERS.trap.onHit!(kernel, w, use(PL, "Block"), OL);
    HANDLERS.trap.onHit!(kernel, w, use(PL, "Block"), OL);
    HANDLERS.trap.onHit!(kernel, w, use(PL, "Block"), OR);
    expect(facts).toEqual(["hit own-left: Falinks can no longer switch out.", "hit own-left: Block fails: Falinks is already trapped.", "hit own-right: Block fails: Gengar is a Ghost type."]);
    expect(outcomeMon(kernel, w, OL).volatiles).toEqual(["trapped"]);
    expect(HANDLERS.noRetreat.volatile!(kernel, w, use(OL, "No Retreat"), OL)).toBe(true);
    expect(w.mons[OL]!.vol.noRetreat).toBeUndefined();
  });
  it("the trapper fainting ends it (linked volatile); one from an earlier turn stays", () => {
    const w = world();
    HANDLERS.trap.onHit!(kernel, w, use(PL, "Mean Look"), OL);
    w.mons[PL]!.fainted = true;
    expect(outcomeMon(kernel, w, OL).volatiles).toEqual([]);
    const carried = world();
    carried.mons[OL]!.vol.trapped = true;
    carried.mons[PL]!.fainted = true;
    expect(outcomeMon(kernel, carried, OL).volatiles).toEqual(["trapped"]);
  });
  it("trapAfterHit: Jaw Lock traps both (the user first), Spirit Shackle the target, not a Ghost; another move nothing", () => {
    facts.length = 0;
    const w = world();
    trapAfterHit(kernel, w, {} as never, PR, PL, "jawlock");
    expect(facts).toEqual(["step: Espathra can no longer switch out.", "hit opponent-left: Bronzong can no longer switch out."]);
    trapAfterHit(kernel, w, {} as never, PL, OR, "spiritshackle");
    trapAfterHit(kernel, w, {} as never, PL, OL, "bodyslam");
    expect([OL, OR, PL, PR].map((slot) => outcomeMon(kernel, w, slot).volatiles)).toEqual([[], [], ["trapped"], ["trapped"]]);
  });
  it("Opportunist's End deletes its pending copy (C7, CR-08b/c); another ability's End keeps a copy by Mirror Herb", () => {
    const w = world();
    w.mons[PR]!.copy = { stages: { atk: 1 }, by: "opportunist" };
    abilityEnd(kernel, w, PR, "opportunist");
    expect(w.mons[PR]!.copy).toBeUndefined();
    const herb = world();
    herb.mons[PR]!.copy = { stages: { atk: 1 }, by: "mirrorherb" };
    abilityEnd(kernel, herb, PR, "opportunist");
    expect(herb.mons[PR]!.copy).toEqual({ stages: { atk: 1 }, by: "mirrorherb" });
  });
});

describe("status2 A1: Champions", () => {
  it("A1-SPL-1-champions: Guard Split into a protecting Snorlax is blocked (protect flag)", async () => {
    const runtime = await game(CHAMPIONS);
    const result = ready(turn(runtime, [mon("alakazam", "innerfocus", "guardsplit", { evs: { spe: 32 }, target: PL }), lax(0), lax(2, "protect", { evs: { def: 32, spe: 2 } }), lax(1, "bodyslam", { target: OL })]));
    expect(texts(hitOf(result, OL, PL).facts)).toContain("Protect blocks Guard Split.");
  });
});

describe("status2 A1: an ability the game's data does not list", () => {
  it("SAT-SBM-1-champions: Simple Beam in Champions is not estimated (no Pokémon there has Simple; the engine has no entry)", async () => {
    const runtime = await game(CHAMPIONS);
    const result = calculateDoublesTurn(turn(runtime, [mon("sirfetchd", "steadfast", "simplebeam", { evs: { spe: 32 }, target: OR }), mon("garchomp", "roughskin", "swordsdance"), lax(2), lax(1)]));
    expect(result).toMatchObject({ status: "not-estimated", reason: "Simple Beam giving Simple is not modelled in 2v2." });
    // The same turn in Scarlet/Violet is modelled (SAT-SBM-1-sv: +4).
    const sv = await game(SV);
    const input = turn(sv, [mon("grumpig", "thickfat", "simplebeam", { evs: { spe: 252 }, target: OR }), mon("garchomp", "roughskin", "swordsdance", { build: { nature: "Brave" } }), lax(16), lax(8)]);
    expect(share(await outcomes(input), (o) => o.mons[OR]!.build.abilityId === "simple" && o.mons[OR]!.build.boosts.atk === 4)).toBeCloseTo(1, 9);
  });
});

/**
 * The parts that need the integrator (W1A-A1.md I1–I3; these fail until they land): I1 the status table's `handler: "trap"`
 * on Block, Mean Look and Spider Web (gen-status-table.ts HANDLERS with handlers emitted for kind N), I2 doubles-turn.ts
 * outcomeOf calling abilityHooks.outcomeMon, I3 doubles-status.ts conditions appending abilityHooks.conditions. Each number
 * is the pinned oracle's (V1's SAT-NRT-2 results; A1's a1-results).
 */
describe("status2 A1 after the integrator's changes (W1A-A1.md I1–I3; these fail until they land)", () => {
  const volatiles = (list: Awaited<ReturnType<typeof outcomes>>, slot: DoublesSlotId, id: string) => share(list, (o) => !!o.mons[slot]?.volatiles?.includes(id));
  it("I1, SAT-NRT-2-swsh: a faster Block traps Falinks, so its No Retreat raises all five but adds no volatile", async () => {
    const input = turn(await game(SWSH), [mon("falinks", "battlearmor", "noretreat"), lax(0), mon("aegislash", "stancechange", "block", { evs: { spe: 252 }, target: OL }), lax(64)]);
    const result = ready(input);
    expect(texts(hitOf(result, PL, OL).facts)).toContain("Falinks can no longer switch out.");
    const list = await outcomes(input);
    expect(volatiles(list, OL, "trapped")).toBeCloseTo(1, 9);
    expect(volatiles(list, OL, "noretreat")).toBe(0);
    expect(share(list, (o) => o.mons[OL]!.build.boosts.atk === 1 && o.mons[OL]!.build.boosts.spe === 1)).toBeCloseTo(1, 9);
  });
  it("I1, SAT-NRT-2-sv: a slower Block after No Retreat: both volatiles; Mean Look into a Ghost type fails", async () => {
    const runtime = await game(SV);
    const list = await outcomes(turn(runtime, [mon("falinks", "battlearmor", "noretreat"), lax(0), mon("bronzong", "levitate", "block", { evs: { spe: 252 }, target: OL }), lax(64)]));
    expect([volatiles(list, OL, "trapped"), volatiles(list, OL, "noretreat")].map((x) => +x.toFixed(9))).toEqual([1, 1]);
    const ghost = ready(turn(runtime, [mon("umbreon", "synchronize", "meanlook", { evs: { spe: 252 }, target: PL }), lax(0), mon("gengar", "cursedbody", null), lax(8)]));
    expect(texts(hitOf(ghost, OL, PL).facts)).toContain("Mean Look fails: Gengar is a Ghost type.");
  });
  it("I2: the outcome carries A1's volatiles and the real ability behind Gastro Acid's stand-in", async () => {
    const runtime = await game(SV);
    const stock = await outcomes(turn(runtime, [mon("swalot", "liquidooze", "stockpile", { evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(volatiles(stock, OL, "stockpile")).toBeCloseTo(1, 9);
    const gas = await outcomes(turn(runtime, [smeargle("gastroacid", PL), lax(0), mon("bronzong", "levitate", null), mon("garchomp", "roughskin", "earthquake")]));
    expect(share(gas, (o) => o.mons[PL]!.build.abilityId === "levitate" && !!o.mons[PL]!.volatiles?.includes("gastroacid"))).toBeCloseTo(1, 9);
  });
  it("I3: the card's conditions say Stockpile and a suppressed ability", async () => {
    const runtime = await game(SV);
    const stock = ready(turn(runtime, [mon("swalot", "liquidooze", "stockpile", { evs: { spe: 252 } }), lax(0), lax(16, "bodyslam", { target: OL }), lax(8)]));
    expect(texts(stock.hp[OL]!.conditions)).toContain("Stockpile 1.");
    const gas = ready(turn(runtime, [smeargle("gastroacid", PL), lax(0), mon("bronzong", "levitate", null), mon("garchomp", "roughskin", "earthquake")]));
    expect(texts(gas.hp[PL]!.conditions)).toContain("Ability suppressed.");
  });
});
