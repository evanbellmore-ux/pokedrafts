# Integration 1a: docs/champions-calculator.md checked against what wave 1a landed (W1A-U1.md needsFromIntegrator). Applied
# first, by hand: "Ripen's weakened Berry halves the next hit; Symbiosis passes its item on an item used; Psychic Noise" lost its
# Symbiosis clause (Symbiosis stays not estimated).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
D = "docs/champions-calculator.md"
apply([
 (D, "Natural Gift under Embargo or Heal Block (**Natural Gift with Embargo is not modelled in 2v2.**), and Revival Blessing",
     "Natural Gift under Embargo or Heal Block (**Natural Gift with Embargo is not modelled in 2v2.**), a Symbiosis holder passing its item (**Symbiosis is not modelled in 2v2.**), and Revival Blessing",
     "Symbiosis: narrow"),
 (D, "a one-hit KO move is a fixed hit of the target's full HP with every immunity it reads (**Sheer Cold: a one-hit KO move; it deals Snorlax's full HP.**, **Sturdy: Snorlax is immune.**)",
     "a one-hit KO move is a fixed hit of the target's full HP after every immunity it reads (**Sturdy: Snorlax is immune.**, **Glalie is immune to Sheer Cold.**; Focus Sash, Endure and a Substitute act on it as on any hit)",
     "OHKO facts"),
 (D, "A Terrain Seed in its terrain, Room Service under Trick Room and Booster Energy for a Protosynthesis or Quark Drive holder are used as they arrive, which is not followed (**Electric Seed received by Pikachu is not modelled in 2v2.**), and neither is",
     "A Terrain Seed in its terrain and Room Service under Trick Room are used as they arrive (**Its Electric Seed is used up on Electric Terrain: +1 Defense.**); Booster Energy for a Protosynthesis or Quark Drive holder is not followed (**Booster Energy received by Iron Hands is not modelled in 2v2.**), and neither is",
     "a received Seed or Room Service"),
 (D, "Not estimated: Max Moves, Parental Bond, Magician taking an item, Mind Blown and a signature Z-Move with an effect of its own into a Substitute (**Max Moves into a Substitute is not modelled in 2v2.**); a multi-hit move into one in front of Multiscale, Shadow Shield, Stamina, Weak Armor, Water Compaction, Seed Sower, Sand Spit, a contact move's Mummy, Lingering Aroma or Wandering Spirit, a resist Berry of the move's type or Luminous Moss (**Bullet Seed into Gastrodon's Substitute with Rindo Berry is not modelled in 2v2.**), or an intact Disguise or Ice Face (**Disguise against a multi-hit move is not modelled in 2v2.**).",
     "Max Moves' and Z-Moves' effects, Magician taking an item with a one-target move, both of Parental Bond's strikes and Mind Blown's cost per Substitute follow it (status2); so does a multi-hit move whose hits after the break meet Multiscale, Stamina, Weak Armor, Mummy, a resist Berry, Luminous Moss or an intact Disguise or Ice Face. Not estimated, each with its fact: Triple Axel, Triple Kick, Parental Bond's doubled strike or a Gem's first hit into a Substitute that breaks, and a multi-hit move with recoil, drain or a cost of its own into a Substitute.",
     "Substitute's narrow reasons"),
 (D, "The calculator does not know how many turns a weather, terrain, Gravity or Magic Room from before the turn has left, so where their ending this turn would change it a turn fact says they go on:",
     "Without an answer in Field conditions (**Weather ends this turn**, **Terrain ends this turn**, **Gravity ends this turn**, **Magic Room ends this turn**), where their ending this turn would change it a turn fact says they go on; a weather the answer ends stops at order 1, and a terrain, Gravity or Magic Room it ends makes the end of turn not estimated for now (**Magic Room ending is not modelled in 2v2.**):",
     "the field's end-of-turn answers"),
])
