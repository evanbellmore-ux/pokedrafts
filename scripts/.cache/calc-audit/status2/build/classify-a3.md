# status2 classification fragment: Track A3 (field, side, reflection, items)

SPEC2 §2.2's A3 rows with ADDENDUM2 §2.2: 18 M + 3 C in wave 1a. Integration 1b flipped `magicroom` and `defog` to M (FC's
Booster Energy path and the terrain re-settle) and added `spotlight` as M (PR: Spotlight through the pipeline, from kind X):
21 M + 1 C. Read by `gen-status-table.ts` (`| move | kind |` rows).
The handler and fails keys are the generator's (F3 §3.4); Stuff Cheeks' `stuffCheeks` handler is A3's (SPEC2 §1.3).

| move | kind |
|---|---|
| magiccoat | M |
| snatch | M |
| craftyshield | M |
| matblock | M |
| luckychant | M |
| mist | M |
| mudsport | M |
| watersport | M |
| magicroom | M |
| wonderroom | M |
| courtchange | M |
| defog | M |
| corrosivegas | M |
| bestow | M |
| recycle | C |
| teatime | M |
| stuffcheeks | M |
| aromatherapy | M |
| healbell | M |
| purify | M |
| psychoshift | M |
| spotlight | M |

Reasons each C move can still give (exact texts):
- recycle: `Recycle needs {Name}'s item from an earlier turn.` (it holds nothing, used nothing this turn, and the input's
  `lastItem` is absent).
