import { describe, expect, it } from "vitest";
import { countsOf, createTracker, shownPercent } from "@/app/(app)/training/sim/tracker";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { Battle, extractChannelMessages } from "@/app/(app)/training/sim/sim";
import { AI_TEAM, PLAYER_TEAM, runtime } from "./training-sim-fixtures";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §8: the public tracker. Line shapes are the pinned simulator's (recorded from the seat probe's p2 channel).

const keyOf = (_side: "p1" | "p2", name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const START = [
  "|player|p1|You|", "|player|p2|Training|", "|gametype|doubles", "|gen|9", "|teampreview|4",
  "|start",
  "|switch|p1a: Incineroar|Incineroar, L50, M|100/100",
  "|switch|p1b: Charizard|Charizard, L50, M|100/100",
  "|switch|p2a: Gyarados|Gyarados, L50, M|172/172",
  "|switch|p2b: Pelipper|Pelipper, L50, M|167/167",
  "|-ability|p2a: Gyarados|Intimidate|boost",
  "|-unboost|p1a: Incineroar|atk|1",
  "|-unboost|p1b: Charizard|atk|1",
  "|-weather|RainDance|[from] ability: Drizzle|[of] p2b: Pelipper",
  "|-ability|p1a: Incineroar|Intimidate|boost",
  "|-unboost|p2a: Gyarados|atk|1",
  "|-unboost|p2b: Pelipper|atk|1",
  "|turn|1",
];
const tracker = (lines: string[] = START, viewer: "p1" | "p2" = "p2") => { const t = createTracker(viewer, keyOf); t.push(lines); return t; };

describe("tracker messages (SPEC 8.1)", () => {
  it("switch, turn, HP as each seat sees it (R12), entry abilities and weather with its start turn (R2)", () => {
    const state = tracker().state();
    expect(state.turn).toBe(1);
    const gyarados = state.mons["p2:gyarados"], incineroar = state.mons["p1:incineroar"];
    expect(gyarados).toMatchObject({ position: 0, exact: { hp: 172, maxhp: 172 }, hp: { percent: 100, color: null }, activeTurns: 1, switchIns: 1, actions: 0 });
    expect(incineroar).toMatchObject({ position: 0, exact: null, hp: { percent: 100, color: null }, ability: { abilityId: "intimidate", how: "announced" } });
    expect(incineroar.boosts.atk).toBe(-1);
    expect(state.field.weather).toEqual({ id: "raindance", since: 1, layers: 1, setterKey: "p2:pelipper", fromAbility: true });
    expect(state.mons["p2:pelipper"].ability).toEqual({ abilityId: "drizzle", how: "announced" });
    expect(JSON.parse(JSON.stringify(state))).toEqual(structuredClone(state));
  });

  it("move, damage with attribution (R1), item reveals, faint and faintedLastTurn", () => {
    const t = tracker([...START,
      "|move|p1b: Charizard|Heat Wave|p2a: Gyarados|[spread] p2a,p2b",
      "|-resisted|p2a: Gyarados",
      "|-damage|p2a: Gyarados|160/172",
      "|-damage|p2b: Pelipper|150/167",
      "|-damage|p1b: Charizard|90/100|[from] item: Life Orb",
      "|move|p2a: Gyarados|Waterfall|p1a: Incineroar",
      "|-supereffective|p1a: Incineroar",
      "|-damage|p1a: Incineroar|25/100",
      "|-enditem|p1a: Incineroar|Sitrus Berry|[eat]",
      "|-heal|p1a: Incineroar|50/100g|[from] item: Sitrus Berry",
      "|move|p1a: Incineroar|Flare Blitz|p2b: Pelipper",
      "|-damage|p2b: Pelipper|0 fnt",
      "|-damage|p1a: Incineroar|20/100y|[from] Recoil",
      "|faint|p2b: Pelipper",
      "|",
      "|upkeep",
      "|turn|2",
    ]);
    const state = t.state();
    expect(state.mons["p1:charizard"].item).toEqual({ state: "held", itemId: "lifeorb" });
    expect(state.mons["p1:incineroar"].item).toEqual({ state: "gone", itemId: "sitrusberry", how: "consumed", stint: 1 });
    expect(state.mons["p1:incineroar"].hp).toEqual({ percent: 20, color: "y" });
    expect(state.mons["p2:pelipper"]).toMatchObject({ fainted: true, exact: { hp: 0, maxhp: 167 }, volatiles: [], boosts: { atk: 0 } });
    expect(state.sides.p2).toMatchObject({ totalFainted: 1, faintedLastTurn: "p2:pelipper" });
    expect(state.mons["p1:charizard"]).toMatchObject({ movesUsed: { heatwave: 1 }, lastMove: "heatwave", lastMoveTarget: { side: "p2", position: 0 }, actions: 1, lastResult: true });
    expect(state.mons["p2:gyarados"].timesHit).toBe(1);
  });

  it("R1: [of] names the holder (Rough Skin, Rocky Helmet); a self-heal ability stays with the healed Pokémon", () => {
    const state = tracker([...START,
      "|move|p2a: Gyarados|Waterfall|p1a: Incineroar",
      "|-damage|p1a: Incineroar|80/100",
      "|-damage|p2a: Gyarados|150/172|[from] item: Rocky Helmet|[of] p1a: Incineroar",
      "|move|p1b: Charizard|Thunder Punch|p2b: Pelipper",
      "|-heal|p2b: Pelipper|167/167|[from] ability: Water Absorb|[of] p1b: Charizard",
    ]).state();
    expect(state.mons["p1:incineroar"].item).toEqual({ state: "held", itemId: "rockyhelmet" });
    expect(state.mons["p2:gyarados"].item).toEqual({ state: "not-shown" });
    expect(state.mons["p2:pelipper"].ability).toEqual({ abilityId: "waterabsorb", how: "announced" });
    expect(state.mons["p1:charizard"].ability).toBeNull();
  });

  it("R3/R4: called moves are not actions; PP counts Pressure; locked continuations spend none (R7 locks)", () => {
    const state = tracker([...START,
      "|-ability|p2b: Pelipper|Pressure",
      "|move|p1a: Incineroar|Outrage|p2b: Pelipper",
      "|-damage|p2b: Pelipper|100/167",
      "|move|p1b: Charizard|Copycat|p1b: Charizard",
      "|move|p1b: Charizard|Outrage|p2a: Gyarados|[from] move: Copycat",
      "|turn|2",
      "|move|p1a: Incineroar|Outrage|p2a: Gyarados|[from] lockedmove",
      "|-damage|p2a: Gyarados|100/172",
      "|-start|p1a: Incineroar|confusion|[fatigue]",
    ]).state();
    expect(state.mons["p1:incineroar"].movesUsed).toEqual({ outrage: 2 });
    expect(state.mons["p1:incineroar"].actions).toBe(2);
    expect(state.mons["p1:incineroar"].lock).toBeNull();
    expect(state.mons["p1:charizard"]).toMatchObject({ movesUsed: { copycat: 1 }, actions: 1, lastMove: "copycat" });
    const locked = tracker([...START, "|move|p1a: Incineroar|Outrage|p2b: Pelipper", "|-damage|p2b: Pelipper|90/167", "|turn|2", "|move|p1a: Incineroar|Outrage|p2a: Gyarados|[from] lockedmove", "|-damage|p2a: Gyarados|100/172"]).state();
    expect(locked.mons["p1:incineroar"].lock).toEqual({ moveId: "outrage", turns: 2 });
    // A locking move that does not land starts no lock (data/moves.ts outrage self.volatileStatus).
    const missed = tracker([...START, "|move|p1a: Incineroar|Outrage|p2b: Pelipper|[miss]", "|-miss|p1a: Incineroar|p2b: Pelipper", "|turn|2"]).state();
    expect(missed.mons["p1:incineroar"].lock).toBeNull();
    expect(locked.mons["p1:incineroar"].lock).toEqual({ moveId: "outrage", turns: 2 });
  });

  it("R5: two-turn charge, fired at once in rain, released next turn", () => {
    const charge = tracker([...START, "|move|p2b: Pelipper|Solar Beam||[still]", "|-prepare|p2b: Pelipper|Solar Beam"]).state();
    expect(charge.mons["p2:pelipper"].volatiles.map((v) => v.id)).toEqual(["twoturnmove"]);
    expect(charge.mons["p2:pelipper"].movesUsed).toEqual({ solarbeam: 1 });
    const fired = tracker([...START, "|move|p2b: Pelipper|Electro Shot||[still]", "|-prepare|p2b: Pelipper|Electro Shot", "|-boost|p2b: Pelipper|spa|1", "|-anim|p2b: Pelipper|Electro Shot|p1a: Incineroar"]).state();
    expect(fired.mons["p2:pelipper"].volatiles).toEqual([]);
    const released = tracker([...START, "|move|p2b: Pelipper|Solar Beam||[still]", "|-prepare|p2b: Pelipper|Solar Beam", "|turn|2", "|move|p2b: Pelipper|Solar Beam|p1a: Incineroar|[from] lockedmove"]).state();
    expect(released.mons["p2:pelipper"].volatiles).toEqual([]);
    expect(released.mons["p2:pelipper"].movesUsed).toEqual({ solarbeam: 1 });
  });

  it("R6: switching out clears volatiles, boosts, last move, lock and protect streak", () => {
    const state = tracker([...START,
      "|move|p1a: Incineroar|Protect|p1a: Incineroar", "|-singleturn|p1a: Incineroar|Protect",
      "|move|p2a: Gyarados|Dragon Dance|p2a: Gyarados", "|-boost|p2a: Gyarados|atk|1", "|-boost|p2a: Gyarados|spe|1",
      "|turn|2",
      "|switch|p2a: Dragonite|Dragonite, L50, M|168/168",
      "|switch|p1a: Garchomp|Garchomp, L50, M|100/100",
    ]).state();
    expect(state.mons["p2:gyarados"]).toMatchObject({ position: null, boosts: { atk: 0, spe: 0 }, lastMove: null });
    expect(state.mons["p1:incineroar"]).toMatchObject({ position: null, protectStreak: 0, volatiles: [] });
    expect(state.mons["p2:dragonite"]).toMatchObject({ position: 0, switchIns: 1, activeTurns: 0 });
  });

  it("R8 stint flag, R9 Taunt/Encore after the target acted, R10 counters, R11 protect streak", () => {
    const state = tracker([...START,
      "|move|p2a: Gyarados|Protect|p2a: Gyarados", "|-singleturn|p2a: Gyarados|Protect",
      "|move|p1a: Incineroar|Fake Out|p2b: Pelipper", "|-damage|p2b: Pelipper|150/167",
      "|move|p2b: Pelipper|Taunt|p1a: Incineroar", "|-start|p1a: Incineroar|move: Taunt",
      "|move|p1b: Charizard|Hypnosis|p2b: Pelipper", "|-status|p2b: Pelipper|slp",
      "|turn|2",
      "|move|p2a: Gyarados|Protect|p2a: Gyarados", "|-singleturn|p2a: Gyarados|Protect",
      "|cant|p2b: Pelipper|slp",
      "|-start|p1b: Charizard|confusion",
      "|-activate|p1b: Charizard|confusion",
      "|move|p1b: Charizard|Heat Wave|p2a: Gyarados|[spread] p2b",
      "|-enditem|p2b: Pelipper|Mystic Water|[from] move: Knock Off|[of] p1a: Incineroar",
      "|turn|3",
    ]).state();
    expect(state.mons["p2:gyarados"].protectStreak).toBe(2);
    expect(state.mons["p1:incineroar"].volatiles).toEqual([{ id: "taunt", since: 1, elapsed: 0, targetMovedFirst: true }]);
    expect(state.mons["p2:pelipper"]).toMatchObject({ status: "slp", statusElapsed: 1, item: { state: "gone", itemId: "mysticwater", how: "removed", stint: 1 } });
    expect(state.mons["p1:charizard"].volatiles).toEqual([{ id: "confusion", since: 2, elapsed: 1 }]);
    const lapsed = tracker([...START, "|move|p2a: Gyarados|Protect|p2a: Gyarados", "|-singleturn|p2a: Gyarados|Protect", "|turn|2", "|move|p2a: Gyarados|Waterfall|p1a: Incineroar", "|turn|3"]).state();
    expect(lapsed.mons["p2:gyarados"].protectStreak).toBe(0);
  });

  it("R2: an effect started after upkeep counts from the next turn", () => {
    const state = tracker([...START, "|move|p1b: Charizard|Tailwind|p1b: Charizard", "|-sidestart|p1: You|move: Tailwind", "|", "|upkeep",
      "|switch|p2b: Torkoal|Torkoal, L50, M|177/177", "|-weather|SunnyDay|[from] ability: Drought|[of] p2b: Torkoal", "|turn|2"]).state();
    expect(state.sides.p1.conditions).toEqual([{ id: "tailwind", since: 1, layers: 1, setterKey: "p1:charizard" }]);
    expect(state.field.weather).toMatchObject({ id: "sunnyday", since: 2, setterKey: "p2:torkoal" });
  });

  it("Mega Evolution: detailschange + -mega shows the stone and uses the side's Mega", () => {
    const state = tracker([...START, "|detailschange|p2a: Gyarados|Gyarados-Mega, L50, M", "|-mega|p2a: Gyarados|Gyarados|Gyaradosite", "|-ability|p2a: Gyarados|Mold Breaker"]).state();
    expect(state.mons["p2:gyarados"]).toMatchObject({ speciesId: "gyaradosmega", mega: true, item: { state: "held", itemId: "gyaradosite" } });
    expect(state.sides.p2.megaUsed).toBe(true);
  });

  it("boosts are clamped; clears and copies apply; weather and fields start and end", () => {
    const state = tracker([...START,
      "|-boost|p2a: Gyarados|atk|12", "|-setboost|p2b: Pelipper|spa|6", "|-clearnegativeboost|p1a: Incineroar|[silent]",
      "|-copyboost|p1b: Charizard|p2a: Gyarados", "|-fieldstart|move: Trick Room|[of] p2b: Pelipper", "|-fieldstart|move: Psychic Terrain|[from] ability: Psychic Surge|[of] p1a: Incineroar",
      "|-weather|none", "|-sidestart|p2: Training|Spikes", "|-sidestart|p2: Training|Spikes",
    ]).state();
    expect(state.mons["p2:gyarados"].boosts.atk).toBe(6);
    expect(state.mons["p1:incineroar"].boosts.atk).toBe(0);
    expect(state.mons["p1:charizard"].boosts.atk).toBe(6);
    expect(state.field).toMatchObject({ weather: null, terrain: { id: "psychicterrain", setterKey: "p1:incineroar" }, rooms: [{ id: "trickroom", setterKey: "p2:pelipper" }] });
    expect(state.mons["p1:incineroar"].ability?.abilityId).toBe("psychicsurge");
    expect(state.sides.p2.conditions).toEqual([{ id: "spikes", since: 1, layers: 2, setterKey: null }]);
  });

  it("Illusion: |replace| moves the state to the revealed member", () => {
    const state = tracker(["|player|p1|You|", "|player|p2|Training|", "|switch|p1a: Incineroar|Incineroar, L50, M|100/100", "|switch|p1b: Charizard|Charizard, L50, M|100/100",
      "|switch|p2a: Gyarados|Gyarados, L50, M|172/172", "|switch|p2b: Pelipper|Pelipper, L50, M|167/167", "|turn|1",
      "|move|p2a: Gyarados|Waterfall|p1a: Incineroar", "|-damage|p1a: Incineroar|60/100", "|replace|p1a: Zoroark|Zoroark-Hisui, L50, M", "|-end|p1a: Zoroark|Illusion"]).state();
    expect(state.mons["p1:incineroar"]).toBeUndefined();
    expect(state.mons["p1:zoroark"]).toMatchObject({ speciesId: "zoroarkhisui", position: 0, hp: { percent: 60 } });
  });

  it("drag, transform, set HP, team cure, swapped and inverted stages", () => {
    const state = tracker([...START,
      "|drag|p2a: Dragonite|Dragonite, L50, M|168/168",
      "|-transform|p1b: Charizard|p2a: Dragonite|[from] ability: Imposter",
      "|-sethp|p2b: Pelipper|80/167|[from] move: Pain Split",
      "|-status|p1a: Incineroar|par", "|-cureteam|p1a: Incineroar|[from] move: Aromatherapy",
      "|-boost|p2b: Pelipper|spa|2", "|-swapboost|p2b: Pelipper|p1a: Incineroar|spa", "|-invertboost|p1a: Incineroar",
    ]).state();
    expect(state.mons["p2:dragonite"]).toMatchObject({ position: 0, switchIns: 1 });
    expect(state.mons["p2:gyarados"].position).toBeNull();
    expect(state.mons["p1:charizard"]).toMatchObject({ transformedInto: "p2:dragonite", ability: { abilityId: "imposter" } });
    expect(state.mons["p2:pelipper"].exact).toEqual({ hp: 80, maxhp: 167 });
    expect(state.mons["p1:incineroar"].status).toBe("");
    expect(state.mons["p2:pelipper"].boosts.spa).toBe(0);
    expect(state.mons["p1:incineroar"].boosts.spa).toBe(-2);
  });

  it("ignores every other protocol command (listed here so new kinds are noticed)", () => {
    const ignored = ["|", "|t:|1791239343", "|gametype|doubles", "|gen|9", "|tier|[Gen 9 Champions] VGC 2026 Reg M-C", "|rule|Species Clause", "|clearpoke",
      "|poke|p1|Garchomp, L50, M|", "|teampreview|4", "|teamsize|p1|4", "|start", "|uhtml|otsrequest|<button>", "|uhtmlchange|otsrequest|",
      "|-supereffective|p2a: Gyarados|1", "|-resisted|p2a: Gyarados|1", "|-hint|Since gen 7, Dark is immune to Prankster moves.", "|-message|Hi",
      "|-center", "|-combine", "|-waiting|p1a: Incineroar|p1b: Charizard", "|-notarget|p1a: Incineroar", "|-nothing", "|-ohko", "|-block|p2a: Gyarados|move: Protect",
      "|-primal|p2a: Gyarados", "|-zbroken|p2a: Gyarados", "|-burst|p2a: Gyarados|Necrozma-Ultra|Ultranecrozium Z", "|-candynamax|p1", "|inactive|", "|j|☆You", "|c|☆You|hi"];
    const base = tracker().state();
    expect(tracker([...START, ...ignored]).state()).toEqual(base);
  });

  it("status-eot public counts: Rest's sleep, Axe Kick's confusion, a Substitute's maker and hits, the Ally Switch streak, an item from Trick", () => {
    const counts = (state: ReturnType<ReturnType<typeof tracker>["state"]>, key: string) => countsOf(state.mons[key]);
    const rest = tracker([...START, "|move|p2b: Pelipper|Rest|p2b: Pelipper", "|-status|p2b: Pelipper|slp|[from] move: Rest", "|-heal|p2b: Pelipper|167/167 slp|[silent]",
      "|move|p1a: Incineroar|Axe Kick|p2a: Gyarados", "|-damage|p2a: Gyarados|120/172", "|-start|p2a: Gyarados|confusion",
      "|move|p1b: Charizard|Substitute|p1b: Charizard", "|-start|p1b: Charizard|Substitute", "|-damage|p1b: Charizard|75/100"]).state();
    expect(counts(rest, "p2:pelipper").restSleep).toBe(true);
    expect(rest.mons["p2:gyarados"].volatiles.find((each) => each.id === "confusion")).toMatchObject({ moveId: "axekick", elapsed: 0 });
    expect(rest.mons["p1:charizard"].volatiles.find((each) => each.id === "substitute")).toMatchObject({ sourceKey: "p1:charizard", hits: 0 });
    // A sleep from anything else is not Rest's; a hit on the Substitute counts.
    const slept = tracker([...START, "|move|p1a: Incineroar|Spore|p2b: Pelipper", "|-status|p2b: Pelipper|slp|[from] move: Spore",
      "|move|p1b: Charizard|Substitute|p1b: Charizard", "|-start|p1b: Charizard|Substitute", "|move|p2a: Gyarados|Waterfall|p1b: Charizard",
      "|-activate|p1b: Charizard|move: Substitute|[damage]"]).state();
    expect(counts(slept, "p2:pelipper").restSleep).toBeUndefined();
    expect(slept.mons["p1:charizard"].volatiles.find((each) => each.id === "substitute")).toMatchObject({ hits: 1 });
    // Ally Switch: a use that passes PrepareHit (a swap, or onHit's own failure) keeps the streak; a plain -fail or a turn without one ends it.
    const swap = ["|move|p2a: Gyarados|Ally Switch|p2a: Gyarados", "|swap|p2a: Gyarados|1|[from] move: Ally Switch"];
    const twice = tracker([...START, ...swap, "|upkeep", "|turn|2", "|move|p2b: Gyarados|Ally Switch|p2b: Gyarados", "|swap|p2b: Gyarados|0|[from] move: Ally Switch", "|upkeep", "|turn|3"]).state();
    expect(counts(twice, "p2:gyarados").allySwitchStreak).toBe(2);
    const failed = tracker([...START, ...swap, "|upkeep", "|turn|2", "|move|p2b: Gyarados|Ally Switch|p2b: Gyarados", "|-fail|p2b: Gyarados", "|upkeep", "|turn|3"]).state();
    expect(counts(failed, "p2:gyarados").allySwitchStreak).toBeUndefined();
    const skipped = tracker([...START, ...swap, "|upkeep", "|turn|2", "|upkeep", "|turn|3"]).state();
    expect(counts(skipped, "p2:gyarados").allySwitchStreak).toBeUndefined();
    const once = tracker([...START, ...swap, "|upkeep", "|turn|2"]).state();
    expect(counts(once, "p2:gyarados").allySwitchStreak).toBe(1);
    // Trick: the item's arrival is counted against the holder's actions (the Choice lock waits for its next move).
    const trick = tracker([...START, "|move|p1a: Incineroar|Trick|p2a: Gyarados", "|-activate|p1a: Incineroar|move: Trick|[of] p2a: Gyarados",
      "|-item|p2a: Gyarados|Choice Scarf|[from] move: Trick", "|-item|p1a: Incineroar|Leftovers|[from] move: Trick"]).state();
    expect(counts(trick, "p2:gyarados").itemSince).toBe(0);
    expect(counts(trick, "p1:incineroar").itemSince).toBe(1);
    // The Choice lock's move (EOT-5): the first move since the item reached it, kept through a forced Struggle; an item
    // from Trick clears it until the next move; a Frisk reveal does not.
    expect(counts(trick, "p1:incineroar").choiceMove).toBeUndefined();
    const struggle = tracker([...START, "|move|p1a: Incineroar|Flare Blitz|p2a: Gyarados", "|-damage|p2a: Gyarados|100/172", "|upkeep", "|turn|2",
      "|move|p1a: Incineroar|Struggle|p2a: Gyarados", "|-activate|p1a: Incineroar|move: Struggle", "|-damage|p2a: Gyarados|90/172", "|upkeep", "|turn|3"]).state();
    expect(counts(struggle, "p1:incineroar").choiceMove).toBe("flareblitz");
    expect(struggle.mons["p1:incineroar"].lastMove).toBe("struggle");
    const frisked = tracker([...START, "|move|p1a: Incineroar|Flare Blitz|p2a: Gyarados", "|-item|p1a: Incineroar|Choice Scarf|[from] ability: Frisk|[of] p2a: Gyarados"]).state();
    expect(counts(frisked, "p1:incineroar").choiceMove).toBe("flareblitz");
    const after = tracker([...START, "|move|p1a: Incineroar|Trick|p2a: Gyarados", "|-item|p2a: Gyarados|Choice Scarf|[from] move: Trick", "|upkeep", "|turn|2",
      "|move|p2a: Gyarados|Waterfall|p1a: Incineroar"]).state();
    expect(counts(after, "p2:gyarados").choiceMove).toBe("waterfall");
    // Syrup Bomb's source is the move's user (its -start line names none).
    const syrup = tracker([...START, "|move|p1b: Charizard|Syrup Bomb|p2a: Gyarados", "|-damage|p2a: Gyarados|150/172", "|-start|p2a: Gyarados|Syrup Bomb"]).state();
    expect(syrup.mons["p2:gyarados"].volatiles.find((each) => each.id === "syrupbomb")).toMatchObject({ sourceKey: "p1:charizard" });
    // Leech Seed keeps the seeder's position as it seeded (the Pokémon standing there heals after it leaves).
    const seed = tracker([...START, "|move|p1b: Charizard|Leech Seed|p2a: Gyarados", "|-start|p2a: Gyarados|move: Leech Seed"]).state();
    expect(seed.mons["p2:gyarados"].volatiles.find((each) => each.id === "leechseed")).toMatchObject({ sourceKey: "p1:charizard", sourcePosition: 1 });
    // A Future Sight resolves at the residual two turns on, with no line when its target has fainted: gone at that upkeep.
    const sight = ["|move|p2a: Gyarados|Future Sight|p1a: Incineroar", "|-start|p2a: Gyarados|move: Future Sight", "|upkeep", "|turn|2", "|upkeep", "|turn|3"];
    const pending = tracker([...START, ...sight]).state();
    expect(pending.sides.p1.conditions.map((each) => each.id)).toEqual(["futuresight"]);
    const resolved = tracker([...START, ...sight, "|faint|p1a: Incineroar", "|upkeep"]).state();
    expect(resolved.sides.p1.conditions.map((each) => each.id)).toEqual([]);
  });

  it("win ends it with the winner's side", () => {
    expect(tracker([...START, "|win|Training"]).state()).toMatchObject({ ended: true, winner: "p2" });
    expect(tracker([...START, "|tie"]).state()).toMatchObject({ ended: true, winner: "tie" });
    expect(shownPercent(36, 180)).toEqual({ percent: 20, color: "r" });
    expect(shownPercent(91, 180)).toEqual({ percent: 50, color: "g" });
  });
});

describe("observations (SPEC 8.2)", () => {
  it("speed order pairs across sides, damage with censoring, reveals, entries and actions", () => {
    const t = tracker([...START,
      "|move|p1b: Charizard|Heat Wave|p2a: Gyarados|[spread] p2a,p2b",
      "|-damage|p2a: Gyarados|150/172",
      "|-damage|p2b: Pelipper|140/167",
      "|move|p2a: Gyarados|Waterfall|p1b: Charizard",
      "|-supereffective|p1b: Charizard",
      "|-crit|p1b: Charizard",
      "|-enditem|p1b: Charizard|Focus Sash",
      "|-damage|p1b: Charizard|1/100",
      "|move|p1a: Incineroar|Knock Off|p2b: Pelipper",
      "|-damage|p2b: Pelipper|120/167",
      "|move|p2b: Pelipper|Hurricane|p1a: Incineroar",
      "|-damage|p1a: Incineroar|0 fnt",
      "|faint|p1a: Incineroar",
      "|",
      "|upkeep",
      "|switch|p1a: Garchomp|Garchomp, L50, M|100/100",
      "|-ability|p1a: Garchomp|Mold Breaker",
      "|turn|2",
    ]);
    const [start, one] = t.observations();
    expect(start.turn).toBe(0);
    expect(start.entries.map((e) => e.key).sort()).toEqual(["p1:charizard", "p1:incineroar"]);
    expect(start.entries.find((e) => e.key === "p1:incineroar")?.announced).toEqual(["intimidate"]);
    expect(start.entries.find((e) => e.key === "p1:charizard")?.announced).toEqual([]);
    expect(one.turn).toBe(1);
    // Charizard → Gyarados → Incineroar → Pelipper: pairs on different sides.
    expect(one.order.map((o) => `${o.first.key}>${o.second.key}`)).toEqual([
      "p1:charizard>p2:gyarados", "p1:charizard>p2:pelipper", "p2:gyarados>p1:incineroar", "p1:incineroar>p2:pelipper",
    ]);
    expect(one.order[0]).toMatchObject({ first: { moveId: "heatwave", speStage: 0, status: "", tailwind: false, quickClaw: false }, trickRoom: false, weather: "raindance" });
    const hits = one.damage.map((d) => ({ move: d.moveId, from: d.attacker.key, to: d.defender.key, censored: d.censored, crit: d.crit, spread: d.spread }));
    expect(hits).toEqual([
      { move: "heatwave", from: "p1:charizard", to: "p2:gyarados", censored: null, crit: false, spread: true },
      { move: "heatwave", from: "p1:charizard", to: "p2:pelipper", censored: null, crit: false, spread: true },
      { move: "waterfall", from: "p2:gyarados", to: "p1:charizard", censored: "focus-sash", crit: true, spread: false },
      { move: "knockoff", from: "p1:incineroar", to: "p2:pelipper", censored: null, crit: false, spread: false },
      { move: "hurricane", from: "p2:pelipper", to: "p1:incineroar", censored: "fainted", crit: false, spread: false },
    ]);
    expect(one.damage[0]).toMatchObject({ defender: { hp: { hp: 172, maxhp: 172 } }, after: { hp: 150, maxhp: 172 } });
    expect(one.damage[2]).toMatchObject({ defender: { hp: { percent: 100 } }, after: { percent: 1 } });
    expect(one.reveals).toEqual(expect.arrayContaining([
      { key: "p1:charizard", kind: "move", id: "heatwave" }, { key: "p1:charizard", kind: "item-gone", id: "focussash" },
      { key: "p1:incineroar", kind: "move", id: "knockoff" }, { key: "p1:garchomp", kind: "ability", id: "moldbreaker" },
    ]));
    expect(one.entries).toEqual([{ key: "p1:garchomp", announced: ["moldbreaker"] }]);
    expect(one.actions).toEqual([
      { key: "p1:incineroar", position: 0, action: { kind: "move", moveId: "knockoff", targetKey: "p2:pelipper", spread: false } },
      { key: "p1:charizard", position: 1, action: { kind: "move", moveId: "heatwave", targetKey: null, spread: true } },
    ]);
  });

  it("a switch and a cant are actions; multi-hit moves give no damage observation; not-choice after two moves", () => {
    const t = tracker([...START,
      "|switch|p1a: Garchomp|Garchomp, L50, M|100/100",
      "|cant|p1b: Charizard|par",
      "|move|p2a: Gyarados|Waterfall|p1a: Garchomp",
      "|-damage|p1a: Garchomp|80/100",
      "|turn|2",
      "|move|p1a: Garchomp|Scale Shot|p2a: Gyarados",
      "|-damage|p2a: Gyarados|150/172",
      "|-damage|p2a: Gyarados|130/172",
      "|-hitcount|p2a: Gyarados|2",
      "|turn|3",
      "|move|p1a: Garchomp|Earthquake|p2a: Gyarados|[spread] p2a,p2b",
      "|turn|4",
    ]);
    const [, one, two, three] = t.observations();
    expect(one.actions).toEqual([
      { key: "p1:incineroar", position: 0, action: { kind: "switch", toKey: "p1:garchomp" } },
      { key: "p1:charizard", position: 1, action: { kind: "none", reason: "cant" } },
    ]);
    expect(one.order).toEqual([]);
    expect(two.damage).toEqual([]);
    expect(three.reveals).toEqual(expect.arrayContaining([{ key: "p1:garchomp", kind: "not-choice", id: "" }]));
    expect(three.actions.find((a) => a.key === "p1:charizard")?.action).toEqual({ kind: "none", reason: "not-shown" });
  });

  it("matches the pinned simulator's public facts at every decision, both seats (fixture battles)", () => {
    const own = toShowdownTeam(PLAYER_TEAM.members, runtime), opponent = toShowdownTeam(AI_TEAM.members, runtime);
    const keys = memberKeys(own, opponent);
    const hidden = new Set(["unburden", "stall", "choicelock", "lockedmove", "protect", "helpinghand", "followme", "ragepowder", "electroshot", "solarbeam", "roost", "twoturnmove", "mustrecharge", "endure"]);
    let decisions = 0, mismatches = 0;
    for (let k = 0; k < 12; k++) {
      const chunks: string[] = [];
      const battle = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [k + 31, 2, 3, 4], send: (type, data) => { if (type === "update") chunks.push(Array.isArray(data) ? data.join("\n") : data); } });
      battle.setPlayer("p1", { name: "You", team: structuredClone(own.sets.map((s) => s.set)) });
      battle.setPlayer("p2", { name: "Training", team: structuredClone(opponent.sets.map((s) => s.set)) });
      const seats = { p1: createTracker("p1", keys.keyOf), p2: createTracker("p2", keys.keyOf) };
      const choose = createChooser(k + 31);
      let guard = 0;
      while (!battle.ended && guard++ < 200) {
        battle.sendUpdates();
        const channels = extractChannelMessages(chunks.splice(0).join("\n"), [1, 2]);
        seats.p1.push(channels[1]); seats.p2.push(channels[2]);
        if (battle.p1.activeRequest && "active" in battle.p1.activeRequest) {
          decisions++;
          for (const viewer of ["p1", "p2"] as const) {
            const state = seats[viewer].state();
            for (const side of ["p1", "p2"] as const) for (const p of battle[side].pokemon) {
              const m = state.mons[`${side}:${keys.keyOf(side, p.name)}`];
              if (!m) continue;
              const truth = [p.species.id, p.fainted, p.fainted ? "" : p.status, JSON.stringify(p.boosts), p.fainted ? "0" : side === viewer ? `${p.hp}/${p.maxhp}` : p.getHealth().shared.split(" ")[0], Object.keys(p.volatiles).filter((v) => !hidden.has(v)).sort().join()];
              const mine = [m.speciesId, m.fainted, m.fainted ? "" : m.status, JSON.stringify(m.boosts), m.fainted ? "0" : side === viewer ? `${m.exact?.hp}/${m.exact?.maxhp}` : `${m.hp.percent}/100${m.hp.color ?? ""}`, m.volatiles.map((v) => v.id).filter((v) => !hidden.has(v)).sort().join()];
              if (JSON.stringify(truth) !== JSON.stringify(mine)) mismatches++;
            }
            for (const side of ["p1", "p2"] as const) if (state.sides[side].conditions.map((c) => c.id).sort().join() !== Object.keys(battle[side].sideConditions).sort().join()) mismatches++;
            if ((state.field.weather?.id ?? "") !== battle.field.weather || state.turn !== battle.turn) mismatches++;
          }
        }
        battle.makeChoices(choose("p1", battle.p1.activeRequest), choose("p2", battle.p2.activeRequest));
      }
    }
    expect(decisions).toBeGreaterThan(150);
    expect(mismatches).toBe(0);
  }, 60_000);
});
