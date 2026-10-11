from patchlib import rep
F = "tests/unit/doubles-outcomes.test.ts"
rep(F, """import type { BattleBuild, BattleConditions, BattleGame, MoveContext } from "@/app/lib/battle/types";""",
 """import type { BattleBuild, BattleConditions, BattleGame, MoveContext, SideConditions } from "@/app/lib/battle/types";""", "import")
rep(F, """type Carried = Omit<DoublesCarried, "trap" | "futureMove" | "cudChew"> & { trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; futureMove?: string; cudChew?: true };""",
 """type Carried = Omit<DoublesCarried, "trap" | "futureMove" | "cudChew" | "ppLeft"> & {
  trap?: { source: DoublesSlotId; bindingBand: boolean; move?: string }; cudChew?: true | string; ppLeft?: Record<string, number>;
  // status2 wave 1b (as doubles-turn-showdown.test.ts): a landing from a Pokémon of the turn, or from one not in battle.
  futureMove?: string | { move: "futuresight" | "doomdesire"; source: DoublesSlotId } | { move: "futuresight" | "doomdesire"; bench: Omit<Mon, "move">; benchSide: "own" | "opponent"; fainted?: true; terastallized?: string };
};""", "Carried")
rep(F, """  types?: string[]; addedType?: "Grass" | "Ghost"; lastItem?: string | null; firstTurn?: boolean;
};
type SideField = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; safeguard?: boolean; mist?: boolean; luckyChant?: boolean };""",
 """  types?: string[]; addedType?: "Grass" | "Ghost"; lastItem?: string | null; firstTurn?: boolean;
  lastMoveTarget?: DoublesSlotId | null; exactMoves?: true;
};
type SideField = { tailwind?: boolean; reflect?: boolean; lightScreen?: boolean; auroraVeil?: boolean; safeguard?: boolean; mist?: boolean; luckyChant?: boolean; gmaxResidual?: SideConditions["gmaxResidual"] };""", "Mon/Side")
rep(F, """  entryOrder?: DoublesTurnInput["entryOrder"]; fieldTurns?: DoublesTurnInput["fieldTurns"];
};
const GAMES""", """  entryOrder?: DoublesTurnInput["entryOrder"]; fieldTurns?: DoublesTurnInput["fieldTurns"];
  battleLastMove?: string | null; faintedLastTurn?: DoublesTurnInput["faintedLastTurn"]; echoedVoice?: DoublesTurnInput["echoedVoice"];
};
const GAMES""", "Case")
rep(F, """  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  return { ...trained, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...typed, ...m.appBuild } as BattleBuild;
}
/** The state from earlier turns (doubles-turn-showdown.test.ts carried). */
function carriedOf(m: Mon): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: toId(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: toId(futureMove) } : {}),
    ...(charging""", """  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  // status2 wave 1b: an appBuild configuration (G-Max's dynamaxLevel, gigantamax) adds to the set's gender and Tera type.
  const merged = { ...configuration, ...((m.appBuild?.configuration ?? {}) as Record<string, unknown>) };
  return { ...trained, ...mechanic, ...typed, ...m.appBuild, ...(Object.keys(merged).length ? { configuration: merged } : {}) } as BattleBuild;
}
/** status2 wave 1b: a landing's user (doubles-turn-showdown.test.ts landing): a slot, or the build of one not in battle. */
function landing(fm: NonNullable<Carried["futureMove"]>, runtime: BattleRuntime): DoublesCarried["futureMove"] {
  if (typeof fm === "string") return toId(fm);
  if ("source" in fm) return { move: fm.move, source: fm.source };
  const bench: Mon = { ...fm.bench, move: null };
  return { move: fm.move, build: caseBuild(fm.terastallized ? { ...bench, teraType: fm.terastallized, choice: "terastallize" } : bench, runtime) };
}
/** The state from earlier turns (doubles-turn-showdown.test.ts carried). */
function carriedOf(m: Mon, runtime: BattleRuntime): DoublesCarried | undefined {
  const { trap, futureMove, charging, encore, disable, cudChew, ppLeft, ...rest } = m.carried ?? {};
  const out: DoublesCarried = {
    ...rest, ...(trap ? { trap: { source: trap.source, bindingBand: trap.bindingBand, move: toId(trap.move ?? "Fire Spin") } } : {}), ...(futureMove ? { futureMove: landing(futureMove, runtime) } : {}),
    ...(cudChew ? { cudChew: cudChew === true ? true : toId(cudChew) } : {}), ...(ppLeft ? { ppLeft: Object.fromEntries(Object.entries(ppLeft).map(([k, v]) => [toId(k), v])) } : {}),
    ...(charging""", "build/carried")
rep(F, """  ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
});""", """  ...(s?.safeguard ? { safeguard: true } : {}), ...(s?.mist ? { mist: true } : {}), ...(s?.luckyChant ? { luckyChant: true } : {}),
  ...(s?.gmaxResidual?.length ? { gmaxResidual: [...s.gmaxResidual] } : {}),
});""", "side")
rep(F, """    const state = carriedOf(m);""", """    const state = carriedOf(m, runtime);""", "carried call")
rep(F, """      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}), ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
  };""", """      ...(m.firstTurn !== undefined ? { firstTurn: m.firstTurn } : {}),
      ...(m.lastMoveTarget !== undefined ? { lastMoveTarget: m.lastMoveTarget } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const turn: DoublesTurnInput = {
    runtime, field, pokemon, ...(c.weatherTurns !== undefined ? { weatherTurns: c.weatherTurns } : {}),
    canSwitch: { own: c.canSwitch?.own ?? true, opponent: c.canSwitch?.opponent ?? true },
    ...(c.entryOrder ? { entryOrder: { ...c.entryOrder } } : {}), ...(c.fieldTurns ? { fieldTurns: { ...c.fieldTurns } } : {}),
    ...(c.battleLastMove !== undefined ? { battleLastMove: c.battleLastMove === null ? null : toId(c.battleLastMove) } : {}),
    ...(c.faintedLastTurn ? { faintedLastTurn: { ...c.faintedLastTurn } } : {}), ...(c.echoedVoice !== undefined ? { echoedVoice: c.echoedVoice } : {}),
  };""", "input")
