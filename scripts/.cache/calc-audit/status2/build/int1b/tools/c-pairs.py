# Integration 1b: doubles-pairs.ts's constant WIRED branches (INTEGRATION-1A §4 item 6): every flag has been true since
# integration 1a, so the flag and the fallbacks it kept go (REASONS.berryBetweenHits loses its last site).
from patchlib import rep
F = "doubles-pairs.ts"
rep(F, """/**
 * The kernel lines Track W asked the integrator for (W1A-W.md "Kernel lines"). Each part below keeps today's guard until its
 * lines are in; the integrator sets each flag with its lines at integration 1a (then the flag and the fallback it keeps can go).
 * - `continuation`: applyStep hands a use the target's Berry stopped between two hits to continueHits (L1); damagingMove
 *   takes a random hit count's worlds from hitCounts (L11), whose count the context hook gives the calculation (L4).
 * - `frozenContext`: contextFor takes W's context (L4): MoveContext.frozenPriority from frozenContext (generation 7's frozen
 *   priority, and Gale Wings at the user's HP in every generation).
 * - `faintedInHits`: the step reports a followed Sparkling Aria user's faint in the hits (L9, L10: uses-to-ko.ts; L3: applyStep's
 *   child key keeps it apart), and D's spreadStep takes its user's losses through userLosses.
 * - `attackerSafeguard`: the calculation reads the user's side's Safeguard against the target's Spicy Spray (L12: conditionsFor
 *   puts SideState.safeguard into the side conditions; F's calculate.ts spicySprayFirstBurnedHit reads attackerSide.safeguard).
 * - `hurt`, `selfHitBand`: hurt gets the step's target and the builds as it began (L2), selfHitBand the self-hit's loss
 *   distribution (L6-L8). Their code reads the arguments themselves; the two flags tell the tests the lines are in.
 */
export const WIRED = { continuation: true, frozenContext: true, faintedInHits: true, attackerSafeguard: true, hurt: true, selfHitBand: true };
""", """/*
 * The kernel lines Track W asked the integrator for (W1A-W.md "Kernel lines") are in since integration 1a (its WIRED flags and
 * the fallbacks they kept went at integration 1b):
 * - the continuation: applyStep hands a use the target's Berry stopped between two hits to continueHits (L1); damagingMove
 *   takes a random hit count's worlds from hitCounts (L11), whose count the context hook gives the calculation (L4);
 * - the frozen context: contextFor takes W's context (L4): MoveContext.frozenPriority from frozenContext (generation 7's
 *   frozen priority, and Gale Wings at the user's HP in every generation);
 * - faintedInHits: the step reports a followed Sparkling Aria user's faint in the hits (L9, L10: uses-to-ko.ts; L3: applyStep's
 *   child key keeps it apart), and D's spreadStep takes its user's losses through userLosses;
 * - the attacker's Safeguard: the calculation reads the user's side's Safeguard against the target's Spicy Spray (L12:
 *   conditionsFor puts SideState.safeguard into the side conditions; F's calculate.ts spicySprayFirstBurnedHit reads it);
 * - hurt gets the step's target and the builds as it began (L2), selfHitBand the self-hit's loss distribution (L6-L8).
 */
""", "WIRED comment")
rep(F, """ * - `betweenHits` (with the continuation's kernel line): a move that can hit more than once""", """ * - `betweenHits`: a move that can hit more than once""", "doc 1")
rep(F, """ * - `report.faintedInHits` (with its kernel lines): a Sparkling Aria user""", """ * - `report.faintedInHits`: a Sparkling Aria user""", "doc 2")
rep(F, """ *   faint in the hits (a Rowap Berry, Innards Out) the outcome reports apart from Life Orb's after them (ariaFaint).
 * Not estimated (until WIRED.attackerSafeguard): the target's Spicy Spray against a user whose side has Safeguard
 * (PS/data/abilities.ts spicyspray onDamagingHit: source.trySetStatus('brn', target), which the user's side's Safeguard stops,
 * `target !== source`), which the step would burn.
 */""", """ *   faint in the hits (a Rowap Berry, Innards Out) the outcome reports apart from Life Orb's after them (ariaFaint).
 */""", "doc 3")
rep(F, """  if (!WIRED.attackerSafeguard && attacker && attacker !== target && build.abilityId === "spicyspray" && w.sides[slotSide(attacker)].safeguard && burnable(kernel, w, attacker)) {
    kernel.notEstimated(REASONS.combo("Spicy Spray", "Safeguard"));
  }
  if (WIRED.continuation && attacker && !spread""", """  if (attacker && !spread""", "stepEnv 1")
rep(F, """  if (WIRED.faintedInHits && attacker && !spread && moveId === "sparklingaria\"""", """  if (attacker && !spread && moveId === "sparklingaria\"""", "stepEnv 2")
rep(F, """/** A Pokémon Spicy Spray's burn could reach (no status, not Fire type, no Water Veil, Water Bubble, Thermal Exchange, Comatose, Purifying Salt). */
function burnable(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const build = w.mons[slot]!.build;
  return !build.status && !kernel.typesIn(w, slot).includes("Fire") && !["waterveil", "waterbubble", "thermalexchange", "comatose", "purifyingsalt"].includes(build.abilityId);
}

""", "", "burnable")
rep(F, """/**
 * Before a pair's step (applyStep). With the continuation's kernel line (WIRED.continuation) the step stops at the Berry's
 * hit and continueHits finishes the use: nothing here. Without it, today's guard: a target's Starf, Ganlon or Apicot Berry
 * or, with Cheek Pouch, a Lansat Berry eaten at the Update between two hits (data/items.ts onUpdate; sim/battle-actions.ts:967)
 * is not estimated where the hits before the last can take the target above the Berry's line to it (VE-F1-10, VE-F1-13).
 */
export function betweenHits(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry) {
  void action;
  if (WIRED.continuation) return;
  const row = entry.row;
  const hits = row.hits ?? 1;
  const mon = w.mons[target];
  if (hits < 2 || row.kind !== "calculated" || !mon || mon.fainted) return;
  const item = mon.build.itemId;
  if (!stopsBetweenHits(mon.build) || !kernel.itemWorks(w, mon.build) || kernel.berryStopped(w, target)) return;
  const { line } = berryArithmetic(item, { ...kernel.hp[target], ability: mon.build.abilityId }, kernel.runtime.profile.generation);
  const perHit = Array.isArray(row.rolls) && Array.isArray(row.rolls[0]) ? (row.rolls as number[][]).map((rolls) => Math.max(...rolls)) : null;
  const before = perHit ? perHit.slice(0, hits - 1).reduce((sum, each) => sum + each, 0) : row.max ?? 0;
  if ([...marginal(w, target).keys()].some((hp) => hp > line && hp - before <= line)) kernel.notEstimated(REASONS.berryBetweenHits(kernel.itemName(item), kernel.moveName(row.moveId)));
}""", """/**
 * Before a pair's step (applyStep): a target's Starf, Ganlon or Apicot Berry or, with Cheek Pouch, a Lansat Berry eaten at the
 * Update between two hits (data/items.ts onUpdate; sim/battle-actions.ts:967) stops the step at the Berry's hit (stepEnv's
 * betweenHits) and continueHits finishes the use: nothing here. Kept as the hook its caller names.
 */
export function betweenHits(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, entry: SearchEntry) {
  void kernel; void w; void action; void target; void entry;
}""", "betweenHits")
rep(F, """  if (!WIRED.continuation || kernel.mode !== "all" ||""", """  if (kernel.mode !== "all" ||""", "hitCounts")
rep(F, """ * set once, :2649), while the calculation reads Gale Wings at full HP (its build holds no HP). With frozenContext's kernel line
 * (WIRED.frozenContext) the calculation reads the frozen priority (MoveContext.frozenPriority): nothing here. Without it,
 * today's guard: where a priority shield or Psychic Terrain reads it, the two can differ.
 */
export function frozenPriority(kernel: TurnKernel, world: World, action: PendingAction, priority: number, resolution: Resolution) {
  if (WIRED.frozenContext) return;
  if (action.frozen && priority !== kernel.priorityOf(world, action)) {
    const shields = (slot: DoublesSlotId) => [slot, allyOf(slot)].some((each) => kernel.alive(world, each) && (PRIORITY_SHIELD_ABILITIES as readonly string[]).includes(world.mons[each]!.build.abilityId));
    if (world.field.terrain === "Psychic" || resolution.targets.some(shields)) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName(world.mons[action.slot]!.build.abilityId)));
  }
}""", """ * set once, :2649), while the calculation reads Gale Wings at full HP (its build holds no HP). The calculation reads the frozen
 * priority (MoveContext.frozenPriority, frozenContext through contextFor): nothing here. Kept as the hook its caller names.
 */
export function frozenPriority(kernel: TurnKernel, world: World, action: PendingAction, priority: number, resolution: Resolution) {
  void kernel; void world; void action; void priority; void resolution;
}""", "frozenPriority")
