# Integration 1a, after dead-sites.py: OWN_RULE_MOVES (doubles-faces.ts) was read only by the FACE_UNSAFE_MOVES guard.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-faces.ts", '''/** The moves whose 0-damage hit this file applies itself (the item and status rules below): no afterHit needed for them. */
const OWN_RULE_MOVES: ReadonlySet<string> = new Set(["knockoff", "thief", "covet", "bugbite", "pluck", "incinerate", "smellingsalts", "wakeupslap"]);
''', "", "faces: OWN_RULE_MOVES (its reader went)"),
])
