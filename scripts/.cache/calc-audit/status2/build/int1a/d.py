# Integration 1a, D's kernel lines (W1A-D.md "For the integrator" 4-5); 4 (outcomeOf stages, berryLocked, glaiverush) went in
# with the merged outcomeOf edit.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-turn.ts",
  '''  mon.moved = true;
  // status2: an Encore that changes the queued move rewrites the action before BeforeMove (D; the stub: unchanged).
  const used = guardHooks.encoreRewrite(kernelOf(ctx), w, action);
  // BeforeMove''',
  '''  mon.moved = true;
  // status2: an Encore that changes the queued move rewrites the action before BeforeMove (D's doubles-guards.ts
  // encoreRewrites): one world per target getRandomTarget can pick (integration 1a), each run as its own action.
  const kernel = kernelOf(ctx);
  const rewrites = mon.vol.encore ? guardHooks.encoreRewrites(kernel, w, action) : null;
  if (rewrites && rewrites.length > 1) return rewrites.flatMap((rewrite) => executeUsed(ctx, rewrite.world, action, guardHooks.encoreRewrite(kernel, rewrite.world, rewrite.action)));
  return executeUsed(ctx, w, action, guardHooks.encoreRewrite(kernel, w, rewrites ? rewrites[0].action : action));
}

/** execute from BeforeMove on, for `used`: the action as it is used (an Encore's rewrite of the queued `action`). */
function executeUsed(ctx: Ctx, w: World, action: PendingAction, used: PendingAction): World[] {
  const step = stepOf(ctx, action);
  // BeforeMove''',
  "D 5: execute runs every Encore rewrite"),
])
