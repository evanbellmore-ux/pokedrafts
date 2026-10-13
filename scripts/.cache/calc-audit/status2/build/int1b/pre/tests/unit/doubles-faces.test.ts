import { beforeAll, describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesOutcomesResult, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, BattleStatus, MoveContext } from "@/app/lib/battle/types";

/**
 * Disguise and Ice Face in the 2v2 turn (status2 ADDENDUM2 §2.3 #15, #48; T2M §3.13, §3.25; app/lib/battle/doubles-faces.ts)
 * against pinned Showdown c23d2e94. Each expectation is the oracle's (scripts/.cache/calc-audit/2v2/verify sim-dfs.ts, the
 * exhaustive walk): the HP after the moves (least, most, average, KO chance) and the state after the turn (E2: item, form,
 * stages). The scenarios are status2/build/w1a-s/cases.ts's (their ids in the titles) and V1's T2M-FA cases. Level 50, 31 IVs,
 * Serious, 0 EVs (Champions: Stat Points) unless set; Showdown's p1a, p1b, p2a, p2b are own-left, own-right, opponent-right,
 * opponent-left here, and every Pokémon left over uses Splash (No move).
 */
type P = {
  id: string; ability: string; item?: string; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>; hp?: number; status?: BattleStatus;
  move?: string | null; target?: DoublesSlotId; carried?: DoublesCarried; context?: MoveContext; build?: Partial<BattleBuild>;
};
type S = "OL" | "OR" | "PL" | "PR";
const SLOT: Record<S, DoublesSlotId> = { OL: "own-left", OR: "own-right", PL: "opponent-left", PR: "opponent-right" };
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const GAMES = { sv: "scarlet_violet", swsh: "sword_shield", usum: "ultra_sun_ultra_moon", champions: "champions" } as const;
type Game = keyof typeof GAMES;
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of Object.values(GAMES)) runtimes[game] = await loadBattleRuntime(game);
});

function buildOf(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const shared = {
    nature: "Serious", abilityId: p.ability, abilityActive: defaultAbilityActive(p.ability), itemId: p.item ?? "", currentHP: p.hp ?? null, status: p.status ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...p.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...p.evs }, ivs: IV31 } };
  return { ...build, ...p.build } as BattleBuild;
}
function turn(game: Game, slots: Record<S, P>): DoublesTurnInput {
  const runtime = runtimes[GAMES[game]];
  const pokemon = Object.fromEntries((Object.keys(SLOT) as S[]).map((key) => {
    const p = slots[key];
    const move = p.move ?? null;
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, p), contexts: move && p.context ? { [move]: p.context } : {}, charged: false,
      action: { moveId: move, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}),
    };
    return [SLOT[key], entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number, extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", evs: { spe }, ...extra });
const kyu = (extra: Partial<P> = {}): P => ({ id: "mimikyu", ability: "disguise", ...extra });
const fast = (id: string, ability: string, move: string, extra: Partial<P> = {}): P => ({ id, ability, evs: { spe: 252 }, move, target: SLOT.PL, ...extra });
const champ = (id: string, ability: string, move: string, extra: Partial<P> = {}): P => ({ id, ability, evs: { spe: 32 }, move, target: SLOT.PL, ...extra });
const kanga = (game: "usum" | "champions", move: string): P => ({ id: "kangaskhanmega", ability: "parentalbond", item: "kangaskhanite", evs: { spe: game === "usum" ? 252 : 32 }, move, target: SLOT.PL });
/** The probes' layout: the attacker at own-left, Snorlax partners, the defender at opponent-left. */
const into = (game: Game, attacker: P, defender: P, partner: P = lax(8)) => turn(game, { OL: attacker, OR: partner, PL: defender, PR: lax(16) });

function ready(result: DoublesTurnResult): Extract<DoublesTurnResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}
function outcomes(result: DoublesOutcomesResult) {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result.outcomes;
}
type Want = { hp?: { min: number; max: number; average: number; koChance: number }; item?: string; species?: string; boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>> };
/** The turn agrees with the oracle's facts: each slot's HP after the moves, and its one item, form and stages after the turn. */
function agrees(input: DoublesTurnInput, want: Partial<Record<S, Want>>) {
  const result = ready(calculateDoublesTurn(input));
  const list = outcomes(calculateDoublesOutcomes(input));
  for (const [key, each] of Object.entries(want) as [S, Want][]) {
    const slot = SLOT[key];
    if (each.hp) {
      const hp = result.hp[slot]!;
      expect([hp.min, hp.max, hp.koChance], slot).toEqual([each.hp.min, each.hp.max, expect.closeTo(each.hp.koChance, 9)]);
      expect(hp.average, slot).toBeCloseTo(each.hp.average, 9);
    }
    const living = list.filter((outcome) => outcome.mons[slot] && !outcome.mons[slot]!.hp.every(({ hp }) => hp === 0));
    if (each.item !== undefined) expect([...new Set(living.map((outcome) => outcome.mons[slot]!.build.itemId))], `${slot} item`).toEqual([each.item]);
    if (each.species) expect([...new Set(living.map((outcome) => outcome.mons[slot]!.build.speciesId))], `${slot} form`).toEqual([each.species]);
    if (each.boosts) {
      const boosts = [...new Set(living.map((outcome) => JSON.stringify(outcome.mons[slot]!.build.boosts)))].map((text) => JSON.parse(text));
      expect(boosts, `${slot} stages`).toEqual([{ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...each.boosts }]);
    }
  }
  return result;
}
const hitOn = (result: Extract<DoublesTurnResult, { status: "ready" }>, attacker: DoublesSlotId, target: DoublesSlotId) =>
  result.steps.find((step) => step.slot === attacker)!.hits.find((hit) => hit.slot === target)!;

describe("a multi-hit or Parental Bond move into an intact face (T2M §3.13 model 1; T2-FA01-FA03)", () => {
  it("the first hit takes no damage, the busted form at its Update (the 1/8 chip from generation 8), the rest into the busted form", () => {
    // S-FA-01-sv: Corviknight's Dual Wingbeat; the hit's calculation is getDamage's before the face, summed (50–60).
    const sv = agrees(into("sv", fast("corviknight", "pressure", "dualwingbeat"), kyu()), { PL: { hp: { min: 84, max: 89, average: 87.125, koChance: 0 }, item: "", species: "mimikyubusted" } });
    expect(hitOn(sv, SLOT.OL, SLOT.PL)).toMatchObject({ kind: "calculated", min: 50, max: 60, koChance: 0 });
    expect(hitOn(sv, SLOT.OL, SLOT.PL).facts.map((fact) => fact.text)).toContain("Disguise: Mimikyu takes no damage.");
    // S-FA-01-usum: Scrappy Double Hit in generation 7: no chip.
    agrees(into("usum", fast("kangaskhan", "scrappy", "doublehit"), kyu()), { PL: { hp: { min: 102, max: 106, average: 104.5, koChance: 0 }, species: "mimikyubusted" } });
    // S-FA-02-swsh: Ice Face takes the first physical hit, the second meets Noice Face's lower Defense.
    agrees(into("swsh", fast("dragonite", "innerfocus", "dualwingbeat"), { id: "eiscue", ability: "iceface" }), { PL: { hp: { min: 102, max: 110, average: 106.5, koChance: 0 }, species: "eiscuenoice" } });
  });
  it("Parental Bond: the face takes the first strike, the ×0.25 second strike reaches the busted form (S-FA-03)", () => {
    agrees(into("champions", kanga("champions", "crunch"), kyu()), { PL: { hp: { min: 101, max: 103, average: 102.4375, koChance: 0 }, species: "mimikyubusted" } });
    agrees(into("usum", kanga("usum", "crunch"), kyu()), { PL: { hp: { min: 117, max: 119, average: 118.4375, koChance: 0 }, species: "mimikyubusted" } });
    // S-FA-27: each strike's 100% Speed drop, the face's included.
    agrees(into("usum", kanga("usum", "rocktomb"), kyu()), { PL: { hp: { min: 120, max: 122, average: 121.25, koChance: 0 }, boosts: { spe: -2 } } });
  });
  it("a random hit count: every count's later hits into the busted form; Skill Link; a later move reads what is left (S-FA-14, S-FA-15, S-FA-31)", () => {
    const seed = agrees(into("sv", fast("breloom", "technician", "bulletseed"), kyu()), { PL: { hp: { min: 0, max: 81, average: 44.2129394531, koChance: 0.1508056641 } } });
    expect(hitOn(seed, SLOT.OL, SLOT.PL)).toMatchObject({ kind: "calculated", min: 66 });
    agrees(into("sv", fast("cloyster", "skilllink", "iciclespear"), kyu(), lax(8, { move: "bodyslam", target: SLOT.PL })), { PL: { hp: { min: 30, max: 50, average: 40, koChance: 0 }, species: "mimikyubusted" } });
    agrees(into("sv", fast("greninja", "torrent", "watershuriken"), kyu({ item: "sitrusberry" }), lax(8, { move: "bodyslam", target: SLOT.PL })),
      { PL: { hp: { min: 66, max: 105, average: 93.13125, koChance: 0 }, item: "sitrusberry" } });
  });
  it("Luminous Moss used by the face's Water hit: the later hits read +1 Sp. Def (S-FA-16)", () => {
    agrees(into("usum", fast("greninja", "torrent", "watershuriken"), kyu({ item: "luminousmoss" })), { PL: { hp: { min: 94, max: 123, average: 115.0375, koChance: 0 }, item: "", boosts: { spd: 1 } } });
  });
  it("Rocky Helmet on the face's hit and on the later one; a user it knocks out at the face's hit deals no second (S-FA-21, S-FA-22)", () => {
    agrees(into("champions", champ("corviknight", "pressure", "dualwingbeat"), kyu({ item: "rockyhelmet" })),
      { OL: { hp: { min: 117, max: 117, average: 117, koChance: 0 } }, PL: { hp: { min: 84, max: 89, average: 87.125, koChance: 0 }, item: "rockyhelmet" } });
    const fallen = agrees(into("sv", fast("corviknight", "pressure", "dualwingbeat", { hp: 20 }), kyu({ item: "rockyhelmet" })),
      { OL: { hp: { min: 0, max: 0, average: 0, koChance: 1 } }, PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, item: "rockyhelmet", species: "mimikyubusted" } });
    // The face's hit was calculated (getDamage's 25–30 before Disguise took it).
    expect(hitOn(fallen, SLOT.OL, SLOT.PL)).toMatchObject({ kind: "calculated", min: 25, max: 30 });
    expect(fallen.hp[SLOT.OL]!.losses?.map((loss) => loss.text)).toContain("Rocky Helmet: Corviknight loses 28 HP.");
  });
  it("the chip knocks the holder out at the face's hit's Update: no later hit, the hit's knockout (S-FA-23)", () => {
    const chip = agrees(into("sv", fast("corviknight", "pressure", "dualwingbeat"), kyu({ hp: 10 })), { PL: { hp: { min: 0, max: 0, average: 0, koChance: 1 } } });
    expect(hitOn(chip, SLOT.OL, SLOT.PL)).toMatchObject({ kind: "calculated", koChance: expect.closeTo(1, 9) });
  });
  it("the busted form's resist Berry: the face's neutral hit leaves it, the next hit eats it as a first hit (S-FA-32, S-FA-33)", () => {
    const eiscue = (item: string): P => ({ id: "eiscue", ability: "iceface", item });
    for (const game of ["sv", "swsh"] as const) {
      // Double Kick: hit 2 into Noice Face meets the Chople Berry (no Ice Face chip in any generation).
      agrees(into(game, fast("cinderace", "blaze", "doublekick"), eiscue("chopleberry")), { PL: { hp: { min: 129, max: 133, average: 131.0625, koChance: 0 }, item: "", species: "eiscuenoice" } });
      // Skill Link Rock Blast: hit 2 eats the Charti Berry, hits 3-5 after it.
      agrees(into(game, fast("cloyster", "skilllink", "rockblast"), eiscue("chartiberry")), { PL: { hp: { min: 38, max: 59, average: 49.8125, koChance: 0 }, item: "" } });
    }
  });
  it("the resist Berry after the face keeps the face's reason where the later hits differ by their index (S-FA-34, S-FA-35)", () => {
    // Triple Kick's rising power and Parental Bond's ×0.25 strike: a fresh continuation would read them as first hits.
    expect(calculateDoublesTurn(into("swsh", fast("hitmontop", "technician", "triplekick"), { id: "eiscue", ability: "iceface", item: "chopleberry" })))
      .toMatchObject({ status: "not-estimated", reason: "Ice Face is not modelled in 2v2." });
    expect(calculateDoublesTurn(into("champions", kanga("champions", "irontail"), kyu({ item: "babiriberry" }))))
      .toMatchObject({ status: "not-estimated", reason: "Disguise is not modelled in 2v2." });
  });
});

describe("the 0-damage hit's own effects (T2M §3.13 models 2-3; T2-FA04-FA12)", () => {
  it("items that answer a hit: Rocky Helmet, Air Balloon, Kee Berry, Sticky Barb, Jaboca and Rowap Berry, Cell Battery, Snowball", () => {
    // S-FA-04-sv: Rocky Helmet hurts the attacker 1/6 (235 → 196).
    agrees(into("sv", fast("snorlax", "thickfat", "crunch"), kyu({ item: "rockyhelmet" })), { OL: { hp: { min: 196, max: 196, average: 196, koChance: 0 } }, PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, item: "rockyhelmet" } });
    agrees(into("sv", fast("snorlax", "thickfat", "crunch"), kyu({ item: "airballoon" })), { PL: { item: "", species: "mimikyubusted" } });
    agrees(into("usum", fast("snorlax", "thickfat", "crunch"), kyu({ item: "keeberry" })), { PL: { item: "", boosts: { def: 1 } } });
    agrees(into("sv", fast("snorlax", "thickfat", "crunch"), kyu({ item: "stickybarb" })), { OL: { item: "stickybarb" }, PL: { item: "" } });
    agrees(into("sv", fast("snorlax", "thickfat", "crunch"), kyu({ item: "jabocaberry" })), { OL: { hp: { min: 206, max: 206, average: 206, koChance: 0 } }, PL: { item: "" } });
    agrees(into("sv", fast("gengar", "cursedbody", "shadowball"), kyu({ item: "rowapberry" })), { OL: { hp: { min: 119, max: 119, average: 119, koChance: 0 } }, PL: { item: "" } });
    agrees(into("usum", fast("raichu", "static", "thunderbolt"), kyu({ item: "cellbattery" })), { PL: { item: "", boosts: { atk: 1 } } });
    agrees(into("swsh", fast("weavile", "pressure", "iceshard"), { id: "eiscue", ability: "iceface", item: "snowball" }), { PL: { item: "", species: "eiscuenoice", boosts: { atk: 1 } } });
  });
  it("moves that take or use the item: Knock Off, Thief, Bug Bite; a Z-Crystal stays; an item-holding Thief takes nothing; Magician", () => {
    agrees(into("champions", champ("weavile", "pressure", "knockoff"), kyu({ item: "leftovers" })), { PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, item: "" } });
    agrees(into("champions", champ("annihilape", "vitalspirit", "thief"), kyu({ item: "leftovers" })), { OL: { item: "leftovers" }, PL: { item: "" } });
    // S-FA-24-sv: Bug Bite eats the Sitrus Berry: Scizor at 70 of 145 heals 36.
    agrees(into("sv", fast("scizor", "technician", "bugbite", { hp: 70 }), kyu({ item: "sitrusberry" })), { OL: { hp: { min: 106, max: 106, average: 106, koChance: 0 } }, PL: { item: "" } });
    agrees(into("usum", fast("weavile", "pressure", "knockoff"), kyu({ item: "mimikiumz" })), { PL: { item: "mimikiumz", species: "mimikyubusted" } });
    agrees(into("sv", fast("annihilape", "vitalspirit", "thief", { item: "leftovers" }), kyu({ item: "sitrusberry" })), { OL: { item: "leftovers" }, PL: { item: "sitrusberry" } });
    agrees(into("usum", fast("delphox", "magician", "flamethrower"), kyu({ item: "leftovers" })), { OL: { item: "leftovers" }, PL: { item: "" } });
  });
  it("Smelling Salts cures the face holder's paralysis; Incinerate burns its Berry in a spread move (S-FA-13c, S-FA-28)", () => {
    const salts = into("usum", fast("exploud", "scrappy", "smellingsalts"), kyu({ status: "par" }));
    agrees(salts, { PL: { item: "", species: "mimikyubusted" } });
    expect(outcomes(calculateDoublesOutcomes(salts)).map((outcome) => outcome.mons[SLOT.PL]!.build.status)).toEqual([""]);
    agrees(turn("usum", { OL: { ...fast("houndoom", "flashfire", "incinerate"), target: undefined }, OR: lax(8), PL: kyu({ item: "sitrusberry" }), PR: lax(16) }),
      { PL: { item: "", species: "mimikyubusted" }, PR: { hp: { min: 219, max: 222, average: 220.6875, koChance: 0 } } });
  });
  it("a Max Move's drop on every foe, the face holder's included (S-FA-29)", () => {
    agrees(into("swsh", fast("snorlax", "thickfat", "crunch", { build: { mechanic: "dynamax" } }), kyu()), { PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, boosts: { spd: -1 } }, PR: { boosts: { spd: -1 } } });
  });
  it("Eject Button and Red Card: used up; with a later action the switch-out is not known (S-FA-17)", () => {
    // The attacker moves last: Mimikyu leaves at the end of the moves (the switch family, wave 2 R).
    agrees(turn("sv", { OL: { ...lax(0), move: "crunch", target: SLOT.PL }, OR: lax(8), PL: kyu({ item: "ejectbutton", evs: { spe: 16 } }), PR: lax(24) }), { PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, item: "" } });
    expect(calculateDoublesTurn(into("sv", fast("snorlax", "thickfat", "crunch"), kyu({ item: "ejectbutton" })))).toMatchObject({ status: "not-estimated", reason: "Mimikyu switches out: the replacement is not known." });
  });
  it("a spread move into a face with Jaboca Berry keeps its reason until the spread step adds the face's retaliation (faceRetaliation)", () => {
    const slide = turn("sv", { OL: { ...fast("garganacl", "clearbody", "rockslide"), target: undefined }, OR: lax(8), PL: kyu({ item: "jabocaberry" }), PR: lax(16) });
    const result = calculateDoublesTurn(slide);
    // The oracle (S-FA-19-sv): Garganacl 175 → 154 (Jaboca's 1/8 at the spread hit's Update).
    if (result.status === "ready") expect(result.hp[SLOT.OL]).toMatchObject({ min: 154, max: 154 });
    else expect(result).toMatchObject({ status: "not-estimated", reason: "Disguise is not modelled in 2v2." });
  });
});

describe("after integration 1a (the kernel's afterHit, confusionHit's selfHit worlds: W1A-S.md)", () => {
  // A move whose 0-damage hit does more than doubles-faces.ts applies itself goes through the kernel's afterHit; a confusion
  // self-hit through confusionHit taking selfHit's worlds (integration 1a; the oracle: S-FA-10, S-FA-11, S-FS-01, S-FA-36).
  it("Fire Spin traps the face holder; Salt Cure starts (S-FA-10-sv, S-FA-11-sv)", () => {
    agrees(into("sv", fast("charizard", "blaze", "firespin"), kyu({ item: "leftovers" })), { PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 }, item: "leftovers" } });
    agrees(into("sv", fast("garganacl", "clearbody", "saltcure"), kyu({ item: "leftovers" })), { PL: { hp: { min: 114, max: 114, average: 114, koChance: 0 } } });
  });
  it("a confused Mimikyu's self-hit: Disguise takes it, the chip from generation 8 (S-FS-01)", () => {
    const self = (game: Game) => into(game, fast("mimikyu", "disguise", "shadowclaw", { carried: { confusion: { attempts: 1 } } }), lax(16), lax(8));
    const sv = ready(calculateDoublesTurn(self("sv")));
    expect(sv.hp[SLOT.OL]).toMatchObject({ min: 114, max: 130 });
    expect(sv.hp[SLOT.OL]!.average).toBeCloseTo(114 * 0.2475 + 130 * 0.7525, 9);
    expect(sv.steps.find((step) => step.slot === SLOT.OL)!.skipped).toContainEqual({ text: "Hurts itself in confusion; Disguise takes the hit.", chance: expect.closeTo(0.2475, 9) });
    expect(ready(calculateDoublesTurn(self("usum"))).hp[SLOT.OL]).toMatchObject({ min: 130, max: 130 });
  });
  it("Dragon Tail drags the face holder: no Eject Button (S-FA-36)", () => {
    // The oracle: the drag's forceSwitchFlag stops Eject Button (data/items.ts ejectbutton onAfterMoveSecondary); Eiscue
    // leaves with it at the end of the moves, its replacement not known (the switch family).
    const tail = into("sv", fast("dragonite", "innerfocus", "dragontail"), { id: "eiscue", ability: "iceface", item: "ejectbutton" });
    const result = ready(calculateDoublesTurn(tail));
    expect(result.endOfTurn).toMatchObject({ status: "not-estimated", reason: "Eiscue switches out: the replacement is not known." });
    agrees(tail, { PL: { hp: { min: 150, max: 150, average: 150, koChance: 0 }, item: "ejectbutton", species: "eiscuenoice" } });
  });
});
