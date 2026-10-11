# Integration 1a, compare.ts: an Encore that rewrote the queued move (D's encoreRewrites: the app's fact "Encore: {Name} uses
# {Move}." with the oracle's `|effective|{Move}` line) is compared as the move used (G4-ENC-01-sv: Rest became Body Slam).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "scripts/.cache/calc-audit/2v2/verify/compare.ts"
apply([
 (F, '''    if (o.effects) compareEffects(slot, o, s, near, push, isStatus(o.moveId), c);''', '''    // status2 (integration 1a): an Encore that changed the queued move: the move used decides how its hits compare.
    const encored = s.facts.map((f) => /^Encore: .+ uses (.+)\.$/.exec(f.text)?.[1]).find((name) => name && o.lines[`|effective|${name}`] !== undefined);
    const usedStatus = isStatus(encored ? toID(encored) : o.moveId);
    if (o.effects) compareEffects(slot, o, s, near, push, usedStatus, c);''', "the Encore's move used"),
 (F, '''    const hits = new Map<SlotId, DoublesHit>(s.hits.map((h) => [h.slot as SlotId, h]));
    if (isStatus(o.moveId)) {''', '''    const hits = new Map<SlotId, DoublesHit>(s.hits.map((h) => [h.slot as SlotId, h]));
    if (usedStatus) {''', "the Encore's move used (hits)"),
])
