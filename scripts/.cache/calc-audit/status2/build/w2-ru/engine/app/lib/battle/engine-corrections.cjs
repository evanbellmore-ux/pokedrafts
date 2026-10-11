// CommonJS on purpose: it must correct the same exports object that the engine's own require()
// returns, which an ES import may only see through read-only getters.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above: an ES import cannot write to it
const util = require("@smogon/calc/dist/mechanics/util");

/*
 * The pinned engine boosts a defending Protosynthesis or Quark Drive holder's Defense or Sp. Def by
 * 5324/4096 (gen789.js calculateDfModsSMSSSV), where pinned Showdown uses 5325/4096 (data/abilities.ts
 * onModifyDef / onModifySpD), so some stats come out a point low. The engine reads util.chainMods from
 * this object at call time. 5324 appears in no other attack or defense chain (its only other use is
 * Life Orb, a final modifier chained with other bounds), so only the defense chain is corrected.
 * node_modules is untouched.
 */
/*
 * A terrain Seed raises its stat through Showdown's boost(), which Simple doubles (data/items.ts
 * electricseed and its kin, useItem); the engine's checkSeedBoost adds a flat 1 (Contrary's -1 is
 * right), so a Simple holder's rise is doubled here.
 */
if (!util.checkSeedBoost.corrected) {
  const originalSeed = util.checkSeedBoost;
  const correctedSeed = (pokemon, field) => {
    const before = { def: pokemon.boosts.def, spd: pokemon.boosts.spd };
    originalSeed(pokemon, field);
    if (!pokemon.hasAbility("Simple")) return;
    for (const stat of ["def", "spd"]) {
      const change = pokemon.boosts[stat] - before[stat];
      if (change) pokemon.boosts[stat] = Math.max(-6, Math.min(6, before[stat] + 2 * Math.sign(change)));
    }
  };
  correctedSeed.corrected = true;
  util.checkSeedBoost = correctedSeed;
}

if (!util.chainMods.corrected) {
  const original = util.chainMods;
  const corrected = (mods, lowerBound, upperBound) =>
    original(lowerBound === 410 && mods.includes(5324) ? mods.map((mod) => mod === 5324 ? 5325 : mod) : mods, lowerBound, upperBound);
  corrected.corrected = true;
  util.chainMods = corrected;
}

/*
 * A doubles partner's power boosts (calculate.ts partnerPowerBoosts: Battery, Power Spot and Steely Spirit on the
 * attacker's partner) are base power modifiers in pinned Showdown (data/abilities.ts battery, powerspot, steelyspirit
 * onAllyBasePower, priority 22): chained into the BasePower event's modifier with every other one (sim/battle.ts
 * chainModify) before it is applied. The engine applies a partner's Steely Spirit to Attack instead (gen789.js
 * calculateAtModsSMSSSV isSteelySpirit) and its Champions mechanics read no isBattery or isPowerSpot, so the app adds
 * them to the base power chain here: the engine reads util.chainMods from this object at call time, and only that chain
 * has the bounds 41 and 2097152 (gen789.js, champions.js calculateBasePower). Showdown chains by handler priority and
 * the engine in its own order; with three or more modifiers the order can change the chained value, so each chain is
 * taken in every order, and its values are kept (`values`, the same set for every such chain of the run, else null) to
 * run the engine again at each (`forced`).
 */
if (!util.chainMods.partnerPower) {
  const inner = util.chainMods;
  const state = { mods: null, forced: null, order: 0, values: undefined };
  /** The values `mods` chains to in each distinct order of the multiset, ascending. */
  const chainValues = (mods, lowerBound, upperBound) => {
    const live = mods.filter((mod) => mod !== 4096);
    if (live.length < 3) return [inner(live, lowerBound, upperBound)];
    const counts = new Map();
    for (const mod of live) counts.set(mod, (counts.get(mod) ?? 0) + 1);
    const chain = [];
    const values = new Set();
    const walk = () => {
      if (chain.length === live.length) { values.add(inner(chain, lowerBound, upperBound)); return; }
      for (const [mod, left] of counts) {
        if (!left) continue;
        counts.set(mod, left - 1);
        chain.push(mod);
        walk();
        chain.pop();
        counts.set(mod, left);
      }
    };
    walk();
    return [...values].sort((a, b) => a - b);
  };
  const withPower = (mods, lowerBound, upperBound) => {
    if (!state.mods || lowerBound !== 41 || upperBound !== 2097152) return inner(mods, lowerBound, upperBound);
    const all = [...mods, ...state.mods];
    const values = chainValues(all, lowerBound, upperBound);
    if (values.length > 1) {
      state.order = Math.max(state.order, all.filter((mod) => mod !== 4096).length);
      const key = values.join();
      state.values = state.values === undefined || (state.values && state.values.join() === key) ? values : null;
      if (state.forced !== null && values.includes(state.forced)) return state.forced;
    }
    return inner(all, lowerBound, upperBound);
  };
  withPower.corrected = inner.corrected;
  withPower.partnerPower = state;
  util.chainMods = withPower;
}

/**
 * Runs `run` with `mods` (4096ths) added to every base power chain the engine computes in it, and returns its result
 * with `order`: the most modifiers of one of those chains whose value depended on their order (0: none), and `values`:
 * the values such a chain takes in each order (null when two chains of the run differ). `forced`: a value of `values`
 * each such chain takes instead of the engine's order.
 * @template T
 * @param {number[]} mods
 * @param {() => T} run
 * @param {number | null} [forced]
 * @returns {{ result: T, order: number, values: number[] | null }}
 */
exports.withPowerMods = (mods, run, forced = null) => {
  const state = util.chainMods.partnerPower;
  const before = { mods: state.mods, forced: state.forced, order: state.order, values: state.values };
  state.mods = mods;
  state.forced = forced;
  state.order = 0;
  state.values = undefined;
  try {
    const result = run();
    return { result, order: state.order, values: state.values ?? null };
  } finally {
    Object.assign(state, before);
  }
};

/*
 * The hit an intact Ice Face or Disguise takes is calculated at a neutral type effectiveness: pinned Showdown
 * data/abilities.ts iceface and disguise onEffectiveness return 0 for each of the holder's types the move does
 * not miss (sim/pokemon.ts runEffectiveness), before onDamage gives the hit 0. The engine reads
 * util.getMoveEffectiveness from this object at call time (the target's types, a Collision Course's boost),
 * so inside neutralEffectiveness(run) every type it would not be immune to counts as 1 (an immunity stays 0):
 * no super-effective or resisted damage, and nothing that reads them (Expert Belt, Filter, Tinted Lens).
 * The state lives on the corrected function, so another copy of this module shares it.
 */
if (!util.getMoveEffectiveness.corrected) {
  const original = util.getMoveEffectiveness;
  const state = { neutral: false };
  const corrected = (...args) => {
    const effectiveness = original(...args);
    return state.neutral && effectiveness !== 0 ? 1 : effectiveness;
  };
  corrected.corrected = true;
  corrected.state = state;
  util.getMoveEffectiveness = corrected;
}

/** Runs `run` with every type effectiveness the engine reads neutral but immunities (see above), and returns its result. */
exports.neutralEffectiveness = (run) => {
  const state = util.getMoveEffectiveness.state;
  const before = state.neutral;
  state.neutral = true;
  try {
    return run();
  } finally {
    state.neutral = before;
  }
};

/*
 * status2 (SPEC2 §3.6, ADDENDUM2 §3.6): the 2v2 turn's calculation-only markers, read by the engine through util at call
 * time. Nothing in 1v1 sets them, so every wrapper below is the engine's own function there.
 * - TURN_MARKS: the key of the markers calculate.ts makePokemon puts on an engine Pokémon (non-enumerable; its clones keep
 *   them): `grounding` (sim/pokemon.ts isGrounded: "pinned" by Ingrain or Smack Down is grounded, before the Flying check;
 *   "floating" by Magnet Rise or Telekinesis is not, unless Gravity or an Iron Ball), `itemSuppressed` (Embargo:
 *   sim/pokemon.ts ignoringItem, as Magic Room: checkItem moves the item to disabledItem, which Knock Off still reads).
 * - withTurnMarks(marks, run): one scope per engine run (calculate.ts calculate). `defender`: what getMoveEffectiveness reads
 *   of the defender: `first` (its Tera type when Terastallized, not Stellar; else its first type), `added` (a two-type
 *   Pokémon's added type, its types[2], multiplied in at the first-type call: the engine multiplies only types[0] and
 *   types[1], gen789.js:300-302, champions.js:169-171; a one-type Pokémon's added type is its types[1]), `tarShot` (a Fire
 *   move +1 on the first type: data/moves.ts tarshot onEffectiveness), `miracleEye` (a Psychic move no longer misses the
 *   Dark type: onNegateImmunity, neutral there), `pinned` (a Ground move into its Flying type is neutral, as the engine's
 *   own Gravity branch). `final`: modifiers appended to every final-damage chain of the run (the only chainMods with the
 *   bounds 41 and 131072: gen789.js:481, 531; champions.js:273, 318), `firstFinal` to its first one only (the first hit).
 *   `extraBoosts`: added to every countBoosts of the run (only Stored Power, Power Trip and Punishment's: gen789.js:581,
 *   609; champions.js:355, 382).
 *   `ungrounded` (on the defender: a priority move into the user's own ally, whose Psychic Terrain block does not reach it).
 * The Pledges' swamp is turnSpeed's own (calculate.ts swampSpeed): getFinalSpeed calls util.js's chainMods by its local
 * binding, which no wrapper reaches.
 */
const TURN_MARKS = Symbol.for("pokedrafts.status2.turnMarks");
const TURN_STATE = Symbol.for("pokedrafts.status2.turnState");

/**
 * Puts the 2v2 turn's markers on an engine Pokémon as a non-enumerable property (calculate.ts makePokemon; its clone hook
 * puts them on every clone), and returns it.
 * @template P
 * @param {P} pokemon
 * @param {Record<string, unknown>} marks
 * @returns {P}
 */
exports.setTurnMarks = (pokemon, marks) => {
  Object.defineProperty(pokemon, TURN_MARKS, { value: marks, enumerable: false, configurable: true, writable: true });
  return pokemon;
};
/**
 * An engine Pokémon's 2v2 turn markers (setTurnMarks), or null.
 * @param {unknown} pokemon
 * @returns {Record<string, unknown> | null}
 */
exports.turnMarksOf = (pokemon) => (pokemon && pokemon[TURN_MARKS]) || null;
if (!util[TURN_STATE]) {
  // The state lives on util, so another copy of this module shares it.
  const turn = { defender: null, final: null, firstFinal: null, finalCalls: 0, extraBoosts: 0 };
  util[TURN_STATE] = turn;
  const marksOf = (pokemon) => (pokemon && pokemon[TURN_MARKS]) || null;

  const effectiveness = util.getMoveEffectiveness;
  const neutral = effectiveness.state;
  const turnEffectiveness = (gen, move, type, isGhostRevealed, isGravity, isRingTarget) => {
    const marks = turn.defender;
    if (!marks) return effectiveness(gen, move, type, isGhostRevealed, isGravity, isRingTarget);
    if (marks.miracleEye && type === "Dark" && move.hasType("Psychic")) return 1;
    if (marks.pinned && type === "Flying" && move.hasType("Ground")) return 1;
    let value = effectiveness(gen, move, type, isGhostRevealed, isGravity, isRingTarget);
    if (type !== marks.first) return value;
    if (marks.added) value *= effectiveness(gen, move, marks.added, isGhostRevealed, isGravity, isRingTarget);
    if (marks.tarShot && move.hasType("Fire") && !(neutral && neutral.neutral)) value *= 2;
    return value;
  };
  turnEffectiveness.corrected = effectiveness.corrected;
  turnEffectiveness.state = neutral;
  util.getMoveEffectiveness = turnEffectiveness;

  const grounded = util.isGrounded;
  util.isGrounded = (pokemon, field) => {
    const marks = marksOf(pokemon);
    // A priority move into the user's own ally: Psychic Terrain's block does not reach it (calculate.ts, conditions.allyTarget).
    if (marks && marks.ungrounded) return false;
    if (marks && marks.grounding === "pinned") return true;
    if (marks && marks.grounding === "floating") return !!field.isGravity || pokemon.hasItem("Iron Ball");
    return grounded(pokemon, field);
  };

  const checkItem = util.checkItem;
  util.checkItem = (pokemon, magicRoomActive) => {
    checkItem(pokemon, magicRoomActive);
    const marks = marksOf(pokemon);
    if (marks && marks.itemSuppressed && pokemon.item) {
      pokemon.disabledItem = pokemon.item;
      pokemon.item = "";
    }
  };

  const chain = util.chainMods;
  const turnChain = (mods, lowerBound, upperBound) => {
    if (lowerBound === 41 && upperBound === 131072 && (turn.final || turn.firstFinal)) {
      const first = turn.finalCalls++ === 0 && turn.firstFinal ? turn.firstFinal : [];
      return chain([...mods, ...(turn.final || []), ...first], lowerBound, upperBound);
    }
    return chain(mods, lowerBound, upperBound);
  };
  // The partner power state (withPowerMods) and the 5324 correction stay reachable through the wrapper.
  turnChain.corrected = chain.corrected;
  turnChain.partnerPower = chain.partnerPower;
  util.chainMods = turnChain;

  // status2 (A2): a used Protean or Libero (calculate.ts engineMarks proteanSpent) adds no STAB of its own.
  const stabMod = util.getStabMod;
  util.getStabMod = (pokemon, move, desc) => {
    const marks = marksOf(pokemon);
    if (!marks || !marks.proteanSpent) return stabMod(pokemon, move, desc);
    const ability = pokemon.ability;
    pokemon.ability = "";
    try {
      return stabMod(pokemon, move, desc);
    } finally {
      pokemon.ability = ability;
    }
  };

  const countBoosts = util.countBoosts;
  util.countBoosts = (gen, boosts) => countBoosts(gen, boosts) + turn.extraBoosts;
}

/**
 * Runs `run` (one engine calculation) with the 2v2 turn's markers of its defender and the move (see above), and returns its
 * result. `marks`: { defender?: { first, added?, tarShot?, miracleEye?, pinned? }, final?: number[], firstFinal?: number[],
 * extraBoosts?: number }.
 * @template T
 * @param {{ defender?: { first?: string, added?: string, tarShot?: boolean, miracleEye?: boolean, pinned?: boolean } | null, final?: number[] | null, firstFinal?: number[] | null, extraBoosts?: number }} marks
 * @param {() => T} run
 * @returns {T}
 */
exports.withTurnMarks = (marks, run) => {
  const turn = util[TURN_STATE];
  const before = { defender: turn.defender, final: turn.final, firstFinal: turn.firstFinal, finalCalls: turn.finalCalls, extraBoosts: turn.extraBoosts };
  turn.defender = marks.defender || null;
  turn.final = marks.final && marks.final.length ? marks.final : null;
  turn.firstFinal = marks.firstFinal && marks.firstFinal.length ? marks.firstFinal : null;
  turn.finalCalls = 0;
  turn.extraBoosts = marks.extraBoosts || 0;
  try {
    return run();
  } finally {
    Object.assign(turn, before);
  }
};

