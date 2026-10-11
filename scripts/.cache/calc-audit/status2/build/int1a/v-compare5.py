# Integration 1a, compare.ts (A1's and W's asks of V1): Showdown clears a fainted Pokemon's stages (clearVolatile), so the
# app's stage mixture counts each outcome's living share only (its HP distribution's mass above 0).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "scripts/.cache/calc-audit/2v2/verify/compare.ts"
apply([
 (F, '''        const got = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot] && stageOf(oc.mons[slot], stat) === n ? oc.chance : 0), 0);
        if (!near(got, want)) push(`E2 ${slot}`, `stage ${stat}:${n}`, want, got);''', '''        // status2 (integration 1a): the living share of each outcome (a fainted Pokémon's stages are cleared in Showdown).
        const living = (m: NonNullable<typeof outcomes.outcomes[number]["mons"][SlotId]>) => m.hp.reduce((x, h) => x + (h.hp > 0 ? h.chance : 0), 0);
        const got = outcomes.outcomes.reduce((x, oc) => x + (oc.mons[slot] && stageOf(oc.mons[slot], stat) === n ? oc.chance * living(oc.mons[slot]!) : 0), 0);
        if (!near(got, want)) push(`E2 ${slot}`, `stage ${stat}:${n}`, want, got);''', "E2 stages: the living share"),
])
