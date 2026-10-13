import { describe, expect, it } from "vitest";
import { REASONS } from "@/app/lib/battle/doubles-actions";
import { custapGuard, rowsByVariant, settleDoublesStart, turnFacts, variants, type DoublesSettle } from "@/app/lib/battle/doubles-start";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesStartRow, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import type { World } from "@/app/lib/battle/doubles-world";
import { intimidatedKey } from "@/app/lib/battle/intimidate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * status2 Track ST (ADDENDUM2 §4.3 ST, T2P §4, SPEC2 D's start items, USER-DECISIONS Q8): app/lib/battle/doubles-start.ts, the
 * start of a doubles turn. The numbers are pinned Showdown c23d2e94's, from the track's probe cases
 * (scripts/.cache/calc-audit/status2/build/w1b-st/cases-st.ts, oracle/<id>.json: sim-dfs.ts with V2's startRandom for a random
 * start) and the stored oracle cases named in each test (CR-08a-sv, G4-OPP-07-sv, SAT-IMP-1-sv, G4-STF-02-usum): level 50, 31
 * IVs, Serious nature, 0 EVs unless set; p1a own-left, p1b own-right, p2a opponent-right, p2b opponent-left.
 *
 * Tests named "(integrator ST-n)" read a doubles-turn.ts line this track asked the integrator for (W1B-ST.md), in since
 * integration 1b.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; carried?: DoublesCarried; build?: Partial<BattleBuild>; extra?: Partial<DoublesPokemonInput>;
  move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon";

const mon = (species: string, ability: string, move: string | null = null, extra: Partial<Mon> = {}): Mon => ({ species, ability, move, ...extra });
/** The probes' lax(n): a Thick Fat Snorlax with n Speed EVs. */
const lax = (spe: number, move: string | null = null, extra: Partial<Mon> = {}) => mon("snorlax", "thickfat", move, { evs: { spe }, ...extra });

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const trained = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  return { ...trained, ...m.build } as BattleBuild;
}
/** The four Pokémon in slot order own-left, own-right, opponent-left, opponent-right (null: an empty slot). */
function turn(runtime: BattleRuntime, mons: [Mon | null, Mon | null, Mon | null, Mon | null], field: Partial<BattleConditions> = {}, more: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    if (!m) return [slot, null];
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}), ...m.extra,
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true }, ...more };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(input: DoublesTurnInput): Ready {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.hits.find((hit) => hit.slot === target)!;
const kernel = {} as TurnKernel;
const weights = (settle: DoublesSettle) => variants(kernel, settle).map((variant) => variant.weight);

// ------------------------------------------------------------------------------------------------------------------
// Trace (T2P §4.1)
// ------------------------------------------------------------------------------------------------------------------

/** STP-TRC-01: Gardevoir's Trace against Levitate Hydreigon and Rough Skin Garchomp; Garchomp's Earthquake. */
const traceTurn = (runtime: BattleRuntime, foe: Mon = mon("hydreigon", "levitate")) => turn(runtime, [
  mon("gardevoir", "trace"), lax(0), foe, mon("garchomp", "roughskin", "earthquake"),
]);

describe("Trace", () => {
  it("copies either of two different foe abilities, 1/2 each: one start per copy", async () => {
    const sv = await game(SV);
    const settle = settleDoublesStart(traceTurn(sv));
    expect(settle.reason).toBeNull();
    expect(weights(settle)).toEqual([0.5, 0.5]);
    expect(settle.variants!.map((variant) => variant.slots[OL]!.folded.abilityId)).toEqual(["levitate", "roughskin"]);
    expect(settle.variants!.map((variant) => variant.label)).toEqual(["If Gardevoir's Trace copied Levitate.", "If Gardevoir's Trace copied Rough Skin."]);
    expect(settle.variants!.map((variant) => variant.slots[OL]!.lines)).toEqual([["Trace: Gardevoir copied Levitate from Hydreigon."], ["Trace: Gardevoir copied Rough Skin from Garchomp."]]);
    // The rows' starts are the same two; the settle's own slots are the first, the Trace holder's saying so (the moves pane).
    expect(settle.rowVariants!.length).toBe(2);
    expect(settle.slots[OL]!.lines).toEqual(["Trace: Gardevoir copied Levitate from Hydreigon.", "If Gardevoir's Trace copied Levitate."]);
    expect(settle.slots[PR]).toBe(settle.rowVariants![0].slots[PR]);
    expect(turnFacts(settle)).toEqual(["Assumes Gardevoir's Trace copied as it came in: Levitate from Hydreigon or Rough Skin from Garchomp, 1/2 each."]);
  });

  it("STP-TRC-01-sv / -usum: Earthquake lands on Gardevoir in the Rough Skin start only (75–88)", async () => {
    for (const id of [SV, USUM] as const) {
      const result = ready(traceTurn(await game(id)));
      expect(hitOf(result, PR, OL)).toMatchObject({ reached: 1, kind: "calculated", min: 75, max: 88 });
      // Half the turn's worlds have Levitate: Gardevoir keeps its 143 HP there.
      expect(result.hp[OL]!.koChance).toBe(0);
      expect(result.hp[OL]!.max).toBe(143);
      expect(result.hp[OL]!.min).toBe(143 - 88);
    }
  });

  it("(integrator ST-4) its turn fact; (ST-3) the start rows per copy", async () => {
    const result = ready(traceTurn(await game(SV)));
    expect(result.facts).toContain("Assumes Gardevoir's Trace copied as it came in: Levitate from Hydreigon or Rough Skin from Garchomp, 1/2 each.");
    const rows = result.startRows.filter((row) => row.slot === PR && row.target === OL);
    expect(rows.map((row) => [row.fact, row.row.min, row.row.max])).toEqual([["If Gardevoir's Trace copied Levitate.", 0, 0], ["If Gardevoir's Trace copied Rough Skin.", 75, 88]]);
  });

  it("keeps its reason for a copy whose Start changes the field as it enters, and against a foe's Trace that may copy first", async () => {
    const sv = await game(SV);
    expect(settleDoublesStart(traceTurn(sv, mon("torkoal", "drought"))).reason).toBe("Trace copies a random foe's ability.");
    expect(settleDoublesStart(traceTurn(sv, mon("porygon2", "trace"))).reason).toBe("Trace copies a random foe's ability.");
    // A slower foe's Trace (its copy given) has not copied yet when this one does (Trace cannot be copied): Garchomp's Rough Skin for sure.
    const slower = settleDoublesStart(traceTurn(sv, mon("porygon2", "trace", null, { nature: "Brave", ivs: { spe: 0 }, build: { tracedAbility: "thickfat" } })));
    expect(slower.reason).toBeNull();
    expect(slower.variants).toBeUndefined();
    expect(slower.slots[OL]!.folded.abilityId).toBe("roughskin");
  });

  it("STP-TRC-02-sv: copying Intimidate drops both foes in its start (Kingambit −1 then Defiant +2); Iron Head 124–147 or 84–99", async () => {
    const sv = await game(SV);
    // Incineroar's own Intimidate is in the input's stages (the apply action); Trace's copy is the settle's.
    const input = turn(sv, [
      mon("gardevoir", "trace", null, { nature: "Brave", ivs: { spe: 0 }, build: { boosts: { atk: -1, def: 0, spa: 0, spd: 0, spe: 0 } } }),
      lax(0, null, { build: { boosts: { atk: -1, def: 0, spa: 0, spd: 0, spe: 0 } } }),
      mon("kingambit", "defiant", "ironhead", { target: OR }), mon("incineroar", "intimidate"),
    ]);
    const settle = settleDoublesStart(input);
    const intimidated = settle.variants!.find((variant) => variant.slots[OL]!.folded.abilityId === "intimidate")!;
    expect(intimidated.slots[PL]!.folded.boosts.atk).toBe(1);
    expect(intimidated.slots[PR]!.folded.boosts.atk).toBe(-1);
    expect(intimidated.slots[OL]!.lines).toContain("Gardevoir's Intimidate (copied by Trace) is applied.");
    const defiant = settle.variants!.find((variant) => variant.slots[OL]!.folded.abilityId === "defiant")!;
    expect(defiant.slots[PL]!.folded.boosts.atk).toBe(0);
    const result = ready(input);
    expect(hitOf(result, PL, OR)).toMatchObject({ min: 84, max: 147 });
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    const share = (atk: number) => outcomes.outcomes.filter((outcome) => outcome.mons[PL]!.build.boosts.atk === atk).reduce((sum, outcome) => sum + outcome.chance, 0);
    expect(share(1)).toBeCloseTo(0.5, 12);
    expect(share(0)).toBeCloseTo(0.5, 12);
  });

  it("keeps its reason where a copy (Defiant) would meet a foe's Intimidate that came after it at the lead (Gardevoir 100 against Incineroar 80)", async () => {
    const sv = await game(SV);
    // In Showdown the Defiant start reacts to Incineroar's Intimidate (−1, then +2): the input's −1 cannot be both starts'.
    const faster = turn(sv, [mon("gardevoir", "trace", null, { build: { boosts: { atk: -1, def: 0, spa: 0, spd: 0, spe: 0 } } }), lax(0), mon("kingambit", "defiant", "ironhead", { target: OR }), mon("incineroar", "intimidate")]);
    expect(settleDoublesStart(faster).reason).toBe("Trace copies a random foe's ability.");
  });

  it("STP-TRC-03-swsh: a sure copy of Intimidate (both foes have it) applies it; its stored drops are not applied again", async () => {
    const swsh = await game(SWSH);
    const mons = (stored?: string): [Mon, Mon, Mon, Mon] => [
      mon("porygon2", "trace", null, { item: "eviolite", nature: "Brave", ivs: { spe: 0 }, build: { boosts: { atk: -2, def: 0, spa: 0, spd: 0, spe: 0 }, ...(stored ? { copiedIntimidateStored: stored } : {}) } }),
      lax(0, null, { build: { boosts: { atk: -2, def: 0, spa: 0, spd: 0, spe: 0 } } }), mon("gyarados", "intimidate", "waterfall", { target: OR }), mon("incineroar", "intimidate"),
    ];
    const settle = settleDoublesStart(turn(swsh, mons()));
    expect(settle.variants).toBeUndefined();
    expect([settle.slots[PL]!.folded.boosts.atk, settle.slots[PR]!.folded.boosts.atk]).toEqual([-1, -1]);
    expect(hitOf(ready(turn(swsh, mons())), PL, OR)).toMatchObject({ min: 51, max: 61 });
    const stored = settleDoublesStart(turn(swsh, mons(["incineroar", "gyarados"].map((id) => intimidatedKey(createBuild(id, swsh), swsh)).join(","))));
    expect([stored.slots[PL]!.folded.boosts.atk, stored.slots[PR]!.folded.boosts.atk]).toEqual([0, 0]);
  });
});

describe("Trace's copied Intimidate and the items it uses", () => {
  it("STP-TRC-04-sv: a White Herb it uses up was used as the leads came in: gone, its last item, not this turn's (Pickup finds nothing)", async () => {
    const sv = await game(SV);
    const lowered = { atk: -2, def: 0, spa: 0, spd: 0, spe: 0 };
    const input = turn(sv, [
      mon("gardevoir", "trace", null, { nature: "Brave", ivs: { spe: 0 }, build: { boosts: lowered } }), mon("ambipom", "pickup", null, { build: { boosts: lowered } }),
      mon("incineroar", "intimidate"), mon("gyarados", "intimidate", null, { item: "whiteherb" }),
    ]);
    const settle = settleDoublesStart(input);
    expect(settle.slots[PR]!.folded).toMatchObject({ itemId: "", boosts: { atk: 0 } });
    expect(settle.slots[PR]!.build.itemId).toBe("");
    // startWorld reads a use this turn where items.build has no item: it keeps the White Herb.
    expect(settle.slots[PR]!.items.build.itemId).toBe("whiteherb");
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes.every((outcome) => outcome.mons[OR]!.build.itemId === "")).toBe(true);
  });

  it("a Grass-type foe beside a Flower Veil partner: not followed", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("gardevoir", "trace", null, { build: { tracedAbility: "intimidate" } }), lax(0), mon("comfey", "flowerveil"), mon("amoonguss", "regenerator")]);
    expect(settleDoublesStart(input).reason).toBe(REASONS.notIn2v2("Trace copying Intimidate beside Flower Veil"));
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Two Pokémon acting on one (T2P §4.2)
// ------------------------------------------------------------------------------------------------------------------

describe("two Pokémon acting on one as the turn starts", () => {
  it("STP-TWO-01-sv: Unnerve Tyranitar keeps Flutter Mane's Sitrus Berry and Cloud Nine Altaria its Protosynthesis: Moonblast 138–164", async () => {
    const sv = await game(SV);
    const input = turn(sv, [mon("fluttermane", "protosynthesis", "moonblast", { item: "sitrusberry", hp: 50, target: PL }), lax(0), mon("tyranitar", "unnerve"), mon("altaria", "cloudnine")], { weather: "Sun" });
    const settle = settleDoublesStart(input);
    expect(settle.reason).toBeNull();
    expect(settle.slots[OL]!.folded.itemId).toBe("sitrusberry");
    expect(settle.slots[OL]!.folded.settledBoostedStat).toBeUndefined();
    expect(hitOf(ready(input), OL, PL)).toMatchObject({ min: 138, max: 164 });
    // The foe across stands for the rest (doublesRepresentative); each need is read from its own Pokémon.
    expect(settle.slots[OL]!.representative).toBe(PL);
  });

  it("an Unnerve foe that is not the Cloud Nine Pokémon still keeps the Berry (T2P-TWO-02-usum: Castform in rain, Normal form)", async () => {
    const usum = await game(USUM);
    const input = turn(usum, [mon("castform", "forecast", "weatherball", { item: "sitrusberry", hp: 70, target: PL }), lax(8), mon("golduck", "cloudnine"), mon("tyranitar", "unnerve")], { weather: "Rain" });
    const settle = settleDoublesStart(input);
    expect(settle.reason).toBeNull();
    expect(settle.slots[OL]!.folded).toMatchObject({ speciesId: "castform", itemId: "sitrusberry" });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Download at the lead (T2P §4.3)
// ------------------------------------------------------------------------------------------------------------------

/** STP-DWN: Porygon-Z's Download against Snorlax and a Brave 0-IV Zamazenta (128 Speed at the lead); its Tri Attack into the Snorlax. */
const downloadTurn = (runtime: BattleRuntime, spe: number, more: Partial<DoublesTurnInput> = {}, foe: Mon = mon("zamazenta", "dauntlessshield", null, { nature: "Brave", ivs: { spe: 0 } }), field: Partial<BattleConditions> = {}) =>
  turn(runtime, [mon("porygonz", "download", "triattack", { evs: { spe }, target: PL }), lax(0), lax(8), foe], field, more);

describe("Download at the lead", () => {
  it("STP-DWN-01 / -02-swsh: before a slower Dauntless Shield it raises Attack (54–64), after a faster one Sp. Atk (81–96)", async () => {
    const swsh = await game(SWSH);
    const faster = settleDoublesStart(downloadTurn(swsh, 252));
    expect(faster.slots[OL]!.folded.settledDownload).toBe("atk");
    expect(faster.slots[OL]!.lines).toEqual(["Porygon-Z's Download raised its Attack: it read Zamazenta's Defense before its Dauntless Shield rise (assumes all four led together, Porygon-Z first: 142 Speed against 128)."]);
    const slower = settleDoublesStart(downloadTurn(swsh, 0));
    expect(slower.slots[OL]!.folded.settledDownload).toBe("spa");
    expect(slower.slots[OL]!.lines).toEqual(["Porygon-Z's Download raised its Sp. Atk: it read Zamazenta's Defense after its Dauntless Shield rise (assumes all four led together, Zamazenta first: 128 Speed against 110)."]);
    expect(hitOf(ready(downloadTurn(swsh, 252)), OL, PL)).toMatchObject({ min: 54, max: 64 });
    expect(hitOf(ready(downloadTurn(swsh, 0)), OL, PL)).toMatchObject({ min: 81, max: 96 });
  });

  it("STP-DWN-03-swsh: a Speed tie at the lead (128) is a start per order, 1/2 each (54–96)", async () => {
    const swsh = await game(SWSH);
    const settle = settleDoublesStart(downloadTurn(swsh, 140));
    expect(weights(settle)).toEqual([0.5, 0.5]);
    expect(settle.variants!.map((variant) => variant.slots[OL]!.folded.settledDownload).sort()).toEqual(["atk", "spa"]);
    expect(settle.variants!.map((variant) => variant.label).sort()).toEqual(["If Porygon-Z came in first.", "If Zamazenta came in first."]);
    expect(hitOf(ready(downloadTurn(swsh, 140)), OL, PL)).toMatchObject({ min: 54, max: 96 });
  });

  it("the entry order given decides it (entryOrder: the smaller rank came in first)", async () => {
    const swsh = await game(SWSH);
    const shieldFirst = settleDoublesStart(downloadTurn(swsh, 252, { entryOrder: { [PR]: 0, [OL]: 1 } }));
    expect(shieldFirst.slots[OL]!.folded.settledDownload).toBe("spa");
    expect(shieldFirst.slots[OL]!.lines[0]).toBe("Porygon-Z's Download raised its Sp. Atk: it read Zamazenta's Defense after its Dauntless Shield rise (Zamazenta came in first).");
    const tieDecided = settleDoublesStart(downloadTurn(swsh, 140, { entryOrder: { [OL]: 0, [PR]: 1 } }));
    expect(tieDecided.variants).toBeUndefined();
    expect(tieDecided.slots[OL]!.folded.settledDownload).toBe("atk");
  });

  it("STP-DWN-04-usum: a foe's terrain Seed is used after Download's Start (Attack, 54–64)", async () => {
    const usum = await game(USUM);
    const input = downloadTurn(usum, 0, {}, mon("togedemaru", "sturdy", null, { item: "electricseed" }), { terrain: "Electric" });
    const settle = settleDoublesStart(input);
    expect(settle.slots[OL]!.folded.settledDownload).toBe("atk");
    expect(settle.slots[OL]!.lines[0]).toBe("Porygon-Z's Download raised its Attack: it read Togedemaru's Defense before its Electric Seed was used (assumes all four led together).");
    expect(hitOf(ready(input), OL, PL)).toMatchObject({ min: 54, max: 64 });
  });

  it("with no foe effect on its defenses, today's line", async () => {
    const swsh = await game(SWSH);
    const settle = settleDoublesStart(downloadTurn(swsh, 0, {}, lax(16)));
    expect(settle.slots[OL]!.lines).toEqual(["Porygon-Z's Download raised its Attack."]);
  });

  it("STP-DWN-05 / -06-sv: an Imposter foe that transformed first (110 against 85) is read as its target (Cloyster: Sp. Atk); a slower one as Ditto (Attack)", async () => {
    const sv = await game(SV);
    const imposterTurn = (ditto: Partial<Mon>, pz: Partial<Mon>) => turn(sv, [
      mon("porygonz", "download", "triattack", { target: PL, ...pz }), mon("cloyster", "shellarmor"), lax(0), mon("ditto", "imposter", null, ditto),
    ]);
    const first = settleDoublesStart(imposterTurn({ nature: "Timid", evs: { spe: 252 } }, { nature: "Brave", ivs: { spe: 0 } }));
    expect(first.slots[PR]!.folded.speciesId).toBe("cloyster");
    expect(first.slots[OL]!.folded.settledDownload).toBe("spa");
    expect(first.slots[OL]!.lines).toEqual(["Porygon-Z's Download raised its Sp. Atk: it read Ditto's Defense and Sp. Def after it transformed into Cloyster (assumes all four led together, Ditto first: 110 Speed against 85)."]);
    const later = settleDoublesStart(imposterTurn({ nature: "Brave", ivs: { spe: 0 } }, {}));
    expect(later.slots[OL]!.folded.settledDownload).toBe("atk");
  });

  it("an Embody Aspect foe is read before it Terastallized", async () => {
    const sv = await game(SV);
    const ogerpon = mon("ogerponcornerstone", "sturdy", null, { build: { mechanic: "tera", configuration: { teraType: "Rock" } } });
    const settle = settleDoublesStart(downloadTurn(sv, 0, {}, ogerpon));
    expect(settle.slots[OL]!.lines[0]).toMatch(/^Porygon-Z's Download raised its (Attack|Sp\. Atk): it read Ogerpon-Cornerstone(-Tera)?'s Defense before it Terastallized \(assumes all four led together\)\.$/);
  });

  it("a foe that could have come in as either of two forms with other defenses (Zygarde-Complete): not estimated", async () => {
    const swsh = await game(SWSH);
    expect(settleDoublesStart(downloadTurn(swsh, 0, {}, mon("zygardecomplete", "powerconstruct"))).reason).toBe("Download needs Zygarde-Complete's Defense and Sp. Def as it came in.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Custap Berry with Quick Draw or Mycelium Might (T2P §4.5)
// ------------------------------------------------------------------------------------------------------------------

const custapTurn = (runtime: BattleRuntime, user: Mon) => turn(runtime, [user, lax(0), lax(8), lax(252)]);
const slowbro = (move = "shellsidearm") => mon("slowbrogalar", "quickdraw", move, { item: "custapberry", hp: 40, target: PR });
const toedscruel = (move: string) => mon("toedscruel", "myceliummight", move, { item: "custapberry", hp: 20, target: PR });

describe("Custap Berry with Quick Draw or Mycelium Might", () => {
  it("STP-CUS-01: Quick Draw with an attack at the Berry's line: kept with 0.3 (Quick Draw's 0.1), eaten with 0.7", async () => {
    for (const id of [SV, SWSH] as const) {
      const settle = settleDoublesStart(custapTurn(await game(id), slowbro()));
      expect(weights(settle)).toEqual([0.3, 0.7]);
      const [kept, eaten] = settle.variants!;
      expect(kept.slots[OL]!.folded.itemId).toBe("custapberry");
      expect(kept.slots[OL]!.fractional).toEqual([{ value: 0.1, chance: 1, fact: "Quick Draw" }]);
      expect(eaten.slots[OL]!.folded.itemId).toBe("");
      expect(eaten.slots[OL]!.folded.settledCustap).toBe(true);
      expect(eaten.slots[OL]!.fractional).toEqual([{ value: 0.1, chance: 1 }]);
      expect([kept.label, eaten.label]).toEqual(["If Slowbro-Galar's Quick Draw activated.", "If Slowbro-Galar ate its Custap Berry."]);
    }
  });

  it("(integrator ST-1) STP-CUS-01-sv: the Berry held after the turn with 0.3; Quick Draw's fact at 0.3", async () => {
    const sv = await game(SV);
    const input = custapTurn(sv, slowbro());
    const result = ready(input);
    const step = result.steps.find((each) => each.slot === OL)!;
    expect(step.facts).toEqual([{ text: "Quick Draw: Slowbro-Galar moves first in its priority bracket.", chance: 0.3 }]);
    expect(hitOf(result, OL, PR)).toMatchObject({ min: 72, max: 85 });
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    const held = outcomes.outcomes.filter((outcome) => outcome.mons[OL]!.build.itemId === "custapberry").reduce((sum, outcome) => sum + outcome.chance, 0);
    expect(held).toBeCloseTo(0.3, 12);
  });

  it("STP-CUS-02 / -03-sv: Mycelium Might keeps the Berry for a status move; an attack eats it (40–48)", async () => {
    const sv = await game(SV);
    const spore = settleDoublesStart(custapTurn(sv, toedscruel("spore")));
    expect(spore.variants).toBeUndefined();
    expect(spore.slots[OL]!.folded.itemId).toBe("custapberry");
    expect(spore.slots[OL]!.folded.settledCustap).toBeUndefined();
    const result = ready(custapTurn(sv, toedscruel("spore")));
    expect(result.status).toBe("ready");
    const earth = settleDoublesStart(custapTurn(sv, toedscruel("earthpower")));
    expect(earth.slots[OL]!.folded.itemId).toBe("");
    expect(earth.slots[OL]!.folded.settledCustap).toBe(true);
    expect(hitOf(ready(custapTurn(sv, toedscruel("earthpower"))), OL, PR)).toMatchObject({ min: 40, max: 48 });
  });

  it("Quick Draw with a status move, or above the Berry's line: no start of its own; the guard stops nothing", async () => {
    const sv = await game(SV);
    expect(settleDoublesStart(custapTurn(sv, slowbro("calmmind"))).variants).toBeUndefined();
    expect(settleDoublesStart(custapTurn(sv, { ...slowbro(), hp: 170 })).variants).toBeUndefined();
    expect(() => custapGuard(kernel, {} as World, OL)).not.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Imposter (Q8)
// ------------------------------------------------------------------------------------------------------------------

describe("Imposter", () => {
  it("SAT-IMP-1-sv / STP-IMP-01-sv: transformed into the Pokémon across from it as both entered (Body Slam 75–88 / 55–66)", async () => {
    const sv = await game(SV);
    const sat = turn(sv, [mon("ditto", "imposter"), lax(0), lax(16, "bodyslam", { target: OL }), mon("garchomp", "roughskin")]);
    const settle = settleDoublesStart(sat);
    expect(settle.reason).toBeNull();
    expect(settle.slots[OL]!.folded).toMatchObject({ speciesId: "snorlax", abilityId: "thickfat", transformedFrom: { speciesId: "ditto" } });
    expect(settle.slots[OL]!.representative).toBe(PL);
    expect(turnFacts(settle)).toEqual(["Assumes Ditto transformed into Snorlax (opponent's) as both entered."]);
    expect(hitOf(ready(sat), PL, OL)).toMatchObject({ min: 75, max: 88 });
    const imp = turn(sv, [mon("ditto", "imposter"), lax(0), mon("garchomp", "roughskin"), lax(16, "bodyslam", { target: OL })]);
    expect(hitOf(ready(imp), PR, OL)).toMatchObject({ min: 55, max: 66 });
  });

  it("STP-IMP-02-sv: copying Intimidate as it transforms drops both foes (the 1v1's settleEntry rule)", async () => {
    const sv = await game(SV);
    const lowered = { atk: -1, def: 0, spa: 0, spd: 0, spe: 0 };
    const input = turn(sv, [
      mon("ditto", "imposter", null, { nature: "Timid", evs: { spe: 252 }, build: { boosts: lowered } }), lax(0, null, { build: { boosts: lowered } }),
      mon("incineroar", "intimidate"), lax(16, "bodyslam", { target: OR }),
    ]);
    const settle = settleDoublesStart(input);
    expect(SLOTS.map((slot) => settle.slots[slot]!.folded.boosts.atk)).toEqual([-1, -1, -1, -1]);
    expect(settle.slots[OL]!.lines).toContain("Ditto's Intimidate (copied by Imposter) is applied.");
  });

  it("with the slot across empty: not estimated", async () => {
    const sv = await game(SV);
    const settle = settleDoublesStart(turn(sv, [mon("ditto", "imposter"), lax(0), null, mon("garchomp", "roughskin")]));
    expect(settle.reason).toBe(REASONS.imposterAcross("Ditto"));
  });

  it("(integrator ST-4) its turn fact", async () => {
    const sv = await game(SV);
    expect(ready(turn(sv, [mon("ditto", "imposter"), lax(0), lax(16, "bodyslam", { target: OL }), mon("garchomp", "roughskin")])).facts).toContain("Assumes Ditto transformed into Snorlax (opponent's) as both entered.");
  });
});

// ------------------------------------------------------------------------------------------------------------------
// A Starf Berry at the turn's start and the start copies (SPEC2 §4.5)
// ------------------------------------------------------------------------------------------------------------------

describe("a Starf Berry eaten as the turn starts", () => {
  it("G4-STF-02-usum: one start per stat below +6 (1/5 each); the rows keep the Berry's random stat", async () => {
    const usum = await game(USUM);
    const input = turn(usum, [lax(0, null, { item: "starfberry", hp: 40 }), lax(32), lax(64, "bodyslam", { target: OL }), lax(96)]);
    const settle = settleDoublesStart(input);
    expect(weights(settle)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(settle.variants!.map((variant) => variant.slots[OL]!.folded.boosts)).toEqual(["atk", "def", "spa", "spd", "spe"].map((stat) => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, [stat]: 2 })));
    // Generation 7 orders the turn from the Speed before the Berry (the Speed start's firstTurnSpeed).
    expect(settle.variants![4].slots[OL]!.folded.firstTurnSpeed).toEqual({ spe: 0, unburden: false, item: "Starf Berry" });
    expect(settle.rowVariants).toBeUndefined();
    expect(settle.slots[OL]!.items.starf).toEqual({ stats: ["atk", "def", "spa", "spd", "spe"], amount: 2 });
    const result = ready(input);
    // Showdown: the Body Slam knocks it out unless its Defense rose (1/5): 37–88 damage, KO 93.75%.
    expect(hitOf(result, PL, OL).koChance).toBeCloseTo(0.9375, 12);
  });
});

describe("the start copies", () => {
  /** CR-08: a foe Garchomp eats its Liechi Berry at the turn's first Update; Espathra (Opportunist) copies the +1 Attack. */
  const liechi = (runtime: BattleRuntime, copier: Mon, partner: Mon = mon("smeargle", "owntempo", null, { evs: { spe: 252 } })) =>
    turn(runtime, [copier, partner, lax(8), mon("garchomp", "roughskin", null, { item: "liechiberry", hp: 40 })]);
  const espathra = (extra: Partial<Mon> = {}) => mon("espathra", "opportunist", null, { nature: "Brave", ivs: { spe: 0 }, ...extra });

  it("CR-08a-sv: the copy is pending in the copier's start (with a copy carried from last turn)", async () => {
    const sv = await game(SV);
    expect(settleDoublesStart(liechi(sv, espathra())).slots[OL]!.copy).toEqual({ stages: { atk: 1 }, by: "opportunist" });
    expect(settleDoublesStart(liechi(sv, espathra({ carried: { copy: { spe: 1 } } }))).slots[OL]!.copy).toEqual({ stages: { spe: 1, atk: 1 }, by: "opportunist" });
    expect(settleDoublesStart(liechi(sv, mon("garchomp", "roughskin", null, { item: "mirrorherb" }))).slots[OL]!.copy).toEqual({ stages: { atk: 1 }, by: "mirrorherb" });
    // Magic Room keeps a Mirror Herb from storing it; an ally's rise is not a foe's.
    expect(settleDoublesStart(turn(sv, [mon("garchomp", "roughskin", null, { item: "mirrorherb" }), lax(0), lax(8), mon("garchomp", "roughskin", null, { item: "liechiberry", hp: 40 })], { magicRoom: true })).slots[OL]!.copy).toBeUndefined();
    expect(settleDoublesStart(turn(sv, [espathra(), mon("garchomp", "roughskin", null, { item: "liechiberry", hp: 40 }), lax(8), lax(16)])).slots[OL]!.copy).toBeUndefined();
  });

  it("an Opportunist holding a Mirror Herb: not followed", async () => {
    const sv = await game(SV);
    const settle = settleDoublesStart(liechi(sv, espathra({ item: "mirrorherb" })));
    expect(settle.reason).toBe(REASONS.copiesRise("Opportunist with Mirror Herb"));
    expect(settle.slots[OL]).not.toBeNull();
  });

  it("with a Terastallized or Mega Evolved Pokémon in the turn: the fact that none changes this turn", async () => {
    const sv = await game(SV);
    const settle = settleDoublesStart(liechi(sv, espathra(), lax(0, null, { build: { mechanic: "tera", configuration: { teraType: "Normal" } } })));
    expect(turnFacts(settle)).toEqual(["Assumes no Pokémon Terastallizes or Mega Evolves this turn."]);
    expect(turnFacts(settleDoublesStart(liechi(sv, espathra())))).toEqual([]);
  });

  it("(integrator ST-2) CR-08a-sv / G4-OPP-07-sv: applied at the first action's end", async () => {
    const sv = await game(SV);
    const outcomes = calculateDoublesOutcomes(liechi(sv, espathra()));
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes.every((outcome) => outcome.mons[OL]!.build.boosts.atk === 1)).toBe(true);
    // G4-OPP-07: a faster Espathra's Stored Power comes first (20 base power: no copy yet), then the copy.
    const first = turn(sv, [mon("espathra", "opportunist", "storedpower", { evs: { spe: 252 }, target: PL }), lax(0), lax(64), mon("garchomp", "roughskin", null, { item: "liechiberry", hp: 40 })]);
    const after = calculateDoublesOutcomes(first);
    if (after.status !== "ready") throw new Error(after.status);
    expect(after.outcomes.every((outcome) => outcome.mons[OL]!.build.boosts.atk === 1)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The hooks
// ------------------------------------------------------------------------------------------------------------------

describe("the hooks", () => {
  it("variants: one settle at weight 1 for a start with no random part, the same list on every call", async () => {
    const sv = await game(SV);
    const settle = settleDoublesStart(turn(sv, [lax(0), lax(8), lax(16), lax(24)]));
    expect(settle.variants).toBeUndefined();
    expect(variants(kernel, settle)).toEqual([{ weight: 1, settle }]);
    const random = settleDoublesStart(traceTurn(sv));
    expect(variants(kernel, random)).toBe(variants(kernel, random));
    expect(variants(kernel, random).map((each) => each.settle.slots)).toEqual(random.variants!.map((variant) => variant.slots));
    expect(turnFacts(settle)).toEqual([]);
  });

  it("rowsByVariant: a pair's row once where every start gives it alike (the assumptions all give), else each start's with its label", () => {
    const row = (min: number, assumptions: string[]): MoveDamageResult => ({
      moveId: "tackle", effectiveName: "Tackle", effectiveType: "Normal", effectivePower: 40, effectiveCategory: "Physical", kind: "calculated",
      min, max: min + 5, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: "", assumptions, reason: "", hits: 1,
    } as unknown as MoveDamageResult);
    const start = (rows: DoublesStartRow[]) => ({ rows });
    const a = start([{ slot: OL, target: PL, row: row(10, ["x", "a"]) }, { slot: OL, target: PR, row: row(20, ["x"]) }]);
    const b = start([{ slot: OL, target: PL, row: row(10, ["x", "b"]) }, { slot: OL, target: PR, row: row(25, ["x"]), fact: "Lightning Rod." }]);
    const settle: DoublesSettle = {
      slots: {} as DoublesSettle["slots"], reason: null,
      rowVariants: [{ weight: 0.5, slots: {} as DoublesSettle["slots"], label: "If A." }, { weight: 0.5, slots: { b: true } as unknown as DoublesSettle["slots"], label: "If B." }],
    };
    const rows = rowsByVariant(settle, (one) => ("b" in one.slots ? b : a).rows);
    expect(rows.map((each) => [each.target, each.row.min, each.row.assumptions, each.fact])).toEqual([
      [PL, 10, ["x"], undefined], [PR, 20, ["x"], "If A."], [PR, 25, ["x"], "If B. Lightning Rod."],
    ]);
    expect(rowsByVariant({ ...settle, rowVariants: undefined }, () => a.rows)).toBe(a.rows);
  });
});
