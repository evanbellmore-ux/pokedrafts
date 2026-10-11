# Integration 1a: a terrain, Gravity or Magic Room the input says ends this turn (fieldTurns 1: NU's "... ends this turn"
# controls) is wave 1b's (E2: T2E-FS, IN-FLD); until then the end of turn is not estimated rather than keeping the effect up.
# And roomFact's White Herb reads the accuracy and evasion stages too (E1's White Herb restores them at 29).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-eot.ts", '''  const e2 = kernel.mode === "all" && !kernel.recording;
  for (const w of worlds) {
    const reason = worldGuard(kernel, w, gmax, e2);''', '''  const e2 = kernel.mode === "all" && !kernel.recording;
  // status2 (integration 1a): an effect from before the turn that ends at this end of turn (fieldTurns 1) is wave 1b's (E2).
  const ends = kernel.input.fieldTurns ?? {};
  const field = kernel.input.field;
  for (const w of worlds) {
    const ending = ends.terrain === 1 && field.terrain && w.field.terrain === field.terrain ? `${field.terrain} Terrain`
      : ends.gravity === 1 && w.field.gravity ? kernel.moveName("gravity") : ends.magicRoom === 1 && w.field.magicRoom ? kernel.moveName("magicroom") : null;
    if (ending) masses.set(REASONS.notIn2v2(`${ending} ending`), (masses.get(REASONS.notIn2v2(`${ending} ending`)) ?? 0) + w.mass);
  }
  for (const w of worlds) {
    const reason = worldGuard(kernel, w, gmax, e2);''', "E2's field ends: not estimated in 1a"),
 ("doubles-eot.ts", '''  if (item === "whiteherb") return STATS.some((stat) => (build.boosts[stat] ?? 0) < 0);''', '''  if (item === "whiteherb") return STATS.some((stat) => (build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);''', "roomFact: White Herb with a lowered accuracy or evasion stage"),
])
