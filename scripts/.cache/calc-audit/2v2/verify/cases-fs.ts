// status2 FS cases (field-side-items.md §11.1; SPEC2 §7.2: Track A3's reflection, side, field and item moves, wave 1a):
// ids FS<nn><variant>-<game> as §11.1 names them, with Pokémon and moves from each game's app catalog (v1/pick.mjs); FS22
// (Swallow) moved to SAT-STK (SPEC2 §7.2). Probes: field-side-items-probes.ts (Fnn). Showdown names; level 50, 31 IVs,
// Serious nature, 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const top = (game: Game) => (game === "champions" ? 32 : 252);
const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, outcomes: true, ...c });
const fast = (game: Game, m: CaseMon) => ({ ...m, evs: { ...(m.evs ?? {}), spe: top(game) } });

// ---- Magic Coat (F01, F04, F05) ----
add("FS01a", "swsh", {
  title: "SwSh: Alakazam's Magic Coat; a foe's spread Growl is reflected back at both foes (F01)",
  slots: slots(act(fast("swsh", mon("Alakazam", "Inner Focus")), "Magic Coat"), idle(lax(0)), act(mon("Audino", "Healer"), "Growl"), idle(lax(8))),
  checks: "magiccoat onTryHit: a reflectable spread move bounces from the holder; the other target still takes it.",
});
add("FS01b", "usum", {
  title: "USUM: a Magic Coat Absol (Dark) and a Prankster Meowstic's Thunder Wave into it: reflected (Prankster vs Dark)",
  slots: slots(act(fast("usum", mon("Absol", "Pressure")), "Magic Coat"), idle(lax(0)), act(mon("Meowstic", "Prankster"), "Thunder Wave", OL), idle(lax(8))),
  checks: "The bounce comes before Prankster's Dark immunity (the oracle decides which applies).",
});
add("FS01c", "swsh", {
  title: "SwSh: Magic Coat; its ally's Thunder Wave into it (an ally's move) (F05)",
  slots: slots(act(fast("swsh", mon("Alakazam", "Inner Focus")), "Magic Coat"), act(mon("Raichu", "Static"), "Thunder Wave", OL), idle(lax(16)), idle(lax(8))),
  checks: "Magic Coat reflects an ally's reflectable move too (onTryHit, not onAllyTryHitSide).",
});
add("FS01d", "usum", {
  title: "USUM: Magic Coat; a foe's Stealth Rock lands on the foe's own side (F04)",
  slots: slots(act(fast("usum", mon("Absol", "Pressure")), "Magic Coat"), idle(lax(0)), act(mon("Aggron", "Sturdy"), "Stealth Rock"), idle(lax(8))),
  checks: "onAllyTryHitSide: a side move into the holder's side bounces.",
});
// ---- Snatch (F10, F11, F13a, F15, F126) ----
const snatcher = (extra: Partial<CaseMon> = {}) => mon("Alakazam", "Inner Focus", { evs: { spe: 252 }, ...extra });
add("FS02a", "usum", {
  title: "USUM: Alakazam's Snatch steals a foe's Swords Dance (F10)",
  slots: slots(act(snatcher(), "Snatch"), idle(lax(0)), idle(lax(16)), act(mon("Absol", "Pressure"), "Swords Dance")),
  checks: "snatch onAnyPrepareHit −1: the user of the snatched move is Alakazam (+2 Atk); the foe gets nothing.",
});
add("FS02b", "usum", {
  title: "USUM: Snatch steals a foe's Reflect: it goes up on Alakazam's side (F11)",
  slots: slots(act(snatcher(), "Snatch"), idle(lax(0)), idle(lax(16)), act(mon("Starmie", "Illuminate"), "Reflect")),
  checks: "The stolen side move lands on the Snatcher's side.",
});
add("FS02c", "usum", {
  title: "USUM: a paralysed Alakazam's Snatch: 1/4 fully paralysed, then the Swords Dance is not stolen (F15)",
  slots: slots(act(snatcher({ status: "par" }), "Snatch"), idle(lax(0)), idle(lax(16)), act(mon("Absol", "Pressure"), "Swords Dance")),
  checks: "Snatch must pass BeforeMove to take effect.",
});
add("FS02d", "usum", {
  title: "USUM: Snatch steals a foe's Substitute: Alakazam pays the quarter (F13a)",
  slots: slots(act(snatcher(), "Snatch"), idle(lax(0)), idle(lax(16)), act(lax(8), "Substitute")),
  checks: "The stolen Substitute is Alakazam's.",
});
add("FS02e", "usum", {
  title: "USUM: Snatch steals a foe's Heal Bell: Alakazam's side is cured, its bench too; the foe's not (F126)",
  bench: { own: { status: "psn" }, opponent: { status: "psn" } },
  slots: slots(act(snatcher(), "Snatch"), idle(lax(0, { status: "brn" })), idle(lax(16, { status: "par" })), act(mon("Blissey", "Natural Cure"), "Heal Bell")),
  checks: "The stolen Heal Bell cures the Snatcher's party (benchCured on its side).",
});
// ---- Crafty Shield (F21, F25, F26) ----
add("FS03a", "swsh", {
  title: "SwSh: Klefki's Crafty Shield; a foe's Growl and Thunder Wave into its side are blocked (F21)",
  slots: slots(act(fast("swsh", mon("Klefki", "Magician")), "Crafty Shield"), idle(lax(0)), act(mon("Audino", "Healer"), "Growl"), act(mon("Raichu", "Static"), "Thunder Wave", OR)),
  checks: "craftyshield: status moves into the side (not the user's own) blocked.",
});
add("FS03b", "swsh", {
  title: "SwSh: Crafty Shield broken by a foe's Feint; the later Thunder Wave lands (F26)",
  slots: slots(act(fast("swsh", mon("Klefki", "Magician")), "Crafty Shield"), idle(lax(0)), act(mon("Absol", "Pressure", { evs: { spe: 252 } }), "Feint", OR), act(mon("Raichu", "Static"), "Thunder Wave", OR)),
  checks: "Feint removes the side's Crafty Shield.",
});
add("FS03c", "usum", {
  title: "USUM: Alakazam's Magic Coat and Klefki's Crafty Shield; a foe's Thunder Wave into Alakazam: Crafty Shield first (F25)",
  slots: slots(act(fast("usum", mon("Klefki", "Magician")), "Crafty Shield"), act(mon("Alakazam", "Inner Focus"), "Magic Coat"), act(mon("Absol", "Pressure"), "Thunder Wave", OR), idle(lax(8))),
  checks: "Crafty Shield (side, priority 3) before Magic Coat's onTryHit 2.",
});
// ---- Mat Block (F31, F32) ----
add("FS04a", "swsh", {
  title: "SwSh: Throh's Mat Block on its first turn; a foe's Body Slam blocked; a Dynamaxed foe's Max Strike at a quarter",
  slots: slots(act(mon("Throh", "Guts"), "Mat Block"), idle(lax(0)), act(lax(16), "Body Slam", OR), act(lax(8, { choice: "dynamax" }), "Body Slam", OL)),
  checks: "matblock: damaging moves into the side blocked; Max Moves hit at 1/4.",
});
add("FS04b", "usum", {
  title: "USUM: Mat Block; its ally's Earthquake still hits it; a foe's Z-Move at a quarter (F31)",
  slots: slots(act(mon("Throh", "Guts"), "Mat Block"), act(mon("Garchomp", "Rough Skin"), "Earthquake"), act(lax(16, { item: "Normalium Z", choice: "zmove" }), "Body Slam", OL), idle(lax(8))),
  checks: "An ally's move is not blocked; Z-Moves through at 1/4.",
});
// ---- Lucky Chant (F35) ----
add("FS05a", "usum", {
  title: "USUM: Lucky Chant this turn; a foe's Frost Breath into its side is not critical",
  slots: slots(act(fast("usum", mon("Audino", "Healer")), "Lucky Chant"), idle(lax(0)), act(mon("Lapras", "Shell Armor"), "Frost Breath", OR), idle(lax(8))),
  checks: "luckychant onCriticalHit false: Frost Breath's always-crit is stopped.",
});
add("FS05b", "usum", {
  title: "USUM: Lucky Chant; a Merciless Toxapex's Body Slam... into a poisoned target is not critical",
  slots: slots(act(fast("usum", mon("Audino", "Healer")), "Lucky Chant"), idle(lax(0, { status: "psn" })), act(mon("Toxapex", "Merciless"), "Poison Jab", OR), idle(lax(8))),
  checks: "Merciless's certain crit is stopped by Lucky Chant.",
});
add("FS05c", "usum", {
  title: "USUM: a Lucky Chant side under the Critical hit toggle: no crits into that side",
  field: { critical: true, own: { luckyChant: true } },
  slots: slots(idle(lax(24)), idle(lax(0)), act(lax(16), "Body Slam", OL), act(lax(8), "Body Slam", PL)),
  checks: "The toggle's crits stop at Lucky Chant; the other side's hit is critical.",
});
// ---- Mist (F40, F41, F42, F43) ----
add("FS06a", "sv", {
  title: "Altaria's Mist; then a foe's Snarl lowers no Sp. Atk on its side",
  slots: slots(act(fast("sv", mon("Altaria", "Natural Cure")), "Mist"), idle(lax(0)), act(mon("Arcanine", "Intimidate"), "Snarl"), idle(lax(8))),
  checks: "mist onTryBoost: drops from foes' moves stopped.",
});
add("FS06b", "swsh", {
  title: "SwSh: Mist on the side of a Mirror Armor Corviknight; a foe Arcanine's Scary Face into it (Mirror Armor reflects first) (F40)",
  slots: slots(act(fast("swsh", mon("Altaria", "Natural Cure")), "Mist"), idle(mon("Corviknight", "Mirror Armor")), act(mon("Arcanine", "Intimidate"), "Scary Face", OR), idle(lax(8))),
  checks: "C10: Mirror Armor before Mist.",
});
add("FS06c", "usum", {
  title: "USUM: Mist; a foe's Parting Shot into it fails (no drop, no switch) (F43)",
  canSwitch: { opponent: false },
  slots: slots(act(fast("usum", mon("Altaria", "Natural Cure")), "Mist"), idle(lax(0)), act(mon("Pangoro", "Iron Fist"), "Parting Shot", OL), idle(lax(8))),
  checks: "Parting Shot's drops stopped; with no bench, no switch.",
});
// ---- Court Change (F50, F51, F53) ----
add("FS07a", "sv", {
  title: "Cinderace's Court Change brings the foes' Tailwind to its side: the turn's order changes",
  field: { opponent: { tailwind: true } },
  slots: slots(act(fast("sv", mon("Cinderace", "Blaze")), "Court Change"), act(lax(8), "Body Slam", PR), idle(lax(0)), act(lax(16), "Body Slam", OR)),
  checks: "courtchange swaps every side condition; Tailwind now doubles its side's Speed (gen 8+ order).",
});
add("FS07b", "champions", {
  title: "Champions: Court Change with Reflect on its side and Stealth Rock on the foes': swapped (clock, hazardsFrom)",
  field: { own: { reflect: true }, opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(fast("champions", mon("Cinderace", "Blaze")), "Court Change"), idle(lax(0)), act(lax(2), "Body Slam", OR), idle(lax(1))),
  checks: "E2: the swapped Reflect's clock and the hazards' hazardsFrom (F50).",
});
add("FS07c", "swsh", {
  title: "SwSh: Wide Guard, then Court Change, then a foe's Earthquake (F53)",
  slots: slots(act(fast("swsh", mon("Cinderace", "Blaze")), "Court Change"), act(mon("Hitmontop", "Intimidate", { evs: { spe: 252 } }), "Wide Guard"), act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(lax(8))),
  checks: "Wide Guard is a single-turn side condition: Court Change moves it (the oracle decides).",
});
// ---- Defog (F55-F61) ----
add("FS08a", "sv", {
  title: "Corviknight's Defog into Snorlax: Reflect on Snorlax's side and the Electric Terrain end",
  field: { terrain: "Electric", opponent: { reflect: true } },
  slots: slots(act(fast("sv", mon("Corviknight", "Pressure")), "Defog", PR), act(lax(8), "Body Slam", PR), idle(lax(0)), idle(lax(16))),
  checks: "Gen 8+ Defog clears the target side's screens and the terrain; the evasion drop.",
});
add("FS08b", "usum", {
  title: "USUM: Defog in generation 7 leaves the terrain",
  field: { terrain: "Electric", opponent: { reflect: true } },
  slots: slots(act(fast("usum", mon("Altaria", "Natural Cure")), "Defog", PR), act(lax(8), "Body Slam", PR), idle(lax(0)), idle(lax(16))),
  checks: "Gen 7: no terrain removal.",
});
add("FS08c", "champions", {
  title: "Champions: Defog into a Defiant Kingambit with hazards on both sides (F59, F61)",
  field: { own: { hazards: ["spikes"] }, opponent: { hazards: ["stealthrock"] } },
  slots: slots(act(fast("champions", mon("Corviknight", "Pressure")), "Defog", PR), idle(lax(0)), idle(lax(2)), idle(mon("Kingambit", "Defiant"))),
  checks: "Defiant +2 from the evasion drop; both sides' hazards cleared.",
});
add("FS08d", "sv", {
  title: "Defog into a Substitute Snorlax (Reflect on its side) and into the user's own ally (F56, F57)",
  field: { opponent: { reflect: true }, own: { reflect: true } },
  slots: slots(act(fast("sv", mon("Corviknight", "Pressure")), "Defog", PR), act(mon("Altaria", "Natural Cure"), "Defog", OL), idle(lax(0)), idle(lax(16, { substitute: 50 }))),
  checks: "The Substitute stops the evasion drop, not the clearing; an ally Defog clears the user's own screens.",
});
add("FS08e", "sv", {
  title: "Defog ends Electric Terrain under a Quark Drive Iron Hands: the reason (FC models it in 1b)",
  field: { terrain: "Electric" },
  notEstimated: "A weather or terrain change this turn would change Quark Drive.",
  slots: slots(act(fast("sv", mon("Corviknight", "Pressure")), "Defog", PR), act(mon("Iron Hands", "Quark Drive"), "Drain Punch", PR), idle(lax(0)), idle(lax(16))),
  checks: "REASONS.fieldChange until FC (ADDENDUM2 §2.2: Defog M after integration 1b).",
});
// ---- Magic Room, Wonder Room (F65, F69, F72) ----
add("FS09a", "sv", {
  title: "Delphox's Magic Room starts: a later Life Orb Garchomp's Dragon Claw has no Life Orb",
  slots: slots(act(fast("sv", mon("Delphox", "Blaze")), "Magic Room"), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { item: "Life Orb" }), "Dragon Claw", OL), idle(lax(8))),
  checks: "Magic Room suppresses items from its start.",
});
add("FS09b", "champions", {
  title: "Champions: Magic Room up; Alakazam's Magic Room ends it: a Sitrus Snorlax at 100 HP eats at the Update (F65)",
  field: { magicRoom: true },
  slots: slots(act(fast("champions", mon("Alakazam", "Inner Focus")), "Magic Room"), idle(lax(0)), idle(lax(2, { item: "Sitrus Berry", hp: 100 })), idle(lax(1))),
  checks: "The room's end mid-turn: items work at the next Update.",
});
add("FS09c", "swsh", {
  title: "SwSh: Magic Room up; Alakazam ends it, then Alcremie restarts it; a Leftovers Chansey at 200 (F69)",
  field: { magicRoom: true },
  slots: slots(act(fast("swsh", mon("Alakazam", "Inner Focus")), "Magic Room"), act(mon("Alcremie", "Sweet Veil"), "Magic Room"), idle(mon("Chansey", "Natural Cure", { item: "Leftovers", hp: 200 })), idle(lax(8))),
  checks: "E2 fieldSet: the room set this turn (a fresh duration).",
});
add("FS09d", "usum", {
  title: "USUM: Magic Room starts; a later Sitrus Snorlax hit below half keeps its Berry",
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Magic Room"), idle(lax(0)), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", PR), idle(lax(8, { item: "Sitrus Berry", hp: 120 }))),
  checks: "Gen 7 Magic Room.",
});
add("FS10a", "sv", {
  title: "Golduck's Wonder Room starts; a later Body Press reads... the swapped Defense",
  slots: slots(act(fast("sv", mon("Golduck", "Damp")), "Wonder Room"), idle(lax(0)), act(mon("Corviknight", "Pressure"), "Body Press", OL), idle(lax(8))),
  checks: "Wonder Room swaps Def and Sp. Def for every Pokémon (Body Press reads the user's Def stat).",
});
add("FS10b", "champions", {
  title: "Champions: Wonder Room up; Alakazam's Wonder Room ends it; then a Body Slam into Snorlax (F72)",
  field: { wonderRoom: true },
  slots: slots(act(fast("champions", mon("Alakazam", "Inner Focus")), "Wonder Room"), act(lax(0), "Body Slam", PR), idle(lax(2)), idle(lax(3))),
  checks: "The room's end mid-turn: Body Slam reads the normal Defense.",
});
// ---- Mud Sport, Water Sport (F75) ----
add("FS11a", "usum", {
  title: "USUM: Mud Sport this turn; an Alolan Golem's Galvanize Double-Edge (Electric) is weakened",
  slots: slots(act(fast("usum", mon("Bibarel", "Simple")), "Mud Sport"), idle(lax(0)), act(mon("Golem-Alola", "Galvanize"), "Double-Edge", OL), idle(lax(8))),
  checks: "Mud Sport reads the move's type after Galvanize.",
});
add("FS11b", "usum", {
  title: "USUM: Water Sport and Mud Sport both this turn; a Fire and an Electric move after them",
  slots: slots(act(fast("usum", mon("Bibarel", "Simple")), "Mud Sport"), act(fast("usum", mon("Azumarill", "Huge Power")), "Water Sport"), act(mon("Charizard", "Blaze"), "Flamethrower", OL), act(mon("Raichu", "Static"), "Thunderbolt", OR)),
  checks: "Each sport ×1352/4096 on its type.",
});
// ---- Corrosive Gas (F80, F81, F83, F84) ----
add("FS12a", "champions", {
  title: "Champions: Corrosive Gas; a Mega Stone holder, a Substitute holder with Leftovers, a Sticky Hold Swalot (F81)",
  slots: slots(act(fast("champions", mon("Gengar", "Cursed Body")), "Corrosive Gas"), idle(lax(0, { item: "Leftovers" })), idle(mon("Swalot", "Sticky Hold", { item: "Leftovers" })), idle(lax(1, { item: "Leftovers", substitute: 50 }))),
  checks: "corrosivegas: Sticky Hold keeps it; a Substitute does not protect; the user's ally loses its item too.",
});
add("FS12b", "swsh", {
  title: "SwSh: Corrosive Gas; an Unburden holder and an Air Balloon holder (F83)",
  slots: slots(act(fast("swsh", mon("Gengar", "Cursed Body")), "Corrosive Gas"), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(mon("Hawlucha", "Unburden", { item: "Air Balloon" }))),
  checks: "The popped... burned item: Unburden doubles Speed; the balloon gone: Earthquake hits.",
});
// ---- Bestow (F88a, F88b) ----
add("FS13a", "usum", {
  title: "USUM: Blissey (Sitrus) Bestows on its ally Lapras at 80 HP: Lapras eats it at once",
  slots: slots(act(mon("Blissey", "Natural Cure", { item: "Sitrus Berry" }), "Bestow", OR), idle(mon("Lapras", "Shell Armor", { hp: 80 })), idle(lax(16)), idle(lax(8))),
  checks: "Bestow then the receiver's Update.",
});
add("FS13b", "usum", {
  title: "USUM: Blissey (Leftovers) Bestows into a protecting Snorlax (F88b)",
  slots: slots(act(mon("Blissey", "Natural Cure", { item: "Leftovers" }), "Bestow", PR), idle(lax(0)), idle(lax(16)), act(lax(8), "Protect")),
  checks: "Bestow's flags decide Protect (the oracle decides).",
});
// ---- Recycle (F90, F92, F93) ----
add("FS14a", "sv", {
  title: "A Sitrus Snorlax hit below half eats it; then its Recycle restores it (F92)",
  slots: slots(act(mon("Raichu", "Static", { evs: { spe: 252 } }), "Thunderbolt", PR), idle(lax(0)), idle(lax(16)), act(mon("Bronzong", "Levitate", { item: "Sitrus Berry", hp: 90 }), "Recycle")),
  checks: "itemHistory: lastItem from this turn's eat; Recycle restores it (and it can be eaten again at the Update).",
});
add("FS14b", "champions", {
  title: "Champions: Recycle with the Berry eaten on an earlier turn (lastItem given)",
  slots: slots(idle(lax(0)), idle(lax(1)), idle(lax(2)), act(mon("Chimecho", "Levitate", { lastItem: "Sitrus Berry", hp: 60 }), "Recycle")),
  checks: "DoublesPokemonInput.lastItem: Recycle restores the Sitrus.",
});
add("FS14c", "swsh", {
  title: "SwSh: Knock Off removes a Sitrus; then Recycle fails (F90)",
  // lastItem null: no item used on an earlier turn (Showdown's '' at the start), else Recycle would need it.
  slots: slots(act(mon("Weavile", "Pressure", { evs: { spe: 252 } }), "Knock Off", PR), idle(lax(0)), idle(lax(16)), act(mon("Bronzong", "Levitate", { item: "Sitrus Berry", lastItem: null }), "Recycle")),
  checks: "A knocked-off item sets no lastItem.",
});
add("FS14d", "sv", {
  title: "Recycle with no item and the last item unknown: the reason",
  notEstimated: "Recycle needs Bronzong's item from an earlier turn.",
  slots: slots(idle(lax(0)), idle(lax(8)), idle(lax(16)), act(mon("Bronzong", "Levitate"), "Recycle")),
  checks: "REASONS.needsLastItem.",
});
// ---- Teatime (K30, F100, F102, F103) ----
add("FS15a", "sv", {
  title: "Polteageist's Teatime: every Pokémon eats its Berry (K30)",
  slots: slots(act(fast("sv", mon("Polteageist", "Cursed Body")), "Teatime"), idle(lax(0, { item: "Sitrus Berry", hp: 150 })), idle(lax(16, { item: "Oran Berry", hp: 200 })), idle(lax(8, { item: "Lum Berry", status: "par" }))),
  checks: "forceEat: each Berry eaten whatever its condition.",
});
add("FS15b", "champions", {
  title: "Champions: Teatime under Magic Room, beside an Unnerve foe, with an Oran Berry (F102; no Figy Berry in Champions)",
  field: { magicRoom: true },
  slots: slots(act(fast("champions", mon("Polteageist", "Cursed Body")), "Teatime"), idle(lax(0, { item: "Sitrus Berry", hp: 150 })), idle(mon("Tyranitar", "Unnerve")), idle(lax(1, { item: "Oran Berry", hp: 150 }))),
  checks: "Teatime under Magic Room and Unnerve (the oracle decides).",
});
add("FS15c", "swsh", {
  title: "SwSh: Teatime with a Ripen Appletun (Sitrus, 100) and a Cheek Pouch Dedenne (F103)",
  slots: slots(act(fast("swsh", mon("Polteageist", "Cursed Body")), "Teatime"), idle(mon("Appletun", "Ripen", { item: "Sitrus Berry", hp: 100 })), idle(lax(16)), idle(mon("Dedenne", "Cheek Pouch", { item: "Sitrus Berry", hp: 50 }))),
  checks: "Ripen doubles the Sitrus; Cheek Pouch adds 1/3.",
});
// ---- Stuff Cheeks (K29, F105-F108) ----
add("FS16a", "sv", {
  title: "Greedent's Stuff Cheeks with a Sitrus Berry at 150 HP (K29)",
  slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Sitrus Berry", hp: 150 }), "Stuff Cheeks"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "The forced eat, Cheek Pouch, +2 Def.",
});
add("FS16b", "champions", {
  title: "Champions: Stuff Cheeks under Magic Room (F107)",
  field: { magicRoom: true },
  slots: slots(act(mon("Swalot", "Gluttony", { item: "Sitrus Berry", hp: 100 }), "Stuff Cheeks"), idle(lax(0)), idle(lax(2)), idle(lax(1))),
  checks: "Magic Room: Stuff Cheeks fails? (the oracle decides).",
});
add("FS16c", "swsh", {
  title: "SwSh: Stuff Cheeks at +6 Def with a Sitrus Berry (F105)",
  slots: slots(act(mon("Greedent", "Cheek Pouch", { item: "Sitrus Berry", hp: 150, boosts: { def: 6 } }), "Stuff Cheeks"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "At +6: the eat and Cheek Pouch, no boost.",
});
// ---- Embargo (F130, F132, F133) ----
add("FS17a", "usum", {
  title: "USUM: Embargo into an Air Balloon Heatran; Garchomp's Earthquake then hits it (F130)",
  slots: slots(act(mon("Alakazam", "Inner Focus", { evs: { spe: 252 } }), "Embargo", PR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(0)), idle(mon("Heatran", "Flash Fire", { item: "Air Balloon" }))),
  checks: "Embargo suppresses the balloon: grounded.",
});
add("FS17b", "usum", {
  title: "USUM: Embargo into a Magic Coat Snorlax bounces onto the Leftovers user at 100 HP (F132)",
  slots: slots(act(mon("Alakazam", "Inner Focus", { item: "Leftovers", hp: 100 }), "Embargo", PR), idle(lax(0)), idle(lax(16)), act(mon("Absol", "Pressure", { evs: { spe: 252 } }), "Magic Coat")),
  checks: "The bounced Embargo stops the user's Leftovers.",
});
// ---- Aromatherapy, Heal Bell (F120-F126) ----
add("FS18a", "swsh", {
  title: "SwSh: Alcremie's Aromatherapy; a poisoned ally behind a Substitute is cured; the poisoned bench Pokémon (Sap Sipper) too (F120)",
  bench: { own: { status: "psn", ability: "Sap Sipper" } },
  slots: slots(act(mon("Alcremie", "Sweet Veil"), "Aromatherapy"), idle(lax(0, { status: "psn", substitute: 40 })), idle(lax(16)), idle(lax(8))),
  checks: "Aromatherapy cures through a Substitute and the bench; Sap Sipper (a Grass move) on the bench is not consulted.",
});
add("FS18b", "usum", {
  title: "USUM: Aromatherapy beside a Sap Sipper ally: the ally absorbs it (+1 Atk) and is not cured",
  slots: slots(act(mon("Blissey", "Natural Cure"), "Aromatherapy"), idle(mon("Azumarill", "Sap Sipper", { status: "psn" })), idle(lax(16)), idle(lax(8))),
  checks: "Gen 7: Aromatherapy is a Grass move that Sap Sipper absorbs.",
});
add("FS19a", "sv", {
  title: "Blissey's Heal Bell; a burned Gholdengo (Good as Gold) ally is cured? and the bench Snorlax (Soundproof) (F121)",
  bench: { own: { status: "psn", ability: "Soundproof" } },
  slots: slots(act(mon("Blissey", "Natural Cure"), "Heal Bell"), idle(mon("Gholdengo", "Good as Gold", { status: "brn" })), idle(lax(16)), idle(lax(8))),
  checks: "Heal Bell reaches allies with Good as Gold (it is a self move); a Soundproof bench Pokémon in gen 8+ is cured.",
});
add("FS19b", "usum", {
  title: "USUM: Blissey's Heal Bell beside a poisoned Soundproof Exploud, and a Soundproof bench Pokémon (F122)",
  bench: { own: { status: "psn", ability: "Soundproof" } },
  slots: slots(act(mon("Blissey", "Natural Cure"), "Heal Bell"), idle(mon("Exploud", "Soundproof", { status: "psn" })), idle(lax(16)), idle(lax(8))),
  checks: "Gen 7: Soundproof holders are not cured, active or benched.",
});
add("FS19c", "champions", {
  title: "Champions: Chimecho's Heal Bell; a paralysed ally and an asleep bench Pokémon (F125)",
  bench: { own: { status: "slp" } },
  slots: slots(act(mon("Chimecho", "Levitate"), "Heal Bell"), idle(lax(0, { status: "par" })), idle(lax(2)), idle(lax(1))),
  checks: "The bench cured (benchCured).",
});
add("FS19d", "usum", {
  title: "USUM: a foe's Heal Bell snatched (F126's other side)",
  bench: { own: { status: "psn" }, opponent: { status: "psn" } },
  slots: slots(act(snatcher(), "Snatch"), idle(lax(0, { status: "brn" })), idle(lax(16, { status: "par" })), act(mon("Blissey", "Natural Cure"), "Heal Bell")),
  checks: "The Snatcher's side and bench are cured; the Heal Bell user's are not.",
});
// ---- Purify (K44, F115, F116) ----
add("FS20a", "swsh", {
  title: "SwSh: Pyukumuku's Purify into a poisoned foe behind Magic Coat (K44)",
  slots: slots(act(mon("Pyukumuku", "Unaware", { hp: 50 }), "Purify", PR), idle(lax(0)), idle(lax(16)), act(mon("Alakazam", "Inner Focus", { evs: { spe: 252 }, status: "psn" }), "Magic Coat")),
  checks: "Purify is reflectable: bounced (the oracle decides the heal and the cure).",
});
add("FS20b", "usum", {
  title: "USUM: Purify at full HP into a poisoned Snorlax: cured, no heal (F115)",
  slots: slots(act(mon("Pyukumuku", "Unaware"), "Purify", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { status: "psn" }))),
  checks: "purify: the cure, then the heal (none at full HP).",
});
// ---- Psycho Shift (K41, F110, F111, F113) ----
add("FS21a", "usum", {
  title: "USUM: a paralysed Alakazam's Psycho Shift into a Lum Berry Snorlax: it eats the Lum (F113)",
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "par", evs: { spe: 252 } }), "Psycho Shift", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { item: "Lum Berry" }))),
  checks: "K41: the status moves; the Lum cures it at the Update.",
});
add("FS21b", "swsh", {
  title: "SwSh: a badly poisoned Alakazam's Psycho Shift into a Synchronize Espeon: Synchronize sends poison back (F110)",
  slots: slots(act(carried(mon("Alakazam", "Inner Focus", { status: "tox", evs: { spe: 252 } }), { toxic: 2 }), "Psycho Shift", PR), idle(lax(0)), idle(lax(16)), idle(mon("Espeon", "Synchronize"))),
  checks: "Psycho Shift then Synchronize: the regular poison back to the user (the oracle decides tox vs psn).",
});
add("FS21c", "usum", {
  title: "USUM: a burned Alakazam's Psycho Shift into a Safeguard side, and into a Fire type (F111)",
  field: { opponent: { safeguard: true } },
  slots: slots(act(mon("Alakazam", "Inner Focus", { status: "brn", evs: { spe: 252 } }), "Psycho Shift", PR), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "Safeguard stops it.",
});

/** SPEC2's FS cases. */
export const FS_CASES: Case[] = cases;
void OR; void PL; void k;
