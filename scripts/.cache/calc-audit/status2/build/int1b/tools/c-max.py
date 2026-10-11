# Integration 1b: doubles-max.ts's WIRED flags (M-1 … M-17 are in) and their fallbacks go (W1B-M.md's optional cleanup;
# REASONS maxGuard, randomStatus and withDynamax lose their last sites).
from patchlib import rep, sub, read
F = "doubles-max.ts"
rep(F, """// The parts that need kernel lines (doubles-max.ts's integrator lines, W1B-M.md) keep today's guards until those lines are in:
// WIRED (the integrator sets each to true with its lines, as doubles-pairs.ts WIRED).

/**
 * The kernel lines each part needs (status2/build/W1B-M.md): `worlds`, maxEffects' worlds at its five call sites (G-Max
 * Befuddle's and Stun Shock's random statuses, G-Max Replenish's 1/2); `maxGuard`, the Max Guard lines (the used move, the
 * protect kind, the blocks); `painSplit`, Pain Split's arithmetic. Until then each keeps today's reason. `chiStrike`: the card's
 * condition and E2's volatile of G-Max Chi Strike (conditions, outcomeVolatiles: read only through those lines).
 */
export const WIRED = { worlds: true, maxGuard: true, painSplit: true, chiStrike: true };
""", """// The kernel lines these parts read (status2/build/W1B-M.md M-1 … M-17) are in since integration 1b: maxEffects' worlds at its
// call sites (G-Max Befuddle's and Stun Shock's random statuses, G-Max Replenish's 1/2), the Max Guard lines (the used move, the
// protect kind, the blocks), Pain Split's arithmetic, and G-Max Chi Strike's card condition and E2 volatile.
""", "WIRED")
rep(F, """      return WIRED.worlds ? randomStatuses(kernel, w, action, target, attacker, id, name) : [w];""",
 """      return randomStatuses(kernel, w, action, target, attacker, id, name);""", "worlds 1")
rep(F, """ * unknown: REASONS.needsLastItem. Until WIRED.worlds: today's reason while a later action follows.
 */""", """ * unknown: REASONS.needsLastItem.
 */""", "replenish doc")
rep(F, """  if (!back.length) return [w];
  if (!WIRED.worlds) {
    if (w.remaining.some((entry) => kernel.alive(w, entry.slot))) kernel.notEstimated(REASONS.notIn2v2(name));
    return [w];
  }
""", """  if (!back.length) return [w];
""", "replenish fallback")
rep(F, """ * step is named so (DoublesStep.effectiveName, as a Max Move's). Until WIRED.maxGuard: today's reason.
 */
export function statusMove(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  if (!maxGuardAction(kernel.input, slot)) return;
  if (!WIRED.maxGuard) kernel.notEstimated(REASONS.maxGuard);
""", """ * step is named so (DoublesStep.effectiveName, as a Max Move's).
 */
export function statusMove(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void w;
  if (!maxGuardAction(kernel.input, slot)) return;
""", "statusMove")
rep(F, """ * Before the walk, for a Dynamaxed Pokémon's damaging move:
 * - G-Max Befuddle's and Stun Shock's random statuses with another action (today's reason until WIRED.worlds: the worlds need
 *   maxEffects' kernel lines);
 * - G-Max Finale heals""", """ * Before the walk, for a Dynamaxed Pokémon's damaging move: G-Max Finale heals""", "guard doc")
rep(F, """  if (RANDOM_STATUSES[id] && !WIRED.worlds && DOUBLES_SLOTS.some((other) => other !== slot && kernel.input.pokemon[other]?.action.moveId)) {
    kernel.notEstimated(REASONS.randomStatus(info.effective.name));
  }
""", "", "random fallback")
rep(F, """// Max Guard (WIRED.maxGuard: the kernel lines of W1B-M.md read these)""", """// Max Guard (the kernel lines of W1B-M.md read these)""", "section")
rep(F, """  // (A string: ProtectKind gains "maxguard" with the integrator's doubles-world.ts line.)
  const kind: string | null | undefined = w.mons[slot]?.protect;""", """  const kind = w.mons[slot]?.protect;""", "kind")
rep(F, """/** Pain Split with a Dynamaxed party: today's reason until WIRED.painSplit (doubles-status.ts painSplit's arithmetic line). */
export function painSplitMax(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  if (WIRED.painSplit) return;
  if (isMaxActive(w.mons[use.user]!.build) || isMaxActive(w.mons[slot]!.build)) kernel.notEstimated(REASONS.withDynamax(use.move.name));
}""", """/** Pain Split with a Dynamaxed party: its arithmetic is painSplitHP's (doubles-status.ts painSplit), so nothing here. Kept as the hook its caller names. */
export function painSplitMax(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  void kernel; void w; void use; void slot;
}""", "painSplitMax")
T = "tests/unit/doubles-max.test.ts"
rep(T, 'import { MAX_GUARD_PASS, maxGuardAction, painSplitHP, WIRED } from "@/app/lib/battle/doubles-max";', 'import { MAX_GUARD_PASS, maxGuardAction, painSplitHP } from "@/app/lib/battle/doubles-max";', "import")
rep(T, """ * with (status2/build/W1B-M.md). Level 50, 31 IVs, 0 EVs, a Serious nature unless set. The parts that need the kernel's lines
 * (doubles-max.ts WIRED) run as `it.fails` until the integrator sets WIRED with the lines: they pass on the scratch tree that has
 * them (status2/build/w1b-m/patch-int.cjs, w1b-m/vitest.int.config.mts).
 */""", """ * with (status2/build/W1B-M.md). Level 50, 31 IVs, 0 EVs, a Serious nature unless set. The kernel's lines these parts read
 * (W1B-M.md M-1 … M-17) are in since integration 1b.
 */""", "header")
rep(T, """/** `it` once the integrator's kernel lines for `part` are in (doubles-max.ts WIRED), `it.fails` until then. */
const wired = (part: keyof typeof WIRED) => (WIRED[part] ? it : it.fails);
""", "", "wired helper")
sub(T, r'  wired\("[a-zA-Z]+"\)\(', '  it(', "wired -> it", count=12)
sub(T, r' \(WIRED\.[a-zA-Z]+(: |\))', lambda m: " (" if m.group(1) == ": " else "", "describe names", count=3)
text, _ = read(T)
start = text.index('  it("keeps today\'s reasons until the kernel lines are in (WIRED false)", async () => {')
end = text.index("  });\n", start) + len("  });\n")
rep(T, text[start:end], "", "fallback test")
