# Integration 1b: a tagged target whose reaction cannot act is a plain reference (the census turns a first version made narrow:
# Rock Slide into a Mirror Armor holder it drops nothing on and a Spicy Spray holder; Heat Wave into a Cramorant not Gulping).
from patchlib import rep
K = "doubles-reactions.ts"
rep(K, """  // status2 integration 1b: Mirror Armor's reflected drop (an onTryBoost, not a DamagingHit: no USER_REACTIONS row) is tagged too.
  const reaction = STATE_REACTIONS.has(was.abilityId) || was.abilityId === "mirrorarmor" ? was.abilityId : STATE_REACTIONS.has(was.itemId) ? was.itemId : null;""",
 """  // status2 integration 1b: Mirror Armor's reflected drop (an onTryBoost, not a DamagingHit: no USER_REACTIONS row) is tagged too;
  // Gulp Missile only where it hits back (a Gulping or Gorging Cramorant: hit-loop.ts gulpingTarget).
  const gulpless = was.abilityId === "gulpmissile" && !gulpingTarget({ speciesId: was.speciesId, abilityId: was.abilityId, transformed: !!was.transformedFrom });
  const reaction = (STATE_REACTIONS.has(was.abilityId) && !gulpless) || was.abilityId === "mirrorarmor" ? was.abilityId : STATE_REACTIONS.has(was.itemId) ? was.itemId : null;""", "veil gulp")
rep(K, 'import { berryUnnerved, HEALING_BERRIES, LANSAT_STARF, ownMoveId, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";',
 'import { berryUnnerved, gulpingTarget, HEALING_BERRIES, LANSAT_STARF, ownMoveId, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";', "import gulpingTarget")
rep(K, """  const entries = states.map((text) => entryOf(text, pre));""", """  // A Mirror Armor holder the move drops nothing on (no certain drop: stageReaction null) is a target with no reaction.
  const entries = states.map((text) => entryOf(text, pre)).map((entry) => (entry.reaction === "mirrorarmor" && !stageReaction(kernel, world, action, info, entry) ? { ...entry, reaction: null } : entry));""", "mirror armor plain")
