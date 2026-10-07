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
