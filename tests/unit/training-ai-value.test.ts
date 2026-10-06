import { describe, expect, it } from "vitest";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import { DEFAULT_WEIGHTS, stateTerms, stateValue, valueWeights, type ValueContext } from "@/app/(app)/training/ai/value";
import type { AiView, PostState } from "@/app/(app)/training/model/ai-view";
import { buildOf, makeView, postOf, runtime, type MonSpec } from "../fixtures/training-ai";

/** SPEC 10.6 V(S) (the AI's side minus the player's) and addendum A1.5's Mega lasting and option values. */
const AI_LEFT: MonSpec = { side: "opponent", species: "garchomp", slot: "opponent-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 }, ability: "roughskin" };
const AI_RIGHT: MonSpec = { side: "opponent", species: "rotomwash", slot: "opponent-right", moves: ["hydropump", "thunderbolt", "willowisp", "protect"], nature: "Modest", points: { hp: 32, spa: 32 }, ability: "levitate" };
const PLAYER_PHYSICAL: MonSpec = { side: "own", species: "kingambit", slot: "own-left", moves: ["kowtowcleave", "suckerpunch", "ironhead"], nature: "Adamant", points: { hp: 32, atk: 32 }, ability: "defiant" };
const PLAYER_SPECIAL: MonSpec = { side: "own", species: "archaludon", slot: "own-right", moves: ["flashcannon", "dracometeor", "electroshot"], nature: "Modest", points: { hp: 32, spa: 32 }, ability: "stamina" };

function context(view: AiView, overrides: Partial<ValueContext> = {}): ValueContext {
  const rows = damageRows(view, runtime);
  return { weights: valueWeights(), worth: worthOf(view, rows, runtime), runtime, field: view.field, rows, particles: [], view, ...overrides };
}
const setHP = (post: PostState, key: string, share: number) => {
  const mon = post.mons.find((each) => each.key === key)!;
  mon.hp = [{ hp: Math.round(mon.maxHp * share), chance: 1 }];
};

describe("stateValue", () => {
  const view = makeView([AI_LEFT, AI_RIGHT, PLAYER_PHYSICAL, PLAYER_SPECIAL]);
  const ctx = context(view);

  it("is the AI's side minus the player's: more HP for the AI raises it, for the player lowers it", () => {
    const base = stateValue(postOf(view), ctx);
    expect(stateValue(postOf(view, (post) => setHP(post, "opponent:garchomp", 0.5)), ctx)).toBeLessThan(base);
    expect(stateValue(postOf(view, (post) => setHP(post, "own:kingambit", 0.5)), ctx)).toBeGreaterThan(base);
  });

  it("a KO is worth more than the same chip from full", () => {
    const fromFull = stateValue(postOf(view, (post) => setHP(post, "own:kingambit", 0.7)), ctx) - stateValue(postOf(view), ctx);
    const ko = stateValue(postOf(view, (post) => { setHP(post, "own:kingambit", 0); }), ctx) - stateValue(postOf(view, (post) => setHP(post, "own:kingambit", 0.3)), ctx);
    expect(ko).toBeGreaterThan(fromFull);
    // u(0) = 0, u(x) = alive + (1 − alive)·x.
    const worth = ctx.worth["own:kingambit"];
    expect(ko).toBeCloseTo(worth * (DEFAULT_WEIGHTS.alive + (1 - DEFAULT_WEIGHTS.alive) * 0.3), 1);
  });

  it("wiping a side adds the terminal term", () => {
    const won = postOf(view, (post) => { post.wiped.own = 1; });
    expect(stateTerms(won, ctx).terminal).toBe(DEFAULT_WEIGHTS.win);
    expect(stateTerms(postOf(view, (post) => { post.wiped.opponent = 0.5; }), ctx).terminal).toBe(-DEFAULT_WEIGHTS.win / 2);
  });

  it("the AI's own Tailwind raises the Speed term", () => {
    const slowAi = makeView([{ ...AI_LEFT, species: "kingambit", moves: ["kowtowcleave"], ability: "defiant", nature: "Adamant", points: { hp: 32, atk: 32 } }, AI_RIGHT,
      { ...PLAYER_PHYSICAL, species: "garchomp", moves: ["dragonclaw"], ability: "roughskin", nature: "Jolly", points: { atk: 32, spe: 32 } }, PLAYER_SPECIAL]);
    const slow = context(slowAi);
    const none = stateTerms(postOf(slowAi), slow).speed;
    const tailwind = stateTerms(postOf(slowAi, (post) => { post.clock.sides.opponent.tailwind = 3; }), slow).speed;
    expect(tailwind).toBeGreaterThan(none);
    const theirs = stateTerms(postOf(slowAi, (post) => { post.clock.sides.own.tailwind = 3; }), slow).speed;
    expect(theirs).toBeLessThan(none);
    // Trick Room inverts the order for the turns it lasts.
    const room = stateTerms(postOf(slowAi, (post) => { post.clock.rooms.trickRoom = 3; }), slow).speed;
    expect(room).toBeGreaterThan(none);
  });

  it("averages the player's Speed over the belief particles", () => {
    // Player Garchomp at 0 or 32 Spe in two particles; the AI's Jolly 32 Spe Garchomp ties one and outspeeds the other.
    const mirror = makeView([AI_LEFT, AI_RIGHT, { ...PLAYER_PHYSICAL, species: "garchomp", moves: ["dragonclaw"], ability: "roughskin", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } }, PLAYER_SPECIAL]);
    const fast = buildOf({ species: "garchomp", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 }, ability: "roughskin" });
    const slow = buildOf({ species: "garchomp", nature: "Adamant", points: { hp: 32, atk: 32 }, ability: "roughskin" });
    const value = (builds: { weight: number; fast: boolean }[]) => stateTerms(postOf(mirror), context(mirror, {
      particles: builds.map(({ weight, fast: isFast }) => ({ weight, builds: { "own:garchomp": isFast ? fast : slow } })),
    })).speed;
    const allFast = value([{ weight: 1, fast: true }]);
    const allSlow = value([{ weight: 1, fast: false }]);
    const half = value([{ weight: 0.5, fast: true }, { weight: 0.5, fast: false }]);
    expect(allSlow).toBeGreaterThan(allFast);
    expect(half).toBeCloseTo((allFast + allSlow) / 2, 12);
  });

  it("burning the player's physical attacker raises V more than burning its special one", () => {
    const base = stateValue(postOf(view), ctx);
    const physical = stateValue(postOf(view, (post) => { post.mons.find((mon) => mon.key === "own:kingambit")!.build.status = "brn"; }), ctx) - base;
    const special = stateValue(postOf(view, (post) => { post.mons.find((mon) => mon.key === "own:archaludon")!.build.status = "brn"; }), ctx) - base;
    expect(physical).toBeGreaterThan(special);
    expect(special).toBeGreaterThan(0);
  });

  it("values the weather and terrain by the best move's type and the turns left", () => {
    const sun = makeView([{ ...AI_LEFT, species: "charizard", moves: ["heatwave", "airslash"], ability: "blaze", nature: "Modest", points: { spa: 32, spe: 32 } }, { ...AI_RIGHT, moves: ["thunderbolt", "willowisp"] }, PLAYER_PHYSICAL, PLAYER_SPECIAL]);
    const ctx = context(sun);
    const terms = (weather: "Sun" | "Rain", turns: number) => stateTerms(postOf(sun, (post) => { post.clock.weather = { id: weather, turns }; }), ctx).field;
    expect(terms("Sun", 5)).toBeGreaterThan(0);
    expect(terms("Rain", 5)).toBeLessThan(0);
    expect(terms("Sun", 1)).toBeCloseTo(terms("Sun", 3) / 3, 12);
    expect(stateTerms(postOf(sun), ctx).field).toBe(0);
  });

  it("counts stages, protect streaks, hazards and unseen members", () => {
    const base = stateTerms(postOf(view), ctx);
    const boosted = stateTerms(postOf(view, (post) => { post.mons.find((mon) => mon.key === "opponent:garchomp")!.build.boosts.atk = 2; }), ctx);
    expect(boosted.stages - base.stages).toBeCloseTo(ctx.worth["opponent:garchomp"] * DEFAULT_WEIGHTS.offenseStage * (1 + DEFAULT_WEIGHTS.stageDecay), 12);
    const guarded = stateTerms(postOf(view, (post) => { post.mons.find((mon) => mon.key === "opponent:garchomp")!.protected = true; }), ctx);
    expect(guarded.protect).toBeCloseTo(-DEFAULT_WEIGHTS.protectStreak, 12);
    const hidden = makeView([AI_LEFT, AI_RIGHT, PLAYER_PHYSICAL, PLAYER_SPECIAL], { unrevealed: 2 });
    expect(stateTerms(postOf(hidden), context(hidden)).material).toBeCloseTo(base.material - 2 * DEFAULT_WEIGHTS.unknownWorth, 12);
  });
});

describe("A1.5 Mega outlook and the lasting / option values", () => {
  // The AI's Charizard holds Charizardite Y against a player Garchomp (Ground) and Incineroar.
  const charizard: MonSpec = { side: "opponent", species: "charizard", slot: "opponent-left", moves: ["heatwave", "airslash", "solarbeam", "protect"], nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, ability: "blaze", item: "charizarditey", canMega: true };
  const partner: MonSpec = { side: "opponent", species: "whimsicott", slot: "opponent-right", moves: ["moonblast", "tailwind"], nature: "Timid", points: { hp: 2, spa: 32, spe: 32 }, ability: "prankster", item: "focussash" };
  const garchomp: MonSpec = { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake", "dragonclaw", "rockslide"], nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 }, ability: "roughskin" };
  const incineroar: MonSpec = { side: "own", species: "incineroar", slot: "own-right", moves: ["flareblitz", "knockoff"], nature: "Careful", points: { hp: 32, spd: 32 }, ability: "intimidate" };

  it("rates the Mega form against the base form both ways", () => {
    const view = makeView([charizard, partner, garchomp, incineroar]);
    const rows = damageRows(view, runtime);
    const outlook = megaOutlook(view, rows, runtime);
    expect(Object.keys(outlook)).toEqual(["opponent:charizard"]);
    const entry = outlook["opponent:charizard"];
    expect(entry.formId).toBe("charizardmegay");
    expect(entry.mega.abilityId).toBe("drought");
    // Mega Charizard Y's Sp. Atk is higher: more damage out; same types, so the same damage in.
    expect(entry.parts.offense).toBeGreaterThan(0);
    expect(entry.gain).toBeGreaterThan(0);
    // Charizard X becomes Fire/Dragon: it loses its Ground immunity, so against Earthquake alone the defense part is negative.
    const x = makeView([{ ...charizard, item: "charizarditex", moves: ["flareblitz", "dragonclaw", "protect"], nature: "Adamant", points: { hp: 2, atk: 32, spe: 32 } }, partner,
      { ...garchomp, moves: ["earthquake"] }, { ...incineroar, moves: ["knockoff"] }]);
    const xEntry = megaOutlook(x, damageRows(x, runtime), runtime)["opponent:charizard"];
    expect(xEntry.formId).toBe("charizardmegax");
    expect(xEntry.parts.defense).toBeLessThan(0);
    // No outlook once the side's Mega is used, or without the stone, or when the request says it cannot.
    expect(megaOutlook(makeView([charizard, partner, garchomp, incineroar], { megaUsed: { opponent: true } }), rows, runtime)).toEqual({});
    expect(megaOutlook(makeView([{ ...charizard, item: "lifeorb" }, partner, garchomp, incineroar]), rows, runtime)).toEqual({});
    expect(megaOutlook(makeView([{ ...charizard, canMega: false }, partner, garchomp, incineroar]), rows, runtime)).toEqual({});
  });

  it("values a Mega Evolution done this turn by its gain, and a Mega kept by its option value", () => {
    const view = makeView([charizard, partner, garchomp, incineroar]);
    const rows = damageRows(view, runtime);
    const mega = megaOutlook(view, rows, runtime);
    const ctx = context(view, { mega });
    const gain = mega["opponent:charizard"].gain;
    const kept = stateTerms(postOf(view), ctx);
    expect(kept.megaLasting).toBe(0);
    // One holder: the option value alone (megaAvailable counts only with two or more holders to choose between).
    expect(kept.megaKeep).toBeCloseTo(DEFAULT_WEIGHTS.megaOption * gain, 12);
    const evolved = stateTerms(postOf(view, (post) => {
      post.megaUsed.opponent = true;
      const mon = post.mons.find((each) => each.key === "opponent:charizard")!;
      mon.build = { ...mon.build, speciesId: "charizardmegay", abilityId: "drought" };
    }), ctx);
    expect(evolved.megaKeep).toBe(0);
    expect(evolved.megaLasting).toBeCloseTo(DEFAULT_WEIGHTS.megaLasting * gain - DEFAULT_WEIGHTS.megaReveal, 12);
    // A holder at low HP keeps less option value (the risk it faints before it can Mega Evolve).
    const hurt = stateTerms(postOf(view, (post) => setHP(post, "opponent:charizard", 0.2)), ctx);
    expect(hurt.megaKeep).toBeLessThan(kept.megaKeep);
    // A fainted holder keeps none.
    const fainted = stateTerms(postOf(view, (post) => setHP(post, "opponent:charizard", 0)), ctx);
    expect(fainted.megaKeep).toBe(0);
  });

  it("scores the player's Mega the same way, with the opposite sign", () => {
    const player: MonSpec = { ...charizard, side: "own", slot: "own-left" };
    const view = makeView([{ ...garchomp, side: "opponent", slot: "opponent-left" }, { ...incineroar, side: "opponent", slot: "opponent-right" }, player, { ...partner, side: "own", slot: "own-right" }]);
    const rows = damageRows(view, runtime);
    const mega = megaOutlook(view, rows, runtime);
    expect(Object.keys(mega)).toEqual(["own:charizard"]);
    const terms = stateTerms(postOf(view), context(view, { mega }));
    expect(terms.megaKeep).toBeLessThan(0);
  });
});
