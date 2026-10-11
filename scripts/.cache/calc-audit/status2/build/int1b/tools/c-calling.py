# Integration 1b: doubles-calling.ts's WIRED flags (every CL line is in) and their fallbacks go; CL-7's pinned callsMove set
# moves to doubles-actions.ts as CALLS_MOVE (in place of CALLING_MOVES, ADDENDUM2 §2.4: CALLING_MOVES emptied) so that
# doubles-typing.ts proteanGuard reads it without a runtime import of doubles-calling.ts (no cycle).
from patchlib import rep, read
C = "doubles-calling.ts"
text, _ = read(C)
start = text.index("/**\n * The integrator lines this file's models need")
end = text.index("};\n", text.index("export const WIRED = {", start)) + 3
rep(C, text[start:end], "", "WIRED")
rep(C, """ * the turn does not follow until their integrator line is in (WIRED.history) or where Showdown's state is not the app's.""",
 """ * the turn does not follow where Showdown's state is not the app's.""", "callingGuard doc")
rep(C, """  if (WIRED.history) return;
  // Until CL-4: a calling move's use and a No move write the battle's last move as Showdown's clearActiveMove does not.
  for (const other of others) {
    const id = kernel.input.pokemon[other]!.action.moveId;
    if (id && CALLERS.has(id)) kernel.notEstimated(REASONS.combo(kernel.moveName("copycat"), kernel.moveName(id)));
    if (id === null && !kernel.input.pokemon[other]!.carried?.mustRecharge) kernel.notEstimated(REASONS.combo(kernel.moveName("copycat"), "No move"));
  }
}""", "}", "history fallback")
rep(C, """ * doubles-status.ts presenceGuards' Sleep Talk and Uproar lines: Uproar's assumption (an Uproar from last turn stops every
 * sleep from the turn's start, a new one only from its hit). Until CL-1 and CL-2 are in, Uproar while a Pokémon sleeps or a
 * sleep can start stays guarded (data/moves.ts uproar), as before.
 */""", """ * doubles-status.ts presenceGuards' Sleep Talk and Uproar lines: Uproar's assumption (an Uproar from last turn stops every
 * sleep from the turn's start, a new one only from its hit).
 */""", "presence doc")
rep(C, """  if (moveId !== "uproar") return;
  if (!WIRED.uproarHit || !WIRED.uproarSleep) {
    const sleeps = DOUBLES_SLOTS.some((other) => {
      const mon = w.mons[other], id = kernel.input.pokemon[other]?.action.moveId;
      return !!mon && (mon.build.status === "slp" || mon.eot.yawn !== undefined || (!!id && (id === "rest" || id === "yawn" || tableEntry(kernel, id)?.status === "slp")));
    });
    if (sleeps) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("uproar")));
  }
""", """  if (moveId !== "uproar") return;
  void w;
""", "presence fallback")
rep(C, """  // Until CL-3 a move used this turn is not kept for these readers: a Pokémon whose action was picked is not followed.
  if (!WIRED.usedMove && w.mons[slot]!.moved) kernel.notEstimated(REASONS.notIn2v2(caller.name));
""", "", "usedMove fallback")
rep(C, """  // Until CL-6 the inserted action would count in every later action's position (DoublesStep.order).
  if (!WIRED.instructOrder) kernel.notEstimated(REASONS.notIn2v2(use.move.name));
""", "", "instructOrder fallback")
rep(C, """  // A called Uproar (Copycat's) wakes and keeps off sleep only with CL-1 and CL-2 in (afterHit, uproarSleep).
  if (moveId === "uproar" && (!WIRED.uproarHit || !WIRED.uproarSleep)) kernel.notEstimated(REASONS.notIn2v2(move!.name));
""", "", "called uproar fallback")
rep(C, """/**
 * Pinned Showdown's callsMove moves (PS/data/moves.ts: Assist, Copycat, Me First, Metronome, Mirror Move, Nature Power, Sleep
 * Talk; not Instruct): Protean and Libero skip their PrepareHit (PS/data/abilities.ts protean onPrepareHit) and wait for the
 * called move's. For doubles-typing.ts proteanGuard in place of CALLING_MOVES (W1B-CL.md CL-7).
 */
export const CALLS_MOVE: ReadonlySet<string> = new Set(["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk"]);
""", """/** Pinned Showdown's callsMove moves (doubles-actions.ts CALLS_MOVE: Protean and Libero wait for the called move's PrepareHit). */
export { CALLS_MOVE };
""", "CALLS_MOVE re-export")
rep(C, 'import { DANCE_MOVES, GRAVITY_MOVES, PROTECT_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";',
 'import { CALLS_MOVE, DANCE_MOVES, GRAVITY_MOVES, PROTECT_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";', "import")
A = "doubles-actions.ts"
rep(A, """/** The moves with callsMove (data/moves.ts: they use a move picked from the battle or at random), and Instruct (its target uses its move again). */
export const CALLING_MOVES: ReadonlySet<string> = new Set(["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk", "instruct"]);""",
 """/**
 * Pinned Showdown's callsMove moves (data/moves.ts: Assist, Copycat, Me First, Metronome, Mirror Move, Nature Power, Sleep Talk;
 * not Instruct): Protean and Libero skip their PrepareHit (data/abilities.ts protean onPrepareHit) and wait for the called
 * move's (doubles-typing.ts proteanGuard; status2 CL-7, in place of CALLING_MOVES, whose guard members CL models).
 */
export const CALLS_MOVE: ReadonlySet<string> = new Set(["assist", "copycat", "mefirst", "metronome", "mirrormove", "naturepower", "sleeptalk"]);""", "CALLING_MOVES")
T = "doubles-typing.ts"
rep(T, 'import { ABSORBING, CALLING_MOVES, FUTURE_MOVES, REASONS, REDIRECT_ABILITIES, TYPE_LOSS_MOVES } from "./doubles-actions";',
 'import { ABSORBING, CALLS_MOVE, FUTURE_MOVES, REASONS, REDIRECT_ABILITIES, TYPE_LOSS_MOVES } from "./doubles-actions";', "typing import")
rep(T, """  // status2 CL-7: pinned callsMove (doubles-calling.ts CALLS_MOVE): Instruct is none, so Protean acts on it.
  if (FUTURE_MOVES.has(moveId) || (CALLING_MOVES.has(moveId) && moveId !== "instruct")) return;""",
 """  // status2 CL-7: pinned callsMove (CALLS_MOVE): Instruct is none, so Protean acts on it.
  if (FUTURE_MOVES.has(moveId) || CALLS_MOVE.has(moveId)) return;""", "typing use")
X = "tests/unit/doubles-calling.test.ts"
rep(X, 'import { afterHit, callingGuard, CALLS_MOVE, context, ownsLastMove, uproarSleep, WIRED } from "@/app/lib/battle/doubles-calling";',
 'import { afterHit, callingGuard, CALLS_MOVE, context, ownsLastMove, uproarSleep } from "@/app/lib/battle/doubles-calling";', "test import")
rep(X, """  it("ownsLastMove: the callers write the battle's last move themselves (CL-4); WIRED lists the integrator lines", () => {""",
 """  it("ownsLastMove: the callers write the battle's last move themselves (CL-4)", () => {""", "test name")
rep(X, """    expect(Object.keys(WIRED).sort()).toEqual(["history", "instructOrder", "uproarHit", "uproarSleep", "usedMove"]);
""", "", "test WIRED")
