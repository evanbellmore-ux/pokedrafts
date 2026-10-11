# Integration 1a (W1A-NU.md / W1A-U1.md needsFromIntegrator): useDoublesCalculation.ts builds the page's turn input itself;
# it passes each slot's history answers (doublesSlotInput's fifth argument) and the field's (withTurnEarlier), as
# getDoublesTurnInput does, so the page and getDoublesTurnInput agree (calculator-doubles-shell.test.ts:240).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "app/(app)/calculator/useDoublesCalculation.ts"
apply([
 (F, '''import { doublesSlotInput, doublesTurnInput, type DoublesMatchup } from "./doubles-prep";''', '''import { withTurnEarlier } from "./doubles-inputs";
import { doublesSlotInput, doublesTurnInput, type DoublesMatchup } from "./doubles-prep";''', "import"),
 (F, ''' * contexts, Charge flags, states from earlier turns and actions (an Imprison user's quick moves), the field and the game.''', ''' * contexts, Charge flags, states from earlier turns and actions (an Imprison user's quick moves), the answers about earlier
 * turns (status2: each slot's history, the field's and the sides' turnEarlier), the field and the game.''', "doc"),
 (F, '''  const { runtime, field, slots, actions, charged, carried, moves } = doubles;''', '''  const { runtime, field, slots, actions, charged, carried, history, turnEarlier, moves } = doubles;''', "destructure"),
 (F, '''  const [carriedA, carriedB, carriedC, carriedD] = [carried["own-left"], carried["own-right"], carried["opponent-left"], carried["opponent-right"]];''', '''  const [carriedA, carriedB, carriedC, carriedD] = [carried["own-left"], carried["own-right"], carried["opponent-left"], carried["opponent-right"]];
  const [historyA, historyB, historyC, historyD] = [history["own-left"], history["own-right"], history["opponent-left"], history["opponent-right"]];''', "histories"),
 (F, '''  const input = useMemo((): DoublesTurnInput => doublesTurnInput(runtime, field, {
    "own-left": doublesSlotInput({ build: a.build, contexts: a.contexts, moves: a.moves }, chargedA, actionA, carriedA),
    "own-right": doublesSlotInput({ build: b.build, contexts: b.contexts, moves: b.moves }, chargedB, actionB, carriedB),
    "opponent-left": doublesSlotInput({ build: c.build, contexts: c.contexts, moves: c.moves }, chargedC, actionC, carriedC),
    "opponent-right": doublesSlotInput({ build: d.build, contexts: d.contexts, moves: d.moves }, chargedD, actionD, carriedD),
  }), [runtime, field, a.build, a.contexts, a.moves, b.build, b.contexts, b.moves, c.build, c.contexts, c.moves, d.build, d.contexts, d.moves,
    chargedA, chargedB, chargedC, chargedD, actionA, actionB, actionC, actionD, carriedA, carriedB, carriedC, carriedD]);''', '''  const input = useMemo((): DoublesTurnInput => withTurnEarlier(doublesTurnInput(runtime, field, {
    "own-left": doublesSlotInput({ build: a.build, contexts: a.contexts, moves: a.moves }, chargedA, actionA, carriedA, historyA),
    "own-right": doublesSlotInput({ build: b.build, contexts: b.contexts, moves: b.moves }, chargedB, actionB, carriedB, historyB),
    "opponent-left": doublesSlotInput({ build: c.build, contexts: c.contexts, moves: c.moves }, chargedC, actionC, carriedC, historyC),
    "opponent-right": doublesSlotInput({ build: d.build, contexts: d.contexts, moves: d.moves }, chargedD, actionD, carriedD, historyD),
  }), turnEarlier), [runtime, field, a.build, a.contexts, a.moves, b.build, b.contexts, b.moves, c.build, c.contexts, c.moves, d.build, d.contexts, d.moves,
    chargedA, chargedB, chargedC, chargedD, actionA, actionB, actionC, actionD, carriedA, carriedB, carriedC, carriedD,
    historyA, historyB, historyC, historyD, turnEarlier]);''', "the input with the answers"),
])
