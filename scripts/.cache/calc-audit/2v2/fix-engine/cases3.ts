// Engine fixer's cases (round 1 fix-status items 2-22 and mech-status), same shape as verify/cases.ts. Showdown names;
// level 50, 31 IVs, Serious, 0 EVs unless set. `notEstimated`: the app's expected reason (the oracle still runs, to show
// what Showdown does there). The review's own probes (review-engine/cases.ts) are re-run by run.ts with EXPECT below.
import type { Case, CaseAction, CaseMon, SlotId } from "../verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId, context?: Record<string, unknown>): Slot =>
  ({ ...m, action: { move, ...(target ? { target } : {}), ...(context ? { context } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });

const chomp = mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 252, spe: 252 } });
const venusaur = mon("Venusaur", "Overgrow");
const blastoise = mon("Blastoise", "Torrent");
const snorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", extra);
const zard = mon("Charizard", "Blaze", { nature: "Timid", evs: { spa: 252, spe: 252 } });

/** The review probes' expected app result after the fixes: a not-estimated reason, or Showdown's numbers (null). */
export const EXPECT: Record<string, string | null> = {
  R01: "Confusion is not modelled in 2v2.",
  R02: "Protean changes Greninja's type: later moves are not modelled.",
  R03: "Double Shock changes Pawmot's type: later moves are not modelled.",
  R04: null, R05: null, R05u: null, R06: null,
  R07: "Burn Up changes Arcanine's type: later moves are not modelled.",
  R08: null,
  R09: "Fire Pledge with Grass Pledge is not modelled in 2v2.",
  R10: "Copycat is not modelled in 2v2.",
  R13: "Blastoise switches out: the replacement is not known.",
  R14: "Glaive Rush doubles the damage Baxcalibur takes: later moves are not modelled.",
  R15: "Confusion is not modelled in 2v2.",
  R16: "Status Z-Moves are not calculated.", R17: null,
};

export const FIX_CASES: Case[] = [
  // 16: no living foe, the attacker's own partner's Lightning Rod takes the move aimed at the fainted foe across.
  {
    id: "F16a", title: "Thunderbolt at a fainted foe goes to the partner's Lightning Rod", game: "sv",
    slots: slots(act(mon("Pikachu", "Static"), "Thunderbolt", "opponent-left"), act(mon("Raichu", "Lightning Rod", { nature: "Jolly", evs: { spe: 252 } }), "Quick Attack", "opponent-left"),
      idle(snorlax({ hp: 1 })), { ...idle(blastoise), absent: true }),
    checks: "Raichu's Quick Attack KOs Snorlax; Pikachu's Thunderbolt has no living foe: it targets the foe across, and Lightning Rod takes it (+1 Sp. Atk, no damage).",
  },
  {
    id: "F16b", title: "A move aimed at a fainted ally with no redirection fails", game: "sv",
    slots: slots(act(snorlax(), "Body Slam", "own-right"), idle(mon("Venusaur", "Overgrow", { hp: 1 })), idle(mon("Clefable", "Magic Guard")), act(chomp, "Dragon Claw", "own-right")),
    checks: "Garchomp KOs Venusaur; Snorlax's Body Slam at its fainted ally fails (no Follow Me).",
  },
  // 18: Clangorous Soulblaze with one foe: no spread modifier.
  {
    id: "F18a", title: "Clangorous Soulblaze into a lone foe", game: "usum",
    slots: slots(act(mon("Kommo-o", "Bulletproof", { item: "Kommonium Z", nature: "Timid", evs: { spa: 252, spe: 252 }, choice: "zmove" }), "Clanging Scales"), idle(venusaur),
      idle(blastoise), { ...idle(zard), absent: true }),
    checks: "One target: no 0.75 (sim/battle-actions.ts spreadHit needs two).",
  },
  // 15: Champions Trick Room above 999 Speed.
  {
    id: "F15a", title: "Champions Trick Room with Speeds above 999", game: "champions", field: { trickRoom: true, own: { tailwind: true }, opponent: { tailwind: true } },
    slots: slots(
      act(mon("Dragapult", "Clear Body", { nature: "Jolly", evs: { spe: 32 }, hp: 1, boosts: { spe: 6 } }), "Dragon Claw", "opponent-left"), idle(mon("Venusaur", "Overgrow")),
      act(mon("Garchomp", "Sand Veil", { nature: "Jolly", evs: { spe: 32 }, hp: 1, boosts: { spe: 6 } }), "Dragon Claw", "own-left"), idle(mon("Blastoise", "Torrent"))),
    checks: "1704 against 1352 under Trick Room: Garchomp moves first and KOs Dragapult.",
  },
  // 17: Flower Gift.
  {
    id: "F17a", title: "Flower Gift raises its partner's Attack in sun", game: "swsh", field: { weather: "Sun" },
    slots: slots(idle(mon("Cherrim", "Flower Gift")), act(chomp, "Dragon Claw", "opponent-left"), idle(snorlax()), idle(blastoise)),
    checks: "Garchomp, Cherrim's partner, has 1.5x Attack in sun (onAllyModifyAtk).",
  },
  {
    id: "F17b", title: "Mold Breaker ignores Flower Gift on the target's partner", game: "swsh", field: { weather: "Sun" },
    slots: slots(idle(mon("Cherrim", "Flower Gift")), idle(venusaur), act(mon("Haxorus", "Mold Breaker", { nature: "Modest" }), "Draco Meteor", "own-right"), idle(blastoise)),
    checks: "Flower Gift is breakable: no 1.5x Sp. Def for Venusaur against Mold Breaker.",
  },
  {
    id: "F17c", title: "Utility Umbrella keeps the sun off Flower Gift's partner", game: "swsh", field: { weather: "Sun" },
    slots: slots(idle(mon("Cherrim", "Flower Gift")), idle(mon("Venusaur", "Overgrow", { item: "Utility Umbrella" })), act(zard, "Air Slash", "own-right"), idle(blastoise)),
    checks: "The partner's own weather is none under its Umbrella: no Sp. Def boost.",
  },
  // 22: Steadfast's flinch Speed copied by an Opportunist foe.
  {
    id: "F22a", title: "Steadfast's Speed after a flinch and an Opportunist foe", game: "sv",
    slots: slots(act(mon("Hariyama", "Thick Fat"), "Fake Out", "opponent-left"), idle(mon("Espathra", "Opportunist")),
      act(mon("Lucario", "Steadfast"), "Close Combat", "own-left"), idle(blastoise)),
    checks: "Lucario flinches, +1 Speed; Espathra copies it.", notEstimated: "Opportunist copying a stat rise is not modelled in 2v2.",
  },
  // 14: Sleep Talk asleep, Snore asleep, Sleep Talk with Comatose.
  {
    id: "F14a", title: "Sleep Talk while asleep", game: "sv",
    slots: slots(act(snorlax({ status: "slp" }), "Sleep Talk"), idle(venusaur), act(blastoise, "Water Pulse", "own-left"), idle(zard)),
    checks: "A random move of its own, or it wakes and Sleep Talk fails.", notEstimated: "Sleep wears off at random.",
  },
  {
    id: "F14b", title: "Snore while asleep", game: "sv",
    slots: slots(act(snorlax({ status: "slp" }), "Snore", "opponent-left"), idle(venusaur), idle(blastoise), idle(zard)),
    checks: "Snore fails if Snorlax wakes first.", notEstimated: "Sleep wears off at random.",
  },
  {
    id: "F14c", title: "Sleep Talk with Comatose", game: "sv",
    slots: slots(act(mon("Komala", "Comatose"), "Sleep Talk"), idle(venusaur), act(blastoise, "Water Pulse", "own-left"), idle(zard)),
    checks: "Comatose: Sleep Talk calls a random move.", notEstimated: "Sleep Talk is not modelled in 2v2.",
  },
  // 21: Sucker Punch against Me First (USUM): Me First is not modelled at all.
  {
    id: "F21a", title: "Sucker Punch against a target using Me First", game: "usum",
    slots: slots(act(mon("Absol", "Pressure", { nature: "Jolly", evs: { spe: 252 } }), "Sucker Punch", "opponent-left"), idle(venusaur), act(mon("Lickilicky", "Own Tempo"), "Me First", "own-left"), idle(blastoise)),
    checks: "Me First copies the target's move.", notEstimated: "Me First is not modelled in 2v2.",
  },
  // Mech-status: Unnerve and As One from a Pokémon that is not the attacker.
  {
    id: "F30a", title: "A third Pokémon's Unnerve stops the target's Sitrus Berry", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-left"), idle(mon("Tyranitar", "Unnerve")), idle(snorlax({ item: "Sitrus Berry", hp: 120 })), idle(blastoise)),
    checks: "Tyranitar is a foe of Snorlax: no Sitrus Berry after Dragon Claw.",
  },
  {
    id: "F30b", title: "An attacker's Unnerve does not stop its own partner's Sitrus Berry", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Crunch", "own-right"), idle(snorlax({ item: "Sitrus Berry", hp: 120 })), idle(venusaur), idle(blastoise)),
    checks: "Unnerve acts on foes only: Snorlax eats its Sitrus Berry.",
  },
  {
    id: "F30c", title: "A third Pokémon's Unnerve stops the attacker's Sitrus Berry after recoil", game: "sv",
    slots: slots(act(mon("Garchomp", "Rough Skin", { item: "Sitrus Berry", hp: 100, nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Double-Edge", "opponent-left"), idle(venusaur),
      idle(snorlax()), idle(mon("Tyranitar", "Unnerve"))),
    checks: "Double-Edge's recoil takes Garchomp under half; Tyranitar stops its Sitrus Berry.",
  },
  {
    id: "F30d", title: "A third Pokémon's As One and a target's resist Berry", game: "sv",
    slots: slots(act(zard, "Air Slash", "opponent-left"), idle(mon("Calyrex-Shadow", "As One (Spectrier)")), idle(mon("Venusaur", "Overgrow", { item: "Coba Berry" })), idle(blastoise)),
    checks: "As One stops the Coba Berry; the calculation reads only the attacker's.", notEstimated: "As One (Spectrier) is not modelled in 2v2.",
  },
  {
    id: "F30e", title: "A third Pokémon's Unnerve and a Figy-family Berry eaten in a spread move", game: "sv",
    slots: slots(act(chomp, "Rock Slide"), idle(mon("Tyranitar", "Unnerve")), idle(snorlax({ item: "Figy Berry", hp: 70 })), idle(mon("Blastoise", "Torrent", { item: "Sitrus Berry", hp: 90 }))),
    checks: "Rock Slide into both foes: Tyranitar's Unnerve stops both Berries.",
  },
  // Mech-status: Throat Chop before a sound move.
  {
    id: "F31a", title: "Throat Chop before a slower sound move", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant", { nature: "Jolly", evs: { spe: 252 } }), "Throat Chop", "opponent-right"), idle(venusaur), idle(snorlax()), act(mon("Sylveon", "Pixilate"), "Hyper Voice")),
    checks: "Kingambit (102) chops Sylveon (80) first: Hyper Voice cannot be used (throatchop onBeforeMove).",
  },
  {
    id: "F31b", title: "Throat Chop before a slower move that is not a sound move", game: "sv",
    slots: slots(act(mon("Kingambit", "Defiant", { nature: "Jolly", evs: { spe: 252 } }), "Throat Chop", "opponent-right"), idle(venusaur), idle(snorlax()), act(mon("Sylveon", "Pixilate"), "Moonblast", "own-left")),
    checks: "Moonblast is not a sound move: Sylveon uses it.",
  },
  // Mech-status: Mirror Armor turns a Max Move's drop on the other foe back on the attacker.
  {
    id: "F32a", title: "Mirror Armor on the other foe of a Max Darkness", game: "swsh",
    slots: slots(act(mon("Weavile", "Pressure", { nature: "Jolly", evs: { atk: 252, spe: 252 }, choice: "dynamax" }), "Night Slash", "opponent-left"), idle(venusaur),
      act(mon("Snorlax", "Thick Fat", { nature: "Modest" }), "Fire Blast", "own-left"), idle(mon("Corviknight", "Mirror Armor"))),
    checks: "Max Darkness lowers both foes' Sp. Def; Corviknight's Mirror Armor turns it on Weavile: Fire Blast into Weavile at -1 Sp. Def.",
  },
  // 13: a Figy Berry eaten during a later hit's step (the target's step) by a target that still moves.
  {
    id: "F13a", title: "A Figy Berry eaten without a disliked Nature", game: "sv",
    slots: slots(act(chomp, "Dragon Claw", "opponent-left"), idle(venusaur), act(mon("Snorlax", "Thick Fat", { nature: "Adamant", item: "Figy Berry", hp: 150 }), "Body Slam", "own-right"), idle(blastoise)),
    checks: "Adamant lowers Sp. Atk: the Figy Berry does not confuse; Body Slam always comes.",
  },
  // 12: Glaive Rush with nothing after it.
  {
    id: "F12a", title: "Glaive Rush with no later damaging move", game: "sv",
    slots: slots(act(mon("Baxcalibur", "Thermal Exchange", { nature: "Jolly", evs: { atk: 252, spe: 252 } }), "Glaive Rush", "opponent-right"), idle(venusaur), idle(zard), idle(blastoise)),
    checks: "No later damaging move: the turn is ready.",
  },
  // 10: Protean with a status move and a later hit.
  {
    id: "F10a", title: "Protean with no later damaging move", game: "sv",
    slots: slots(act(mon("Greninja", "Protean", { nature: "Timid", evs: { spa: 252, spe: 252 } }), "Ice Beam", "opponent-right"), idle(venusaur), act(mon("Pelipper", "Drizzle"), "Tailwind"), idle(blastoise)),
    checks: "Only Tailwind follows: the type change reads nothing.",
  },
];

// 5: Bolt Beak against a target whose priority move comes first (the pane reads the order as the turn does).
FIX_CASES.push({
  id: "F05a", title: "Bolt Beak into a target using a priority move", game: "swsh",
  slots: slots(act(mon("Dracozolt", "Volt Absorb"), "Bolt Beak", "opponent-left"), idle(venusaur),
    act(mon("Azumarill", "Huge Power"), "Aqua Jet", "own-right"), idle(blastoise)),
  checks: "Azumarill's Aqua Jet (+1) comes first: Bolt Beak is not doubled though Dracozolt is faster.",
});
// 5: Analytic, the slowest Pokémon.
FIX_CASES.push({
  id: "F05b", title: "Analytic moving last", game: "sv",
  slots: slots(act(mon("Magnezone", "Analytic"), "Flash Cannon", "opponent-left"), idle(venusaur), idle(blastoise), act(chomp, "Dragon Claw", "own-right")),
  checks: "Magnezone (80) moves after every other Pokémon: Analytic 1.3x.",
});
// Mech-status: Unnerve against the user's own partner in a spread move, and an exploding user's Unnerve.
FIX_CASES.push({
  id: "F30f", title: "An Earthquake user's Unnerve and its partner's Sitrus Berry", game: "sv",
  slots: slots(act(mon("Tyranitar", "Unnerve"), "Earthquake"), idle(snorlax({ item: "Sitrus Berry", hp: 140 })), idle(venusaur), idle(mon("Blastoise", "Torrent", { item: "Sitrus Berry", hp: 100 }))),
  checks: "Snorlax, the user's partner, eats its Sitrus Berry; Blastoise, a foe, does not.",
});
FIX_CASES.push({
  id: "F30g", title: "Self-Destruct from an Unnerve user and the targets' Sitrus Berries", game: "swsh",
  slots: slots(act(mon("Mewtwo", "Unnerve"), "Self-Destruct"), idle(venusaur), idle(snorlax({ item: "Sitrus Berry", hp: 140 })), idle(mon("Blastoise", "Torrent", { item: "Sitrus Berry", hp: 120 }))),
  checks: "Mewtwo faints as Self-Destruct starts: its Unnerve no longer stops the foes' Sitrus Berries.",
});
