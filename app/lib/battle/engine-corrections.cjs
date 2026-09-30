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
if (!util.chainMods.corrected) {
  const original = util.chainMods;
  const corrected = (mods, lowerBound, upperBound) =>
    original(lowerBound === 410 && mods.includes(5324) ? mods.map((mod) => mod === 5324 ? 5325 : mod) : mods, lowerBound, upperBound);
  corrected.corrected = true;
  util.chainMods = corrected;
}
