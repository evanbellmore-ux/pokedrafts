# Integration 1b (V2's T2P-BKB-02-champions): a drag or a selfSwitch needs a Pokémon to come in (sim/battle-actions.ts
# forceSwitch: canSwitch(target.side); :1290 selfSwitch: canSwitch(source.side)). With canSwitch false on that side the
# Pokémon stays in: no switch-out.
from patchlib import rep
F = "doubles-turn.ts"
rep(F, """  // U-turn, Volt Switch and Flip Turn switch the user out after a hit (selfSwitch): its replacement is not known. A gas
  // holder takes its Neutralizing Gas with it, whether or not an action follows. With no later action the switch
  // reaches only the end of turn (doubles-eot.ts leaving; R's doubles-switch.ts switchOut).
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted) {""", """  // U-turn, Volt Switch and Flip Turn switch the user out after a hit (selfSwitch): its replacement is not known. A gas
  // holder takes its Neutralizing Gas with it, whether or not an action follows. With no later action the switch
  // reaches only the end of turn (doubles-eot.ts leaving; R's doubles-switch.ts switchOut). A side with no Pokémon left to
  // switch in (canSwitch false) keeps it in (sim/battle-actions.ts:1290-1291 canSwitch(source.side)).
  const switchable = (slot: DoublesSlotId) => ctx.input.canSwitch?.[slotSide(slot)] !== false;
  if (SWITCH_MOVES.has(id) && ownAny && !user.fainted && switchable(attacker)) {""", "selfswitch")
rep(F, """  // Dragon Tail and Circle Throw drag the target out (forceSwitch: sim/battle-actions.ts:1353-1360, then
  // sim/battle.ts:2821-2829 between actions), unless it is Dynamaxed or a Suction Cups or Guard Dog holder
  // (onDragOut, breakable): later moves meet its replacement, which is not known.
  const dragged = DRAG_MOVES.has(id) && own && !receiver.fainted && !isMaxActive(receiver.build)""", """  // Dragon Tail and Circle Throw drag the target out (forceSwitch: sim/battle-actions.ts:1353-1360, then
  // sim/battle.ts:2821-2829 between actions), unless it is Dynamaxed or a Suction Cups or Guard Dog holder
  // (onDragOut, breakable), or its side has no Pokémon left to switch in (canSwitch false, :1357): later moves meet its
  // replacement, which is not known.
  const dragged = DRAG_MOVES.has(id) && own && !receiver.fainted && switchable(target) && !isMaxActive(receiver.build)""", "drag")
