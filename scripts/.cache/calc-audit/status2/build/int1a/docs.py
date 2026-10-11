# Integration 1a: docs/champions-calculator.md, F's asks of U1 (W1A-F.md needsFromOthers): Fling is calculated in 1v1.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
D = "docs/champions-calculator.md"
apply([
 (D, "and Fling or Counter comes next), Uses to KO is not estimated", "and Counter comes next), Uses to KO is not estimated", "Uses to KO: Fling is calculated"),
 (D, "- Other history-dependent moves (for example Counter, Fling, Fury Cutter) get **Needs context**, not guessed damage.", "- Other history-dependent moves (for example Counter, Fury Cutter) get **Needs context**, not guessed damage.", "Needs context: Fling left it"),
 (D, "- Other unsupported special-damage mechanics are explicitly withheld. Fling's item eligibility/consumption is not verified. Source or engine data gaps remain visible instead of being silently mapped to another Pokémon/move.",
  "- **Fling** throws the held item at its pinned power (Iron Ball 130, a Mega Stone 80, a TR 120 in Sword/Shield), with the item's own damage effects for the hit; a Terastallized user gets Showdown's 60-power floor. It fails with no item, under Magic Room or Embargo, with a working Klutz, or with an item it cannot throw, each as a fact (**Fling fails: Garchomp has no item.**). The item's effect is a fact (**Flame Orb: Snorlax is burned.**, **Sitrus Berry: Snorlax eats it.**, **King's Rock: Snorlax flinches if it has not moved.**), and Uses to KO counts it (the thrown item gone: no Life Orb recoil after the throw; a burn or poison it gave at that end of turn).\n"
  "- Other unsupported special-damage mechanics are explicitly withheld. Source or engine data gaps remain visible instead of being silently mapped to another Pokémon/move.",
  "the Fling bullet"),
])
