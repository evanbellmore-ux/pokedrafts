import { createBuild, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility } from "@/app/lib/battle/move-defaults";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import type { BattleStat } from "@/app/lib/battle/types";
import { showdownNature } from "@/app/(app)/training/model/sets";
import type { TrainingMember, TrainingTeam } from "@/app/(app)/training/model/view-types";

/**
 * Training team fixtures (SPEC §14.1 plus addendum A1.4/A1.5). Every team is six Reg M-C members with distinct species and
 * items (Species Clause, Item Clause = 1: PS/data/mods/champions/rulesets.ts:28-32); tests/unit/training-teams.test.ts
 * validates each with the bundled TeamValidator and parses each paste with parseTeamImport(…, "champions").
 *
 * - Pool S (suggested): the calculator's suggested sets (createMoveSlots + usualAbility, Doubles), only required items,
 *   Hardy with 0 Stat Points (SPEC C15). No Protect or status moves (move-usage.json keeps damaging moves only).
 * - Pool V (VGC-style): hand-written sets with real spreads: Protect on most members, Fake Out, Tailwind, Trick Room,
 *   Follow Me / Rage Powder, Sleep Powder (no Reg M-C species learns Spore), Will-O-Wisp, Thunder Wave, Intimidate, sun,
 *   rain, sand, snow and Psychic Terrain setters, one Mega Stone per team; 40 of the 72 spreads are no SPEC 10.1 archetype.
 * - Pool U (usage, addendum A1.2/A1.4): sets made by the A1.2 rule from the hash-checked Smogon 2026-08 Reg M-B chaos
 *   archive (the four highest-weight learnable moves of any category, the highest-weight free item, the highest-weight
 *   ability, the highest-weight valid spread, Protect in place of the fourth move unless the item is Choice Scarf): Tailwind,
 *   Trick Room, Follow Me and Rage Powder users and one Mega-capable member per team.
 * - Pool A (archetype): every member's spread and nature is both one SPEC 10.1 archetype candidate and one of the species'
 *   top 12 usage spreads, so the truth is inside the belief's support under the rule prior and the usage prior (A1.4).
 *
 * Compact set notation, one string per member: "Species @ Item; Ability; Nature hp/atk/def/spa/spd/spe; Move / Move / …".
 * The item part is optional. Mega forms are written as their base species holding the stone, as a PokéPaste names them.
 */
export type TeamPool = "S" | "V" | "U" | "A";
export type TeamFixture =
  | { id: string; pool: "S"; species: readonly string[] }
  | { id: string; pool: "V" | "U" | "A"; sets: readonly string[] };

const STAT_ORDER: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
const STAT_LABEL: Readonly<Record<BattleStat, string>> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

const POOL_S: Readonly<Record<string, readonly string[]>> = {
  S01: ["garchomp", "incineroar", "whimsicott", "kingambit", "charizardmegay", "sinistcha"],
  S02: ["basculegion", "sneasler", "farigiraf", "archaludon", "floettemega", "pelipper"],
  S03: ["sylveon", "gholdengo", "staraptormega", "milotic", "excadrill", "grimmsnarl"],
  S04: ["tyranitarmega", "talonflame", "rotomwash", "clefable", "hydreigon", "venusaur"],
  S05: ["gengarmega", "politoed", "kommoo", "glimmora", "arcaninehisui", "maushold"],
  S06: ["aerodactylmega", "torkoal", "hatterene", "annihilape", "primarina", "dragonite"],
  S07: ["metagrossmega", "corviknight", "sableye", "ninetalesalola", "ceruledge", "meowscarada"],
  S08: ["mawilemega", "gallade", "toxapex", "snorlax", "azumarill", "lucario"],
  S09: ["delphoxmega", "gyarados", "volcarona", "tsareena", "lycanrocdusk", "scizor"],
  S10: ["kangaskhanmega", "froslass", "blastoise", "mamoswine", "chandelure", "hawlucha"],
  S11: ["swampertmega", "raichu", "dragapult", "greninja", "tinkaton", "espathra"],
  S12: ["blazikenmega", "slowking", "rhyperior", "weavile", "ampharos", "golurk"],
};

const POOL_V: Readonly<Record<string, readonly string[]>> = {
  V01: [
    "Charizard @ Charizardite Y; Blaze; Timid 2/0/0/32/0/32; Heat Wave / Weather Ball / Solar Beam / Protect",
    "Venusaur @ Focus Sash; Chlorophyll; Modest 4/0/12/32/0/18; Sludge Bomb / Earth Power / Sleep Powder / Protect",
    "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
    "Whimsicott @ Mental Herb; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
    "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
    "Farigiraf @ Colbur Berry; Armor Tail; Calm 29/0/21/0/16/0; Trick Room / Psychic / Helping Hand / Protect",
  ],
  V02: [
    "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
    "Swampert @ Swampertite; Torrent; Adamant 2/32/0/0/0/32; Wave Crash / Earthquake / Ice Punch / Protect",
    "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
    "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
    "Sinistcha @ Kasib Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
  ],
  V03: [
    "Hatterene @ Life Orb; Magic Bounce; Quiet 27/0/7/32/0/0; Dazzling Gleam / Trick Room / Psychic / Protect",
    "Torkoal @ Charcoal; Drought; Quiet 32/0/0/32/2/0; Eruption / Heat Wave / Earth Power / Protect",
    "Mawile @ Mawilite; Intimidate; Brave 32/32/0/0/2/0; Play Rough / Sucker Punch / Iron Head / Protect",
    "Incineroar @ Sitrus Berry; Intimidate; Impish 32/0/21/0/10/3; Fake Out / Parting Shot / Flare Blitz / Will-O-Wisp",
    "Gallade @ Expert Belt; Sharpness; Brave 32/32/2/0/0/0; Sacred Sword / Psycho Cut / Trick Room / Protect",
    "Primarina @ Mystic Water; Liquid Voice; Quiet 32/0/2/32/0/0; Hyper Voice / Moonblast / Calm Mind / Protect",
  ],
  V04: [
    "Tyranitar @ Tyranitarite; Sand Stream; Jolly 17/18/0/0/0/31; Rock Slide / Knock Off / Low Kick / Protect",
    "Excadrill @ Focus Sash; Sand Rush; Adamant 2/32/0/0/0/32; Iron Head / High Horsepower / Rock Slide / Protect",
    "Talonflame @ Sharp Beak; Gale Wings; Jolly 2/32/0/0/0/32; Tailwind / Brave Bird / Will-O-Wisp / Protect",
    "Rotom-Wash @ Sitrus Berry; Levitate; Bold 32/0/23/1/3/7; Hydro Pump / Thunderbolt / Thunder Wave / Protect",
    "Clefable @ Leftovers; Magic Guard; Bold 32/0/20/0/14/0; Follow Me / Moonblast / Helping Hand / Protect",
    "Garchomp @ Life Orb; Rough Skin; Jolly 6/28/0/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
  ],
  V05: [
    "Froslass @ Froslassite; Cursed Body; Timid 2/0/0/32/0/32; Blizzard / Shadow Ball / Aurora Veil / Protect",
    "Arcanine-Hisui @ Focus Sash; Rock Head; Jolly 2/32/0/0/0/32; Flare Blitz / Extreme Speed / Head Smash / Protect",
    "Maushold @ Wide Lens; Friend Guard; Jolly 2/32/0/0/0/32; Follow Me / Population Bomb / Super Fang / Protect",
    "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    "Gholdengo @ Life Orb; Good as Gold; Modest 25/0/0/27/0/14; Shadow Ball / Make It Rain / Nasty Plot / Protect",
    "Baxcalibur @ Never-Melt Ice; Thermal Exchange; Jolly 2/32/0/0/0/32; Glaive Rush / Icicle Crash / Ice Shard / Protect",
  ],
  V06: [
    "Indeedee-F @ Psychic Seed; Psychic Surge; Bold 32/0/32/0/2/0; Follow Me / Helping Hand / Psychic / Protect",
    "Gardevoir @ Gardevoirite; Trace; Modest 32/0/2/32/0/0; Hyper Voice / Psychic / Trick Room / Protect",
    "Kingambit @ Chople Berry; Defiant; Adamant 32/32/0/0/1/1; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
    "Garchomp @ Sitrus Berry; Rough Skin; Jolly 0/30/4/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
    "Incineroar @ Passho Berry; Intimidate; Careful 32/0/1/0/10/23; Fake Out / Parting Shot / Darkest Lariat / Protect",
    "Rotom-Heat @ Choice Scarf; Levitate; Timid 2/0/0/32/0/32; Overheat / Thunderbolt / Volt Switch / Will-O-Wisp",
  ],
  V07: [
    "Kangaskhan @ Kangaskhanite; Scrappy; Brave 32/32/2/0/0/0; Fake Out / Double-Edge / Sucker Punch / Low Kick",
    "Whimsicott @ Focus Sash; Prankster; Timid 0/0/2/32/0/32; Tailwind / Moonblast / Encore / Protect",
    "Archaludon @ Leftovers; Stamina; Modest 32/0/0/1/29/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
    "Sylveon @ Fairy Feather; Pixilate; Modest 13/0/22/23/0/8; Hyper Voice / Quick Attack / Yawn / Detect",
    "Annihilape @ Life Orb; Defiant; Jolly 2/32/0/0/0/32; Rage Fist / Close Combat / Bulk Up / Protect",
    "Milotic @ Sitrus Berry; Competitive; Calm 20/0/20/4/8/14; Scald / Icy Wind / Hypnosis / Protect",
  ],
  V08: [
    "Staraptor @ Staraptite; Intimidate; Jolly 29/1/0/0/4/32; Close Combat / Brave Bird / Tailwind / Protect",
    "Basculegion @ Choice Scarf; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Flip Turn",
    "Sneasler @ Focus Sash; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    "Gholdengo @ Life Orb; Good as Gold; Timid 2/0/0/32/0/32; Shadow Ball / Make It Rain / Nasty Plot / Protect",
    "Sinistcha @ Colbur Berry; Hospitality; Bold 29/0/15/0/22/0; Matcha Gotcha / Rage Powder / Life Dew / Protect",
    "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
  ],
  V09: [
    "Gengar @ Gengarite; Cursed Body; Modest 20/0/4/10/0/32; Shadow Ball / Sludge Bomb / Perish Song / Protect",
    "Politoed @ Sitrus Berry; Drizzle; Calm 31/0/23/0/12/0; Weather Ball / Perish Song / Encore / Protect",
    "Whimsicott @ Occa Berry; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
    "Kingambit @ Life Orb; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
    "Basculegion @ Mystic Water; Adaptability; Adamant 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    "Clefable @ Leftovers; Unaware; Bold 32/0/32/2/0/0; Follow Me / Moonblast / Thunder Wave / Protect",
  ],
  V10: [
    "Aerodactyl @ Aerodactylite; Unnerve; Jolly 2/32/0/0/0/32; Rock Slide / Dual Wingbeat / Tailwind / Protect",
    "Glimmora @ Focus Sash; Toxic Debris; Modest 1/0/1/32/0/32; Power Gem / Earth Power / Sludge Bomb / Spiky Shield",
    "Kommo-o @ Life Orb; Soundproof; Modest 2/0/0/32/0/32; Clanging Scales / Aura Sphere / Vacuum Wave / Protect",
    "Sylveon @ Fairy Feather; Pixilate; Modest 9/0/22/30/0/5; Hyper Voice / Quick Attack / Hyper Beam / Detect",
    "Farigiraf @ Sitrus Berry; Armor Tail; Bold 25/0/26/0/15/0; Trick Room / Psychic / Helping Hand / Protect",
    "Incineroar @ Shuca Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Throat Chop",
  ],
  V11: [
    "Metagross @ Metagrossite; Clear Body; Jolly 14/27/0/0/0/25; Psychic Fangs / Iron Head / Bullet Punch / Protect",
    "Hydreigon @ Choice Scarf; Levitate; Modest 2/0/0/32/0/32; Dark Pulse / Draco Meteor / Snarl / Earth Power",
    "Milotic @ Leftovers; Competitive; Calm 32/0/13/5/2/14; Scald / Icy Wind / Recover / Protect",
    "Arcanine @ Sitrus Berry; Intimidate; Adamant 31/32/0/0/0/3; Extreme Speed / Flare Blitz / Will-O-Wisp / Protect",
    "Venusaur @ Focus Sash; Chlorophyll; Modest 2/0/0/32/0/32; Sludge Bomb / Leaf Storm / Sleep Powder / Protect",
    "Grimmsnarl @ Light Clay; Prankster; Careful 32/0/19/0/15/0; Reflect / Light Screen / Spirit Break / Fake Out",
  ],
  V12: [
    "Delphox @ Delphoxite; Blaze; Timid 13/0/12/18/0/23; Heat Wave / Psychic / Nasty Plot / Protect",
    "Dragonite @ Life Orb; Multiscale; Adamant 29/32/0/0/0/5; Extreme Speed / Dragon Claw / Superpower / Protect",
    "Gyarados @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Waterfall / Thunder Wave / Taunt / Protect",
    "Corviknight @ Leftovers; Mirror Armor; Impish 32/0/5/0/26/3; Brave Bird / Tailwind / Iron Head / Protect",
    "Sableye @ Light Clay; Prankster; Calm 32/0/2/0/32/0; Fake Out / Will-O-Wisp / Encore / Reflect",
    "Primarina @ Mystic Water; Liquid Voice; Quiet 21/0/21/24/0/0; Hyper Voice / Moonblast / Calm Mind / Protect",
  ],
};

// Pools U and A: generated once from the cached archive by the VAL scratch script (scripts/.cache/training/build/val/
// gen-usage-teams.ts) and frozen here, so the fixtures never change with a data refresh.
const POOL_U: Readonly<Record<string, readonly string[]>> = {
  U01: [
    "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
    "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/4/0/30/0; Matcha Gotcha / Rage Powder / Protect / Trick Room",
    "Charizard @ Charizardite Y; Solar Power; Timid 2/0/0/32/0/32; Heat Wave / Protect / Weather Ball / Solar Beam",
    "Incineroar @ Sitrus Berry; Intimidate; Impish 32/0/21/0/10/3; Fake Out / Parting Shot / Flare Blitz / Protect",
    "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
    "Kingambit @ Chople Berry; Defiant; Adamant 32/32/0/0/2/0; Sucker Punch / Kowtow Cleave / Protect / Iron Head",
  ],
  U02: [
    "Farigiraf @ Sitrus Berry; Armor Tail; Calm 29/0/21/0/16/0; Trick Room / Psychic / Helping Hand / Protect",
    "Pelipper @ Focus Sash; Drizzle; Timid 2/0/0/32/0/32; Hurricane / Weather Ball / Tailwind / Protect",
    "Basculegion @ Choice Scarf; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    "Archaludon @ Leftovers; Stamina; Bold 32/0/1/1/29/3; Electro Shot / Flash Cannon / Protect / Dragon Pulse",
    "Floette-Eternal @ Floettite; Flower Veil; Timid 2/0/0/32/0/32; Protect / Dazzling Gleam / Moonblast / Light of Ruin",
    "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Close Combat / Fake Out / Dire Claw / Protect",
  ],
  U03: [
    "Staraptor @ Staraptite; Intimidate; Jolly 29/1/0/0/4/32; Close Combat / Protect / Brave Bird / Roost",
    "Clefable @ Sitrus Berry; Unaware; Bold 32/0/20/0/14/0; Follow Me / Moonblast / Protect / Helping Hand",
    "Sylveon @ Fairy Feather; Pixilate; Modest 13/0/22/23/0/8; Hyper Voice / Quick Attack / Hyper Beam / Protect",
    "Gholdengo @ Life Orb; Good as Gold; Timid 2/0/0/32/0/32; Shadow Ball / Make It Rain / Protect / Nasty Plot",
    "Talonflame @ Sharp Beak; Gale Wings; Jolly 2/32/0/0/0/32; Tailwind / Protect / Flare Blitz / Dual Wingbeat",
    "Kingambit @ Chople Berry; Defiant; Adamant 32/32/0/0/2/0; Sucker Punch / Kowtow Cleave / Protect / Iron Head",
  ],
  U04: [
    "Maushold @ Wide Lens; Friend Guard; Jolly 2/32/0/0/0/32; Follow Me / Protect / Population Bomb / Super Fang",
    "Hatterene @ Life Orb; Magic Bounce; Quiet 32/0/0/32/2/0; Dazzling Gleam / Trick Room / Psychic / Protect",
    "Torkoal @ Charcoal; Drought; Quiet 32/0/0/32/2/0; Eruption / Protect / Weather Ball / Heat Wave",
    "Venusaur @ Focus Sash; Chlorophyll; Modest 2/0/0/32/0/32; Protect / Sludge Bomb / Earth Power / Sleep Powder",
    "Tyranitar @ Tyranitarite; Sand Stream; Jolly 17/18/0/0/0/31; Rock Slide / Protect / Knock Off / Low Kick",
    "Incineroar @ Sitrus Berry; Intimidate; Impish 32/0/21/0/10/3; Fake Out / Parting Shot / Flare Blitz / Protect",
  ],
  U05: [
    "Corviknight @ Leftovers; Mirror Armor; Impish 32/0/5/0/26/3; Brave Bird / Tailwind / Iron Head / Protect",
    "Grimmsnarl @ Light Clay; Prankster; Careful 32/0/19/0/15/0; Parting Shot / Light Screen / Reflect / Protect",
    "Dragonite @ Dragoninite; Inner Focus; Modest 2/0/0/32/0/32; Protect / Dragon Pulse / Heat Wave / Tailwind",
    "Excadrill @ Focus Sash; Sand Rush; Adamant 2/32/0/0/0/32; Iron Head / Protect / Rock Slide / High Horsepower",
    "Milotic @ Sitrus Berry; Competitive; Calm 20/0/20/4/8/14; Protect / Scald / Icy Wind / Ice Beam",
    "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Close Combat / Fake Out / Dire Claw / Protect",
  ],
  U06: [
    "Aerodactyl @ Aerodactylite; Unnerve; Jolly 2/32/0/0/0/32; Rock Slide / Dual Wingbeat / Tailwind / Protect",
    "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/4/0/30/0; Matcha Gotcha / Rage Powder / Protect / Trick Room",
    "Kommo-o @ Life Orb; Soundproof; Modest 2/0/0/32/0/32; Clanging Scales / Protect / Aura Sphere / Vacuum Wave",
    "Glimmora @ Focus Sash; Toxic Debris; Timid 1/0/1/32/0/32; Power Gem / Earth Power / Spiky Shield / Protect",
    "Politoed @ Sitrus Berry; Drizzle; Calm 31/0/23/0/12/0; Protect / Weather Ball / Perish Song / Ice Beam",
    "Basculegion @ Choice Scarf; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
  ],
};

const POOL_A: Readonly<Record<string, readonly string[]>> = {
  A01: [
    "Kingambit @ Chople Berry; Defiant; Adamant 32/32/0/0/2/0; Sucker Punch / Kowtow Cleave / Protect / Iron Head",
    "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
    "Incineroar @ Sitrus Berry; Intimidate; Impish 32/0/32/0/2/0; Fake Out / Parting Shot / Flare Blitz / Protect",
    "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
    "Torkoal @ Charcoal; Drought; Quiet 32/0/0/32/2/0; Eruption / Protect / Weather Ball / Heat Wave",
    "Charizard @ Charizardite Y; Solar Power; Timid 2/0/0/32/0/32; Heat Wave / Protect / Weather Ball / Solar Beam",
  ],
  A02: [
    "Basculegion @ Choice Scarf; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    "Sneasler @ Focus Sash; Unburden; Jolly 2/32/0/0/0/32; Close Combat / Fake Out / Dire Claw / Protect",
    "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/32/0/2/0; Matcha Gotcha / Rage Powder / Protect / Trick Room",
    "Sylveon @ Fairy Feather; Pixilate; Quiet 32/0/2/32/0/0; Hyper Voice / Quick Attack / Hyper Beam / Protect",
    "Gholdengo @ Life Orb; Good as Gold; Timid 2/0/0/32/0/32; Shadow Ball / Make It Rain / Protect / Nasty Plot",
    "Floette-Eternal @ Floettite; Flower Veil; Timid 2/0/0/32/0/32; Protect / Dazzling Gleam / Moonblast / Light of Ruin",
  ],
  A03: [
    "Pelipper @ Sitrus Berry; Drizzle; Timid 2/0/0/32/0/32; Hurricane / Weather Ball / Tailwind / Protect",
    "Archaludon @ Leftovers; Stamina; Timid 2/0/0/32/0/32; Electro Shot / Flash Cannon / Protect / Dragon Pulse",
    "Milotic @ Life Orb; Competitive; Bold 32/0/32/0/2/0; Protect / Scald / Icy Wind / Ice Beam",
    "Mawile @ Mawilite; Hyper Cutter; Brave 32/32/0/0/2/0; Play Rough / Sucker Punch / Protect / Iron Head",
    "Maushold @ Wide Lens; Friend Guard; Jolly 2/32/0/0/0/32; Follow Me / Protect / Population Bomb / Super Fang",
    "Excadrill @ Focus Sash; Sand Rush; Adamant 2/32/0/0/0/32; Iron Head / Protect / Rock Slide / High Horsepower",
  ],
  A04: [
    "Gardevoir @ Gardevoirite; Telepathy; Modest 32/0/2/32/0/0; Hyper Voice / Protect / Psychic / Trick Room",
    "Primarina @ Leftovers; Liquid Voice; Quiet 32/0/2/32/0/0; Protect / Hyper Voice / Moonblast / Calm Mind",
    "Sableye @ Light Clay; Prankster; Careful 32/0/2/0/32/0; Light Screen / Encore / Reflect / Protect",
    "Arcanine-Hisui @ Focus Sash; Rock Head; Jolly 2/32/0/0/0/32; Flare Blitz / Protect / Extreme Speed / Head Smash",
    "Tyranitar @ Choice Scarf; Sand Stream; Jolly 2/32/0/0/0/32; Rock Slide / Knock Off / Ice Punch / Low Kick",
    "Venusaur @ Life Orb; Chlorophyll; Modest 2/0/0/32/0/32; Protect / Sludge Bomb / Earth Power / Sleep Powder",
  ],
  A05: [
    "Kangaskhan @ Kangaskhanite; Scrappy; Brave 32/32/2/0/0/0; Fake Out / Double-Edge / Sucker Punch / Protect",
    "Clefable @ Sitrus Berry; Unaware; Bold 32/0/32/0/2/0; Follow Me / Moonblast / Protect / Helping Hand",
    "Azumarill @ Life Orb; Huge Power; Adamant 32/32/2/0/0/0; Aqua Jet / Protect / Play Rough / Belly Drum",
    "Rotom-Wash @ Choice Scarf; Levitate; Timid 2/0/0/32/0/32; Hydro Pump / Will-O-Wisp / Thunderbolt / Protect",
    "Talonflame @ Sharp Beak; Gale Wings; Jolly 2/32/0/0/0/32; Tailwind / Protect / Flare Blitz / Dual Wingbeat",
    "Hydreigon @ Haban Berry; Levitate; Modest 2/0/0/32/0/32; Dark Pulse / Draco Meteor / Snarl / Protect",
  ],
  A06: [
    "Aegislash @ Spell Tag; Stance Change; Brave 32/32/2/0/0/0; King's Shield / Poltergeist / Shadow Sneak / Protect",
    "Slowking @ Leftovers; Regenerator; Bold 32/0/32/0/2/0; Trick Room / Chilly Reception / Scald / Protect",
    "Metagross @ Metagrossite; Clear Body; Jolly 2/32/0/0/0/32; Protect / Psychic Fangs / Iron Head / Body Press",
    "Lycanroc-Dusk @ Focus Sash; Tough Claws; Adamant 2/32/0/0/0/32; Accelerock / Protect / Close Combat / Rock Slide",
    "Ninetales-Alola @ Never-Melt Ice; Snow Warning; Timid 2/0/0/32/0/32; Blizzard / Freeze-Dry / Protect / Encore",
    "Ceruledge @ Colbur Berry; Flash Fire; Adamant 32/32/2/0/0/0; Bitter Blade / Shadow Sneak / Protect / Bulk Up",
  ],
  A07: [
    "Hawlucha @ Hawluchanite; Unburden; Jolly 32/0/0/0/2/32; Entrainment / Detect / Cross Chop / Protect",
    "Snorlax @ Leftovers; Thick Fat; Impish 32/0/32/0/2/0; Protect / Fissure / Stockpile / Yawn",
    "Gallade @ Expert Belt; Sharpness; Brave 32/32/2/0/0/0; Sacred Sword / Psycho Cut / Leaf Blade / Protect",
    "Dragonite @ Life Orb; Inner Focus; Adamant 2/32/0/0/0/32; Extreme Speed / Dragon Claw / Protect / Superpower",
    "Kommo-o @ Dragon Fang; Soundproof; Modest 2/0/0/32/0/32; Clanging Scales / Protect / Aura Sphere / Vacuum Wave",
    "Glimmora @ Focus Sash; Toxic Debris; Modest 2/0/0/32/0/32; Power Gem / Earth Power / Spiky Shield / Protect",
  ],
  A08: [
    "Scizor @ Scizorite; Technician; Adamant 32/32/0/0/2/0; Bullet Punch / Protect / Swords Dance / Bug Bite",
    "Politoed @ Sitrus Berry; Drizzle; Timid 2/0/0/32/0/32; Protect / Weather Ball / Perish Song / Ice Beam",
    "Annihilape @ Leftovers; Defiant; Jolly 2/32/0/0/0/32; Protect / Rage Fist / Close Combat / Drain Punch",
    "Meowscarada @ Life Orb; Overgrow; Jolly 2/32/0/0/0/32; Flower Trick / Knock Off / Protect / Triple Axel",
    "Toxapex @ Shuca Berry; Regenerator; Bold 32/0/32/0/2/0; Toxic / Infestation / Baneful Bunker / Protect",
    "Rotom-Heat @ Choice Scarf; Levitate; Timid 2/0/0/32/0/32; Overheat / Thunderbolt / Volt Switch / Will-O-Wisp",
  ],
};

/**
 * Addendum A1.5 gate positions: turn 1 after both team previews (the first two of each order lead; the AI is p2). Each
 * holds one Mega-capable AI member, so keeping the Mega has no option value for another member. Damage and Speed facts
 * from calculateTurnMove / getBuildStats with these spreads (scripts/.cache/training/build/val/mega-calcs.ts):
 * - keep: Mega now is worse this turn;
 * - mega: Mega now wins a KO race the base form loses.
 */
export type MegaPosition = {
  id: string; expect: "keep" | "mega"; fact: string; ai: readonly string[]; player: readonly string[];
  /** "mega" positions: the move of the KO race; a sample counts only when the Mega slot uses it (not Mega + Protect). */
  move?: string;
};
export const MEGA_POSITIONS: readonly MegaPosition[] = [
  {
    id: "K1-charizard-x-ground", expect: "keep",
    fact: "Charizard-Mega-X (Fire/Dragon) loses Charizard's Ground immunity: Earthquake 97-117% and Dragon Claw 106-126% from a faster Garchomp (169 vs 167); Charizard takes 0% from Earthquake and Earth Power. Kingambit leads beside it: a Prankster Tailwind lead (Whimsicott) would let the Mega move first this turn (PS/sim/battle.ts:2919-2925) and KO Hydreigon.",
    ai: [
      "Charizard @ Charizardite X; Blaze; Jolly 2/32/0/0/0/32; Flare Blitz / Dragon Claw / Dragon Dance / Protect",
      "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Basculegion @ Mystic Water; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
      "Farigiraf @ Sitrus Berry; Armor Tail; Calm 29/0/21/0/16/0; Trick Room / Psychic / Helping Hand / Protect",
    ],
    player: [
      "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Earthquake / Dragon Claw / Stomping Tantrum / Protect",
      "Hydreigon @ Choice Scarf; Levitate; Timid 2/0/0/32/0/32; Draco Meteor / Earth Power / Dark Pulse / Flamethrower",
      "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
    ],
  },
  {
    id: "K2-gyarados-fighting", expect: "keep",
    fact: "Gyarados-Mega (Water/Dark) loses the Flying resistance to Fighting and gains a Fairy weakness: Sneasler's Close Combat 112-133% (Gyarados 37-43%), Grimmsnarl's Spirit Break 54-64% (35-42%).",
    ai: [
      "Gyarados @ Gyaradosite; Intimidate; Adamant 2/32/0/0/0/32; Waterfall / Crunch / Dragon Dance / Protect",
      "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
    ],
    player: [
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Close Combat / Dire Claw / Fake Out / Protect",
      "Grimmsnarl @ Light Clay; Prankster; Careful 32/0/19/0/15/0; Spirit Break / Reflect / Light Screen / Fake Out",
      "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
      "Garchomp @ Life Orb; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
      "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
      "Rotom-Wash @ Leftovers; Levitate; Bold 32/0/23/1/3/7; Hydro Pump / Thunderbolt / Will-O-Wisp / Protect",
    ],
  },
  {
    id: "K3-garchomp-speed", expect: "keep",
    fact: "Garchomp-Mega is slower than Garchomp (158 vs 169): a Timid Hydreigon (165) moves between them and its Draco Meteor KOs either form (160-207%); Garchomp moves first with Dragon Claw 90-107%.",
    ai: [
      "Garchomp @ Garchompite; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Rock Slide / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Basculegion @ Mystic Water; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    ],
    player: [
      "Hydreigon @ Life Orb; Levitate; Timid 2/0/0/32/0/32; Draco Meteor / Dark Pulse / Earth Power / Protect",
      "Rotom-Wash @ Leftovers; Levitate; Bold 32/0/23/1/3/7; Hydro Pump / Thunderbolt / Will-O-Wisp / Protect",
      "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
      "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
      "Gholdengo @ Metal Coat; Good as Gold; Timid 2/0/0/32/0/32; Shadow Ball / Make It Rain / Nasty Plot / Protect",
    ],
  },
  {
    id: "K4-charizard-y-sun-feeds-fire", expect: "keep",
    fact: "Mega Charizard Y's Drought powers the foes' Fire: Flare Blitz into the AI's Kingambit goes from 87-102% to 130-154% in sun, while its own Heat Wave into two Fire types stays at 28-33%.",
    ai: [
      "Charizard @ Charizardite Y; Blaze; Timid 2/0/0/32/0/32; Heat Wave / Air Slash / Solar Beam / Protect",
      "Kingambit @ Chople Berry; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Basculegion @ Mystic Water; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    ],
    player: [
      "Incineroar @ Sitrus Berry; Intimidate; Adamant 32/32/0/0/2/0; Fake Out / Flare Blitz / Darkest Lariat / Protect",
      "Arcanine @ Life Orb; Intimidate; Adamant 31/32/0/0/0/3; Flare Blitz / Extreme Speed / Will-O-Wisp / Protect",
      "Garchomp @ Yache Berry; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
      "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
      "Rotom-Wash @ Leftovers; Levitate; Bold 32/0/23/1/3/7; Hydro Pump / Thunderbolt / Will-O-Wisp / Protect",
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    ],
  },
  {
    id: "R1-charizard-y-double-ko", expect: "mega", move: "heatwave",
    fact: "Mega Charizard Y's sun Heat Wave KOs Kingambit (114-136%) and Metagross (147-173%) before either moves; Charizard's Heat Wave does 58-70% and 74-89%.",
    ai: [
      "Charizard @ Charizardite Y; Blaze; Timid 2/0/0/32/0/32; Heat Wave / Air Slash / Solar Beam / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Basculegion @ Mystic Water; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Farigiraf @ Sitrus Berry; Armor Tail; Calm 29/0/21/0/16/0; Trick Room / Psychic / Helping Hand / Protect",
    ],
    player: [
      "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Metagross @ Life Orb; Clear Body; Jolly 2/32/0/0/0/32; Iron Head / Psychic Fangs / Bullet Punch / Protect",
      "Garchomp @ Yache Berry; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
      "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
      "Pelipper @ Damp Rock; Drizzle; Modest 32/0/1/5/17/11; Hurricane / Weather Ball / Tailwind / Wide Guard",
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    ],
  },
  {
    id: "R2-gengar-speed", expect: "mega", move: "sludgebomb",
    fact: "Gengar-Mega outspeeds a Jolly Meowscarada (200 vs 192; Gengar 178) and its Sludge Bomb KOs it first (165-194%); Meowscarada's Knock Off KOs either form (114-167%). Pelipper beside it has no attack (a Weather Ball that KOs Gengar, 105-125%, made Protect as good as the race: scripts/.cache/training/build/fixer/r2-probe-R2-gengar-speed.out).",
    ai: [
      "Gengar @ Gengarite; Cursed Body; Timid 2/0/0/32/0/32; Sludge Bomb / Shadow Ball / Icy Wind / Protect",
      "Kingambit @ Black Glasses; Defiant; Adamant 32/32/0/0/2/0; Kowtow Cleave / Sucker Punch / Iron Head / Protect",
      "Whimsicott @ Focus Sash; Prankster; Timid 2/0/0/32/0/32; Tailwind / Moonblast / Encore / Protect",
      "Sinistcha @ Colbur Berry; Hospitality; Bold 32/0/14/0/20/0; Matcha Gotcha / Rage Powder / Trick Room / Protect",
      "Archaludon @ Leftovers; Stamina; Modest 32/0/0/12/18/4; Electro Shot / Flash Cannon / Dragon Pulse / Protect",
      "Basculegion @ Mystic Water; Adaptability; Jolly 2/32/0/0/0/32; Last Respects / Aqua Jet / Wave Crash / Protect",
    ],
    player: [
      "Meowscarada @ Life Orb; Overgrow; Jolly 2/32/0/0/0/32; Knock Off / Flower Trick / Triple Axel / Protect",
      "Pelipper @ Damp Rock; Drizzle; Bold 32/0/17/0/17/0; Tailwind / Wide Guard / Protect / Roost",
      "Garchomp @ Yache Berry; Rough Skin; Jolly 2/32/0/0/0/32; Dragon Claw / Earthquake / Stomping Tantrum / Protect",
      "Incineroar @ Sitrus Berry; Intimidate; Careful 32/0/14/0/20/0; Fake Out / Parting Shot / Flare Blitz / Protect",
      "Rotom-Wash @ Leftovers; Levitate; Bold 32/0/23/1/3/7; Hydro Pump / Thunderbolt / Will-O-Wisp / Protect",
      "Sneasler @ White Herb; Unburden; Jolly 2/32/0/0/0/32; Fake Out / Close Combat / Dire Claw / Protect",
    ],
  },
];
/** A Mega position's side as a TrainingTeam (members in the order written; the first two lead). */
export function positionTeam(position: MegaPosition, side: "ai" | "player", runtime: BattleRuntime = championsRuntime): TrainingTeam {
  return fixtureTeam({ id: `${position.id}:${side}`, pool: "V", sets: position[side] }, runtime);
}

export const TEAM_FIXTURES: readonly TeamFixture[] = [
  ...Object.entries(POOL_S).map(([id, species]) => ({ id, pool: "S" as const, species })),
  ...Object.entries(POOL_V).map(([id, sets]) => ({ id, pool: "V" as const, sets })),
  ...Object.entries(POOL_U).map(([id, sets]) => ({ id, pool: "U" as const, sets })),
  ...Object.entries(POOL_A).map(([id, sets]) => ({ id, pool: "A" as const, sets })),
];

export function fixturesIn(pools: readonly TeamPool[]): TeamFixture[] {
  return TEAM_FIXTURES.filter((fixture) => pools.includes(fixture.pool));
}
export function fixtureById(id: string): TeamFixture {
  const fixture = TEAM_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`No training team fixture ${id}.`);
  return fixture;
}

/** One compact set as Showdown/PokéPaste text (Champions: "EVs" are Stat Points). */
export function pasteSet(compact: string): string {
  const [head, ability, spread, moves] = compact.split(";").map((part) => part.trim());
  const [nature, points] = spread.split(" ");
  const values = points.split("/").map(Number);
  const evs = STAT_ORDER.flatMap((stat, index) => values[index] ? [`${values[index]} ${STAT_LABEL[stat]}`] : []);
  return [head, `Ability: ${ability}`, "Level: 50", ...(evs.length ? [`EVs: ${evs.join(" / ")}`] : []), `${nature} Nature`,
    ...moves.split("/").map((move) => `- ${move.trim()}`)].join("\n");
}
/** A fixture's six as PokéPaste text; Pool S has none (its members are fresh calculator builds). */
export function fixturePaste(fixture: TeamFixture): string | null {
  return fixture.pool === "S" ? null : `${fixture.sets.map(pasteSet).join("\n\n")}\n`;
}

/**
 * The fixture as the Training page hands it to the worker: TrainingMember key = the member's species id (unique under
 * Species Clause), builds through showdownNature (SPEC C15).
 */
export function fixtureTeam(fixture: TeamFixture, runtime: BattleRuntime = championsRuntime): TrainingTeam {
  if (fixture.pool === "S") {
    const members = fixture.species.map((speciesId): TrainingMember => {
      const species = runtime.speciesById.get(speciesId);
      if (!species) throw new Error(`${fixture.id}: unknown species ${speciesId}.`);
      const build = showdownNature(withUsualAbility(createBuild(speciesId, runtime), usualAbility(speciesId, "Doubles", runtime)));
      return { key: speciesId, name: species.name, speciesId, build, moves: createMoveSlots(speciesId, "Doubles", runtime), origin: "suggested" };
    });
    return { label: fixture.id, members };
  }
  const team = parseTeamImport(fixturePaste(fixture)!, "champions", runtime);
  const errors = [...team.diagnostics, ...team.members.flatMap((member) => member.diagnostics)].filter((entry) => entry.severity === "error");
  if (errors.length || team.members.some((member) => !member.selectable || !member.build || !member.speciesId)) {
    throw new Error(`${fixture.id}: ${errors.map((entry) => entry.message).join(" ") || "a member is not selectable"}`);
  }
  const members = team.members.map((member): TrainingMember => ({
    key: member.speciesId!, name: member.name, speciesId: member.speciesId!, build: showdownNature(member.build!), moves: member.moves, origin: "imported",
  }));
  return { label: fixture.id, members };
}
