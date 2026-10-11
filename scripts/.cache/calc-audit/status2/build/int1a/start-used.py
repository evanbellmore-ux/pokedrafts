# Integration 1a: an item the start settle ate at the turn's first Update (an HP, pinch or curing Berry; a Custap Berry as its
# move is chosen) was used this turn (pinned eatItem: usedItemThisTurn), so Pickup can take it (G4-PKP-01-sv, -05-champions).
# A Terrain Seed used on entry (only `folded` drops it) is not this turn's.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-turn.ts", '''    // An item the start settle used up (F3 §4.1: the input item, not a popped Air Balloon; its usedItem waits for the
    // settle's own record of the turn's first Update, doubles-start.ts).
    const held = input.pokemon[slot]!.build.itemId;
    if (ctx.tracksItems && held && !start.folded.itemId && held !== "airballoon") mons[slot]!.lastItem = held;
''', '''    // An item the start settle used up (F3 §4.1: the input item, not a popped Air Balloon). One it ate at the turn's first
    // Update (settleItems: start.items.build has none) was used this turn (usedItemThisTurn: Pickup reads it; integration
    // 1a); a Terrain Seed used on entry (only `folded` drops it) was not.
    const held = input.pokemon[slot]!.build.itemId;
    if (ctx.tracksItems && held && !start.folded.itemId && held !== "airballoon") mons[slot]!.lastItem = held;
    if (ctx.tracksItems && held && !start.items.build.itemId && held !== "airballoon") mons[slot]!.usedItem = true;
''', "start-settled items were used this turn"),
])
