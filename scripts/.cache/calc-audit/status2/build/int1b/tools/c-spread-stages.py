# Integration 1b (census: spreadEffect beyond ADDENDUM2 §2.3 #4's Dragon Darts corner): a spread move's user whose stages one
# target changes, a Gulping Cramorant's Gulp Missile (Def -1, data/abilities.ts gulpmissile onDamagingHit) or a Mirror Armor
# holder reflecting the move's certain drop (data/abilities.ts mirrorarmor onTryBoost), composed in target order by replaying
# the reaction through applyBoosts from the holder (its TryBoost, Defiant, the caps, as Showdown boosts it), not by a difference.
from patchlib import rep
K = "doubles-reactions.ts"
rep(K, """  const reaction = STATE_REACTIONS.has(was.abilityId) ? was.abilityId : STATE_REACTIONS.has(was.itemId) ? was.itemId : null;""",
 """  // status2 integration 1b: Mirror Armor's reflected drop (an onTryBoost, not a DamagingHit: no USER_REACTIONS row) is tagged too.
  const reaction = STATE_REACTIONS.has(was.abilityId) || was.abilityId === "mirrorarmor" ? was.abilityId : STATE_REACTIONS.has(was.itemId) ? was.itemId : null;""", "veil tag")
rep(K, """/**
 * One target's own-state reaction on the user, as the difference between its step's state and the reference (a target with
 * none): the fields a status, ability or item reaction changes (Spicy Spray's burn, a Lum or Rawst Berry it used, Mummy,
 * Lingering Aroma, Wandering Spirit, Pickpocket, Sticky Barb), applied in target order on the user's build: the first status
 * stands (a later one fails), the latest ability and item. False for a difference it cannot compose (stages, a form).
 */
function applyDiff(kernel: TurnKernel, world: World, attacker: DoublesSlotId, ref: TurnSide, side: TurnSide): boolean {
  void kernel;
  const mon = world.mons[attacker]!;
  for (const key of new Set([...Object.keys(ref), ...Object.keys(side)]) as Set<keyof TurnSide>) {
    if (key === "hp" || JSON.stringify(ref[key]) === JSON.stringify(side[key])) continue;""", """/**
 * One target's own-state reaction on the user, as the difference between its step's state and the reference (a target with
 * none): the fields a status, ability or item reaction changes (Spicy Spray's burn, a Lum or Rawst Berry it used, Mummy,
 * Lingering Aroma, Wandering Spirit, Pickpocket, Sticky Barb), applied in target order on the user's build: the first status
 * stands (a later one fails), the latest ability and item. Stages (status2 integration 1b): a Gulping Cramorant's Gulp Missile
 * (Def -1) and a Mirror Armor holder's reflected drop (the move's certain drops on it, those it is not at -6 in), each replayed
 * through applyBoosts from the holder (`stages`). False for a difference it cannot compose (other stages, a form).
 */
function applyDiff(kernel: TurnKernel, world: World, attacker: DoublesSlotId, ref: TurnSide, side: TurnSide, stages?: { from: DoublesSlotId; changes: Partial<Record<CombatStat, number>> } | null): boolean {
  const mon = world.mons[attacker]!;
  for (const key of new Set([...Object.keys(ref), ...Object.keys(side)]) as Set<keyof TurnSide>) {
    if (key === "hp" || JSON.stringify(ref[key]) === JSON.stringify(side[key])) continue;
    if (key === "boosts" && stages) {
      if (kernel.alive(world, attacker)) kernel.applyBoosts(world, attacker, stages.changes, stages.from, { effect: "ability" });
      continue;
    }""", "applyDiff stages")
rep(K, """    if (entry && ref && keys.size > 1 && !applyDiff(kernel, world, attacker, ref, entry.side)) fail();""",
 """    if (entry && ref && keys.size > 1 && !applyDiff(kernel, world, attacker, ref, entry.side, stageReaction(kernel, world, action, info, entry))) fail();""", "applyDiff call")
rep(K, """/**
 * The user after a spread move's hits (T2M §3.3;""", """/**
 * The stage reaction a spread target's entry carries for applyDiff (status2 integration 1b): a Gulping Cramorant's Gulp Missile
 * (Def -1 from the holder: PS/data/abilities.ts gulpmissile onDamagingHit, boost(…, source, target, null, true)), or a Mirror
 * Armor holder's reflection of the move's certain drops on it (PS/data/abilities.ts mirrorarmor onTryBoost: each negative
 * stage the holder is not at -6 in, boosted on the user from the holder), else null.
 */
function stageReaction(kernel: TurnKernel, world: World, action: PendingAction, info: TurnMoveInfo, entry: Entry): { from: DoublesSlotId; changes: Partial<Record<CombatStat, number>> } | null {
  if (!entry.target || !entry.reaction) return null;
  if (entry.reaction === "gulpmissile") return { from: entry.target, changes: { def: -1 } };
  if (entry.reaction !== "mirrorarmor") return null;
  const drops = statMove(ownMoveId(action.moveId!, info), gameOf(kernel), world.mons[action.slot]!.build.abilityId === "serenegrace")?.target ?? {};
  const holder = world.mons[entry.target]!.build;
  const changes = Object.fromEntries(Object.entries(drops).filter(([stat, amount]) => (amount ?? 0) < 0 && (holder.boosts[stat as CombatStat] ?? 0) > -6)) as Partial<Record<CombatStat, number>>;
  return Object.keys(changes).length ? { from: entry.target, changes } : null;
}

/**
 * The user after a spread move's hits (T2M §3.3;""", "stageReaction")
