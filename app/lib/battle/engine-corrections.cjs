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
