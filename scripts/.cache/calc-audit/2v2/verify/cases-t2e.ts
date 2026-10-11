// status2 T2E- and IN- cases of tier2-eot-training.md (ADDENDUM2 §7.2's cases-t2e.ts): wave 1a's (Track V1): T2E §4.7.5's
// IN-RC (recharge), IN-SU (Struggle), IN-FO (Fake Out after the first turn), gated at integration 1a (N; Struggle the Step 0a
// kernel's). IN-SW is Step 1's (cases-status2-step1.ts); the E2 entries (T2E-FS, -CC, -MO, -GX, -FC) are V2's.
// Probes: tier2-eot-training-probes-2.ts (TR01, TR07, TR09, TR09b, TR09c, TR11). Showdown names; level 50, 31 IVs, Serious
// nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, perGame, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const GAMES: Game[] = ["champions", "sv"];

const RC: Case[] = [
  ...perGame("IN-RC01", GAMES, (game) => ({
    title: "An asleep Garchomp must recharge (Hyper Beam last turn): its No move stops at the recharge before sleep; the sleep counter does not move (TR01)",
    slots: slots(idle(carried(mon("Garchomp", "Rough Skin", { status: "slp" }), { mustRecharge: true })), idle(lax(k(game, 1))),
      idle(lax(k(game, 2))), idle(lax(k(game, 4)))),
    checks: "conditions.ts mustrecharge onBeforeMove priority 11 (cant recharge) before slp's 10: statusState.time is not lowered (E2 sleepTurns).",
    outcomes: true,
  })),
  ...perGame("IN-RC02", GAMES, (game) => ({
    title: "A confused Garchomp must recharge: no confusion check, no self-hit; its confusion's turn is not counted (TR11)",
    slots: slots(idle(carried(mon("Garchomp", "Rough Skin"), { mustRecharge: true, confusion: { attempts: 0 } })), idle(lax(k(game, 1))),
      idle(lax(k(game, 2))), idle(lax(k(game, 4)))),
    checks: "mustrecharge (11) stops BeforeMove before confusion (3): no self-hit; the confusion time is not lowered.",
    outcomes: true,
  })),
];

const SU: Case[] = [
  ...perGame("IN-SU01", GAMES, (game) => ({
    title: "Snorlax has no PP left: Struggle at a random foe (typeless) and its 1/4 recoil (TR09)",
    slots: slots(act(lax(k(game, 5)), "Struggle"), idle(lax(k(game, 1))), idle(mon("Gengar", "Cursed Body")), idle(lax(k(game, 2)))),
    checks: "moves.ts struggle: randomNormal target, typeless (hits the Ghost), recoil clampIntRange(round(baseMaxhp / 4), 1) = 59.",
  })),
  ...perGame("IN-SU02", GAMES, (game) => ({
    title: "Struggle into the lone foe's Substitute (40 HP): the recoil still comes (TR09b)",
    canSwitch: { opponent: false },
    slots: slots(act(lax(k(game, 5)), "Struggle"), idle(lax(k(game, 1))), { ...lax(k(game, 3)), absent: true, action: { move: null } }, idle(lax(k(game, 2), { substitute: 40 }))),
    checks: "TR09b: the Substitute takes the hit (move.totalDamage > 0): the 1/4 recoil applies.",
  })),
  ...perGame("IN-SU02b", GAMES, (game) => ({
    title: "Struggle into the lone foe's Protect: no damage, no recoil (TR09c)",
    canSwitch: { opponent: false },
    slots: slots(act(lax(k(game, 5)), "Struggle"), idle(lax(k(game, 1))), { ...lax(k(game, 3)), absent: true, action: { move: null } }, act(lax(k(game, 20)), "Protect")),
    checks: "TR09c: blocked by Protect, no recoil (applyRecoilDamage needs damage dealt).",
  })),
];

const FO: Case[] = perGame("IN-FO01", GAMES, (game) => ({
  title: "A confused Incineroar's Fake Out after its first turn, under Gravity: confusion runs; the Fake Out then fails (TR07)",
  field: { gravity: true },
  slots: slots(act(carried(mon("Incineroar", "Blaze", { firstTurn: false }), { confusion: { attempts: 0 } }), "Fake Out", PL), idle(lax(k(game, 1))),
    idle(lax(k(game, 2))), idle(lax(k(game, 4)))),
  checks: "moves.ts fakeout onTry: activeMoveActions > 1 fails after BeforeMove (a 1/3 self-hit first); Gravity does not stop it.",
}));

/** Wave 1a's cases of cases-t2e.ts. */
export const T2E_CASES: Case[] = [...RC, ...SU, ...FO];
void OL; void OR; void PR;
