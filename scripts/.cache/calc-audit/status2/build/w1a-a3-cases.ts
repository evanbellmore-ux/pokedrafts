// Track A3 (wave 1a) verification cases: F3 field-side-items.md §11.1's FS scenarios (and a few more of A3's points),
// each run by w1a-a3-run.ts against pinned Showdown c23d2e94 and the app. Track V1 owns the stored FS cases (cases-fs.ts);
// these are A3's own check while it builds. Showdown names; level 50, 31 IVs, Serious, 0 EVs unless set (Champions: Stat
// Points). Speeds at level 50 with 0 EVs: base + 20; 252 EVs: base + 52. Slots: own-left p1a, own-right p1b,
// opponent-right p2a, opponent-left p2b. Every move is one its user learns in that game (the app checks learnsets).
import type { Case, Game } from "../../2v2/verify/case-types";
import { OL, OR, PL, PR, act, idle, lax, mon, slots } from "../../2v2/verify/case-kit";

const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, ...c });
/** A fast Pokémon: 252 Speed EVs (Champions: 32 Stat Points). */
const quick = (game: Game) => ({ spe: game === "champions" ? 32 : 252 });

// ---- Magic Coat (SwSh, USUM) ----
for (const game of ["swsh", "usum"] as Game[]) add("A3-MC-01", game, {
  title: "Clefable Magic Coat; Jolteon's Growl (spread) comes back to both foes, the ally Lapras takes it; Snorlax's Body Slam into Lapras",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Magic Coat"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OR), act(mon("Jolteon", "Volt Absorb"), "Growl")),
  outcomes: true, checks: "F01: the reflected spread move is the holder's at its own targets.",
});
for (const coat of ["Sableye", "Clefable"]) add(`A3-MC-02-${coat}`, "usum", {
  title: `${coat} Magic Coat; Absol's Thunder Wave into it: a Prankster reflection fails on the Dark type (F02)`,
  slots: slots(act(coat === "Sableye" ? mon("Sableye", "Prankster") : mon("Clefable", "Magic Guard"), "Magic Coat"), idle(mon("Lapras", "Shell Armor")),
    idle(lax(0)), act(mon("Absol", "Pressure"), "Thunder Wave", OL)),
  outcomes: true, checks: "F02",
});
add("A3-MC-03", "swsh", {
  title: "Clefable Magic Coat; its ally Togekiss Thunder Waves it: back to Togekiss (F05)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Magic Coat"), act(mon("Togekiss", "Serene Grace"), "Thunder Wave", OL), idle(lax(0)), idle(lax(4))),
  outcomes: true, checks: "F05",
});
add("A3-MC-04", "usum", {
  title: "Clefable Magic Coat; Smeargle's Stealth Rock lands on Smeargle's side (F04)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Magic Coat"), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), act(mon("Smeargle", "Own Tempo"), "Stealth Rock")),
  outcomes: true, checks: "F04",
});
add("A3-MC-05", "swsh", {
  title: "Mold Breaker Haxorus Leer into a Magic Coat holder: it comes back (F03)",
  slots: slots(act(mon("Clefable", "Magic Guard"), "Magic Coat"), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), act(mon("Haxorus", "Mold Breaker"), "Leer")),
  outcomes: true, checks: "F03",
});

// ---- Snatch (USUM) ----
add("A3-SN-01", "usum", {
  title: "Absol Snatch takes a foe's Swords Dance; the slower foe Body Slams Absol",
  slots: slots(act(mon("Absol", "Pressure"), "Snatch"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OL), act(mon("Smeargle", "Own Tempo"), "Swords Dance")),
  outcomes: true, checks: "F10-F11: the next snatchable move is the Snatch user's.",
});
add("A3-SN-02", "usum", {
  title: "Sableye Snatch takes a foe's Reflect; the slower foe's Body Slam into Sableye's ally Lapras meets Reflect",
  slots: slots(act(mon("Sableye", "Keen Eye"), "Snatch"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OR), act(mon("Alakazam", "Inner Focus"), "Reflect")),
  outcomes: true, checks: "F16: a stolen screen goes to the Snatch user's side.",
});
add("A3-SN-03", "usum", {
  title: "A paralysed Absol's Snatch and a foe's Substitute; the slower foe Body Slams Absol",
  slots: slots(act(mon("Absol", "Pressure", { status: "par" }), "Snatch"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OL), act(mon("Gengar", "Cursed Body"), "Substitute")),
  outcomes: true, checks: "F13, F15: the Snatch user pays for the Substitute; paralysis read at the Snatch action only.",
});
add("A3-SN-04", "usum", {
  title: "Umbreon Snatch takes the foe's Wide Guard; its ally Tyranitar's Rock Slide then hits both foes",
  slots: slots(act(mon("Umbreon", "Inner Focus"), "Snatch"), act(mon("Tyranitar", "Unnerve"), "Rock Slide"), idle(lax(0)), act(mon("Hariyama", "Thick Fat"), "Wide Guard")),
  outcomes: true, checks: "earlyBranch's dispatch (Wide Guard).",
});
add("A3-SN-05", "usum", {
  title: "Absol Snatch takes the foe Chansey's Heal Bell: Absol's burned ally is cured, Chansey's poisoned ally is not",
  slots: slots(act(mon("Absol", "Pressure"), "Snatch"), idle(mon("Lapras", "Shell Armor", { status: "brn", silentStatus: true })),
    idle(lax(0, { status: "psn", silentStatus: true })), act(mon("Chansey", "Natural Cure"), "Heal Bell")),
  outcomes: true, checks: "F126 (the active part).",
});
add("A3-SN-06", "usum", {
  title: "Absol Snatch takes the foe's Tailwind (via earlyBranch's fieldMove); the slower Snorlaxes' order",
  slots: slots(act(mon("Absol", "Pressure"), "Snatch"), act(lax(0), "Body Slam", PR), act(mon("Talonflame", "Gale Wings"), "Tailwind"), act(lax(8), "Body Slam", OR)),
  outcomes: true, checks: "F16: a stolen Tailwind goes to the Snatch user's side; generation 7 keeps its frozen order.",
});

// ---- Crafty Shield (SwSh, USUM) ----
add("A3-CS-01", "swsh", {
  title: "Klefki Crafty Shield; a foe's Thunder Wave into its ally is blocked; the slower foe's Body Slam is not",
  slots: slots(act(mon("Klefki", "Prankster"), "Crafty Shield"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OR), act(mon("Jolteon", "Volt Absorb"), "Thunder Wave", OR)),
  outcomes: true, checks: "F21-F23",
});
add("A3-CS-02", "usum", {
  title: "Klefki Crafty Shield as the last action fails (three faster Protects)",
  slots: slots(act(mon("Klefki", "Magician"), "Crafty Shield"), act(mon("Jolteon", "Volt Absorb"), "Protect"), act(mon("Lapras", "Shell Armor"), "Protect"), act(lax(4), "Protect")),
  checks: "F20",
});
add("A3-CS-03", "usum", {
  title: "Klefki Crafty Shield and its ally Clefable's Magic Coat: Absol's Thunder Wave into Clefable is blocked, not reflected (F25)",
  slots: slots(act(mon("Klefki", "Magician"), "Crafty Shield"), act(mon("Clefable", "Magic Guard"), "Magic Coat"), idle(lax(0)), act(mon("Absol", "Pressure"), "Thunder Wave", OR)),
  outcomes: true, checks: "F25",
});

// ---- Mat Block (SwSh, USUM) ----
add("A3-MB-01", "usum", {
  title: "Greninja Mat Block; the foe's Body Slam into its ally is blocked, and so is its ally Garchomp's own Earthquake into it (F31)",
  slots: slots(act(mon("Greninja", "Torrent"), "Mat Block"), act(mon("Garchomp", "Rough Skin"), "Earthquake"), act(lax(0), "Body Slam", OR), idle(lax(4))),
  outcomes: true, checks: "F30-F32",
});
add("A3-MB-02", "usum", {
  title: "Greninja Mat Block; the foe's Body Slam into it is blocked; its ally is hit by a Rock Slide from the other foe",
  slots: slots(act(mon("Greninja", "Torrent"), "Mat Block"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OL), act(mon("Tyranitar", "Unnerve"), "Rock Slide")),
  outcomes: true, checks: "F30",
});

// ---- Lucky Chant (USUM) ----
add("A3-LC-01", "usum", {
  title: "Clefable Lucky Chant; a foe's Frost Breath into its ally is not critical",
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 252 } }), "Lucky Chant"), idle(lax(8)), idle(lax(4)), act(mon("Articuno", "Pressure"), "Frost Breath", OR)),
  checks: "K52, F35",
});

// ---- Mist ----
for (const game of ["sv", "swsh"] as Game[]) add("A3-MI-01", game, {
  title: "Lapras Mist; a foe's Snarl does not lower Lapras's or its ally's Sp. Atk; the ally's later Surf",
  slots: slots(act(mon("Lapras", "Water Absorb", { evs: { spe: 252 } }), "Mist"), act(mon("Gastrodon", "Storm Drain"), "Surf"), idle(lax(4)), act(mon("Umbreon", "Inner Focus"), "Snarl")),
  checks: "K51: Mist against a damaging move's drop (the step's UsesEnv.mist).",
});
add("A3-MI-02", "swsh", {
  title: "Lapras Mist; Jolteon's Growl into Lapras is stopped and into Corviknight reflected onto Jolteon by Mirror Armor first (F40)",
  slots: slots(act(mon("Lapras", "Water Absorb", { evs: { spe: 252 } }), "Mist"), idle(mon("Corviknight", "Mirror Armor")), idle(lax(0)), act(mon("Jolteon", "Volt Absorb"), "Growl")),
  outcomes: true, checks: "F40",
});
add("A3-MI-03", "usum", {
  title: "Lapras Mist; a foe's Parting Shot drops nothing and switches nothing (F43)",
  slots: slots(act(mon("Lapras", "Water Absorb", { evs: { spe: 252 } }), "Mist"), idle(lax(8)), idle(lax(4)), act(mon("Pangoro", "Iron Fist"), "Parting Shot", OL)),
  outcomes: true, checks: "F43",
});
add("A3-MI-04", "sv", {
  title: "Mist up on own side from an earlier turn: the foe Umbreon's Snarl lowers nothing; the ally's later Surf",
  field: { own: { mist: true } },
  slots: slots(idle(mon("Lapras", "Water Absorb")), act(mon("Gastrodon", "Storm Drain"), "Surf"), idle(lax(4)), act(mon("Umbreon", "Inner Focus"), "Snarl")),
  checks: "SideConditions.mist (startWorld).",
});

// ---- Court Change (SV, Champions, SwSh) ----
for (const game of ["sv", "champions"] as Game[]) add("A3-CC-01", game, {
  title: "The foe's Tailwind, then Cinderace's Court Change moves it to own side; the slower Snorlaxes follow the new order",
  slots: slots(act(mon("Cinderace", "Blaze"), "Court Change"), act(lax(0), "Body Slam", PR), act(lax(4), "Body Slam", OR), act(mon("Talonflame", "Gale Wings", { evs: quick(game) }), "Tailwind")),
  outcomes: true, checks: "F50, F51",
});
add("A3-CC-02", "swsh", {
  title: "Machamp Wide Guard, then Cinderace's Court Change: the Wide Guard stays (F53); Tyranitar's Rock Slide is blocked",
  slots: slots(act(mon("Cinderace", "Blaze"), "Court Change"), act(mon("Machamp", "Guts"), "Wide Guard"), idle(lax(0)), act(mon("Tyranitar", "Unnerve"), "Rock Slide")),
  outcomes: true, checks: "F53",
});

// ---- Defog ----
add("A3-DF-01", "sv", {
  title: "Corviknight Defogs a foe: its side's Reflect and the Electric Terrain end; Snorlax's later Body Slam and the foe's Thunderbolt",
  field: { terrain: "Electric", opponent: { reflect: true } },
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { spe: 252 } }), "Defog", PR), act(lax(0), "Body Slam", PR), act(lax(4), "Thunderbolt", OR), idle(lax(12))),
  checks: "F58: generation 8 on, the terrain ends.",
});
add("A3-DF-02", "usum", {
  title: "Togekiss Defogs a foe under Electric Terrain (generation 7: the terrain stays); the foe's later Thunderbolt",
  field: { terrain: "Electric", opponent: { reflect: true } },
  slots: slots(act(mon("Togekiss", "Serene Grace", { evs: { spe: 252 } }), "Defog", PR), act(lax(0), "Body Slam", PR), act(lax(4), "Thunderbolt", OR), idle(lax(12))),
  checks: "K45",
});
add("A3-DF-03", "champions", {
  title: "Corviknight Defogs a Defiant Kingambit (+2 Atk); Kingambit's later Iron Head",
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { spe: 32 } }), "Defog", PR), idle(lax(4)), idle(lax(0)), act(mon("Kingambit", "Defiant"), "Iron Head", OR)),
  outcomes: true, checks: "F59",
});
add("A3-DF-04", "sv", {
  title: "Corviknight Defogs a foe behind a Substitute: no evasion drop, but its side's Reflect goes (F56)",
  field: { opponent: { reflect: true } },
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { spe: 252 } }), "Defog", PR), act(lax(0), "Body Slam", PL), idle(lax(4)), idle(lax(8, { substitute: 50 }))),
  outcomes: true, checks: "F56",
});
add("A3-DF-05", "sv", {
  title: "Corviknight Defogs while Iron Hands (Quark Drive) stands on Electric Terrain: not estimated (FC until 1b)",
  field: { terrain: "Electric" },
  slots: slots(act(mon("Corviknight", "Pressure", { evs: { spe: 252 } }), "Defog", PR), act(mon("Iron Hands", "Quark Drive"), "Drain Punch", PR), idle(lax(0)), idle(lax(4))),
  notEstimated: "A weather or terrain change this turn would change Quark Drive.", checks: "F60",
});

// ---- Magic Room ----
add("A3-MR-01", "sv", {
  title: "Smeargle Magic Room: a Life Orb Garchomp's later Earthquake loses its boost and recoil; a foe's Sitrus is not eaten",
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Magic Room"), act(mon("Garchomp", "Rough Skin", { item: "Life Orb" }), "Earthquake"),
    idle(lax(0, { item: "Sitrus Berry", hp: 150 })), idle(lax(4))),
  checks: "K25",
});
add("A3-MR-02", "champions", {
  title: "Magic Room up; Gardevoir's Magic Room ends it: a Sitrus at half and a Lum against paralysis act at the Update; a later hit",
  field: { magicRoom: true },
  slots: slots(act(mon("Gardevoir", "Trace", { evs: { spe: 32 } }), "Magic Room"), idle(lax(8, { item: "Lum Berry", status: "par", silentStatus: true })),
    idle(lax(4, { item: "Sitrus Berry", hp: 100 })), act(lax(0), "Body Slam", PL)),
  checks: "F65, F143",
});
add("A3-MR-03", "sv", {
  title: "Smeargle Magic Room; a Choice Scarf foe and Air Balloon target: the ally's Earthquake hits the Air Balloon Snorlax",
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Magic Room"), act(mon("Garchomp", "Rough Skin"), "Earthquake"),
    idle(lax(0, { item: "Air Balloon" })), idle(lax(4, { item: "Choice Scarf" }))),
  checks: "F66",
});

// ---- Wonder Room ----
add("A3-WR-01", "sv", {
  title: "Mismagius Wonder Room; a later Body Slam into Chansey uses its Sp. Def",
  slots: slots(act(mon("Mismagius", "Levitate", { evs: { spe: 252 } }), "Wonder Room"), idle(mon("Chansey", "Natural Cure")), act(lax(0), "Body Slam", OR), idle(lax(4))),
  checks: "K53",
});
add("A3-WR-02", "champions", {
  title: "Wonder Room up; Gardevoir's Wonder Room ends it; the later Body Slam into Clefable uses its Defense again",
  field: { wonderRoom: true },
  slots: slots(act(mon("Gardevoir", "Trace", { evs: { spe: 32 } }), "Wonder Room"), idle(mon("Clefable", "Magic Guard")), act(lax(0), "Body Slam", OR), idle(lax(4))),
  checks: "F72",
});

// ---- Mud Sport, Water Sport (USUM) ----
add("A3-SP-01", "usum", {
  title: "Excadrill Mud Sport; the foe's Thunderbolt is weakened",
  slots: slots(act(mon("Excadrill", "Sand Rush", { evs: { spe: 252 } }), "Mud Sport"), idle(mon("Lapras", "Shell Armor")), idle(lax(4)), act(lax(0), "Thunderbolt", OR)),
  checks: "K39",
});
add("A3-SP-02", "usum", {
  title: "Azumarill Water Sport; the foe's Flamethrower is weakened",
  slots: slots(act(mon("Azumarill", "Huge Power", { evs: { spe: 252 } }), "Water Sport"), idle(mon("Lapras", "Shell Armor")), idle(lax(4)), act(mon("Arcanine", "Intimidate"), "Flamethrower", OR)),
  checks: "F76's base",
});

// ---- Corrosive Gas (Champions, SwSh) ----
add("A3-CG-01", "champions", {
  title: "Gengar Corrosive Gas: its ally's and the foes' items go (a Leftovers foe heals nothing at the end)",
  slots: slots(act(mon("Gengar", "Cursed Body", { evs: { spe: 32 } }), "Corrosive Gas"), idle(mon("Clefable", "Magic Guard", { item: "Sitrus Berry" })),
    idle(lax(0, { item: "Leftovers", hp: 150 })), act(lax(4, { item: "Sitrus Berry" }), "Body Slam", OR)),
  outcomes: true, checks: "F80-F84",
});
add("A3-CG-02", "swsh", {
  title: "Weezing Corrosive Gas into a Sticky Hold Muk and an Air Balloon Snorlax; the ally's Earthquake then hits the Snorlax",
  slots: slots(act(mon("Weezing", "Levitate", { evs: { spe: 252 } }), "Corrosive Gas"), act(mon("Excadrill", "Sand Rush"), "Earthquake"),
    idle(lax(0, { item: "Air Balloon" })), idle(mon("Gastrodon", "Sticky Hold", { item: "Leftovers" }))),
  outcomes: true, checks: "F80, F83",
});

// ---- Bestow (USUM) ----
add("A3-BE-01", "usum", {
  title: "Togekiss Bestows a Sitrus Berry on its ally at 80 HP: eaten at the Update; a later hit",
  slots: slots(act(mon("Togekiss", "Serene Grace", { item: "Sitrus Berry", evs: { spe: 252 } }), "Bestow", OR), idle(mon("Lapras", "Shell Armor", { hp: 80 })),
    act(lax(0), "Body Slam", OR), idle(lax(4))),
  outcomes: true, checks: "F88",
});

// ---- Recycle ----
add("A3-RC-01", "champions", {
  title: "Snorlax Recycles its Sitrus Berry from an earlier turn (input lastItem), then eats it after a hit",
  slots: slots(act(lax(0, { lastItem: "Sitrus Berry", hp: 150 }), "Recycle"), idle(mon("Clefable", "Magic Guard")), idle(lax(4)), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OL)),
  outcomes: true, checks: "F93 as one turn",
});
add("A3-RC-02", "sv", {
  title: "Snorlax Recycle with its earlier item not known: not estimated",
  slots: slots(act(lax(0), "Recycle"), idle(mon("Lapras", "Shell Armor")), idle(lax(4)), idle(lax(8))),
  notEstimated: "Recycle needs Snorlax (yours)'s item from an earlier turn.", checks: "needsLastItem",
});

// ---- Teatime (SV, Champions, SwSh) ----
add("A3-TT-01", "sv", {
  title: "Smeargle Teatime: a Sitrus above half is eaten anyway (no line), a Lum holder eats it, a Good as Gold Gholdengo eats nothing",
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Teatime"), idle(lax(0, { item: "Sitrus Berry", hp: 150 })),
    idle(lax(4, { item: "Lum Berry" })), idle(mon("Gholdengo", "Good as Gold", { item: "Sitrus Berry", hp: 100 }))),
  outcomes: true, checks: "K30",
});
add("A3-TT-02", "champions", {
  title: "Polteageist Teatime under Magic Room: no Berry effect (Sitrus, Oran); a later hit",
  field: { magicRoom: true },
  slots: slots(act(mon("Polteageist", "Cursed Body", { evs: { spe: 32 } }), "Teatime"), idle(lax(0, { item: "Sitrus Berry", hp: 100 })),
    act(lax(4, { item: "Oran Berry", hp: 100 }), "Body Slam", OR), idle(mon("Clefable", "Magic Guard"))),
  outcomes: true, checks: "F100",
});
add("A3-TT-03", "sv", {
  title: "Smeargle Teatime: a Modest Snorlax eats its Figy Berry (heal and confusion) before its own Body Slam",
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Teatime"), act(lax(0, { item: "Figy Berry", nature: "Modest", hp: 120 }), "Body Slam", PR),
    idle(lax(4)), idle(lax(12))),
  outcomes: true, checks: "F102 (Figy)",
});

// ---- Stuff Cheeks ----
add("A3-SC-01", "sv", {
  title: "Greedent Stuff Cheeks: Def +2 then its Sitrus at once (Cheek Pouch); a later Body Slam into it",
  slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Sitrus Berry", hp: 150, evs: { spe: 252 } }), "Stuff Cheeks"), idle(mon("Lapras", "Shell Armor")),
    act(lax(0), "Body Slam", OL), idle(lax(4))),
  outcomes: true, checks: "K29",
});
add("A3-SC-02", "champions", {
  title: "Swalot Stuff Cheeks under Magic Room: +2 Def, the Sitrus eaten with no heal",
  field: { magicRoom: true },
  slots: slots(act(mon("Swalot", "Gluttony", { item: "Sitrus Berry", hp: 100, evs: { spe: 32 } }), "Stuff Cheeks"), idle(mon("Clefable", "Magic Guard")),
    act(lax(0), "Body Slam", OL), idle(lax(4))),
  outcomes: true, checks: "F107",
});

// ---- Aromatherapy, Heal Bell ----
add("A3-HB-01", "sv", {
  title: "Chansey Heal Bell cures its sleeping ally before it moves; the ally's Body Slam",
  slots: slots(act(mon("Chansey", "Natural Cure", { evs: { spe: 252 } }), "Heal Bell"), act(lax(0, { status: "slp", silentStatus: true, carried: { sleep: { attempts: 0, rest: false } } }), "Body Slam", PR),
    idle(lax(4)), idle(lax(12))),
  outcomes: true, checks: "K42 sv",
});
add("A3-AR-01", "usum", {
  title: "Blissey Aromatherapy: a Sap Sipper ally keeps its burn",
  slots: slots(act(mon("Blissey", "Natural Cure", { evs: { spe: 252 } }), "Aromatherapy"), idle(mon("Azumarill", "Sap Sipper", { status: "brn", silentStatus: true })),
    idle(lax(4)), idle(lax(12))),
  outcomes: true, checks: "F120",
});

// ---- Purify (SwSh, USUM) ----
add("A3-PU-01", "usum", {
  title: "Smeargle Purify on a poisoned foe: cured; Smeargle heals ceil(maxhp / 2)",
  slots: slots(act(mon("Smeargle", "Own Tempo", { hp: 50, evs: { spe: 252 } }), "Purify", PR), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), idle(lax(4, { status: "psn", silentStatus: true }))),
  outcomes: true, checks: "K44",
});

// ---- Psycho Shift (SwSh, USUM) ----
add("A3-PS-01", "usum", {
  title: "A burned Alakazam Psycho Shifts its burn onto a foe Snorlax, whose later Body Slam is halved",
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "brn", silentStatus: true, evs: { spe: 252 } }), "Psycho Shift", PR), idle(mon("Lapras", "Shell Armor")),
    idle(lax(0)), act(lax(4), "Body Slam", OR)),
  outcomes: true, checks: "K41",
});

// ======================================= batch 2 =======================================
add("A3-MC-06", "swsh", {
  title: "Clefable Magic Coat reflects Corviknight's Defog: Corviknight's evasion −1, its side's Reflect and the Electric Terrain end (F06); a later Body Slam",
  field: { terrain: "Electric", opponent: { reflect: true } },
  slots: slots(act(mon("Clefable", "Magic Guard"), "Magic Coat"), act(lax(0), "Body Slam", PL), idle(lax(4)), act(mon("Corviknight", "Pressure"), "Defog", OL)),
  outcomes: true, checks: "F06",
});
add("A3-MC-07", "usum", {
  title: "Clefable (100 HP) Magic Coat reflects a poisoned Smeargle's Purify: Smeargle is cured, Clefable heals (F07)",
  slots: slots(act(mon("Clefable", "Magic Guard", { hp: 100 }), "Magic Coat"), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), act(mon("Smeargle", "Own Tempo", { status: "psn", silentStatus: true }), "Purify", OL)),
  outcomes: true, checks: "F07",
});
add("A3-SN-07", "usum", {
  title: "Two Absol at one Speed use Snatch, one per side: the foe Smeargle's Swords Dance goes to either, 1/2 each",
  slots: slots(act(mon("Absol", "Pressure"), "Snatch"), idle(lax(0)), act(mon("Absol", "Pressure"), "Snatch"), act(mon("Smeargle", "Own Tempo"), "Swords Dance")),
  outcomes: true, checks: "speedSort's shuffle among the Snatch handlers.",
});
add("A3-SN-08", "usum", {
  title: "Absol Snatch takes the foe Lapras's Mist (sideOrField's dispatch); the foe Chansey's Growl into own side is stopped",
  slots: slots(act(mon("Absol", "Pressure"), "Snatch"), idle(lax(0)), act(mon("Chansey", "Natural Cure"), "Growl"), act(mon("Lapras", "Shell Armor"), "Mist")),
  outcomes: true, checks: "F16 (a stolen side condition).",
});
add("A3-LC-02", "usum", {
  title: "Clefable Lucky Chant; a Merciless Toxapex's Scald into the poisoned ally is not critical (F35)",
  slots: slots(act(mon("Clefable", "Magic Guard", { evs: { spe: 252 } }), "Lucky Chant"), idle(lax(0, { status: "psn", silentStatus: true })), idle(lax(4)), act(mon("Toxapex", "Merciless"), "Scald", OR)),
  checks: "F35",
});
add("A3-MI-05", "usum", {
  title: "Lapras Mist; an Infiltrator Seviper's Screech goes through (F42); the foe Snorlax's later Body Slam into Lapras",
  slots: slots(act(mon("Lapras", "Water Absorb", { evs: { spe: 252 } }), "Mist"), idle(lax(8)), act(lax(0), "Body Slam", OL), act(mon("Seviper", "Infiltrator"), "Screech", OL)),
  checks: "F42",
});
add("A3-WR-03", "sv", {
  title: "Smeargle Wonder Room; Corviknight's later Body Press into Chansey (both use the swapped stats)",
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Wonder Room"), idle(lax(0)), idle(mon("Chansey", "Natural Cure")), act(mon("Corviknight", "Pressure"), "Body Press", PL)),
  checks: "K53, Body Press",
});
add("A3-MR-04", "swsh", {
  title: "Magic Room up; Alakazam's Magic Room ends it, Espeon's starts it again (5 turns); a Leftovers foe heals nothing",
  field: { magicRoom: true },
  slots: slots(act(mon("Alakazam", "Inner Focus"), "Magic Room"), act(mon("Espeon", "Synchronize"), "Magic Room"), idle(lax(0, { item: "Leftovers", hp: 150 })), idle(lax(4))),
  outcomes: true, checks: "F69",
});
add("A3-CG-03", "champions", {
  title: "Gengar Corrosive Gas into a foe behind a Substitute: its Leftovers stay (F81)",
  slots: slots(act(mon("Gengar", "Cursed Body", { evs: { spe: 32 } }), "Corrosive Gas"), idle(mon("Clefable", "Magic Guard")),
    idle(lax(0, { item: "Leftovers", hp: 150, substitute: 40 })), idle(lax(4, { item: "Leftovers", hp: 150 }))),
  outcomes: true, checks: "F81",
});
add("A3-TT-04", "swsh", {
  title: "Polteageist Teatime: a Ripen Appletun's Sitrus heals double; a Cheek Pouch Dedenne's Lum heals a third",
  slots: slots(act(mon("Polteageist", "Cursed Body", { evs: { spe: 252 } }), "Teatime"), idle(mon("Appletun", "Ripen", { item: "Sitrus Berry", hp: 100 })),
    idle(mon("Dedenne", "Cheek Pouch", { item: "Lum Berry", hp: 60 })), idle(lax(4))),
  outcomes: true, checks: "F103, F100 (Cheek Pouch)",
});
add("A3-SC-03", "swsh", {
  title: "Greedent at +6 Defense uses Stuff Cheeks: nothing is eaten (F105)",
  slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Sitrus Berry", hp: 100, boosts: { def: 6 } }), "Stuff Cheeks"), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), idle(lax(4))),
  outcomes: true, checks: "F105",
});
add("A3-SC-04", "sv", {
  title: "Greedent (Cheek Pouch) Stuff Cheeks with a Pomeg Berry: Def +2, the Berry eaten, Cheek Pouch heals",
  slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Pomeg Berry", hp: 100, evs: { spe: 252 } }), "Stuff Cheeks"), idle(mon("Lapras", "Shell Armor")), idle(lax(0)), idle(lax(4))),
  outcomes: true, checks: "eatItem's EatItem runs whatever the Eat did",
});
add("A3-HB-02", "usum", {
  title: "Chansey Heal Bell (generation 7): a Soundproof Exploud ally keeps its burn",
  slots: slots(act(mon("Chansey", "Natural Cure"), "Heal Bell"), idle(mon("Exploud", "Soundproof", { status: "brn", silentStatus: true })), idle(lax(0)), idle(lax(4))),
  outcomes: true, checks: "PS/data/mods/gen7/moves.ts healbell",
});
add("A3-HB-03", "sv", {
  title: "Chansey Heal Bell: a Good as Gold Gholdengo ally keeps its burn",
  slots: slots(act(mon("Chansey", "Natural Cure"), "Heal Bell"), idle(mon("Gholdengo", "Good as Gold", { status: "brn", silentStatus: true })), idle(lax(0)), idle(lax(4))),
  outcomes: true, checks: "F121",
});
add("A3-PS-02", "swsh", {
  title: "A badly poisoned Alakazam Psycho Shifts onto a Synchronize Espeon with a Lum Berry: Synchronize fails, the Lum cures it (F110, F113)",
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "tox", silentStatus: true, evs: { spe: 252 } }), "Psycho Shift", PR), idle(mon("Lapras", "Shell Armor")),
    idle(lax(0)), idle(mon("Espeon", "Synchronize", { item: "Lum Berry" }))),
  outcomes: true, checks: "F110, F113",
});
add("A3-PS-03", "usum", {
  title: "A burned Alakazam's Psycho Shift into a Safeguard side fails and it stays burned (F111)",
  field: { opponent: { safeguard: true } },
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "brn", silentStatus: true, evs: { spe: 252 } }), "Psycho Shift", PR), idle(mon("Lapras", "Shell Armor")),
    idle(lax(0)), act(lax(4), "Body Slam", OR)),
  outcomes: true, checks: "F111",
});
add("A3-PS-04", "usum", {
  title: "A burned Alakazam's Psycho Shift into a Fire type: immune; it stays burned (K57)",
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "brn", silentStatus: true, evs: { spe: 252 } }), "Psycho Shift", PR), idle(mon("Lapras", "Shell Armor")),
    idle(lax(0)), idle(mon("Arcanine", "Intimidate"))),
  outcomes: true, checks: "K57",
});
add("A3-RC-03", "swsh", {
  title: "Snorlax (lastItem none) Recycle fails; Clefable's Knock Off removed nothing to restore",
  slots: slots(act(lax(0, { lastItem: null, item: "Leftovers" }), "Recycle"), idle(mon("Lapras", "Shell Armor")), idle(lax(4)), act(mon("Clefable", "Magic Guard"), "Knock Off", OL)),
  outcomes: true, checks: "F90 (Knock Off leaves no lastItem)",
});

add("A3-RC-04", "sv", {
  title: "Garchomp's Dragon Claw makes Snorlax eat its Sitrus Berry; Snorlax's later Recycle gets it back (item history: F92)",
  slots: slots(act(lax(0, { item: "Sitrus Berry", hp: 140 }), "Recycle"), idle(mon("Lapras", "Shell Armor")), idle(lax(4)), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OL)),
  outcomes: true, checks: "F92",
});
add("A3-MB-03", "usum", {
  title: "Greninja Mat Block when it is not its first turn: fails",
  slots: slots(act(mon("Greninja", "Torrent", { firstTurn: false }), "Mat Block"), idle(mon("Lapras", "Shell Armor")), act(lax(0), "Body Slam", OR), idle(lax(4))),
  outcomes: true, checks: "F32",
});

// ---- Wave 1a additions: Teatime past a Fly user, Magic Room ending with herbs and Booster Energy, Court Change of a screen ----
add("A3-TT-05", "sv", {
  title: "Dragonite flies up (holding a Sitrus Berry); Smeargle Teatime: Dragonite eats nothing (in the sky), Snorlax eats its Sitrus",
  slots: slots(act(mon("Dragonite", "Inner Focus", { item: "Sitrus Berry", hp: 100, evs: { spe: 252 } }), "Fly", PR), idle(lax(0, { item: "Sitrus Berry", hp: 150 })),
    act(mon("Smeargle", "Own Tempo"), "Teatime"), idle(lax(4))),
  outcomes: true, checks: "teatime onHitField: Invulnerability (ADDENDUM2 §4.2 hidden.missesField)",
});
add("A3-MR-05", "sv", {
  title: "Magic Room up; Smeargle ends it: Snorlax (-1 Atk) uses its White Herb, a taunted Snorlax its Mental Herb; a later Body Slam",
  field: { magicRoom: true },
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Magic Room"), act(lax(0, { item: "White Herb", boosts: { atk: -1 } }), "Body Slam", PL),
    idle(lax(4, { item: "Mental Herb", carried: { taunt: 2 } })), idle(lax(8))),
  outcomes: true, checks: "whiteherb onAnyAfterMove / mentalherb onUpdate after the room ends",
});
add("A3-MR-06", "sv", {
  title: "Magic Room up since before Iron Hands came in (its Booster Energy unused); Smeargle ends it with no terrain: not estimated (FC at 1b)",
  field: { magicRoom: true },
  slots: slots(act(mon("Smeargle", "Own Tempo", { evs: { spe: 252 } }), "Magic Room"), idle(mon("Iron Hands", "Quark Drive", { item: "Booster Energy", appBuild: { itemUsedBeforeRoom: false } })), idle(lax(0)), idle(lax(4))),
  notEstimated: "Booster Energy after Magic Room ends is not modelled in 2v2.", checks: "boosterenergy onUpdate after the room (C)",
});
add("A3-CC-03", "sv", {
  title: "The foe side's Reflect from an earlier turn; Cinderace's Court Change moves it to own side: the foe's Body Slam is halved, own Body Slam is not",
  field: { opponent: { reflect: true } },
  slots: slots(act(mon("Cinderace", "Blaze"), "Court Change"), act(lax(0), "Body Slam", PL), act(lax(4), "Body Slam", OR), idle(lax(8))),
  outcomes: true, checks: "courtchange onHitField: the screen and its clock swap sides",
});

export const A3_CASES: Case[] = cases;
void PL;
