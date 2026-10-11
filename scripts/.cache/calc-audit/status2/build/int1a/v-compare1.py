# Integration 1a, compare.ts: an oracle residual line with no `other` and no HP change (Pickup: one line, its items as facts)
# against the app's lines for the same effect split by their source (`other`): their chances add.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("scripts/.cache/calc-audit/2v2/verify/compare.ts", '''    used.add(j);
    const a = eot.residuals[j];
    if (!near(a.chance, r.chance)) push(`endOfTurn ${r.slot}`, `residual ${r.effect}.chance`, r.chance, a.chance);''', '''    used.add(j);
    const a = eot.residuals[j];
    // status2 (integration 1a): the app splits a line with no HP change by its source (Pickup's `other`); the oracle's has none.
    let chance = a.chance;
    if (r.other === undefined && r.min === null && a.min === null && a.other !== undefined) {
      eot.residuals.forEach((b, k) => {
        if (!used.has(k) && b.slot === r.slot && b.min === null && b.other !== undefined && residualMatches(r.effect, b)) { used.add(k); chance += b.chance; }
      });
    }
    if (!near(chance, r.chance)) push(`endOfTurn ${r.slot}`, `residual ${r.effect}.chance`, r.chance, chance);''', "compare: per-source lines with no HP change add up"),
])
