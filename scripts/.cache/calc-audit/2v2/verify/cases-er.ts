// status-eot SPEC §7.1 "End of turn (R)" cases. R ids are taken by review-engine/cases.ts, so ERnn is SPEC Rnn. Showdown
// names; level 50, 31 IVs, Serious nature and 0 EVs unless set (Speed at level 50 with 0 EVs is base + 20). Most Pokémon
// take No move: the end of turn is what each case checks.
import type { Case, CaseAction, CaseMon, SlotId } from "./case-types";
import { chomp, clef, gengar, lax, saur, sm, toise, zard } from "./cases-s";

type Slot = CaseMon & { action: CaseAction };
type Game = Case["game"];
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const empty = (m: CaseMon): Slot => ({ ...m, absent: true, action: { move: null } });
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const games = <T,>(list: readonly Game[], f: (g: Game) => T): T[] => list.map(f);
/** Snorlax with Speed EVs n (4: 51, 12: 52, 20: 53, 28: 54). */
const laxN = (spe: number, extra: Partial<CaseMon> = {}) => lax({ evs: { spe }, ...extra });

export const ER_CASES: Case[] = [
  // ---- R01: sand immunities.
  {
    id: "ER01a", title: "Sandstorm: Overcoat, Magic Guard, Safety Goggles, a plain Pokémon", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(mon("Cloyster", "Overcoat")), idle(clef()), idle(lax({ item: "Safety Goggles" })), idle(toise())),
    checks: "Only Blastoise takes 1/16; then the Update after the weather.",
  },
  {
    id: "ER01b", title: "Sandstorm: Ground, Steel, Rock types", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(chomp({ ability: "Sand Veil" })), idle(mon("Magnezone", "Sturdy")), idle(mon("Tyranitar", "Unnerve")), idle(saur())),
    checks: "Ground, Steel and Rock are immune; Venusaur takes 1/16.",
  },
  {
    id: "ER01c", title: "Sandstorm: a Dive user on its charge turn", game: "sv", field: { weather: "Sand" },
    slots: slots(act(sm(), "Dive", PL), idle(mon("Jolteon", "Volt Absorb")), idle(saur()), idle(toise())),
    checks: "Smeargle (the last action) is underwater on Dive's charge turn: no sand damage; the others take 1/16.",
  },
  {
    id: "ER01d-champions", title: "Sandstorm (Champions)", game: "champions", field: { weather: "Sand" },
    slots: slots(idle(mon("Garchomp", "Sand Veil")), idle(toise()), idle(clef()), idle(lax())),
    checks: "Champions sand: Garchomp immune, Magic Guard immune, Blastoise and Snorlax 1/16.",
  },
  // ---- R02, R03: hail and snow.
  {
    id: "ER02-usum", title: "Hail: Ice Body, Snow Cloak, Ice type, a plain Pokémon (USUM)", game: "usum", field: { weather: "Hail" },
    slots: slots(idle(mon("Vanilluxe", "Ice Body", { hp: 100 })), idle(mon("Froslass", "Snow Cloak")), idle(lax()), idle(mon("Mamoswine", "Thick Fat"))),
    checks: "Ice Body heals 1/16; Snow Cloak and Ice types take no hail; Snorlax takes 1/16.",
  },
  {
    id: "ER03-sv", title: "Snow: Ice Body heals, nothing is damaged (SV)", game: "sv", field: { weather: "Snow" },
    slots: slots(idle(mon("Glalie", "Ice Body", { hp: 100 })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Snow deals no damage; Ice Body heals 1/16.",
  },
  // ---- R04, R05: rain and sun.
  {
    id: "ER04", title: "Rain: Rain Dish, Dry Skin, Hydration, Utility Umbrella", game: "sv", field: { weather: "Rain" },
    slots: slots(idle(mon("Pelipper", "Rain Dish", { hp: 100 })), idle(mon("Toxicroak", "Dry Skin", { hp: 100 })),
      idle(mon("Swanna", "Hydration", { status: "brn" })), idle(mon("Toxicroak", "Dry Skin", { hp: 100, item: "Utility Umbrella", evs: { spe: 4 } }))),
    checks: "Rain Dish +1/16, Dry Skin +1/8, Hydration cures the burn (5.3) before it burns (10); Utility Umbrella: no Dry Skin heal.",
  },
  {
    id: "ER05", title: "Sun: Dry Skin, Solar Power, Utility Umbrella", game: "sv", field: { weather: "Sun" },
    slots: slots(idle(mon("Toxicroak", "Dry Skin")), idle(zard({ ability: "Solar Power" })), idle(zard({ ability: "Solar Power", item: "Utility Umbrella", evs: { spe: 4 } })), idle(saur())),
    checks: "Dry Skin −1/8, Solar Power −1/8 in sun; Utility Umbrella cancels it.",
  },
  // ---- R06: Cloud Nine.
  {
    id: "ER06a", title: "Sandstorm with a Cloud Nine holder in", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(mon("Golduck", "Cloud Nine")), idle(lax()), idle(saur()), idle(toise())),
    checks: "Cloud Nine suppresses the weather: no sand damage.",
  },
  {
    id: "ER06b", title: "Sandstorm, the Cloud Nine holder knocked out during the moves", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(mon("Golduck", "Cloud Nine", { hp: 1 })), idle(lax()), act(chomp(), "Dragon Claw", OL), idle(toise())),
    checks: "Golduck faints to Dragon Claw: the sand acts at the end of turn on Snorlax and Blastoise.",
  },
  // ---- R07, R08: the Updates.
  {
    id: "ER07", title: "Sand takes a Sitrus holder to half: the weather's Update, then Leftovers", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(lax({ item: "Sitrus Berry", hp: 125 })), idle(toise({ item: "Leftovers", hp: 100 })), idle(chomp()), idle(saur())),
    checks: "Snorlax 125 − 14 = 111 ≤ 117: Sitrus at the Update after the weather; then Leftovers (5.4).",
  },
  {
    id: "ER08a", title: "Poison takes a Sitrus holder to half: the final Update", game: "sv",
    slots: slots(idle(lax({ item: "Sitrus Berry", hp: 140, status: "psn" })), idle(toise()), idle(chomp()), idle(saur())),
    checks: "Poison (9) takes Snorlax to 111; the Sitrus Berry is eaten at the final Update.",
  },
  {
    id: "ER08b", title: "Poison, then a Salt Cure knockout before the Berry's Update", game: "sv",
    slots: slots(idle(lax()), idle(saur()), idle(toise({ item: "Figy Berry", hp: 50, status: "psn", carried: { saltCure: true } })), idle(chomp())),
    checks: "Blastoise 50 − 19 (poison) = 31 ≤ 1/4: Figy due, but Salt Cure (13, Water: 1/4 = 38) knocks it out before any Update.",
  },
  // ---- R09: order 5, Speed before subOrder; Trick Room.
  {
    id: "ER09a", title: "Order 5: Speed before subOrder (Grassy Terrain, Leftovers)", game: "sv", field: { terrain: "Grassy" },
    slots: slots(idle(mon("Jolteon", "Volt Absorb", { item: "Leftovers", hp: 100 })), idle(lax({ hp: 100 })), idle(chomp({ hp: 100 })), idle(saur({ hp: 100, item: "Leftovers" }))),
    checks: "Each Pokémon's Grassy heal (5.2) and Leftovers (5.4) come together in Speed order: Jolteon, Garchomp, Venusaur, Snorlax.",
  },
  {
    id: "ER09b", title: "Order 5 under Trick Room", game: "sv", field: { terrain: "Grassy", trickRoom: true },
    slots: slots(idle(mon("Jolteon", "Volt Absorb", { item: "Leftovers", hp: 100 })), idle(lax({ hp: 100 })), idle(chomp({ hp: 100 })), idle(saur({ hp: 100, item: "Leftovers" }))),
    checks: "Trick Room reverses the residual Speed order (10000 − speed).",
  },
  {
    id: "ER09c-champions", title: "Order 5 under Champions Trick Room", game: "champions", field: { terrain: "Grassy", trickRoom: true },
    slots: slots(idle(mon("Jolteon", "Volt Absorb", { item: "Leftovers", hp: 100 })), idle(lax({ hp: 100 })), idle(chomp({ hp: 100 })), idle(saur({ hp: 100, item: "Leftovers" }))),
    checks: "Champions Trick Room sorts by −speed.",
  },
  // ---- R10: Grassy Terrain grounding.
  {
    id: "ER10a", title: "Grassy Terrain: Flying, Levitate, Air Balloon, Iron Ball", game: "sv", field: { terrain: "Grassy" },
    slots: slots(idle(zard({ hp: 100 })), idle(mon("Bronzong", "Levitate", { hp: 100 })), idle(lax({ hp: 100, item: "Air Balloon" })), idle(laxN(12, { hp: 100, item: "Iron Ball" }))),
    checks: "Only the Iron Ball Snorlax is grounded and heals 1/16.",
  },
  {
    id: "ER10b", title: "Grassy Terrain under Gravity", game: "sv", field: { terrain: "Grassy", gravity: true },
    slots: slots(idle(zard({ hp: 100 })), idle(mon("Bronzong", "Levitate", { hp: 100 })), idle(lax({ hp: 100, item: "Air Balloon" })), idle(toise({ hp: 100 }))),
    checks: "Gravity grounds everyone: all four heal 1/16.",
  },
  {
    id: "ER10c", title: "Grassy Terrain after Smack Down", game: "sv", field: { terrain: "Grassy" },
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Smack Down", PL), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), idle(mon("Corviknight", "Pressure", { hp: 120 })), idle(toise({ hp: 100 }))),
    checks: "Smack Down (the last action) grounds Corviknight: it heals 1/16 at the end of turn.",
  },
  {
    id: "ER10d", title: "Grassy Terrain: Dig and Fly charge turns", game: "sv", field: { terrain: "Grassy" },
    slots: slots(act(mon("Donphan", "Sturdy", { hp: 100 }), "Dig", PL), idle(mon("Corviknight", "Pressure", { hp: 100 })), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), idle(toise({ hp: 100 }))),
    checks: "Dig is the last action (70): Donphan underground (semi-invulnerable): no Grassy heal; Corviknight (Flying): none; the foes heal.",
  },
  {
    id: "ER10e", title: "Sandstorm: a Fly user on its charge turn", game: "sv", field: { weather: "Sand" },
    slots: slots(act(zard({ hp: 100 }), "Fly", PL), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Dragapult", "Clear Body")), idle(chomp())),
    checks: "Fly is the last action (120): Charizard in the air at the end of turn; whether sand hurts it is Showdown's (the oracle).",
  },
  // ---- R11: weather and terrain set this turn; weatherTurns.
  {
    id: "ER11a", title: "Sandstorm and Grassy Terrain used this turn", game: "sv",
    slots: slots(act(mon("Tyranitar", "Unnerve"), "Sandstorm"), act(saur(), "Grassy Terrain"), idle(lax({ hp: 100 })), idle(toise({ hp: 100 }))),
    checks: "Both set this turn act at the end of turn: sand 1/16, Grassy +1/16.",
  },
  {
    id: "ER11b", title: "Sandstorm with one turn left", game: "sv", field: { weather: "Sand" }, weatherTurns: 1,
    slots: slots(idle(lax()), idle(saur()), idle(toise()), idle(clef())),
    checks: "weatherTurns 1: the sand ends at this end of turn without acting.",
  },
  {
    id: "ER11c", title: "Sandstorm with no turn count", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(lax()), idle(saur()), idle(toise()), idle(clef())),
    checks: "No weatherTurns: it lasts (the assumption fact) and acts.",
  },
  // ---- R12-R14: items, burn, poison.
  {
    id: "ER12", title: "Leftovers, Black Sludge on Poison and not, Sticky Barb", game: "sv",
    slots: slots(idle(lax({ item: "Leftovers", hp: 100 })), idle(gengar({ item: "Black Sludge", hp: 60 })), idle(laxN(12, { item: "Black Sludge" })), idle(toise({ item: "Sticky Barb" }))),
    checks: "Leftovers +1/16; Black Sludge +1/16 on Gengar, −1/8 on Snorlax; Sticky Barb −1/8.",
  },
  {
    id: "ER13", title: "Burn, Heatproof, Magic Guard", game: "sv",
    slots: slots(idle(lax({ status: "brn" })), idle(mon("Bronzong", "Heatproof", { status: "brn" })), idle(clef({ status: "brn" })), idle(toise())),
    checks: "Burn 1/16; Heatproof halves it; Magic Guard: none.",
  },
  {
    id: "ER14", title: "Poison, bad poison at stage 3, Poison Heal, Toxic Orb", game: "sv",
    slots: slots(idle(lax({ status: "psn" })), idle(laxN(12, { status: "tox", carried: { toxic: 3 } })), idle(mon("Breloom", "Poison Heal", { status: "psn", hp: 80 })), idle(toise({ item: "Toxic Orb" }))),
    checks: "Poison 1/8; bad poison stage 3 → 4: 4/16; Poison Heal +1/8; Toxic Orb badly poisons Blastoise at 28.3 with no damage this turn.",
  },
  {
    id: "ER15", title: "Baneful Bunker and Burning Bulwark this turn, then the end of turn", game: "sv",
    slots: slots(act(chomp(), "Dragon Claw", PL), act(lax(), "Body Slam", PR), act(mon("Toxapex", "Regenerator"), "Baneful Bunker"), act(sm(), "Burning Bulwark")),
    checks: "Garchomp poisoned by Baneful Bunker, Snorlax burned by Burning Bulwark: 1/8 and 1/16 at the end of turn.",
  },
  // ---- R16, R17: Leech Seed.
  {
    id: "ER16a", title: "Leech Seed from before the turn, Big Root", game: "sv",
    slots: slots(idle(saur({ hp: 100, item: "Big Root" })), idle(lax()), idle(chomp({ carried: { leechSeed: OL } })), idle(toise())),
    checks: "Garchomp −22, Venusaur +22 × Big Root (29).",
  },
  {
    id: "ER16b", title: "Leech Seed, the seeder knocked out during the moves", game: "sv",
    slots: slots(idle(saur({ hp: 1 })), idle(lax()), idle(laxN(12, { carried: { leechSeed: OL } })), act(chomp(), "Dragon Claw", OL)),
    checks: "Venusaur faints to Dragon Claw: no seeder at its slot, so no drain.",
  },
  {
    id: "ER16c", title: "Leech Seed, the seeder faints to sand first", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(saur({ hp: 1 })), idle(lax()), idle(laxN(12, { carried: { leechSeed: OL } })), idle(toise())),
    checks: "Venusaur faints to the sand (order 1) before Leech Seed (8): no drain.",
  },
  {
    id: "ER16d", title: "Leech Seed into Liquid Ooze; a Magic Guard seeded", game: "sv",
    slots: slots(idle(saur({ hp: 100 })), idle(lax()), idle(mon("Tentacruel", "Liquid Ooze", { carried: { leechSeed: OL } })), idle(clef({ carried: { leechSeed: OL } }))),
    checks: "Liquid Ooze: Venusaur takes the drain. Magic Guard: Clefable loses nothing, Venusaur gains nothing.",
  },
  {
    id: "ER17", title: "Mutual Leech Seed at equal Speed", game: "sv",
    slots: slots(idle(saur({ hp: 15, carried: { leechSeed: PL } })), idle(lax()), idle(saur({ hp: 15, carried: { leechSeed: OL } })), idle(toise())),
    checks: "Equal Speed (101): the two drains are a tie; whichever runs first knocks out its seeded Pokémon (19 ≥ 15) and the other then has no seeder.",
  },
  // ---- R18: partial trap.
  {
    id: "ER18a", title: "Fire Spin this turn", game: "sv",
    slots: slots(act(zard(), "Fire Spin", PL), idle(lax()), idle(laxN(12)), idle(toise())),
    checks: "Snorlax trapped this turn: 1/8 at the end of turn.",
  },
  {
    id: "ER18b", title: "A trap from before the turn, Binding Band", game: "sv",
    slots: slots(idle(zard({ item: "Binding Band" })), idle(lax()), idle(laxN(12, { carried: { trap: { source: OL, bindingBand: true } } })), idle(toise())),
    checks: "Binding Band: 1/6.",
  },
  {
    id: "ER18c", title: "A trap, the trapper knocked out during the moves", game: "sv",
    slots: slots(idle(zard({ hp: 1 })), idle(lax()), idle(laxN(12, { carried: { trap: { source: OL, bindingBand: false } } })), act(chomp(), "Dragon Claw", OL)),
    checks: "The trapper has fainted: the trap ends with no damage.",
  },
  {
    id: "ER18d", title: "A trap, the trapper faints to sand first", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(zard({ hp: 1 })), idle(lax()), idle(laxN(12, { carried: { trap: { source: OL, bindingBand: false } } })), idle(toise())),
    checks: "Charizard faints to the sand (1) before the trap (13): no trap damage.",
  },
  // ---- R19: Salt Cure.
  ...games(["sv", "champions"], (game) => ({
    id: `ER19a-${game}`, title: `Salt Cure this turn and from before (${game})`, game,
    slots: slots(act(mon("Garganacl", "Purifying Salt"), "Salt Cure", PL), idle(saur()), idle(lax()), idle(toise({ carried: { saltCure: true } }))),
    checks: "SV: 1/8, Water or Steel 1/4; Champions: 1/16 and 1/8.",
  })),
  {
    id: "ER19c", title: "Salt Cure into Covert Cloak", game: "sv",
    slots: slots(act(mon("Garganacl", "Purifying Salt"), "Salt Cure", PL), idle(saur()), idle(lax({ item: "Covert Cloak" })), idle(toise())),
    checks: "Covert Cloak stops the added effect: no salt cure.",
  },
  {
    id: "ER19d", title: "A trap and Salt Cure on one Pokémon (a tie)", game: "sv",
    slots: slots(idle(zard()), idle(lax()), idle(toise({ hp: 40, carried: { trap: { source: OL, bindingBand: false }, saltCure: true } })), idle(saur())),
    checks: "Both order 13 on Blastoise: shuffled; either knocks it out second (C9: the KO is credited by permutation).",
  },
  // ---- R20, R21: Curse; Aqua Ring, Ingrain; Psychic Noise.
  {
    id: "ER20", title: "Ghost Curse from before the turn and this turn", game: "sv",
    slots: slots(act(gengar(), "Curse", PR), idle(saur()), idle(lax({ carried: { curse: true } })), idle(toise())),
    checks: "Both cursed Pokémon lose 1/4; Gengar paid half its HP.",
  },
  {
    id: "ER21a", title: "Aqua Ring and Ingrain from before the turn, Big Root", game: "sv",
    slots: slots(idle(toise({ hp: 100, carried: { aquaRing: true } })), idle(saur({ hp: 100, item: "Big Root", carried: { ingrain: true } })), idle(chomp()), idle(lax())),
    checks: "Aqua Ring +1/16 (6), Ingrain +1/16 × Big Root (7).",
  },
  {
    id: "ER21b", title: "Psychic Noise as the last action blocks Aqua Ring and Leftovers", game: "sv",
    slots: slots(act(mon("Hatterene", "Healer"), "Psychic Noise", PL), idle(lax()), idle(toise({ hp: 120, item: "Leftovers", carried: { aquaRing: true } })), idle(saur())),
    checks: "Heal Block (Hatterene 49 is the last action): no Aqua Ring or Leftovers heal on Blastoise.",
  },
  {
    id: "ER21c", title: "Psychic Noise as the last action blocks a Sitrus Berry", game: "sv",
    slots: slots(act(mon("Hatterene", "Healer"), "Psychic Noise", PL), idle(toise()), idle(laxN(12, { item: "Sitrus Berry", hp: 150 })), idle(saur())),
    checks: "Snorlax's Sitrus Berry is not eaten at the Update after the hit (TryHeal fails) nor at the final Update.",
  },
  // ---- R22, R23: Healer, Shed Skin.
  ...games(["sv", "champions"], (game) => ({
    id: `ER22a-${game}`, title: `Healer before poison (${game})`, game,
    slots: slots(idle(mon("Hatterene", "Healer")), idle(lax({ status: "psn" })), idle(chomp()), idle(toise())),
    checks: "Healer (5.3) cures the ally's poison before it hurts (9): SV 3/10, Champions 1/2.",
  })),
  {
    id: "ER22c", title: "Healer, the holder faints to sand first", game: "sv", field: { weather: "Sand" },
    slots: slots(idle(mon("Hatterene", "Healer", { hp: 1 })), idle(lax({ status: "psn" })), idle(chomp()), idle(toise())),
    checks: "Hatterene faints to the sand: no Healer; Snorlax poisoned and sand-hurt.",
  },
  {
    id: "ER23", title: "Shed Skin before burn", game: "sv",
    slots: slots(idle(mon("Sandaconda", "Shed Skin", { status: "brn" })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Shed Skin (5.3) cures with 33/100 before the burn (10).",
  },
  // ---- R25: Bad Dreams.
  {
    id: "ER25a", title: "Bad Dreams on a sleeper and a Comatose foe", game: "sv",
    slots: slots(idle(lax({ status: "slp" })), idle(mon("Komala", "Comatose")), idle(mon("Darkrai", "Bad Dreams")), idle(toise())),
    checks: "Bad Dreams: 1/8 on asleep Snorlax and on Comatose Komala.",
  },
  {
    id: "ER25b", title: "Bad Dreams on a Magic Guard sleeper", game: "sv",
    slots: slots(idle(clef({ status: "slp" })), idle(lax()), idle(mon("Darkrai", "Bad Dreams")), idle(toise())),
    checks: "Magic Guard: no Bad Dreams damage.",
  },
  {
    id: "ER25c", title: "Bad Dreams, the holder knocked out during the moves", game: "sv",
    slots: slots(idle(lax({ status: "slp" })), act(chomp(), "Dragon Claw", PL), idle(mon("Darkrai", "Bad Dreams", { hp: 1 })), idle(toise())),
    checks: "Darkrai at 0 HP: no Bad Dreams.",
  },
  // ---- R27, R28: perish, Wish.
  {
    id: "ER27", outcomes: true, title: "Perish counts from before the turn: 1 and 3", game: "sv",
    slots: slots(idle(lax({ carried: { perish: 1 } })), idle(saur()), idle(chomp({ carried: { perish: 3 } })), idle(toise())),
    checks: "Perish 1 → 0: Snorlax faints at 24; perish 3 → 2.",
  },
  {
    id: "ER28", title: "A Wish landing; one at full HP", game: "sv",
    slots: slots(idle(lax({ hp: 100, carried: { wish: 117 } })), idle(saur()), idle(chomp({ carried: { wish: 90 } })), idle(toise())),
    checks: "Wish heals Snorlax 117 (order 4); Garchomp at full HP: no heal.",
  },
  // ---- R29: Speed Boost, Syrup Bomb.
  {
    id: "ER29a", outcomes: true, title: "Speed Boost", game: "sv",
    slots: slots(idle(mon("Blaziken", "Speed Boost")), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Speed Boost: Speed +1 at 28.2 (E2 build).",
  },
  {
    id: "ER29b", outcomes: true, title: "Syrup Bomb from before the turn: Mirror Armor, White Herb", game: "sv",
    slots: slots(idle(mon("Hydrapple", "Regenerator")), idle(lax()), idle(mon("Corviknight", "Mirror Armor", { carried: { syrupBomb: OL } })), idle(laxN(12, { item: "White Herb", carried: { syrupBomb: OL } }))),
    checks: "Syrup Bomb (14): Mirror Armor sends Speed −1 back to Hydrapple; White Herb (29) restores Snorlax's Speed.",
  },
  {
    id: "ER29c", title: "Syrup Bomb from before the turn: Eject Pack", game: "sv",
    slots: slots(idle(mon("Hydrapple", "Regenerator")), idle(lax()), idle(laxN(12, { item: "Eject Pack", carried: { syrupBomb: OL } })), idle(toise())),
    checks: "The Speed drop triggers Eject Pack: Snorlax switches out after the turn (fact).",
  },
  // ---- R31, R32: Emergency Exit; switches out on the last action.
  {
    id: "ER31a-usum", title: "Emergency Exit after burn (USUM)", game: "usum",
    slots: slots(idle(mon("Golisopod", "Emergency Exit", { status: "brn", hp: 80 })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Burn takes Golisopod from above half to half or below: Emergency Exit after the turn (fact).",
  },
  {
    id: "ER31b-usum", title: "Emergency Exit kept off by a Sitrus Berry at the final Update (USUM)", game: "usum",
    slots: slots(idle(mon("Golisopod", "Emergency Exit", { status: "brn", hp: 80, item: "Sitrus Berry" })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Burn to half, Sitrus Berry at the final Update back above half: no Emergency Exit.",
  },
  {
    id: "ER32a", title: "Eject Button on the last hit", game: "sv", endNotEstimated: "Blastoise switches out: the replacement is not known.",
    slots: slots(act(lax(), "Body Slam", PL), idle(saur()), idle(toise({ item: "Eject Button" })), idle(chomp())),
    checks: "The last action's hit sends Blastoise out: the moves are estimated, the end of turn is not.",
  },
  {
    id: "ER32b-usum", title: "Emergency Exit in the last move (USUM)", game: "usum", endNotEstimated: "Golisopod switches out: the replacement is not known.",
    slots: slots(act(lax(), "Body Slam", PL), idle(saur()), idle(mon("Golisopod", "Emergency Exit", { hp: 100 })), idle(chomp())),
    checks: "Body Slam takes Golisopod to half or below: Emergency Exit, the end of turn is not estimated.",
  },
  // ---- R34: Dynamax in sand.
  {
    id: "ER34-swsh", title: "Dynamax in sand (SwSh)", game: "swsh", field: { weather: "Sand" },
    slots: slots(act(lax({ choice: "dynamax" }), "Body Slam", PL), idle(saur()), idle(toise()), idle(chomp())),
    checks: "Sand on the Dynamaxed Snorlax: 1/16 of its base maximum HP; the fact that Dynamax started this turn.",
  },
  // ---- R37-R40.
  {
    id: "ER37", title: "Tailwind this turn reorders the residuals", game: "sv",
    slots: slots(act(mon("Whimsicott", "Prankster"), "Tailwind"), idle(lax({ item: "Leftovers", hp: 100 })), idle(saur({ item: "Leftovers", hp: 100 })), idle(toise())),
    checks: "Snorlax (51 → 102 under Tailwind) now comes before Venusaur (101) in the residual order.",
  },
  {
    id: "ER38", title: "An Unnerve holder faints in the residual: Berries at the final Update", game: "sv",
    slots: slots(idle(lax({ item: "Sitrus Berry", hp: 100 })), idle(saur()), idle(mon("Corviknight", "Unnerve", { status: "brn", hp: 1 })), idle(toise())),
    checks: "Unnerve stopped Snorlax's Sitrus during the moves; Corviknight faints to burn (10); the Sitrus is eaten at the final Update.",
  },
  {
    id: "ER39", title: "A commuting tie: two burned Pokémon at equal Speed", game: "sv",
    slots: slots(idle(lax({ status: "brn" })), idle(saur()), idle(lax({ status: "brn" })), idle(toise())),
    checks: "Two burns at 51: the tie commutes (same HP either way).",
  },
  {
    id: "ER40", outcomes: true, title: "Soul-Heart on a residual faint", game: "sv",
    slots: slots(idle(lax({ status: "brn", hp: 1 })), idle(saur()), idle(mon("Magearna", "Soul-Heart")), idle(toise())),
    checks: "Snorlax faints to burn: Soul-Heart Sp. Atk +1 (E2 build).",
  },
  // ---- R41: end-of-turn guards (the moves stay estimated).
  {
    id: "ER41a", title: "Neutralizing Gas holder faints in the residual", game: "sv", endNotEstimated: "Neutralizing Gas ending is not modelled in 2v2.",
    slots: slots(idle(lax()), idle(saur()), idle(mon("Weezing", "Neutralizing Gas", { status: "brn", hp: 1 })), idle(toise())),
    checks: "Weezing faints to burn while Snorlax's Thick Fat is suppressed.",
  },
  {
    id: "ER41b", title: "Pickup after an item was used this turn", game: "sv", endNotEstimated: "Pickup is not modelled in 2v2.",
    slots: slots(act(chomp(), "Dragon Claw", PL), idle(mon("Dedenne", "Pickup")), idle(lax({ item: "Sitrus Berry", hp: 150 })), idle(toise())),
    checks: "Snorlax eats its Sitrus Berry; Dedenne (no item) has Pickup.",
  },
  {
    id: "ER41c", title: "Harvest with no item", game: "sv", endNotEstimated: "Harvest is not modelled in 2v2.",
    slots: slots(idle(mon("Exeggutor", "Harvest")), idle(lax()), idle(chomp()), idle(toise())),
    checks: "A Harvest holder with no item.",
  },
  {
    id: "ER41d", title: "Cud Chew from before the turn", game: "sv", endNotEstimated: "Cud Chew is not modelled in 2v2.",
    slots: slots(idle(mon("Farigiraf", "Cud Chew", { carried: { cudChew: true } })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "A Berry Cud Chew re-eats now.",
  },
  {
    id: "ER41e", title: "Future Sight landing", game: "sv", endNotEstimated: "Future Sight landing is not modelled in 2v2.",
    slots: slots(idle(lax()), idle(saur()), idle(chomp({ carried: { futureMove: "futuresight" } })), idle(toise())),
    checks: "A carried Future Sight lands on Garchomp at this end of turn (the oracle runs the moves only).",
  },
  {
    id: "ER41f", title: "Moody (the calculator states a fact)", game: "sv",
    slots: slots(idle(mon("Glalie", "Moody")), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Moody raises one stat and lowers another; no HP changes (the calculator's end of turn is ready with the fact).",
  },
  {
    id: "ER41g-usum", title: "Zen Mode at the line (USUM)", game: "usum", endNotEstimated: "Zen Mode changing Darmanitan's form is not modelled in 2v2.",
    slots: slots(idle(mon("Darmanitan", "Zen Mode", { status: "brn", hp: 95 })), idle(lax()), idle(chomp()), idle(toise())),
    checks: "Burn takes Darmanitan across half: Zen Mode's form change.",
  },
  {
    id: "ER41h-swsh", title: "G-Max Wildfire this turn (SwSh)", game: "swsh", endNotEstimated: "G-Max Wildfire's damage over time is not modelled in 2v2.",
    slots: slots(act(zard({ choice: "dynamax", gigantamax: true, appBuild: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } }), "Flamethrower", PL), idle(lax()), idle(saur()), idle(toise())),
    checks: "G-Max Wildfire's damage over time.",
  },
  // ---- R45: Desolate Land ends in the residual.
  {
    id: "ER45-usum", outcomes: true, title: "A Desolate Land holder faints in the residual (USUM)", game: "usum", field: { weather: "Harsh Sunshine" },
    slots: slots(idle(mon("Groudon", "Desolate Land", { item: "Red Orb", appSpecies: "groudonprimal", status: "psn", hp: 1 })), idle(lax()), idle(chomp()), idle(saur())),
    checks: "Primal Groudon faints to poison (9): the harsh sunshine ends (E2 field).",
  },
];
