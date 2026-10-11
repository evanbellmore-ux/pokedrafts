# Integration 1b: tests/source/status2-hooks.test.ts rows for the wave 1b integrator lines (ADDENDUM2 §8.6).
from patchlib import rep
F = "tests/source/status2-hooks.test.ts"
rep(F, """  ["doubles-start.ts", "variants", "doubles-turn.ts", "rootWorlds", "startHooks.variants("],
];""", """  ["doubles-start.ts", "variants", "doubles-turn.ts", "rootWorlds", "startHooks.variants("],
  // Integration 1b's call sites (the wave 1b tracks' integrator lines: W1B-*.md).
  ["doubles-start.ts", "turnFacts", "doubles-turn.ts", "turnFacts", "startHooks.turnFacts("],
  ["doubles-start.ts", "rowsByVariant", "doubles-turn.ts", "calculateDoublesTurn", "startHooks.rowsByVariant("],
  ["doubles-reactions.ts", "calcStandIns", "doubles-turn.ts", "searchFor", "reactionHooks.calcStandIns("],
  ["doubles-presence.ts", "stepReport", "doubles-turn.ts", "searchFor", "presenceHooks.stepReport("],
  ["doubles-presence.ts", "outcomeVolatiles", "doubles-turn.ts", "outcomeOf", "presenceHooks.outcomeVolatiles("],
  ["doubles-max.ts", "usedStatus", "doubles-turn.ts", "priorityOf", "maxHooks.usedStatus("],
  ["doubles-max.ts", "usedStatus", "doubles-turn.ts", "runMove", "maxHooks.usedStatus("],
  ["doubles-max.ts", "usedStatus", "doubles-status.ts", "beforeInfo", "maxHooks.usedStatus("],
  ["doubles-max.ts", "maxGuardAction", "doubles-turn.ts", "carriedState", "maxHooks.maxGuardAction("],
  ["doubles-max.ts", "maxGuardAction", "doubles-turn.ts", "turnFacts", "maxHooks.maxGuardAction("],
  ["doubles-max.ts", "passesMaxGuard", "doubles-turn.ts", "hitChecks", "maxHooks.passesMaxGuard("],
  ["doubles-max.ts", "maxGuardBlocks", "doubles-status.ts", "tryHit", "maxHooks.maxGuardBlocks("],
  ["doubles-max.ts", "painSplitHP", "doubles-status.ts", "painSplit", "maxHooks.painSplitHP("],
  ["doubles-max.ts", "conditions", "doubles-turn.ts", "conditionFacts", "maxHooks.conditions("],
  ["doubles-max.ts", "outcomeVolatiles", "doubles-turn.ts", "outcomeOf", "maxHooks.outcomeVolatiles("],
  ["doubles-calling.ts", "afterHit", "doubles-turn.ts", "afterHit", "callingHooks.afterHit("],
  ["doubles-calling.ts", "uproarSleep", "doubles-status.ts", "canStatus", "callingHooks.uproarSleep("],
  ["doubles-calling.ts", "ownsLastMove", "doubles-turn.ts", "noteHistory", "callingHooks.ownsLastMove("],
  ["doubles-fieldchange.ts", "fainted", "doubles-turn.ts", "faint", "fieldChangeHooks.fainted("],
  ["doubles-fieldchange.ts", "stepEnv", "doubles-turn.ts", "searchFor", "fieldChangeHooks.stepEnv("],
  ["doubles-fieldchange.ts", "stepField", "doubles-turn.ts", "applyStep", "fieldChangeHooks.stepField("],
];""", "MOVED rows")
rep(F, """  ["doubles-turn.ts", "searchFor", ["guardHooks.hiddenStageGuard(", "healStandIn(", "guardHooks.stepReport(", "reactionHooks.stepEnv(", "pairHooks.stepEnv("]],""",
 """  ["doubles-turn.ts", "searchFor", ["guardHooks.hiddenStageGuard(", "reactionHooks.calcStandIns(", "healStandIn(", "presenceHooks.stepReport(", "guardHooks.stepReport(", "reactionHooks.stepEnv(", "pairHooks.stepEnv(", "fieldChangeHooks.stepEnv("]],""", "searchFor CALLS")
rep(F, """  ["doubles-turn.ts", "faint", ["reactionHooks.allyFaint(", "fieldChangeHooks.stepField(", "presenceHooks.onFaint(", "hiddenHooks.fainted("]],""",
 """  ["doubles-turn.ts", "faint", ["reactionHooks.allyFaint(", "fieldChangeHooks.fainted(", "fieldChangeHooks.stepField(", "presenceHooks.onFaint(", "hiddenHooks.fainted("]],""", "faint CALLS")
rep(F, """  ["doubles-turn.ts", "applyStep", ["guardHooks.lockedBerryGuard(", "pairHooks.betweenHits(", "pairHooks.continueHits(", "reactionHooks.unnerveRecoil(", "stepItems(", "reactionHooks.veil(", "hitReactions(",""",
 """  ["doubles-turn.ts", "applyStep", ["guardHooks.lockedBerryGuard(", "pairHooks.betweenHits(", "pairHooks.continueHits(", "reactionHooks.unnerveRecoil(", "stepItems(", "fieldChangeHooks.stepField(", "reactionHooks.veil(", "hitReactions(",""", "applyStep CALLS")
rep(F, """    "guardHooks.glaiveRushAfter(", "flinchCheck(", "statusHooks.afterHit(", "reactionHooks.volatileSecondary(", "typingHooks.psychicNoiseGuard(", "eotHooks.afterHit(",
    "guardHooks.flingAfter(", "presenceHooks.afterHit("]],""", """    "guardHooks.glaiveRushAfter(", "flinchCheck(", "statusHooks.afterHit(", "reactionHooks.volatileSecondary(", "typingHooks.psychicNoiseGuard(", "eotHooks.afterHit(",
    "guardHooks.flingAfter(", "presenceHooks.afterHit(", "callingHooks.afterHit("]],""", "afterHit CALLS")
