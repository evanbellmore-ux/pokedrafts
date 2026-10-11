# Integration 1a, D's uses-to-ko.ts ask 3 (G4-BZK-01/02/04/05): Berserk's +1 Sp. Atk when a hit takes its holder from above
# half to half or less (PS/data/abilities.ts berserk onAfterMoveSecondary, Anger Shell's rule: not after a Sheer Force move
# with secondaries, which runs no AfterMoveSecondary), with the healing Berry held until that check (onTryEatItem
# checkedBerserk). Turn mode only: a 1v1 row never reads its target's Sp. Atk (golden-1v1 stays byte-equal).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("uses-to-ko.ts", '''    if (this.ability(initial, "def") === "angershell" || first.cases.length > 1 || ["ficklebeam", "shellsidearm"].includes(this.input.move.id)) return false;''',
  '''    if (this.ability(initial, "def") === "angershell" || this.turnBerserk(initial) || first.cases.length > 1 || ["ficklebeam", "shellsidearm"].includes(this.input.move.id)) return false;''', "the fast path: Berserk in turn mode"),
 ("uses-to-ko.ts", '''      const angerShell = this.ability(state, "def") === "angershell";''', '''      const angerShell = this.ability(state, "def") === "angershell" || this.turnBerserk(state);''', "Berserk acts as Anger Shell's line (turn mode)"),
 ("uses-to-ko.ts", '''    if (mask & ANGER_SHELL) boost(m, state, "def", { atk: 1, spa: 1, spe: 1, def: -1, spd: -1 }, false, true);''', '''    if (mask & ANGER_SHELL) boost(m, state, "def", this.turnBerserk(state) ? { spa: 1 } : { atk: 1, spa: 1, spe: 1, def: -1, spd: -1 }, false, true);''', "Berserk's rise"),
 ("uses-to-ko.ts", '''    if (this.ability(state, "def") === "angershell" && !(this.ability(state, "att") === "sheerforce" && engineMove.secondaries)) return true;''', '''    if ((this.ability(state, "def") === "angershell" || this.turnBerserk(state)) && !(this.ability(state, "att") === "sheerforce" && engineMove.secondaries)) return true;''', "tracksDealt: Berserk (turn mode)"),
 ("uses-to-ko.ts", '''  /** Whether the use's dealt damage matters to the state: Anger Shell's line, or recoil, draining or Shell Bell on a followed attacker HP. */''', '''  /** status2 (2v2 turn mode only): the target's Berserk, which follows Anger Shell's line and holding (a 1v1 row never reads its Sp. Atk). */
  private turnBerserk(state: State): boolean {
    return this.m.turn && this.ability(state, "def") === "berserk";
  }

  /** Whether the use's dealt damage matters to the state: Anger Shell's line, or recoil, draining or Shell Bell on a followed attacker HP. */''', "turnBerserk helper"),
])
