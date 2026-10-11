# Integration 1a, compare.ts (W's ask of V1): a target that ate a Berry between two hits of the move (W's continuation; the
# oracle's |-enditem|{target}|{Ganlon, Apicot, Starf or Lansat Berry}|[eat] in the step) has Showdown's realized sum per
# path, while the app's hit is the calculations it met: the covering rule of `truncated` (the calculation covers the sums).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "scripts/.cache/calc-audit/2v2/verify/compare.ts"
apply([
 (F, '''        if ((oh!.truncated ?? 0) > 0) {
          if (ah.max === null || ah.max < oh!.dmgMax) push(`${slot}→${target}`, "hit.max", `≥ ${oh!.dmgMax}`, ah.max, "hits stopped at the knockout: the calculation covers the hits dealt");''', '''        // status2 (integration 1a, W): a Berry its target ate between two hits changed the later hits (pairs.ts continueHits).
        const between = Object.keys(o.lines).some((l) => new RegExp(`^\\|-enditem\\|${IDENT[target]}: [^|]+\\|(Ganlon|Apicot|Starf|Lansat) Berry\\|\\[eat\\]`).test(l));
        if ((oh!.truncated ?? 0) > 0 || between) {
          if (ah.max === null || ah.max < oh!.dmgMax) push(`${slot}→${target}`, "hit.max", `≥ ${oh!.dmgMax}`, ah.max, between ? "a Berry between the hits: the calculations cover the sums dealt" : "hits stopped at the knockout: the calculation covers the hits dealt");''', "Berry between hits: covering rule"),
])

# Fixed (a template literal drops the backslashes):
apply([('scripts/.cache/calc-audit/2v2/verify/compare.ts', '        const between = Object.keys(o.lines).some((l) => new RegExp(`^\\|-enditem\\|${IDENT[target]}: [^|]+\\|(Ganlon|Apicot|Starf|Lansat) Berry\\|\\[eat\\]`).test(l));', '        const between = Object.keys(o.lines).some((l) => l.startsWith(`|-enditem|${IDENT[target]}: `) && /\\|(Ganlon|Apicot|Starf|Lansat) Berry\\|\\[eat\\]$/.test(l));', 'Berry between hits: a regex literal')])
