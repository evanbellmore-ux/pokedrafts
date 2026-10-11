# Integration 1a: tests/source/status2-hooks.test.ts. The removed guard rows (A2's ateRedirectGuard, E1's copierEndOfTurn, the
# L branch's beforeFieldMove, H's skyDrop: lint1.py, h2.py) and the new call sites (A1's conditions, outcomeMon, trapAfterHit;
# A2's conditions, outcomeVolatiles; A3's Teatime, room end, sports and rooms; D's encoreRewrites; H's beforeMove, skyDropHit,
# fainted; S's faceOnce; W's continueHits, context, hitCounts, userLosses).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "tests/source/status2-hooks.test.ts"
apply([
 (F, '''  ["doubles-typing.ts", "ateRedirectGuard", "doubles-status.ts", "targetsOf", "typingHooks.ateRedirectGuard("],\n''', "", "A2: ateRedirectGuard's call went (P2)"),
 (F, '''  ["doubles-guards.ts", "copierEndOfTurn", "doubles-eot.ts", "afterChecks", "guardHooks.copierEndOfTurn("],\n''', "", "E1: copierEndOfTurn's call went (the copies at order 29)"),
 (F, '''  ["doubles-faces.ts", "faceHit", ["kernel.healStandIn(", "withSpecies("]],''', '''  // S: faceHit dispatches; faceOnce holds the face's hit with both calls in order.
  ["doubles-faces.ts", "faceOnce", ["kernel.healStandIn(", "withSpecies("]],''', "S: faceOnce"),
 (F, '''  ["doubles-eot.ts", "afterChecks", ["guardHooks.copierEndOfTurn(", "guardHooks.symbiosisEndOfTurn("]],''', '''  ["doubles-eot.ts", "afterChecks", ["guardHooks.symbiosisEndOfTurn("]],''', "E1: afterChecks"),
 (F, '''  ["doubles-turn.ts", "execute", ["guardHooks.encoreRewrite(", "statusHooks.beforeMove("]],''', '''  // Integration 1a (D): every Encore rewrite runs as its own action (executeUsed: BeforeMove on).
  ["doubles-turn.ts", "execute", ["guardHooks.encoreRewrites(", "guardHooks.encoreRewrite(", "executeUsed("]],
  ["doubles-turn.ts", "executeUsed", ["statusHooks.beforeMove(", "runMove(ctx"]],''', "D: execute"),
 (F, '''  ["doubles-status.ts", "beforeMove", ["hook(guardHooks.beforeFirst)", "hook(historyHooks.beforeMoveStart)",''', '''  ["doubles-status.ts", "beforeMove", ["hook(guardHooks.beforeFirst)", "hook(hiddenHooks.beforeMove)", "hook(historyHooks.beforeMoveStart)",''', "H: BeforeMove priority 12"),
 (F, '''  ["doubles-turn.ts", "singleStep", ["statusHooks.singleHit(",''', '''  ["doubles-turn.ts", "singleStep", ["hiddenHooks.skyDropHit(", "statusHooks.singleHit(",''', "H: skyDropHit"),
 (F, '''  ["doubles-turn.ts", "faint", ["reactionHooks.allyFaint(", "fieldChangeHooks.stepField(", "presenceHooks.onFaint("]],''', '''  ["doubles-turn.ts", "faint", ["reactionHooks.allyFaint(", "fieldChangeHooks.stepField(", "presenceHooks.onFaint(", "hiddenHooks.fainted("]],''', "H: fainted"),
 (F, '''  ["doubles-turn.ts", "contextFor", ["pairHooks.assurance(", "presenceHooks.context(", "callingHooks.context("]],''', '''  ["doubles-turn.ts", "contextFor", ["pairHooks.assurance(", "pairHooks.context(", "presenceHooks.context(", "callingHooks.context("]],''', "W: context"),
 (F, '''  ["doubles-turn.ts", "applyStep", ["guardHooks.lockedBerryGuard(", "pairHooks.betweenHits(", "reactionHooks.unnerveRecoil(",''', '''  ["doubles-turn.ts", "applyStep", ["guardHooks.lockedBerryGuard(", "pairHooks.betweenHits(", "pairHooks.continueHits(", "reactionHooks.unnerveRecoil(",''', "W: continueHits"),
 (F, '''  ["doubles-faces.ts", "faceHit", "doubles-turn.ts", "singleStep", "faceHooks.faceHit("],''', '''  ["doubles-faces.ts", "faceHit", "doubles-turn.ts", "singleStep", "faceHooks.faceHit("],
  // Integration 1a's call sites (the hooks the kernel and the files the tracks share now call).
  ["doubles-abilities.ts", "conditions", "doubles-status.ts", "conditions", "abilityHooks.conditions("],
  ["doubles-abilities.ts", "outcomeMon", "doubles-turn.ts", "outcomeOf", "abilityHooks.outcomeMon("],
  ["doubles-abilities.ts", "trapAfterHit", "doubles-turn.ts", "afterHit", "abilityHooks.trapAfterHit("],
  ["doubles-typing.ts", "conditions", "doubles-turn.ts", "conditionFacts", "typingHooks.conditions("],
  ["doubles-typing.ts", "outcomeVolatiles", "doubles-turn.ts", "outcomeOf", "typingHooks.outcomeVolatiles("],
  ["doubles-typing.ts", "gravityGrounds", "doubles-field.ts", "fieldMove", "typingNs.gravityGrounds("],
  ["doubles-pairs.ts", "hitCounts", "doubles-turn.ts", "damagingMove", "pairHooks.hitCounts("],
  ["doubles-pairs.ts", "userLosses", "doubles-spread.ts", "spreadStep", "pairHooks.userLosses("],
  ["doubles-history.ts", "destinyBondPrepare", "doubles-status.ts", "earlyBranch", "historyHooks.destinyBondPrepare("],
  ["doubles-history.ts", "stallRaise", "doubles-status.ts", "earlyBranch", "historyHooks.stallRaise("],
  ["doubles-hidden.ts", "missesField", "doubles-field.ts", "teatime", "hiddenHooks.missesField("],
  ["doubles-presence.ts", "invulnerable", "doubles-field.ts", "teatime", "presenceHooks.invulnerable("],
  ["doubles-fieldchange.ts", "itemsAfterField", "doubles-field.ts", "roomEnd", "fieldChangeHooks.itemsAfterField("],
  ["doubles-fieldchange.ts", "pseudoWeatherChanged", "doubles-field.ts", "sport", "fieldChangeHooks.pseudoWeatherChanged("],
  ["doubles-fieldchange.ts", "pseudoWeatherChanged", "doubles-field.ts", "room", "fieldChangeHooks.pseudoWeatherChanged("],''', "integration 1a's MOVED-style rows"),
])
