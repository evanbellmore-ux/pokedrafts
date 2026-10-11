# Integration 1a, SPEC2 §8.4's second line: gasShieldGuard also reads an Embargo on a shielded Pokemon (itemSuppressed: the
# Ability Shield is ignored, PS/sim/pokemon.ts hasItem -> ignoringItem), now that Embargo leaves GAS_CHANGING_MOVES (a3.py I5).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-turn.ts",
  '''  if (w.field.magicRoom !== ctx.input.field.magicRoom || shielded.some((slot) => w.mons[slot]!.build.itemId !== "abilityshield")) notEstimated(REASONS.gasShield);''',
  '''  // status2 (SPEC2 §8.4): an Embargo on it ignores the Shield too (hasItem reads ignoringItem); a carried one never let it act.
  if (w.field.magicRoom !== ctx.input.field.magicRoom || shielded.some((slot) => w.mons[slot]!.build.itemId !== "abilityshield" || w.mons[slot]!.build.itemSuppressed)) notEstimated(REASONS.gasShield);''',
  "gasShieldGuard reads itemSuppressed"),
 ("doubles-turn.ts",
  ''' * Covet) or Magic Room starting or ending changes which abilities act: not followed.''',
  ''' * Covet), Magic Room starting or ending, or an Embargo on it (status2) changes which abilities act: not followed.''',
  "gasShieldGuard doc"),
 ("doubles-actions.ts",
  ''' * Play, Doodle, Transform), drag a Pokémon out (Roar, Whirlwind), or move, remove or switch off an Ability Shield (Trick,
 * Switcheroo, Bestow, Corrosive Gas, Embargo, Magic Room).''',
  ''' * Play, Doodle, Transform), drag a Pokémon out (Roar, Whirlwind), or move an Ability Shield (Trick, Switcheroo). status2
 * (SPEC2 §8.4): Bestow, Corrosive Gas, Embargo and Magic Room left it; gasShieldGuard follows a Shield they change.''',
  "GAS_CHANGING_MOVES doc"),
])
# A suppressed Pokemon given an Ability Shield this turn (Bestow, Recycle, Symbiosis: Bestow left GAS_CHANGING_MOVES) gets its
# ability back (ignoringAbility: hasItem('Ability Shield')): not followed either.
apply([
 ("doubles-turn.ts",
  '''  const shielded = ctx.gas?.shielded.filter((slot) => alive(w, slot)) ?? [];
  if (!shielded.length) return;
''',
  '''  const shielded = ctx.gas?.shielded.filter((slot) => alive(w, slot)) ?? [];
  // status2 (integration 1a): a suppressed Pokémon given an Ability Shield (Bestow, Recycle, Symbiosis) gets its ability back.
  if (ctx.gas?.suppressed.some((slot) => alive(w, slot) && w.mons[slot]!.build.itemId === "abilityshield")) notEstimated(REASONS.gasShield);
  if (!shielded.length) return;
''',
  "gasShieldGuard: a Shield gained under the gas"),
])

# Refined (a suppressed holder of a Shield under Magic Room at the start is not a change):
apply([('doubles-turn.ts', '  // status2 (integration 1a): a suppressed Pokémon given an Ability Shield (Bestow, Recycle, Symbiosis) gets its ability back.\n  if (ctx.gas?.suppressed.some((slot) => alive(w, slot) && w.mons[slot]!.build.itemId === "abilityshield")) notEstimated(REASONS.gasShield);\n', '  // status2 (integration 1a): a suppressed Pokémon whose Ability Shield now works (given by Bestow, Recycle or Symbiosis; Magic\n  // Room ending) gets its ability back (ignoringAbility: hasItem(\'Ability Shield\'), which ignores Klutz).\n  if (ctx.gas?.suppressed.some((slot) => alive(w, slot) && w.mons[slot]!.build.itemId === "abilityshield" && !w.field.magicRoom && !w.mons[slot]!.build.itemSuppressed)) notEstimated(REASONS.gasShield);\n', 'gasShieldGuard: a Shield that starts to work under the gas')])
