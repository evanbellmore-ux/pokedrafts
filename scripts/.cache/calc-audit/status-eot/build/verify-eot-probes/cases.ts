// VERIFY-eot-training: the neighbourhood of each EOT fix (status-eot review lens eot-training). Showdown names; level 50,
// 31 IVs, Serious, 0 EVs unless set: HP = base + 75, Speed = base + 20.
import type { Case, CaseAction, CaseMon, SlotId } from "../../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const lax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });

/** Oracle cases (sim-dfs vs app-turn through compareCase). */
export const VERIFY_CASES: Case[] = [
  // ---------- EOT-1: a weather from before with one turn left, set again this turn ----------
  {
    id: "VE01", title: "Rain (1 left): Rain Dance first fails, then Sunny Day sets a new sun (Solar Power acts)", game: "sv", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Solar Power", { hp: 120 }), "Sunny Day"), act(mon("Jolteon", "Volt Absorb"), "Rain Dance"),
      idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(lax({ hp: 150 }))),
    checks: "Jolteon is faster: its Rain Dance fails, Sunny Day sets a 5-turn sun; Solar Power 153/8 = 19, no Rain Dish.",
  },
  {
    id: "VE02", title: "Rain (2 left): Sunny Day then Rain Dance: a new rain or the old one give the same HP", game: "sv", weatherTurns: 2, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Blaze", { nature: "Timid" }), "Sunny Day"), act(mon("Pelipper", "Drizzle"), "Rain Dance"),
      idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(lax({ hp: 150 }))),
    checks: "The new rain counts 5 → 4: Rain Dish 9 (the old one would count 2 → 1 and heal the same).",
  },
  {
    id: "VE03", title: "Rain (1 left): Sand Spit sets sand on a hit, then Rain Dance sets a new rain", game: "sv", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Garchomp", "Rough Skin", { nature: "Jolly" }), "Dragon Claw", PR), act(mon("Pelipper", "Drizzle"), "Rain Dance"),
      idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(mon("Sandaconda", "Sand Spit"))),
    checks: "The app cannot tell the new rain from the old one: not estimated (the guard), oracle: Rain Dish 9.",
  },
  {
    id: "VE04", title: "Rain (1 left): the Sunny Day user is asleep (Rest, cannot wake), Rain Dance fails: the old rain ends", game: "sv", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Blaze", { nature: "Timid", status: "slp", carried: { sleep: { attempts: 0, rest: true } } }), "Sunny Day"), act(mon("Pelipper", "Drizzle"), "Rain Dance"),
      idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(lax({ hp: 150 }))),
    checks: "No sun: Rain Dance fails, the rain ends at order 1, no Rain Dish (exact; the guard may be conservative here).",
  },
  {
    id: "VE05", title: "Rain (1 left): Max Flare then Max Geyser (SwSh): a new rain", game: "swsh", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Blaze", { nature: "Timid", choice: "dynamax" }), "Flamethrower", PR), idle(mon("Tentacruel", "Rain Dish", { hp: 100 })),
      idle(lax({ hp: 150 })), act(mon("Blastoise", "Torrent", { choice: "dynamax" }), "Surf", "own-right")),
    checks: "Max Geyser after Max Flare sets a 5-turn rain: Rain Dish heals (the app: the guard).",
  },
  {
    id: "VE06", title: "Rain (1 left), Champions: Sunny Day then Rain Dance", game: "champions", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Blaze", { nature: "Timid" }), "Sunny Day"), act(mon("Politoed", "Drizzle"), "Rain Dance"),
      idle(mon("Pelipper", "Rain Dish", { hp: 100 })), idle(lax({ hp: 150 }))),
    checks: "As RV01 in Champions: the app gives the guard.",
  },
  // ---------- EOT-2: Harvest and Pickup ----------
  {
    id: "VE07", title: "Harvest in sun with a Lum Berry eaten at a carried Yawn's sleep", game: "sv", weatherTurns: 3, outcomes: true,
    field: { weather: "Sun" },
    slots: slots(idle(mon("Exeggutor", "Harvest", { item: "Lum Berry", carried: { yawn: true } })), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Yawn's sleep at 23, the Lum Berry cures it at once; Harvest (sun: certain) restores it at 28.2: the app is not estimated.",
  },
  {
    id: "VE08", title: "Harvest holder keeps its Sitrus (above half): ready", game: "sv", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(mon("Exeggutor", "Harvest", { item: "Sitrus Berry", hp: 150 })), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Sand 10: 140 > 85, no Berry: Harvest has nothing to restore.",
  },
  {
    id: "VE09", title: "Pickup holder holding an item: no Pickup after a Sitrus eaten at the weather's Update", game: "sv", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(lax({ hp: 120, item: "Sitrus Berry" })), idle(mon("Ambipom", "Pickup", { hp: 75, item: "Leftovers" })),
      idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Ambipom holds Leftovers: Pickup does nothing (pokemon.item); Leftovers 9 at 5.4.",
  },
  {
    id: "VE10", title: "Pickup after a Lum Berry eaten at a carried Yawn's sleep", game: "sv", outcomes: true,
    slots: slots(idle(lax({ item: "Lum Berry", carried: { yawn: true } })), idle(mon("Ambipom", "Pickup", { hp: 75 })),
      idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Snorlax falls asleep at 23 and eats its Lum Berry; Ambipom's Pickup (28.2) takes it: the app is not estimated.",
  },
  {
    id: "VE11", title: "Pickup when a foe's Sitrus is eaten at the weather's Update (Champions)", game: "champions", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(mon("Diggersby", "Pickup", { hp: 100 })), idle(mon("Venusaur", "Overgrow")),
      idle(lax({ hp: 120, item: "Sitrus Berry" })), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Every active Pokémon is adjacent in doubles: Pickup takes the foe's Sitrus: the app is not estimated.",
  },
  // ---------- EOT-3: results that rely on a weather, terrain or room going on ----------
  {
    id: "VE12", title: "Leaf Guard and a Flame Orb in sun with one turn left: burned", game: "sv", weatherTurns: 1, outcomes: true,
    field: { weather: "Sun" },
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { item: "Flame Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "The sun ends at order 1: the Orb burns at 28.3.",
  },
  {
    id: "VE13", title: "Hydration in a rain set this turn by Rain Dance: cured, no assumption", game: "sv", outcomes: true,
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150 })), act(mon("Pelipper", "Drizzle"), "Rain Dance"), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "A new rain lasts 5 turns: Hydration cures at 5.3; no burn damage.",
  },
  {
    id: "VE14", title: "Hydration in Champions with the rain's last turn", game: "champions", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "The rain ends at order 1: the burn deals 205/16 = 12.",
  },
  {
    id: "VE15", title: "Hydration in USUM rain with two turns left: cured", game: "usum", weatherTurns: 2, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "The rain goes on: Hydration cures at 5.3 (gen 7).",
  },
  // ---------- Roost's volatile ending at order 25 ----------
  {
    id: "VE16", title: "Tera Flying Corviknight uses Roost in Grassy Terrain: no Roost volatile, not grounded", game: "sv", outcomes: true, field: { terrain: "Grassy" },
    slots: slots(act(mon("Corviknight", "Pressure", { hp: 60, teraType: "Flying", choice: "terastallize" }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "roost onStart returns false when Terastallized: Corviknight stays Flying, Grassy Terrain does not heal it (60 + 86 = 146).",
  },
  {
    id: "VE17", title: "Roost at full HP (the heal fails) and a carried Yawn in Electric Terrain", game: "sv", outcomes: true, field: { terrain: "Electric" },
    slots: slots(act(mon("Corviknight", "Pressure", { carried: { yawn: true } }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Whether the Roost volatile starts when the heal fails decides whether Electric Terrain stops Yawn's sleep at 23.",
  },
  {
    id: "VE18", title: "Harvest after a Sitrus eaten at the weather's Update (Champions, Trevenant)", game: "champions", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(mon("Trevenant", "Harvest", { hp: 90, item: "Sitrus Berry" })), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Sand 10 → 80, at or under half: the Sitrus at the weather's Update; Harvest 1/2 at 28.2: the app is not estimated.",
  },
  {
    id: "VE19", title: "Roost and a Flame Orb under Misty Terrain (USUM)", game: "usum", outcomes: true, field: { terrain: "Misty" },
    slots: slots(act(mon("Skarmory", "Sturdy", { item: "Flame Orb", hp: 100 }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Gen 7: Roost ends at 25, the Orb burns at 28.3.",
  },
  {
    id: "VE20", title: "Roost with a carried Yawn in Misty Terrain: still grounded at 23", game: "sv", outcomes: true, field: { terrain: "Misty" },
    slots: slots(act(mon("Corviknight", "Pressure", { hp: 100, carried: { yawn: true } }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Yawn (23) before Roost's end (25): grounded, Misty Terrain stops the sleep.",
  },
  {
    id: "VE21", title: "Magic Room from before and a Flame Orb (the room's turns are not an input)", game: "sv", outcomes: true, field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Flame Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "With five turns left: no burn. With one left the room ends at 27.6 and the Orb burns.",
  },
];

/** App-only text cases: the facts the residual states. */
export const VERIFY_TEXTS: Case[] = [
  {
    id: "VT01", title: "Magic Room from before, Flame Orb holder", game: "sv", field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Flame Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Expect `Assumes Magic Room does not end this turn.`",
  },
  {
    id: "VT02", title: "Magic Room from before, Sitrus at 100/235", game: "sv", field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Sitrus Berry", hp: 100 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Expect the Magic Room fact (the final Update would eat the Sitrus if it ended at 27.6).",
  },
  {
    id: "VT03", title: "Magic Room from before, Sticky Barb", game: "sv", field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Sticky Barb", hp: 200 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Expect the Magic Room fact.",
  },
  {
    id: "VT04", title: "Magic Room from before, Leftovers only (5.4, before the room's countdown)", game: "sv", field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Leftovers", hp: 100 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "No Magic Room fact: nothing after 27.6 reads an item.",
  },
  {
    id: "VT05", title: "Magic Room from before, Sitrus above half", game: "sv", field: { magicRoom: true },
    slots: slots(idle(lax({ item: "Sitrus Berry", hp: 200 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "No Magic Room fact: the Sitrus is not due.",
  },
  {
    id: "VT06", title: "Magic Room used this turn (new): Flame Orb", game: "sv",
    slots: slots(idle(lax({ item: "Flame Orb" })), act(mon("Klefki", "Prankster"), "Magic Room"), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "A new room lasts 5 turns: no fact.",
  },
  {
    id: "VT07", title: "Misty Terrain from before, Toxic Orb (fixer's fact)", game: "sv", field: { terrain: "Misty" },
    slots: slots(idle(lax({ item: "Toxic Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Expect `Assumes the Misty Terrain does not end this turn.`",
  },
  {
    id: "VT08", title: "Hydration with Utility Umbrella in rain from before: no cure, no fact", game: "sv", field: { weather: "Rain" },
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150, item: "Utility Umbrella" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "No rain for the holder: the burn deals 12; no assumption fact.",
  },
  {
    id: "VT09", title: "Leaf Guard and Flame Orb in Harsh Sunshine (strong, USUM): no fact", game: "usum", field: { weather: "Harsh Sunshine" },
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { item: "Flame Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(mon("Groudon", "Desolate Land", { appSpecies: "groudonprimal", item: "Red Orb" }))),
    checks: "A strong weather has no countdown: no assumption fact.",
  },
];
