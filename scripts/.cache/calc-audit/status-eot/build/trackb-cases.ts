// Track B's own end-of-turn cases (Case shape of 2v2/verify/case-types.ts) for trackb-check.ts. Level 50, 31 IVs, 0 EVs:
// maximum HP = base HP + 75, Speed = base Speed + 20 (neutral nature). No two Pokémon of a case share a Speed unless the
// case is about a tie.
import type { Case, CaseMon, CaseAction, SlotId } from "../../2v2/verify/case-types";

type M = CaseMon & { action: CaseAction };
const idle = (species: string, ability: string, extra: Partial<CaseMon> = {}): M => ({ species, ability, ...extra, action: { move: null } });
const uses = (species: string, ability: string, move: string, target: SlotId | undefined, extra: Partial<CaseMon> = {}): M => ({ species, ability, ...extra, action: { move, ...(target ? { target } : {}) } });
const turn = (id: string, title: string, game: Case["game"], slots: [M, M, M, M], extra: Partial<Case> = {}): Case => ({
  id, title, game, checks: title,
  slots: { "own-left": slots[0], "own-right": slots[1], "opponent-left": slots[2], "opponent-right": slots[3] }, ...extra,
});

export const TB_CASES: Case[] = [
  turn("B01", "sand: types, Magic Guard, Safety Goggles, Overcoat", "sv", [
    idle("Gengar", "Cursed Body", { hp: 100 }), idle("Clefable", "Magic Guard", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100, item: "Safety Goggles" }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand" } }),
  turn("B02", "sand then Sitrus at the weather's Update, then Leftovers; Unnerve holder", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 120, item: "Sitrus Berry" }), idle("Gengar", "Cursed Body", { hp: 100, item: "Leftovers" }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand" } }),
  turn("B03", "an Unnerve holder knocked out by sand: the foe's Sitrus at the weather's Update", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 120, item: "Sitrus Berry" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Houndoom", "Unnerve", { hp: 5 }),
  ], { field: { weather: "Sand" } }),
  turn("B04", "poison then Salt Cure knock out before a Sitrus (no Update between); one survives and eats at the final Update", "sv", [
    idle("Garchomp", "Rough Skin", { hp: 40, status: "psn", item: "Sitrus Berry", carried: { saltCure: true } }),
    idle("Gengar", "Cursed Body", { hp: 100, status: "psn", item: "Sitrus Berry", carried: { saltCure: true } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B05", "Grassy Terrain: Flying, Levitate, Air Balloon, Iron Ball", "sv", [
    idle("Charizard", "Blaze", { hp: 100 }), idle("Bronzong", "Levitate", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100, item: "Air Balloon" }), idle("Dragapult", "Clear Body", { hp: 100, item: "Iron Ball" }),
  ], { field: { terrain: "Grassy" } }),
  turn("B06", "Leftovers at full, Black Sludge on Poison and not, Sticky Barb", "sv", [
    idle("Snorlax", "Thick Fat", { item: "Leftovers" }), idle("Toxapex", "Regenerator", { hp: 80, item: "Black Sludge" }),
    idle("Jolteon", "Volt Absorb", { hp: 100, item: "Black Sludge" }), idle("Dragapult", "Clear Body", { hp: 100, item: "Sticky Barb" }),
  ]),
  turn("B07", "burn, Heatproof, Magic Guard; bad poison stage 3; Poison Heal", "sv", [
    idle("Gengar", "Cursed Body", { hp: 100, status: "brn" }), idle("Bronzong", "Heatproof", { hp: 100, status: "brn" }),
    idle("Jolteon", "Volt Absorb", { hp: 130, status: "tox", carried: { toxic: 3 } }), idle("Gliscor", "Poison Heal", { hp: 100, status: "tox" }),
  ]),
  turn("B08", "carried Leech Seed with Big Root; Liquid Ooze; Magic Guard seeded", "sv", [
    idle("Venusaur", "Overgrow", { hp: 100, item: "Big Root" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Tentacruel", "Liquid Ooze", { hp: 150, carried: { leechSeed: "own-right" } }), idle("Dragapult", "Clear Body", { hp: 100, carried: { leechSeed: "own-left" } }),
  ]),
  turn("B09", "Leech Seed: the seeder faints to sand first; a seeded Pokémon drained to 0", "sv", [
    idle("Venusaur", "Overgrow", { hp: 1 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 10, carried: { leechSeed: "own-left" } }), idle("Dragapult", "Clear Body", { hp: 15, carried: { leechSeed: "own-right" } }),
  ], { field: { weather: "Sand" } }),
  turn("B10", "carried trap with Binding Band, the other trapper faints to sand first", "sv", [
    idle("Charizard", "Blaze", { hp: 100, item: "Binding Band" }), idle("Gengar", "Cursed Body", { hp: 1 }),
    idle("Jolteon", "Volt Absorb", { hp: 100, carried: { trap: { source: "own-left", bindingBand: true } } }), idle("Dragapult", "Clear Body", { hp: 100, carried: { trap: { source: "own-right", bindingBand: false } } }),
  ], { field: { weather: "Sand" } }),
  turn("B11", "Salt Cure SV: Water 1/4, others 1/8", "sv", [
    idle("Blastoise", "Torrent", { hp: 100, carried: { saltCure: true } }), idle("Gengar", "Cursed Body", { hp: 100, carried: { saltCure: true } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B12", "Salt Cure Champions: Water 1/8, others 1/16; Curse", "champions", [
    idle("Blastoise", "Torrent", { hp: 100, carried: { saltCure: true } }), idle("Gengar", "Cursed Body", { hp: 100, carried: { saltCure: true, curse: true } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B13", "Aqua Ring and Ingrain with Big Root", "sv", [
    idle("Venusaur", "Overgrow", { hp: 50, item: "Big Root", carried: { ingrain: true, aquaRing: true } }), idle("Gengar", "Cursed Body", { hp: 100, carried: { aquaRing: true } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B14", "Healer (SV 3/10) cures the ally's poison before it acts", "sv", [
    idle("Blissey", "Healer", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100, status: "psn" }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B15", "Healer (Champions 1/2); Shed Skin 33% on a burn", "champions", [
    idle("Audino", "Healer", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100, status: "tox" }),
    idle("Arbok", "Shed Skin", { hp: 100, status: "brn" }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B16", "Bad Dreams on a sleeper, a Comatose foe, a Magic Guard sleeper", "sv", [
    idle("Darkrai", "Bad Dreams", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Komala", "Comatose", { hp: 100 }), idle("Clefable", "Magic Guard", { hp: 100, status: "slp" }),
  ]),
  turn("B17", "carried Yawn: sleep at 23, then Bad Dreams; a Lum holder is cured at once", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 200, carried: { yawn: true } }), idle("Gengar", "Cursed Body", { hp: 100, item: "Lum Berry", carried: { yawn: true } }),
    idle("Darkrai", "Bad Dreams", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B18", "carried perish 1 faints after Leftovers, perish 3 counts down", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 200, item: "Leftovers", carried: { perish: 1 } }), idle("Gengar", "Cursed Body", { hp: 100, carried: { perish: 3 } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B19", "carried Wish heals; a Wish into full HP heals nothing", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 100, carried: { wish: 77 } }), idle("Gengar", "Cursed Body", { carried: { wish: 60 } }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B20", "Emergency Exit after a burn takes it to half; a Sitrus at the final Update keeps the other above", "usum", [
    idle("Golisopod", "Emergency Exit", { hp: 80, status: "brn" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Golisopod", "Emergency Exit", { hp: 80, status: "brn", item: "Sitrus Berry", evs: { spe: 4 } }),
  ]),
  turn("B21", "two burned at equal Speed (a commuting tie)", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 100, status: "brn" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Snorlax", "Immunity", { hp: 100, status: "brn" }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B22", "mutual Leech Seed at equal Speed (the order matters)", "sv", [
    idle("Venusaur", "Overgrow", { hp: 10, carried: { leechSeed: "opponent-left" } }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Venusaur", "Chlorophyll", { hp: 100, carried: { leechSeed: "own-left" } }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B23", "rain: Rain Dish, Dry Skin, Hydration cures a burn before it acts; Umbrella", "sv", [
    idle("Ludicolo", "Rain Dish", { hp: 100 }), idle("Toxicroak", "Dry Skin", { hp: 100 }),
    idle("Lapras", "Hydration", { hp: 100, status: "brn" }), idle("Pelipper", "Rain Dish", { hp: 100, item: "Utility Umbrella" }),
  ], { field: { weather: "Rain" } }),
  turn("B24", "sun: Solar Power, Dry Skin hurt; Umbrella", "sv", [
    idle("Charizard", "Solar Power", { hp: 100 }), idle("Toxicroak", "Dry Skin", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Tropius", "Solar Power", { hp: 100, item: "Utility Umbrella" }),
  ], { field: { weather: "Sun" } }),
  turn("B25", "snow: Ice Body heals, no damage", "sv", [
    idle("Glalie", "Ice Body", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Snow" } }),
  turn("B26", "USUM hail: damage, Ice Body, Snow Cloak", "usum", [
    idle("Glalie", "Ice Body", { hp: 100 }), idle("Bronzong", "Levitate", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Froslass", "Snow Cloak", { hp: 100 }),
  ], { field: { weather: "Hail" } }),
  turn("B27", "Cloud Nine: no sand damage", "sv", [
    idle("Golduck", "Cloud Nine", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand" } }),
  turn("B28", "sand with one turn left ends without acting", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand" }, weatherTurns: 1 }),
  turn("B29", "Toxic Orb and Flame Orb: status, no damage this turn; Speed Boost", "sv", [
    idle("Gliscor", "Poison Heal", { hp: 100, item: "Toxic Orb" }), idle("Ursaring", "Guts", { hp: 100, item: "Flame Orb" }),
    idle("Blaziken", "Speed Boost", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B30", "Micle Berry eaten at a quarter by a Cheek Pouch holder", "sv", [
    idle("Dedenne", "Cheek Pouch", { hp: 30, item: "Micle Berry" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B31", "a Sitrus after a residual drop below half, eaten at the final Update", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 120, item: "Sitrus Berry", status: "brn" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B32", "Tailwind used this turn: the residual order follows the new Speeds", "sv", [
    uses("Pelipper", "Keen Eye", "Tailwind", undefined, { hp: 100, item: "Leftovers" }), idle("Gengar", "Cursed Body", { hp: 100, item: "Leftovers" }),
    idle("Jolteon", "Volt Absorb", { hp: 100, item: "Leftovers" }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { terrain: "Grassy" } }),
  turn("B33", "a damaging hit then sand; a KO in the moves; Leftovers", "sv", [
    uses("Garchomp", "Rough Skin", "Dragon Claw", "opponent-right", { item: "Leftovers" }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 60, item: "Sitrus Berry" }),
  ], { field: { weather: "Sand" } }),
  turn("B34", "Fire Spin this turn traps and damages", "sv", [
    uses("Charizard", "Blaze", "Fire Spin", "opponent-left"), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B35", "Salt Cure this turn (Champions)", "champions", [
    uses("Garganacl", "Purifying Salt", "Salt Cure", "opponent-left"), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Garchomp", "Rough Skin"), idle("Dragapult", "Clear Body", { hp: 100 }),
  ]),
  turn("B36", "Psychic Noise as the last move blocks Leftovers and Grassy Terrain", "sv", [
    uses("Bronzong", "Heatproof", "Psychic Noise", "opponent-left"), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Garchomp", "Rough Skin", { item: "Leftovers" }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { terrain: "Grassy" } }),
  turn("B37", "U-turn as the last action: the end of turn is not estimated", "sv", [
    uses("Spidops", "Insomnia", "U-turn", "opponent-left"), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Garchomp", "Rough Skin"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ], { endNotEstimated: "Spidops switches out: the replacement is not known." }),
  turn("B38", "Dig as the last move: no sand underground, no Grassy heal", "sv", [
    uses("Ariados", "Insomnia", "Dig", "opponent-left", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand", terrain: "Grassy" } }),
  turn("B39", "Fly as the last move: sand still hits", "sv", [
    uses("Charizard", "Blaze", "Fly", "opponent-left", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), idle("Dragapult", "Clear Body", { hp: 100 }),
  ], { field: { weather: "Sand" } }),
  turn("B40", "Ally Switch: Leech Seed heals whoever stands at the seeder's position (A6)", "sv", [
    idle("Venusaur", "Overgrow", { hp: 100 }), uses("Farigiraf", "Armor Tail", "Ally Switch", undefined, { hp: 100 }),
    idle("Garchomp", "Rough Skin", { hp: 150, carried: { leechSeed: "own-left" } }), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B41", "Ally Switch: a Wish heals whoever stands at its position (A7)", "sv", [
    idle("Venusaur", "Overgrow", { hp: 100, carried: { wish: 77 } }), uses("Farigiraf", "Armor Tail", "Ally Switch", undefined, { hp: 100 }),
    idle("Garchomp", "Rough Skin", { hp: 150 }), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B42", "Toxic this turn: bad poison from stage 0 (1/16)", "sv", [
    uses("Gengar", "Cursed Body", "Toxic", "opponent-left"), idle("Venusaur", "Overgrow", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B43", "Will-O-Wisp this turn: burn 1/16", "sv", [
    uses("Gengar", "Cursed Body", "Will-O-Wisp", "opponent-left"), idle("Venusaur", "Overgrow", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B44", "Spore this turn, then Bad Dreams on the new sleeper", "sv", [
    uses("Amoonguss", "Effect Spore", "Spore", "opponent-left"), idle("Darkrai", "Bad Dreams", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B45", "Leech Seed this turn drains at this end of turn", "sv", [
    uses("Venusaur", "Overgrow", "Leech Seed", "opponent-left", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B46", "Perish Song this turn: the count, no HP", "sv", [
    uses("Gengar", "Cursed Body", "Perish Song", undefined), idle("Venusaur", "Overgrow", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ], { outcomes: true }),
  turn("B47", "Yawn this turn: no sleep yet", "sv", [
    uses("Snorlax", "Thick Fat", "Yawn", "opponent-left"), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Garchomp", "Rough Skin", { hp: 100 }), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ], { outcomes: true }),
  turn("B48", "Ingrain and Aqua Ring this turn heal at this end of turn", "sv", [
    uses("Venusaur", "Overgrow", "Ingrain", undefined, { hp: 100, item: "Big Root" }), uses("Blastoise", "Torrent", "Aqua Ring", undefined, { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B49", "Ghost Curse this turn: the cost now, 1/4 at the end of turn", "sv", [
    uses("Gengar", "Cursed Body", "Curse", "opponent-left"), idle("Venusaur", "Overgrow", { hp: 100 }),
    idle("Snorlax", "Thick Fat"), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B50", "Trick: the end of turn reads the new holders (Black Sludge, Leftovers)", "sv", [
    uses("Gengar", "Cursed Body", "Trick", "opponent-left", { hp: 100, item: "Black Sludge" }), idle("Venusaur", "Overgrow", { hp: 100 }),
    idle("Snorlax", "Thick Fat", { hp: 200, item: "Leftovers" }), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B51", "Rapid Spin ends its user's Leech Seed (C16)", "sv", [
    idle("Venusaur", "Overgrow", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Jolteon", "Volt Absorb", { hp: 100 }), uses("Forretress", "Sturdy", "Rapid Spin", "own-left", { hp: 100, carried: { leechSeed: "own-left" } }),
  ]),
  turn("B52", "a trap and Salt Cure on one Pokémon tie: each order is a world (C9)", "sv", [
    idle("Charizard", "Blaze", { hp: 100 }), idle("Gengar", "Cursed Body", { hp: 100 }),
    idle("Snorlax", "Thick Fat", { hp: 30, carried: { saltCure: true, trap: { source: "own-left", bindingBand: false } } }), idle("Jolteon", "Volt Absorb", { hp: 100 }),
  ]),
  turn("B53", "a side's last Pokémon faints to sand with none left to send in: the battle ends, no Leftovers", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 100, item: "Leftovers" }), idle("Excadrill", "Sand Rush", { hp: 100, item: "Leftovers" }),
    idle("Gengar", "Cursed Body", { hp: 1 }), { ...idle("Jolteon", "Volt Absorb"), absent: true },
  ], { field: { weather: "Sand" }, canSwitch: { opponent: false } }),
  turn("B54", "the same with a Pokémon left to send in: the end of turn goes on", "sv", [
    idle("Snorlax", "Thick Fat", { hp: 100, item: "Leftovers" }), idle("Excadrill", "Sand Rush", { hp: 100, item: "Leftovers" }),
    idle("Gengar", "Cursed Body", { hp: 1 }), { ...idle("Jolteon", "Volt Absorb"), absent: true },
  ], { field: { weather: "Sand" } }),
];
