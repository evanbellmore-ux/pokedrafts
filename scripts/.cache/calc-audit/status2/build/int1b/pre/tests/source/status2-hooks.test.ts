import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * status2 Step 0a's hook map (scripts/.cache/calc-audit/status2/design SPEC2.md §3.5, ADDENDUM2.md §3.5, §9 "Step 0";
 * scripts/.cache/calc-audit/status2/build/STEP0A.md): every moved guard keeps a call site (until its track removes it),
 * every hook is called where §3.5 says, presenceGuards' lines keep today's order, every DoublesCarried key is mapped by
 * carriedState and checked by the input issues, the hook modules import the kernel's type only (no cycle), residualHit is
 * called from doubles-eot.ts alone, and kernel.useCalled is the only calling path. A track that removes a guard or moves a
 * call updates its row here in the same change.
 */
const DIR = fileURLToPath(new URL("../../app/lib/battle/", import.meta.url));
const APP = fileURLToPath(new URL("../../app/", import.meta.url));
const read = (file: string) => readFileSync(join(DIR, file), "utf8").replace(/\r\n/g, "\n");

/** A top-level function's text (from its `function name(` line to the next line that is a lone `}`). */
function body(file: string, name: string): string {
  const source = read(file);
  const start = source.search(new RegExp(`^(?:export )?function ${name}[<(]`, "m"));
  if (start < 0) throw new Error(`${file}: no function ${name}`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end < 0 ? undefined : end);
}
/** The calls appear in `name`'s body, in this order. */
function inOrder(file: string, name: string, calls: string[]) {
  const text = body(file, name);
  let at = -1;
  for (const call of calls) {
    const next = text.indexOf(call, at + 1);
    expect(next, `${file} ${name}: ${call} after ${calls[calls.indexOf(call) - 1] ?? "the start"}`).toBeGreaterThan(at);
    at = next;
  }
}

// ---- Each moved guard and helper: its owner exports it and its old site calls it (SPEC2 §3.5, ADDENDUM2 §3.5) ----
const MOVED: [owner: string, fn: string, caller: string, callerFn: string, call: string][] = [
  ["doubles-stages.ts", "applyBoosts", "doubles-status.ts", "effects", "applyBoosts(kernel"],
  ["doubles-stages.ts", "selfBoost", "doubles-turn.ts", "makeKernel", "stageHooks.selfBoost(kernel"],
  ["doubles-stages.ts", "foeDrop", "doubles-turn.ts", "makeKernel", "stageHooks.foeDrop(kernel"],
  ["doubles-stages.ts", "whiteHerbAfterMove", "doubles-stages.ts", "applyBoosts", "whiteHerbAfterMove("],
  ["doubles-typing.ts", "proteanGuard", "doubles-status.ts", "earlyBranch", "typingHooks.proteanGuard("],
  ["doubles-typing.ts", "roost", "doubles-status.ts", "effects", "typingHooks.roost("],
  ["doubles-typing.ts", "ingrainGuard", "doubles-status.ts", "volatile", "typingHooks.ingrainGuard("],
  ["doubles-typing.ts", "magnetRiseGuard", "doubles-status.ts", "volatile", "typingHooks.magnetRiseGuard("],
  ["doubles-typing.ts", "groundingAfterHit", "doubles-turn.ts", "afterHit", "typingHooks.groundingAfterHit("],
  ["doubles-typing.ts", "afterHit", "doubles-turn.ts", "afterHit", "typingHooks.afterHit("],
  ["doubles-typing.ts", "psychicNoiseKeepsBerry", "doubles-turn.ts", "singleStep", "typingHooks.psychicNoiseKeepsBerry("],
  ["doubles-typing.ts", "psychicNoiseGuard", "doubles-turn.ts", "afterHit", "typingHooks.psychicNoiseGuard("],
  ["doubles-field.ts", "fieldMove", "doubles-status.ts", "earlyBranch", "fieldHooks.fieldMove("],
  ["doubles-fieldchange.ts", "beforeFieldMove", "doubles-field.ts", "fieldMove", "fieldChangeHooks.beforeFieldMove("],
  ["doubles-fieldchange.ts", "eotField", "doubles-eot.ts", "resolveFaints", "fieldChangeHooks.eotField("],
  ["doubles-fieldchange.ts", "eotField", "doubles-eot.ts", "weatherHandler", "fieldChangeHooks.eotField("],
  ["doubles-guards.ts", "copierGuard", "doubles-turn.ts", "eventGuards", "guardHooks.copierGuard("],
  ["doubles-guards.ts", "symbiosisAfterAction", "doubles-turn.ts", "eventGuards", "guardHooks.symbiosisAfterAction("],
  ["doubles-guards.ts", "symbiosisReceived", "doubles-items.ts", "receive", "guardHooks.symbiosisReceived("],
  ["doubles-guards.ts", "symbiosisEndOfTurn", "doubles-eot.ts", "afterChecks", "guardHooks.symbiosisEndOfTurn("],
  ["doubles-guards.ts", "lockedBerryGuard", "doubles-turn.ts", "applyStep", "guardHooks.lockedBerryGuard("],
  ["doubles-guards.ts", "hiddenStageGuard", "doubles-turn.ts", "searchFor", "guardHooks.hiddenStageGuard("],
  ["doubles-guards.ts", "ripenGuard", "doubles-turn.ts", "stolenFacts", "guardHooks.ripenGuard("],
  ["doubles-guards.ts", "glaiveRushAfter", "doubles-turn.ts", "afterHit", "guardHooks.glaiveRushAfter("],
  ["doubles-guards.ts", "encoreGuard", "doubles-status.ts", "lastMoveVolatile", "guardHooks.encoreGuard("],
  ["doubles-spread.ts", "spreadStep", "doubles-turn.ts", "damagingMove", "spreadHooks.spreadStep("],
  ["doubles-switch.ts", "switchOut", "doubles-turn.ts", "eventGuards", "switchHooks.switchOut("],
  ["doubles-switch.ts", "switchOut", "doubles-turn.ts", "hitReactions", "switchHooks.switchOut("],
  ["doubles-switch.ts", "switchOut", "doubles-turn.ts", "afterHit", "switchHooks.switchOut("],
  ["doubles-switch.ts", "switchOut", "doubles-status.ts", "switchOut", "switchHooks.switchOut("],
  ["doubles-switch.ts", "switchOut", "doubles-eot.ts", "ejectPack", "switchHooks.switchOut("],
  ["doubles-hidden.ts", "chargeHidden", "doubles-turn.ts", "chargeTurn", "hiddenHooks.chargeHidden("],
  ["doubles-hidden.ts", "carriedStart", "doubles-turn.ts", "presenceGuards", "hiddenHooks.carriedStart("],
  ["doubles-reactions.ts", "afterKnockOut", "doubles-turn.ts", "afterHit", "reactionHooks.afterKnockOut("],
  ["doubles-reactions.ts", "koRetaliationAfter", "doubles-turn.ts", "afterHit", "reactionHooks.koRetaliationAfter("],
  ["doubles-reactions.ts", "allyFaint", "doubles-turn.ts", "faint", "reactionHooks.allyFaint("],
  ["doubles-reactions.ts", "cottonDown", "doubles-turn.ts", "hitReactions", "reactionHooks.cottonDown("],
  ["doubles-reactions.ts", "veil", "doubles-turn.ts", "applyStep", "reactionHooks.veil("],
  ["doubles-reactions.ts", "unnerveRecoil", "doubles-turn.ts", "applyStep", "reactionHooks.unnerveRecoil("],
  ["doubles-reactions.ts", "unnerveStand", "doubles-turn.ts", "singleStep", "reactionHooks.unnerveStand("],
  ["doubles-reactions.ts", "resistUnnerve", "doubles-turn.ts", "pairRows", "reactionHooks.resistUnnerve("],
  ["doubles-reactions.ts", "volatileSecondary", "doubles-turn.ts", "afterHit", "reactionHooks.volatileSecondary("],
  ["doubles-reactions.ts", "contactKO", "doubles-spread.ts", "spreadStep", "reactionHooks.contactKO("],
  ["doubles-reactions.ts", "spreadUser", "doubles-spread.ts", "spreadStep", "reactionHooks.spreadUser("],
  ["doubles-pairs.ts", "focusBand", "doubles-turn.ts", "singleStep", "pairHooks.focusBand("],
  ["doubles-pairs.ts", "selfHitBand", "doubles-status.ts", "confusionHit", "pairHooks.selfHitBand("],
  ["doubles-pairs.ts", "betweenHits", "doubles-turn.ts", "applyStep", "pairHooks.betweenHits("],
  ["doubles-pairs.ts", "allyShield", "doubles-turn.ts", "moveFailure", "pairHooks.allyShield("],
  ["doubles-pairs.ts", "frozenPriority", "doubles-turn.ts", "damagingMove", "pairHooks.frozenPriority("],
  ["doubles-pairs.ts", "assurance", "doubles-turn.ts", "contextFor", "pairHooks.assurance("],
  ["doubles-pairs.ts", "ariaFaint", "doubles-turn.ts", "sparklingAria", "pairHooks.ariaFaint("],
  ["doubles-pairs.ts", "safeguard", "doubles-status.ts", "afterHit", "pairHooks.safeguard("],
  ["doubles-faces.ts", "faceTaken", "doubles-turn.ts", "singleStep", "faceHooks.faceTaken("],
  ["doubles-faces.ts", "faceHit", "doubles-turn.ts", "singleStep", "faceHooks.faceHit("],
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
  ["doubles-fieldchange.ts", "pseudoWeatherChanged", "doubles-field.ts", "room", "fieldChangeHooks.pseudoWeatherChanged("],
  ["doubles-faces.ts", "multiHit", "doubles-turn.ts", "rowReason", "faceHooks.multiHit("],
  ["doubles-faces.ts", "selfHit", "doubles-status.ts", "confusionHit", "faceHooks.selfHit("],
  ["doubles-max.ts", "maxEffects", "doubles-turn.ts", "singleStep", "maxHooks.maxEffects("],
  ["doubles-max.ts", "statusMove", "doubles-turn.ts", "presenceGuards", "maxHooks.statusMove("],
  ["doubles-max.ts", "randomStatusGuard", "doubles-turn.ts", "presenceGuards", "maxHooks.randomStatusGuard("],
  ["doubles-max.ts", "painSplitMax", "doubles-status.ts", "painSplit", "maxHooks.painSplitMax("],
  ["doubles-presence.ts", "commanderGuard", "doubles-turn.ts", "presenceGuards", "presenceHooks.commanderGuard("],
  ["doubles-presence.ts", "thirdPartyGuard", "doubles-turn.ts", "presenceGuards", "presenceHooks.thirdPartyGuard("],
  ["doubles-presence.ts", "dancerGuard", "doubles-turn.ts", "presenceGuards", "presenceHooks.dancerGuard("],
  ["doubles-presence.ts", "movesGuard", "doubles-turn.ts", "presenceGuards", "presenceHooks.movesGuard("],
  ["doubles-presence.ts", "pledgeGuard", "doubles-turn.ts", "presenceGuards", "presenceHooks.pledgeGuard("],
  ["doubles-calling.ts", "callingGuard", "doubles-turn.ts", "presenceGuards", "callingHooks.callingGuard("],
  ["doubles-calling.ts", "presence", "doubles-status.ts", "presenceGuards", "callingHooks.presence("],
  ["doubles-calling.ts", "statusMove", "doubles-status.ts", "statusMove", "callingHooks.statusMove("],
  ["doubles-calling.ts", "helpingHand", "doubles-status.ts", "earlyBranch", "callingHooks.helpingHand("],
  // Step 0b.3: the settle's move into doubles-start.ts, with its two hooks.
  ["doubles-start.ts", "settleDoublesStart", "doubles-turn.ts", "settleOf", "settleDoublesStart("],
  ["doubles-start.ts", "custapGuard", "doubles-turn.ts", "presenceGuards", "startHooks.custapGuard("],
  ["doubles-start.ts", "variants", "doubles-turn.ts", "rootWorlds", "startHooks.variants("],
];

// ---- The hook calls Step 0a inserts (SPEC2 §3.5's table, ADDENDUM2 §3.5's lists), each at its site ----
const CALLS: [file: string, fn: string, calls: string[]][] = [
  ["doubles-status.ts", "beforeMove", ["hook(guardHooks.beforeFirst)", "hook(hiddenHooks.beforeMove)", "hook(historyHooks.beforeMoveStart)", "sleepCheck(", "confusionCheck(", "hook(typingHooks.beforeAttract)",
    "paralysisCheck(", "historyHooks.destinyBondBefore(", "focusCheck(", "historyHooks.destinyBondBefore("]],
  ["doubles-status.ts", "statusType", ["typingHooks.retypeStatus("]],
  ["doubles-status.ts", "statusMove", ["presenceHooks.statusMove(", "callingHooks.statusMove("]],
  ["doubles-status.ts", "earlyBranch", ["historyHooks.stallPrepare(", "fieldHooks.snatch(", "callingHooks.helpingHand(", "fieldHooks.fieldMove("]],
  ["doubles-status.ts", "prepareHit", ["fieldHooks.snatch("]],
  ["doubles-status.ts", "sideOrField", ["fieldHooks.snatch(", "familyHandler(use)"]],
  ["doubles-status.ts", "runUse", ["kernel.priorityShield(", "typingHooks.powderTryMove("]],
  ["doubles-status.ts", "tryHit", ["presenceHooks.invulnerable(", "hiddenHooks.missesStatus(", "fieldHooks.tryHitSide("]],
  ["doubles-status.ts", "moveTry", ["familyHandler(use)"]],
  ["doubles-status.ts", "tryImmunity", ["familyHandler(use)"]],
  ["doubles-status.ts", "hitOne", ["familyHandler(use)"]],
  ["doubles-status.ts", "volatile", ["familyHandler(use)"]],
  ["doubles-status.ts", "onHit", ["familyHandler(use)"]],
  ["doubles-status.ts", "updateAll", ["abilityHooks.updateCures("]],
  ["doubles-status.ts", "updateAll", ["kernel.noteItemUse("]],
  ["doubles-status.ts", "order", ["kernel.prioritize("]],
  ["doubles-status.ts", "setStatus", ["presenceHooks.afterSetStatus("]],
  ["doubles-status.ts", "stanceChange", ["withSpecies("]],
  ["doubles-status.ts", "runCalledStatus", ["makeUse(", "runUse(", "updateAll("]],
  ["doubles-stages.ts", "applyBoosts", ["fieldHooks.mistBlocks(", "guardHooks.noteRise("]],
  ["doubles-stages.ts", "whiteHerbAfterMove", ["kernel.noteItemUse("]],
  ["doubles-field.ts", "fieldMove", ["fieldChangeHooks.beforeFieldMove(", "fieldChangeHooks.afterFieldMove(", "hiddenHooks.land("]],
  ["doubles-spread.ts", "spreadStep", ["reactionHooks.contactKO(", "substituteHooks.plan(", "reactionHooks.beforeStep(", "guardHooks.ohkoStep(", "kernel.searchFor(", "reactionHooks.spreadUser(", "kernel.healStandIn("]],
  // S: faceHit dispatches; faceOnce holds the face's hit with both calls in order.
  ["doubles-faces.ts", "faceOnce", ["kernel.healStandIn(", "withSpecies("]],
  ["doubles-eot.ts", "afterChecks", ["guardHooks.symbiosisEndOfTurn("]],
  ["doubles-eot.ts", "hungerSwitch", ["withSpecies("]],
  ["doubles-eot.ts", "residualMon", ["sheltered("]],
  ["doubles-eot.ts", "loseItem", ["kernel.noteItemUse("]],
  ["doubles-items.ts", "receive", ["guardHooks.symbiosisReceived(", "kernel.noteItemUse("]],
  ["doubles-turn.ts", "makeKernel", ["guardHooks.lockedBerryGuard(kernel", "faceHooks.faceTaken(kernel", "faceHooks.faceHit(kernel", "pairHooks.focusBand(kernel",
    "reactionHooks.unnerveStand(kernel", "maxHooks.maxEffects(kernel", "stageHooks.selfBoost(kernel", "stageHooks.foeDrop(kernel", "stageHooks.applyBoosts(kernel"]],
  ["doubles-turn.ts", "calcBuild", ["turnMarks("]],
  ["doubles-turn.ts", "searchFor", ["guardHooks.hiddenStageGuard(", "healStandIn(", "guardHooks.stepReport(", "reactionHooks.stepEnv(", "pairHooks.stepEnv("]],
  ["doubles-turn.ts", "rootWorlds", ["startHooks.variants(", "rootWorldsOf("]],
  ["doubles-turn.ts", "rootWorldsOf", ["historyHooks.proteanUsed(", "presenceHooks.rootActions("]],
  ["doubles-turn.ts", "walk", ["statusHooks.turnStartUpdate(", "presenceHooks.turnStart("]],
  // Integration 1a (D): every Encore rewrite runs as its own action (executeUsed: BeforeMove on).
  ["doubles-turn.ts", "execute", ["guardHooks.encoreRewrites(", "guardHooks.encoreRewrite(", "executeUsed("]],
  ["doubles-turn.ts", "executeUsed", ["statusHooks.beforeMove(", "runMove(ctx"]],
  ["doubles-turn.ts", "runMove", ["hiddenHooks.release(", "abilityHooks.afterMove(", "guardHooks.afterMoveCopies(", "eventGuards(ctx", "presenceHooks.afterAction("]],
  ["doubles-turn.ts", "sparklingAria", ["pairHooks.ariaFaint("]],
  ["doubles-turn.ts", "eventGuards", ["guardHooks.copierGuard(", "guardHooks.symbiosisAfterAction(", "switchHooks.switchOut("]],
  ["doubles-turn.ts", "faint", ["reactionHooks.allyFaint(", "fieldChangeHooks.stepField(", "presenceHooks.onFaint(", "hiddenHooks.fainted("]],
  ["doubles-turn.ts", "redirect", ["historyHooks.entryTie("]],
  ["doubles-turn.ts", "contextFor", ["pairHooks.assurance(", "pairHooks.context(", "presenceHooks.context(", "callingHooks.context("]],
  ["doubles-turn.ts", "hitChecks", ["presenceHooks.invulnerable(", "hiddenHooks.misses(", "side.wideGuard", "side.matBlock"]],
  ["doubles-turn.ts", "damagingMove", ["typingHooks.comboGuard(", "abilityHooks.damagingTry(", "presenceHooks.aim(", "pairHooks.frozenPriority(", "moveFailure(ctx",
    "statusHooks.tryMove(", "presenceHooks.tryMove(", "guardHooks.flingTry(", "historyHooks.moveTry(", "typingHooks.powderTryMove(", "presenceHooks.prepareHit(",
    "proteanGuard(ctx", "hitChecks(ctx", "spreadHooks.spreadStep(", "struggleRecoil(", "hiddenHooks.crash("]],
  ["doubles-turn.ts", "chargesThisTurn", ["vol.locked === move.id"]],
  ["doubles-turn.ts", "chargeTurn", ["hiddenHooks.chargeHidden("]],
  ["doubles-turn.ts", "moveFailure", ["pairHooks.allyShield("]],
  ["doubles-turn.ts", "singleStep", ["hiddenHooks.skyDropHit(", "statusHooks.singleHit(", "reactionHooks.beforeStep(", "substituteHooks.single(", "guardHooks.ohkoStep(", "typingHooks.psychicNoiseKeepsBerry(",
    "searchFor(ctx", "faceHooks.faceTaken(", "faceHooks.faceHit(", "pairHooks.focusBand(", "reactionHooks.unnerveStand(", "applyStep(ctx", "maxHooks.maxEffects("]],
  ["doubles-turn.ts", "applyStep", ["guardHooks.lockedBerryGuard(", "pairHooks.betweenHits(", "pairHooks.continueHits(", "reactionHooks.unnerveRecoil(", "stepItems(", "reactionHooks.veil(", "hitReactions(",
    "pairHooks.hurt(", "residualReactions(", "afterHit("]],
  ["doubles-turn.ts", "hitReactions", ["reactionHooks.cottonDown(", "statusHooks.onKnockOut(", "switchHooks.switchOut(kernel, w, target", "switchHooks.switchOut(kernel, w, attacker"]],
  ["doubles-turn.ts", "afterHit", ["reactionHooks.afterKnockOut(", "typingHooks.groundingAfterHit(", "reactionHooks.koRetaliationAfter(", "\"selfswitch\"", "\"drag\"", "typingHooks.afterHit(",
    "guardHooks.glaiveRushAfter(", "flinchCheck(", "statusHooks.afterHit(", "reactionHooks.volatileSecondary(", "typingHooks.psychicNoiseGuard(", "eotHooks.afterHit(",
    "guardHooks.flingAfter(", "presenceHooks.afterHit("]],
  ["doubles-turn.ts", "flinchCheck", ["w.remaining.some("]],
  ["doubles-turn.ts", "dartsStep", ["faceHooks.faceTaken(", "spreadHooks.spreadStep("]],
  ["doubles-turn.ts", "ateBerry", ["noteItemUse("]],
  ["doubles-turn.ts", "createContext", ["readersOf(", "inEndOfTurn: false"]],
  ["doubles-turn.ts", "readersOf", ["guardHooks.tracksItems(", "entryReaders(", "historyReaders("]],
  ["doubles-turn.ts", "endOfTurnOf", ["ctx.inEndOfTurn = kernel.inEndOfTurn = true", "eotHooks.endOfTurn(", "ctx.inEndOfTurn = kernel.inEndOfTurn = false"]],
  ["doubles-turn.ts", "useCalled", ["statusHooks.runCalledStatus(", "damagingMove(ctx"]],
  ["doubles-turn.ts", "externalUse", ["statusHooks.beforeMove(", "runMove(ctx"]],
];

// presenceGuards keeps its loop and its order (C27): each of today's lines now calls its owner's hook in place.
const PRESENCE_ORDER = [
  "presenceHooks.commanderGuard(", "ABILITY_REPLACERS.has(", "presenceHooks.thirdPartyGuard(", "hiddenHooks.carriedStart(", "presenceHooks.dancerGuard(",
  "statusHooks.presenceGuards(", "presenceHooks.movesGuard(", "callingHooks.callingGuard(", "presenceHooks.pledgeGuard(",
  "maxHooks.statusMove(", "startHooks.custapGuard(", "maxHooks.randomStatusGuard(",
];

// The code that left the kernel and doubles-status.ts (each now its owner's).
const GONE: [file: string, fn: string][] = [
  ["doubles-turn.ts", "focusBandGuard"], ["doubles-turn.ts", "veilGuard"], ["doubles-turn.ts", "volatileGuard"], ["doubles-turn.ts", "spreadStep"],
  ["doubles-turn.ts", "faceTaken"], ["doubles-turn.ts", "faceHit"], ["doubles-turn.ts", "faceProbe"], ["doubles-turn.ts", "neutralRow"], ["doubles-turn.ts", "maxEffects"],
  ["doubles-turn.ts", "berryBetweenHitsGuard"], ["doubles-turn.ts", "lockedBerryGuard"], ["doubles-turn.ts", "psychicNoiseKeepsBerry"], ["doubles-turn.ts", "unnerveGuard"],
  ["doubles-turn.ts", "resistUnnerve"], ["doubles-turn.ts", "hiddenStageGuard"],
  ["doubles-status.ts", "applyBoosts"], ["doubles-status.ts", "selfBoost"], ["doubles-status.ts", "foeDrop"], ["doubles-status.ts", "fieldMove"], ["doubles-status.ts", "fieldGuard"],
  ["doubles-status.ts", "proteanGuard"], ["doubles-status.ts", "roost"],
  ["doubles-eot.ts", "fieldChangeGuard"],
];

/** The DoublesCarried keys with no impossible value to report (a flag any Pokémon in the turn may carry). */
const NO_ISSUE = new Set(["saltCure", "aquaRing", "ingrain", "curse", "yawn", "trapped"]);
/** The DoublesCarried keys carriedState leaves to their readers: PR reads the history counters from the input; Commander's pair is startWorld's. */
const READ_ELSEWHERE: Record<string, [string, string]> = {
  furyCutter: ["doubles-turn.ts", "carriedState"], rollout: ["doubles-turn.ts", "carriedState"], defenseCurl: ["doubles-turn.ts", "carriedState"],
  ppLeft: ["doubles-turn.ts", "carriedState"], commanding: ["doubles-turn.ts", "startWorld"],
};

const HOOK_MODULES = ["doubles-abilities.ts", "doubles-calling.ts", "doubles-faces.ts", "doubles-field.ts", "doubles-fieldchange.ts", "doubles-guards.ts", "doubles-hidden.ts",
  "doubles-history.ts", "doubles-max.ts", "doubles-pairs.ts", "doubles-presence.ts", "doubles-reactions.ts", "doubles-spread.ts", "doubles-stages.ts", "doubles-switch.ts",
  "doubles-typing.ts", "doubles-use.ts", "doubles-status.ts", "doubles-eot.ts", "doubles-positions.ts", "doubles-items.ts", "doubles-substitute.ts", "doubles-start.ts"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("status2 Step 0a: the hook map (SPEC2 §3.5, ADDENDUM2 §3.5)", () => {
  it("every moved guard is its owner's export and keeps its call site", () => {
    for (const [owner, fn, caller, callerFn, call] of MOVED) {
      expect(read(owner), `${owner} exports ${fn}`).toMatch(new RegExp(`^export function ${fn}[<(]`, "m"));
      expect(body(caller, callerFn), `${caller} ${callerFn} calls ${call}`).toContain(call);
    }
  });
  it("every hook is called where §3.5 says, in the pipeline's order", () => {
    for (const [file, fn, calls] of CALLS) inOrder(file, fn, calls);
  });
  it("presenceGuards keeps its lines in today's order", () => {
    inOrder("doubles-turn.ts", "presenceGuards", PRESENCE_ORDER);
  });
  it("the moved code is gone from its old file", () => {
    for (const [file, fn] of GONE) expect(read(file), `${file} still defines ${fn}`).not.toMatch(new RegExp(`^(?:export )?function ${fn}[<(]`, "m"));
  });
  it("every DoublesCarried key has a carriedState mapping and an input-issue branch", () => {
    const types = read("doubles-types.ts");
    const block = types.slice(types.indexOf("export type DoublesCarried = {"), types.indexOf("\n};", types.indexOf("export type DoublesCarried = {")));
    const keys = [...block.matchAll(/^ {2}(\w+)\?:/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(50);
    const mapped = body("doubles-turn.ts", "carriedState");
    const issues = body("doubles-turn.ts", "carriedIssues") + body("doubles-turn.ts", "status2Issues") + body("doubles-turn.ts", "carriedAction");
    for (const key of keys) {
      const elsewhere = READ_ELSEWHERE[key];
      if (elsewhere) expect(body(...elsewhere), `${key} named in ${elsewhere[1]}`).toContain(key);
      else expect(mapped, `carriedState maps carried.${key}`).toContain(`carried.${key}`);
      if (!NO_ISSUE.has(key)) expect(issues, `an input issue reads carried.${key}`).toContain(`carried.${key}`);
    }
  });
  it("the hook modules import the kernel's type only, and no runtime import makes a cycle", () => {
    const graph = new Map<string, string[]>();
    for (const file of readdirSync(DIR).filter((name) => name.endsWith(".ts"))) {
      const source = read(file);
      const runtime = [...source.matchAll(/^(?:import|export)\s+(?!type\b)([^;]*?)from\s+"\.\/([^"]+)"/gm)]
        .filter(([, clause]) => !/^\{[^}]*\}\s*$/.test(clause.trim()) || clause.split(",").some((part) => part.trim() && !part.trim().replace(/^\{\s*/, "").startsWith("type ")))
        .map(([, , target]) => (target.endsWith(".cjs") ? target : `${target}.ts`));
      graph.set(file, runtime);
    }
    for (const hookFile of HOOK_MODULES) expect(graph.get(hookFile) ?? [], `${hookFile} imports doubles-turn.ts at runtime`).not.toContain("doubles-turn.ts");
    const visiting = new Set<string>(), done = new Set<string>();
    const visit = (file: string, path: string[]) => {
      if (visiting.has(file)) throw new Error(`import cycle: ${[...path, file].join(" -> ")}`);
      if (done.has(file)) return;
      visiting.add(file);
      for (const next of graph.get(file) ?? []) if (graph.has(next)) visit(next, [...path, file]);
      visiting.delete(file);
      done.add(file);
    };
    for (const file of graph.keys()) visit(file, []);
  });
  it("residualHit is called only from doubles-eot.ts; kernel.useCalled is the only calling path", () => {
    for (const path of filesUnder(APP)) {
      const name = path.replace(/^.*[\\/]/, "");
      const source = readFileSync(path, "utf8");
      if (name !== "doubles-turn.ts" && name !== "doubles-eot.ts") expect(source, `${name} calls residualHit`).not.toMatch(/\.residualHit\(/);
      if (name !== "doubles-turn.ts" && name !== "doubles-status.ts") expect(source, `${name} calls runCalledStatus`).not.toMatch(/runCalledStatus\(/);
    }
    const turn = read("doubles-turn.ts");
    // runCalledStatus is called by useCalled alone; damagingMove by runMove and useCalled.
    expect([...turn.matchAll(/statusHooks\.runCalledStatus\(/g)].length).toBe(1);
    expect(body("doubles-turn.ts", "useCalled")).toContain("statusHooks.runCalledStatus(");
    expect([...turn.matchAll(/[^\w]damagingMove\(ctx,/g)].length).toBe(2);
    expect(body("doubles-turn.ts", "runMove")).toContain("damagingMove(ctx");
  });
});
