// status2 integration 1a: the cases for the integrator's own lines (status2/build/INTEGRATION-1A.md), each against pinned
// Showdown c23d2e94 as every other case: Struggle's recoil sets no hurtThisTurn (Assurance), the trapped volatile of Jaw Lock,
// Anchor Shot, Spirit Shackle and Thousand Waves (A1's trapAfterHit, wired in afterHit), Magic Room under Neutralizing Gas with no
// Ability Shield (SPEC2 §8.4). Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set. Wired into cases-wave1a.ts.
import type { Case } from "./case-types";
import { OL, OR, PL, PR, act, idle, lax, mon, slots } from "./case-kit";

export const INT1A_CASES: Case[] = [
  {
    id: "INT-STR-01-sv", game: "sv", outcomes: true,
    title: "Struggle's recoil (directDamage) sets no hurtThisTurn: a slower Assurance into the Struggle user is not doubled",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Struggle"), idle(lax(0)), act(mon("Kingambit", "Defiant"), "Assurance", OL), idle(lax(8))),
    checks: "battle-actions.ts:1388-1389 struggleRecoil: directDamage; battle.ts:2138 hurtThisTurn only in spreadDamage; assurance basePowerCallback.",
  },
  {
    id: "INT-STR-02-sv", game: "sv", outcomes: true,
    title: "The control: Double-Edge's recoil (damage) sets hurtThisTurn: the slower Assurance into its user is doubled",
    slots: slots(act(mon("Garchomp", "Rough Skin", { evs: { spe: 252 } }), "Double-Edge", PL), idle(lax(0)), act(mon("Kingambit", "Defiant"), "Assurance", OL), idle(lax(8))),
    checks: "battle-actions.ts:1392 recoil through this.battle.damage.",
  },
  {
    id: "INT-TRP-01-usum", game: "usum", outcomes: true,
    title: "Dhelmise's Anchor Shot traps Snorlax (a certain secondary: the trapped volatile after the turn)",
    slots: slots(act(mon("Dhelmise", "Steelworker"), "Anchor Shot", PL), idle(lax(0)), idle(lax(8)), idle(lax(16))),
    checks: "moves.ts anchorshot secondary.onHit: addVolatile('trapped', source, move, 'trapper').",
  },
  {
    id: "INT-TRP-02-usum", game: "usum", outcomes: true,
    title: "Decidueye's Spirit Shackle into a Ghost type: no trapped volatile (addVolatile fails on a Ghost)",
    slots: slots(act(mon("Decidueye", "Overgrow"), "Spirit Shackle", PL), idle(lax(0)), idle(mon("Gengar", "Cursed Body")), idle(lax(16))),
    checks: "conditions.ts trapped onTrapPokemon; Ghost types are immune to trapping (pokemon.ts trapping immunity).",
  },
  {
    id: "INT-TRP-03-swsh", game: "swsh", outcomes: true,
    title: "Drednaw's Jaw Lock traps both it and its target",
    slots: slots(act(mon("Drednaw", "Strong Jaw"), "Jaw Lock", PL), idle(lax(0)), idle(lax(8)), idle(lax(16))),
    checks: "moves.ts jawlock onHit: source and target each trapped by the other.",
  },
  {
    id: "INT-TRP-04-usum", game: "usum", outcomes: true,
    title: "Zygarde's Thousand Waves traps both foes (spread), not through a Substitute",
    slots: slots(act(mon("Zygarde", "Aura Break"), "Thousand Waves"), idle(lax(0)), idle(lax(8)), idle(lax(16, { item: "Leftovers" }))),
    checks: "moves.ts thousandwaves onHit: target.addVolatile('trapped', source, move, 'trapper') for each target.",
  },
  // No Corrosive Gas, Bestow or Embargo meets Neutralizing Gas and an Ability Shield in one game (Bestow and Embargo: USUM; Corrosive
  // Gas: SwSh, Champions; the gas: SwSh, SV; the Shield: SV): Magic Room is the one of the four that reaches a shielded Pokémon (VG39).
  {
    id: "INT-GAS-02-sv", game: "sv", outcomes: true,
    title: "Magic Room under Neutralizing Gas with no Ability Shield in play changes no ability: Flamethrower into a gassed Thick Fat",
    slots: slots(act(mon("Klefki", "Prankster"), "Magic Room"), act(mon("Charizard", "Blaze"), "Flamethrower", PR),
      idle(mon("Weezing-Galar", "Neutralizing Gas")), idle(lax(4, { item: "Leftovers" }))),
    checks: "SPEC2 §8.4: Magic Room left GAS_CHANGING_MOVES; Leftovers off for the end of turn.",
  },
];
void OR;
