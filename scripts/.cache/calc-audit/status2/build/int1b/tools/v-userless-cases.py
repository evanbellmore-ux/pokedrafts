# Integration 1b: oracle cases for a landing whose user is not in battle (PendingAction.userless; tools/c-userless.py): the
# first slot of the user's side empty (the t2-fuzz seed 101 crash) or holding another Pokémon (Normalize, read as the user
# before). Appended to verify/cases-int1b.ts.
from patchlib import rep
F = "scripts/.cache/calc-audit/2v2/verify/cases-int1b.ts"
rep(F, """    checks: "moves.ts smackdown condition onStart: removeVolatile('fly') sets applies before the grounding check; queue.cancelMove.",
  },
];
void OR;""", """    checks: "moves.ts smackdown condition onStart: removeVolatile('fly') sets applies before the grounding check; queue.cancelMove.",
  },
  // A landing whose user is not in battle (conditions.ts futuremove onEnd: trySpreadMoveHit from data.source, no ModifyType;
  // Normalize only for an active source): residualHit's action only names the user's side (PendingAction.userless), whose
  // first slot may be empty (t2-fuzz seed 101: Training after the user fainted and nothing came in) or hold another Pokémon.
  {
    id: "INT-FUT-01-sv", game: "sv", outcomes: true,
    title: "Future Sight from a fainted Hatterene lands on Snorlax; the first slot of Hatterene's side is empty",
    slots: slots({ ...lax(2), absent: true, action: { move: null } }, idle(lax(4)),
      idle(lax(12)), idle(carried(lax(8, { item: "Leftovers" }), { futureMove: { move: "futuresight", bench: hatterene, benchSide: "own", fainted: true } }))),
    checks: "futuremove onEnd with data.source fainted: its ability and item do not count; Leftovers after the landing (order 5.4).",
  },
  {
    id: "INT-FUT-02-usum", game: "usum", outcomes: true,
    title: "Future Sight from Alakazam on the bench lands on Kecleon; the first slot of its side is empty: Color Change makes Kecleon Psychic",
    slots: slots({ ...lax(2), absent: true, action: { move: null } }, idle(lax(4)),
      idle(lax(12)), idle(carried(mon("Kecleon", "Color Change"), { futureMove: { move: "futuresight", bench: alakazam, benchSide: "own" } }))),
    checks: "abilities.ts colorchange onAfterMoveSecondary: the landing's type, Psychic.",
  },
  {
    id: "INT-FUT-03-usum", game: "usum", outcomes: true,
    title: "Future Sight from Alakazam on the bench lands on Kecleon beside a Normalize Delcatty on Alakazam's side: Kecleon becomes Psychic",
    slots: slots(idle(mon("Delcatty", "Normalize")), idle(lax(4)),
      idle(lax(12)), idle(carried(mon("Kecleon", "Color Change"), { futureMove: { move: "futuresight", bench: alakazam, benchSide: "own" } }))),
    checks: "futuremove onEnd: data.source.hasAbility('normalize') is the bench Alakazam's (false); Delcatty is not the user.",
  },
];
void OR;""", "INT-FUT cases")
rep(F, """const oranguru = (item: string) => mon("Oranguru", "Symbiosis", { item });""", """const oranguru = (item: string) => mon("Oranguru", "Symbiosis", { item });
const hatterene = mon("Hatterene", "Magic Bounce", { nature: "Modest", evs: { spa: 252 } });
const alakazam = mon("Alakazam", "Inner Focus", { nature: "Modest", evs: { spa: 252 } });""", "helpers")
rep(F, """import { OL, OR, PL, PR, act, idle, lax, mon, slots } from "./case-kit";""", """import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";""", "import carried")
