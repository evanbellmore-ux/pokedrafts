# Integration 1b: a hit at the residual whose source is not in battle (a Future Sight or Doom Desire landing from a fainted
# user or a build) runs as an action at the first slot of the source's side (doubles-turn.ts residualHit), which may be empty
# (Training: the user fainted and nothing came in) or hold another Pokémon. K's koRetaliationAfter (its Flower Veil fact)
# and A2's Color Change read that slot as the user: a TypeError on an empty slot (t2-fuzz.ts seed 101, battle 12 turn 22:
# `Cannot read properties of undefined (reading 'build')` at secondaryLands), another Pokemon's state otherwise.
# Pinned Showdown (data/conditions.ts futuremove onEnd): trySpreadMoveHit([target], data.source, hitMove, true), no ModifyType
# event, the move's own type (Normal only for an active source's Normalize: Pokemon.hasAbility is false for one not active,
# sim/pokemon.ts ignoringAbility); a landing move has no secondaries and no stat drop.
from patchlib import rep
rep("doubles-world.ts", """  /** status2 PR: a Dancer's copy (runMove externalMove). */
  external?: true;
};""", """  /** status2 PR: a Dancer's copy (runMove externalMove). */
  external?: true;
  /**
   * status2 integration 1b: a hit at the residual whose source is not in battle (doubles-turn.ts residualHit): `slot` only
   * names the source's side (it may be empty or hold another Pokémon), so nothing reads it as the user.
   */
  userless?: true;
};""", "PendingAction.userless")
rep("doubles-turn.ts", """  const action: PendingAction = { index: -1, slot, moveId: move.id, target, fractional: 0 };
  if (receiver.eot.hidden) return [{ world: w, landed: 0 }];""", """  const action: PendingAction = { index: -1, slot, moveId: move.id, target, fractional: 0, ...(source ? {} : { userless: true as const }) };
  if (receiver.eot.hidden) return [{ world: w, landed: 0 }];""", "residualHit userless")
rep("doubles-reactions.ts", """  // Flower Veil kept the move's drop off a Grass target (the step's veil): the hit's fact (T2M §4.2).
  if (outcome.landed > 0 && !info.transformed && kernel.alive(w, target) && kernel.secondaryLands(w, action.slot, target, info)""",
 """  // Flower Veil kept the move's drop off a Grass target (the step's veil): the hit's fact (T2M §4.2). Integration 1b: none for a
  // residual hit whose source is not in battle (action.userless: a landing move drops nothing, and no Pokémon is its user).
  if (!action.userless && outcome.landed > 0 && !info.transformed && kernel.alive(w, target) && kernel.secondaryLands(w, action.slot, target, info)""",
 "koRetaliationAfter userless")
rep("doubles-typing.ts", """  if (info.effective.category === "Status") return;
  const user = w.mons[action.slot]!.build;
  if (user.abilityId === "sheerforce" && info.secondaries) return;
  const type = retyped(w, action.slot, action.moveId!, kernel.usedType(w, action.slot, action.moveId!, target, info, kernel.input.pokemon[action.slot]?.contexts[action.moveId!]));""",
 """  if (info.effective.category === "Status") return;
  // Integration 1b: a residual hit whose source is not in battle (action.userless) has the move's own type: the landing runs
  // no ModifyType (data/conditions.ts futuremove onEnd), and the Normalize it reads is an active source's.
  const user = action.userless ? null : w.mons[action.slot]!.build;
  if (user?.abilityId === "sheerforce" && info.secondaries) return;
  const type = !user ? info.effective.type
    : retyped(w, action.slot, action.moveId!, kernel.usedType(w, action.slot, action.moveId!, target, info, kernel.input.pokemon[action.slot]?.contexts[action.moveId!]));""",
 "colorChange userless")
