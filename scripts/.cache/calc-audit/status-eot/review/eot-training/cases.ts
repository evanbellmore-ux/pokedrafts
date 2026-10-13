// status-eot review, lens eot-training: end-of-turn interactions the stored oracle cases do not cover.
// Showdown names; level 50, 31 IVs, Serious nature, 0 EVs unless set: HP = base + 75, Speed = base + 20.
import type { Case, CaseAction, CaseMon, SlotId } from "../../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });
const OL: SlotId = "own-left", OR: SlotId = "own-right", PL: SlotId = "opponent-left", PR: SlotId = "opponent-right";
const lax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });

export const REVIEW_CASES: Case[] = [
  {
    id: "RV01", title: "Rain with one turn left is replaced by Sunny Day, then Rain Dance sets a new rain this turn", game: "sv", weatherTurns: 1, outcomes: true,
    field: { weather: "Rain" },
    slots: slots(act(mon("Charizard", "Blaze", { nature: "Timid" }), "Sunny Day"), act(mon("Pelipper", "Drizzle"), "Rain Dance"),
      idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(lax({ hp: 150 }))),
    checks: "Rain Dance's rain has duration 5: the residual counts it to 4 and Rain Dish heals Tentacruel 155/16 = 9.",
  },
  {
    id: "RV02", title: "Trick Room this turn reorders a mutual Leech Seed", game: "sv", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow", { hp: 100, carried: { leechSeed: PL } })), act(mon("Farigiraf", "Armor Tail"), "Trick Room"),
      idle(mon("Jolteon", "Volt Absorb", { hp: 10, carried: { leechSeed: OL } })), idle(lax())),
    checks: "Under Trick Room Venusaur's seed drains first: Jolteon 10 + 19 = 29, then 29 − 17 = 12; Venusaur 100 − 19 + 17 = 98.",
  },
  {
    id: "RV03", title: "Trick Room this turn reorders a mutual Leech Seed (Champions)", game: "champions", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow", { hp: 100, carried: { leechSeed: PL } })), act(mon("Farigiraf", "Armor Tail"), "Trick Room"),
      idle(mon("Jolteon", "Volt Absorb", { hp: 10, carried: { leechSeed: OL } })), idle(lax())),
    checks: "As RV02 under Champions (speed = -speed under Trick Room).",
  },
  {
    id: "RV04", title: "Fire Spin from a Binding Band holder this turn: 1/6", game: "sv", outcomes: true,
    slots: slots(act(mon("Charizard", "Blaze", { item: "Binding Band", nature: "Timid" }), "Fire Spin", PL), idle(mon("Venusaur", "Overgrow")),
      idle(lax({ hp: 200 })), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "The trap's boundDivisor 6: floor(235/6) = 39 at order 13.",
  },
  {
    id: "RV05", title: "Psychic Noise heal-blocks a Leech Seed seeder: the seeded still loses HP", game: "sv", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow", { hp: 120 })), idle(mon("Blastoise", "Torrent")),
      act(mon("Gengar", "Cursed Body"), "Psychic Noise", OL), idle(lax({ hp: 150, carried: { leechSeed: OL } }))),
    checks: "Snorlax loses 29; Venusaur's heal fails (healblock onTryHeal).",
  },
  {
    id: "RV06", title: "Flame Orb under Misty Terrain on a grounded holder; Toxic Orb on a Flying holder", game: "sv", outcomes: true,
    field: { terrain: "Misty" },
    slots: slots(idle(mon("Ursaluna", "Guts", { item: "Flame Orb" })), idle(mon("Gliscor", "Poison Heal", { item: "Toxic Orb" })),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Ursaluna is grounded in Misty Terrain: mistyterrain onSetStatus stops the Orb; Gliscor (Flying) is not grounded: badly poisoned.",
  },
  {
    id: "RV07", title: "A carried Yawn: a Sweet Veil ally, a Flying type in Electric Terrain", game: "sv", outcomes: true, field: { terrain: "Electric" },
    slots: slots(idle(mon("Charizard", "Blaze", { carried: { yawn: true } })), idle(mon("Snorlax", "Thick Fat", { carried: { yawn: true } })),
      idle(mon("Alcremie", "Sweet Veil")), idle(mon("Corviknight", "Pressure"))),
    checks: "Charizard (not grounded) falls asleep; Snorlax (grounded, Electric Terrain) does not; Alcremie (Sweet Veil) and Corviknight (Flying, a Sweet Veil ally) do not.",
  },
  {
    id: "RV08", title: "Tera types at the end of turn: sand on a Tera Fire Garchomp, Black Sludge and Salt Cure on a Tera Water Toxapex", game: "sv", outcomes: true,
    field: { weather: "Sand" },
    slots: slots(act(mon("Garchomp", "Rough Skin", { teraType: "Fire", choice: "terastallize", hp: 150 }), "Protect"), idle(mon("Clefable", "Magic Guard")),
      act(mon("Toxapex", "Regenerator", { item: "Black Sludge", teraType: "Water", choice: "terastallize", hp: 100, carried: { saltCure: true } }), "Protect"), idle(lax())),
    checks: "Tera Fire Garchomp is not a Ground type: sand 183/16 = 11. Tera Water Toxapex is not Poison: Black Sludge −1/8 (15) and sand 7, Salt Cure 1/4 (31).",
  },
  {
    id: "RV09", title: "Roost this turn grounds a Flying type for Grassy Terrain", game: "sv", outcomes: true, field: { terrain: "Grassy" },
    slots: slots(act(mon("Corviknight", "Pressure", { hp: 60 }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Roost's volatile stands until order 25: Corviknight (Steel only) is grounded at 5.2 and Grassy Terrain heals 173/16 = 10 after Roost.",
  },
  {
    id: "RV10", title: "Toxic Orb on a Steel type, Flame Orb on a Fire type: no status", game: "sv", outcomes: true,
    slots: slots(idle(mon("Corviknight", "Pressure", { item: "Toxic Orb" })), idle(mon("Charizard", "Blaze", { item: "Flame Orb" })),
      idle(mon("Jolteon", "Volt Absorb", { item: "Toxic Orb", hp: 100 })), idle(lax({ item: "Flame Orb", hp: 150 }))),
    checks: "Corviknight and Charizard are immune; Jolteon is badly poisoned, Snorlax burned, no damage this turn.",
  },
  {
    id: "RV11", title: "Healer cures the ally's sleep before Bad Dreams", game: "sv", outcomes: true,
    slots: slots(idle(mon("Alomomola", "Healer")), idle(lax({ status: "slp", hp: 150, carried: { sleep: { attempts: 0, rest: false } } })),
      idle(mon("Darkrai", "Bad Dreams")), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "Healer at 5.3 (3/10) cures Snorlax's sleep: no Bad Dreams then; otherwise −29.",
  },
  {
    id: "RV12", title: "A trap from a trapper that is also trapped by the other foe; both damage", game: "sv", outcomes: true,
    slots: slots(idle(mon("Charizard", "Blaze", { hp: 100, carried: { trap: { source: PL, bindingBand: false, move: "Whirlpool" } } })), idle(mon("Venusaur", "Overgrow")),
      idle(lax({ hp: 150, carried: { trap: { source: OL, bindingBand: true, move: "Fire Spin" } } })), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "Snorlax 235/6 = 39 from Charizard's Fire Spin; Charizard 153/8 = 19 from Snorlax's Whirlpool.",
  },
  {
    id: "RV13", title: "Sand knocks out an Unnerve holder; the Leftovers and Sitrus holders after it", game: "sv", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(lax({ hp: 120, item: "Sitrus Berry" })), idle(mon("Gengar", "Cursed Body", { hp: 90, item: "Leftovers" })),
      idle(mon("Tyranitar", "Unnerve", { hp: 30 })), idle(mon("Houndoom", "Unnerve", { hp: 5 }))),
    checks: "Houndoom faints to sand; Tyranitar (Rock) is immune and has HP: its Unnerve still stops Snorlax's Sitrus.",
  },
  {
    id: "RV14", title: "Wish landing on a Pokémon a sand KO takes first: no heal", game: "sv", outcomes: true, field: { weather: "Sand" },
    slots: slots(idle(mon("Gengar", "Cursed Body", { hp: 5, carried: { wish: 80 } })), idle(mon("Clefable", "Magic Guard")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Gengar faints at order 1; the Wish at order 4 heals nothing.",
  },
  {
    id: "RV15", title: "Perish count 1 and a Leech Seed seeder: the seeded faints at 24 after draining", game: "sv", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow", { hp: 100 })), idle(mon("Blastoise", "Torrent")),
      idle(lax({ hp: 150, carried: { leechSeed: OL, perish: 1 } })), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "Snorlax loses 29 to Leech Seed (Venusaur +29), then faints at perish 0.",
  },
  {
    id: "RV16", title: "A carried trap ends when its holder makes a Substitute this turn (U13)", game: "sv", outcomes: true,
    slots: slots(idle(mon("Charizard", "Blaze")), idle(mon("Venusaur", "Overgrow")),
      act(lax({ hp: 200, carried: { trap: { source: OL, bindingBand: false, move: "Fire Spin" } } }), "Substitute"), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "substitute onStart deletes partiallytrapped: Snorlax pays 58 for the Substitute and takes no trap damage.",
  },
  {
    id: "RV17", title: "Emergency Exit after Leech Seed takes Golisopod to half (USUM)", game: "usum", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow")), idle(mon("Blastoise", "Torrent")),
      idle(mon("Golisopod", "Emergency Exit", { hp: 85, carried: { leechSeed: OL } })), idle(mon("Jolteon", "Volt Absorb"))),
    checks: "Golisopod 85/150 loses 18 to 67: half or below after the residual, above half at its start: Emergency Exit (switchFlag).",
  },
  {
    id: "RV18", title: "Bad poison at stage 15 stays 15; Poison Heal under Psychic Noise's Heal Block", game: "sv", outcomes: true,
    slots: slots(idle(lax({ status: "tox", hp: 230, carried: { toxic: 15 } })), idle(mon("Gliscor", "Poison Heal", { status: "tox", hp: 100, carried: { toxic: 2 } })),
      idle(mon("Jolteon", "Volt Absorb")), act(mon("Bronzong", "Levitate", { nature: "Brave" }), "Psychic Noise", OR)),
    checks: "Snorlax loses 14 × 15 = 210; Gliscor neither heals (Heal Block) nor takes damage (Poison Heal returns false).",
  },
  {
    id: "RV19", title: "Hit KO chances combined with sand and Leftovers (Champions)", game: "champions", outcomes: true, field: { weather: "Sand" },
    slots: slots(act(mon("Garchomp", "Rough Skin", { nature: "Jolly", evs: { atk: 32, spe: 32 } }), "Rock Slide"), idle(mon("Clefable", "Magic Guard")),
      idle(mon("Charizard", "Blaze", { hp: 60 })), idle(mon("Gengar", "Cursed Body", { hp: 50, item: "Leftovers" }))),
    checks: "Rock Slide's spread rolls then sand 1/16 and Leftovers: the after-turn KO chances combine both.",
  },
  {
    id: "RV20", title: "Flame Orb on a Leaf Guard holder in sun; Toxic Orb on a Comatose holder", game: "sv", outcomes: true, field: { weather: "Sun" }, weatherTurns: 3,
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { item: "Flame Orb" })), idle(mon("Komala", "Comatose", { item: "Toxic Orb" })),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Leaf Guard in sun stops the burn; Comatose stops the poison.",
  },
  {
    id: "RV21", title: "Harvest after a Sitrus Berry eaten at the weather's Update (the holder had its Berry after the moves)", game: "sv", outcomes: true,
    field: { weather: "Sand" },
    slots: slots(idle(mon("Exeggutor", "Harvest", { hp: 90, item: "Sitrus Berry", status: "psn", carried: { saltCure: true } })), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Sand 10 → 80, Sitrus +42 at the weather's Update → 122, poison 21, Salt Cure 21 → 80; Harvest (50%) restores the Sitrus, eaten again at the final Update → 122.",
  },
  {
    id: "RV22", title: "Pickup takes a Sitrus Berry eaten at the weather's Update", game: "sv", outcomes: true,
    field: { weather: "Sand" },
    slots: slots(idle(lax({ hp: 120, item: "Sitrus Berry" })), idle(mon("Ambipom", "Pickup", { hp: 75 })),
      idle(mon("Jolteon", "Volt Absorb")), idle(mon("Garchomp", "Rough Skin"))),
    checks: "Snorlax eats its Sitrus at the weather's Update (usedItemThisTurn); Ambipom's Pickup (28.2) takes it and eats it at the final Update.",
  },
  {
    id: "RV23", title: "RT01 with the rain's last turn (weatherTurns 1): no Hydration cure, burn damage", game: "sv", weatherTurns: 1,
    field: { weather: "Rain" },
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "The rain ends at order 1; Hydration (5.3) sees no rain; the burn deals 205/16 = 12.",
  },
  {
    id: "RV24", title: "RT02 with the sun's last turn (weatherTurns 1): Leaf Guard does not stop Yawn's sleep", game: "sv", weatherTurns: 1,
    field: { weather: "Sun" },
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { carried: { yawn: true } })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "The sun ends at order 1; Yawn's sleep lands at 23.",
  },
  {
    id: "RV05b", title: "Psychic Noise as the last action heal-blocks a Leech Seed seeder", game: "sv", outcomes: true,
    slots: slots(idle(mon("Venusaur", "Overgrow", { hp: 120 })), idle(mon("Blastoise", "Torrent")),
      act(mon("Bronzong", "Levitate", { nature: "Brave" }), "Psychic Noise", OL), idle(lax({ hp: 150, carried: { leechSeed: OL } }))),
    checks: "Snorlax loses 29; Venusaur's heal fails (healblock onTryHeal).",
  },
];

/** App-side text checks (no oracle needed: the oracle's weather lasts 5 turns, the app's input leaves weatherTurns out). */
export const TEXT_CASES: Case[] = [
  {
    id: "RT01", title: "Rain from before with no turn count: Hydration cures a burn (the residual reads that the rain goes on)", game: "sv",
    field: { weather: "Rain" },
    slots: slots(idle(mon("Vaporeon", "Hydration", { status: "brn", hp: 150 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "With the rain ending now (duration 1) Vaporeon keeps its burn and loses 205/16 = 12; the app cures it: does it state the assumption?",
  },
  {
    id: "RT02", title: "Sun from before with no turn count: Leaf Guard stops a carried Yawn's sleep", game: "sv",
    field: { weather: "Sun" },
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { carried: { yawn: true } })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "With the sun ending now Leafeon falls asleep at 23; the app keeps it awake: does it state the assumption?",
  },
  {
    id: "RT03", title: "Rain from before with no turn count: Rain Dish (the assumption fact is stated)", game: "sv",
    field: { weather: "Rain" },
    slots: slots(idle(mon("Tentacruel", "Rain Dish", { hp: 100 })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "Control: the fact `Assumes the Rain does not end this turn.`",
  },
  {
    id: "RT04", title: "Sun from before with no turn count: Leaf Guard stops a Flame Orb's burn", game: "sv",
    field: { weather: "Sun" },
    slots: slots(idle(mon("Leafeon", "Leaf Guard", { item: "Flame Orb" })), idle(mon("Venusaur", "Overgrow")), idle(mon("Jolteon", "Volt Absorb")), idle(lax())),
    checks: "With the sun ending now Leafeon is burned at 28.3; the app keeps it unburned: does it state the assumption?",
  },
];
