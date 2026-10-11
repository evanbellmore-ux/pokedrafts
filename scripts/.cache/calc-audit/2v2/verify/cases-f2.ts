// status2 F2- cases (types-volatiles.md §10; SPEC2 §7.2: Track A2's types, volatiles and grounding, wave 1a): each row in
// the game §10 names, with Pokémon and moves from that game's app catalog (v1/pick.mjs); a stand-in keeps a probe's point
// where its Pokémon is missing (the checks say so). F2-CC1…4 are Step 1's (cases-status2-step1.ts). Probes:
// types-volatiles-probes.ts (TVnn), types-volatiles-probes-2.ts (TWnn). Showdown names; level 50, 31 IVs, Serious nature,
// 0 EVs unless set (Champions: Stat Points). Wired into cases-se.ts.
import type { Case, CaseMon, Game } from "./case-types";
import { OL, OR, PL, PR, act, carried, idle, lax, mon, slots } from "./case-kit";

const k = (game: Game, n: number) => (game === "champions" ? n : n * 8);
const top = (game: Game) => (game === "champions" ? 32 : 252);
const cases: Case[] = [];
const add = (id: string, game: Game, c: Omit<Case, "id" | "game">) => cases.push({ id: `${id}-${game}`, game, ...c });
const fast = (game: Game, m: CaseMon) => ({ ...m, evs: { ...(m.evs ?? {}), spe: top(game) } });

// ---- Soak (TV01, TV01b-e, K1) ----
add("F2-SK1", "sv", {
  title: "Azumarill Soaks Gyarados; Raichu's Thunderbolt into it is 2x; its partner's Earthquake hits it; Grassy Terrain heals", outcomes: true,
  field: { terrain: "Grassy" },
  slots: slots(act(fast("sv", mon("Azumarill", "Huge Power")), "Soak", PR), act(mon("Raichu", "Static"), "Thunderbolt", PR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(mon("Gyarados", "Moxie"))),
  checks: "TV01: setType(['Water']): Electric 2x, no Flying immunity to Earthquake (now grounded), Grassy heal at the end.",
});
add("F2-SK2", "champions", {
  title: "Champions: Araquanid Soaks Gyarados; Raichu's Thunderbolt into it; sand", outcomes: true,
  field: { weather: "Sand" },
  slots: slots(act(fast("champions", mon("Araquanid", "Water Bubble")), "Soak", PR), act(mon("Raichu", "Static"), "Thunderbolt", PR), idle(lax(1)), idle(mon("Gyarados", "Moxie"))),
  checks: "K1: Champions types; sand chip on the Water type.",
});
add("F2-SK3", "sv", {
  title: "Soak into a Garchomp that Terastallized (Stellar) this turn, and into Arceus: both fail (TV01c, TV01d)", outcomes: true,
  slots: slots(act(fast("sv", mon("Azumarill", "Huge Power")), "Soak", PR), act(fast("sv", mon("Araquanid", "Water Bubble")), "Soak", PL), idle(mon("Arceus", "Multitype")), { ...mon("Garchomp", "Rough Skin", { teraType: "Stellar", choice: "terastallize" }), action: { move: null } }),
  checks: "setType fails on a Terastallized Pokémon and on Arceus (Multitype).",
});
add("F2-SK4", "usum", {
  title: "USUM: Soak into a Gengar (Black Sludge, 100 HP): it is no longer Poison, so Black Sludge hurts it at the end", outcomes: true,
  slots: slots(act(fast("usum", mon("Azumarill", "Huge Power")), "Soak", PR), idle(lax(0)), idle(lax(16)), idle(mon("Gengar", "Cursed Body", { item: "Black Sludge", hp: 100 }))),
  checks: "TV01b: Black Sludge on a non-Poison holder: −1/8.",
});
// ---- Magic Powder (TV02, TV02b, TW09) ----
add("F2-MP1", "sv", {
  title: "Hatterene's Magic Powder makes Gengar Psychic; then a foe's Close Combat into it (0.5x... the oracle decides)", outcomes: true,
  slots: slots(act(mon("Hatterene", "Magic Bounce"), "Magic Powder", PR), act(mon("Kingambit", "Defiant"), "Low Kick", PR), idle(lax(0)), idle(mon("Gengar", "Cursed Body"))),
  checks: "TV02: setType(['Psychic']): a Fighting move now hits (no Ghost immunity) at 0.5x.",
});
add("F2-MP2", "champions", {
  title: "Champions: Magic Powder into Venusaur (Grass: powder immune) and into Espeon (Magic Bounce sends it back)", outcomes: true,
  slots: slots(act(mon("Hatterene", "Healer"), "Magic Powder", PR), idle(lax(0)), idle(mon("Espeon", "Magic Bounce")), idle(mon("Venusaur", "Chlorophyll"))),
  checks: "TV02b: powder moves fail on Grass types.",
});
add("F2-MP2b", "champions", {
  title: "Champions: Magic Powder into a Magic Bounce Espeon: bounced back onto Hatterene", outcomes: true,
  slots: slots(act(mon("Hatterene", "Healer"), "Magic Powder", PL), idle(lax(0)), idle(mon("Espeon", "Magic Bounce")), idle(mon("Venusaur", "Chlorophyll"))),
  checks: "TW09: Magic Bounce reflects Magic Powder: Hatterene becomes pure Psychic.",
});
// ---- Forest's Curse (K2, TV03, TV03b, TV01e) ----
add("F2-FC1", "sv", {
  title: "Trevenant's Forest's Curse on Gyarados (three types); then Lapras's Ice Beam into it", outcomes: true,
  slots: slots(act(mon("Trevenant", "Natural Cure"), "Forest's Curse", PR), act(mon("Lapras", "Shell Armor"), "Ice Beam", PR), idle(lax(0)), idle(mon("Gyarados", "Moxie"))),
  checks: "K2: Water/Flying/Grass: Ice 2x (Flying ×2, Grass ×2, Water ×0.5).",
});
add("F2-FC2", "champions", {
  title: "Champions: Trevenant's Forest's Curse on Snorlax; Snorlax's Seed Bomb then has no STAB... and a later Spore into it fails", outcomes: true,
  slots: slots(act(mon("Trevenant", "Natural Cure"), "Forest's Curse", PR), idle(lax(0)), idle(lax(2)), act(lax(1), "Seed Bomb", OL)),
  checks: "TV03: the added Grass type gives STAB? (the oracle decides) and powder immunity.",
});
add("F2-FC3", "sv", {
  title: "Forest's Curse on a Garchomp that Terastallized (Water) this turn: it fails (TV03b)", outcomes: true,
  slots: slots(act(mon("Trevenant", "Natural Cure"), "Forest's Curse", PR), idle(lax(0)), idle(lax(16)), { ...mon("Garchomp", "Rough Skin", { teraType: "Water", choice: "terastallize" }), action: { move: null } }),
  checks: "addType fails on a Terastallized Pokémon.",
});
add("F2-FC3b", "sv", {
  title: "Forest's Curse on Snorlax, then Soak replaces both types (the added Grass goes) (TV01e)", outcomes: true,
  slots: slots(act(fast("sv", mon("Trevenant", "Natural Cure")), "Forest's Curse", PR), act(mon("Azumarill", "Huge Power"), "Soak", PR), idle(lax(0)), idle(lax(8))),
  checks: "setType clears addedType: pure Water.",
});
// ---- Trick-or-Treat (TV04, TV04b-d, TW05, TW15) ----
add("F2-TT1", "champions", {
  title: "Champions: Gourgeist's Trick-or-Treat on Lucario; Gengar's Shadow Ball into it is 2x", outcomes: true,
  slots: slots(act(fast("champions", mon("Gourgeist", "Frisk")), "Trick-or-Treat", PR), act(mon("Gengar", "Cursed Body"), "Shadow Ball", PR), idle(lax(0)), idle(mon("Lucario", "Inner Focus"))),
  checks: "TV04: addType Ghost: Shadow Ball 2x.",
});
add("F2-TT2", "swsh", {
  title: "SwSh: Forest's Curse on Snorlax, then Trick-or-Treat replaces the added Grass with Ghost (TV04b)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Trevenant", "Natural Cure")), "Forest's Curse", PR), act(mon("Gourgeist", "Frisk"), "Trick-or-Treat", PR), idle(lax(0)), idle(lax(8))),
  checks: "One added type at a time.",
});
add("F2-TT3", "champions", {
  title: "Champions: Trick-or-Treat on a Snorlax (position 1) whose Curse is queued: it becomes the Ghost Curse at a random foe (TV04c)", outcomes: true,
  slots: slots(act(fast("champions", mon("Gourgeist", "Frisk")), "Trick-or-Treat", PL), idle(lax(1)), act(lax(0), "Curse"), idle(lax(2))),
  checks: "The Curse reads the type when it runs: the Ghost Curse, its target random among foes.",
});
add("F2-TT4", "usum", {
  title: "USUM: the same: the generation 7 Curse glitch targets the ally (TW05)", outcomes: true,
  slots: slots(act(fast("usum", mon("Gourgeist", "Frisk")), "Trick-or-Treat", PL), idle(lax(8)), act(lax(0), "Curse"), idle(lax(16))),
  checks: "TW05: gen 7's Curse aims at the position of its locked target (the ally).",
});
add("F2-TT5", "swsh", {
  title: "SwSh: Trick-or-Treat on a Snorlax at position 0 whose Curse is queued: a random foe (TW15)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Gourgeist", "Frisk")), "Trick-or-Treat", PR), idle(lax(8)), idle(lax(16)), act(lax(0), "Curse")),
  checks: "TW15.",
});
// ---- Reflect Type (TV05, TV05b, TV05c, TW14) ----
add("F2-RT1", "sv", {
  title: "Gengar Reflect Types onto a Forest's-Cursed Gyarados (earlier turn): Water/Flying/Grass; then Lapras's Ice Beam into Gengar", outcomes: true,
  slots: slots(act(fast("sv", mon("Gengar", "Cursed Body")), "Reflect Type", PR), idle(lax(0)), act(mon("Lapras", "Shell Armor"), "Ice Beam", OL), idle(mon("Gyarados", "Moxie", { addedType: "Grass" }))),
  checks: "TV05: Reflect Type copies the base types and the added type.",
});
add("F2-RT2", "champions", {
  title: "Champions: Stunfisk Reflect Types onto the same Gyarados", outcomes: true,
  slots: slots(act(mon("Stunfisk", "Static"), "Reflect Type", PR), idle(lax(0)), idle(lax(2)), idle(mon("Gyarados", "Moxie", { addedType: "Grass" }))),
  checks: "TW14.",
});
add("F2-RT3", "sv", {
  title: "Reflect Type onto a Garchomp that Terastallized (Water) this turn: Gengar becomes Water; a Terastallized user's Reflect Type fails (TV05b)", outcomes: true,
  slots: slots(act(fast("sv", mon("Gengar", "Cursed Body")), "Reflect Type", PR), act(mon("Mew", "Synchronize", { teraType: "Fire", choice: "terastallize" }), "Reflect Type", PR), idle(lax(0)), { ...mon("Garchomp", "Rough Skin", { teraType: "Water", choice: "terastallize" }), action: { move: null } }),
  checks: "Reflect Type reads the Tera type; a Terastallized user cannot change type.",
});
add("F2-RT4", "champions", {
  title: "Champions: Arcanine's Burn Up (it becomes typeless), then Stunfisk's Reflect Type on it fails (TV05c)", outcomes: true,
  slots: slots(act(mon("Stunfisk", "Static"), "Reflect Type", PR), idle(lax(0)), idle(lax(2)), act(fast("champions", mon("Arcanine", "Intimidate")), "Burn Up", OR)),
  checks: "Reflect Type fails into a ??? Pokémon.",
});
// ---- Conversion, Conversion 2, Camouflage (TV06, TV07, TV07b, TV08) ----
add("F2-CV1", "sv", {
  title: "Porygon2 (Thunderbolt first) uses Conversion: Electric; then a foe's Earthquake into it 2x (TV06)", outcomes: true,
  // Download's lead +1 Atk: Showdown's start has it (boosts); the app input is before the start settle, which adds it (appBoosts).
  slots: slots(act(mon("Porygon2", "Download", { moves: ["Thunderbolt"], boosts: { atk: 1 }, appBoosts: {} }), "Conversion"), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(8))),
  checks: "Conversion takes the first move slot's type.",
});
add("F2-CV2", "usum", {
  title: "USUM: Porygon (Hidden Power first) uses Conversion: the dex type Normal", outcomes: true,
  slots: slots(act(mon("Porygon", "Trace", { moves: ["Hidden Power"] }), "Conversion"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "Conversion reads the move's dex type (Hidden Power: Normal), not its typed power.",
});
add("F2-C21", "sv", {
  title: "Sylveon's Hyper Voice (Pixilate) first; then Porygon-Z's Conversion 2 on Sylveon: a type that resists Fairy, 1/3 each (TV07)", outcomes: true,
  slots: slots(act(mon("Porygon-Z", "Adaptability"), "Conversion 2", PR), idle(lax(0)), idle(lax(16)), act(fast("sv", mon("Sylveon", "Pixilate")), "Hyper Voice")),
  checks: "Conversion 2 reads the target's last move as used (Fairy after Pixilate): Fire, Poison or Steel, 1/3 each.",
});
add("F2-C22", "swsh", {
  title: "SwSh: Conversion 2 on a target whose last move (last turn) was Body Slam", outcomes: true,
  slots: slots(act(mon("Porygon-Z", "Adaptability"), "Conversion 2", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { lastMove: "Body Slam" }))),
  checks: "TV07b: last turn's move: Rock, Steel or Ghost, 1/3 each.",
});
add("F2-CM1", "usum", {
  title: "USUM: Kecleon's Camouflage on Grassy Terrain: Grass (TV08)", outcomes: true,
  field: { terrain: "Grassy" },
  slots: slots(act(mon("Kecleon", "Color Change"), "Camouflage"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "camouflage: the terrain's type.",
});
add("F2-CM2", "usum", {
  title: "USUM: Camouflage with no terrain: Normal, which Kecleon already is: it fails (TV08b)", outcomes: true,
  slots: slots(act(mon("Kecleon", "Color Change"), "Camouflage"), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "setType to its own type fails.",
});
// ---- Electrify (K32, TW01, TV09b, TV09c, TW04, TV09f, TV09g) ----
add("F2-EL1", "champions", {
  title: "Champions: Heliolisk Electrifies Snorlax; Snorlax's Body Slam into Garchomp: immune (K32)", outcomes: true,
  slots: slots(act(fast("champions", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(mon("Garchomp", "Rough Skin")), idle(lax(1)), act(lax(0), "Body Slam", OR)),
  checks: "Electrify makes the move Electric: Garchomp is immune.",
});
add("F2-EL2", "champions", {
  title: "Champions: Electrify, then Snorlax's Body Slam at Raichu's (Lightning Rod) ally: redirected to Raichu (TW01)", outcomes: true,
  slots: slots(act(fast("champions", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(mon("Raichu", "Lightning Rod")), idle(lax(1)), act(lax(0), "Body Slam", OL)),
  checks: "The retype comes before targeting: Lightning Rod takes it.",
});
add("F2-EL3", "champions", {
  title: "Champions: Electrify a Pixilate Sylveon; its Hyper Voice is Electric and keeps the 1.2x (TV09b)", outcomes: true,
  slots: slots(act(fast("champions", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(mon("Gyarados", "Moxie")), idle(lax(1)), act(mon("Sylveon", "Pixilate"), "Hyper Voice")),
  checks: "TV09b: Pixilate's 1.2x stays though the type ends Electric.",
});
add("F2-EL4", "swsh", {
  title: "SwSh: Electrify Snorlax; its Yawn into Lanturn (Volt Absorb, 100 HP) is absorbed (TV09c)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(mon("Lanturn", "Volt Absorb", { hp: 100 })), idle(lax(16)), act(lax(0), "Yawn", OR)),
  checks: "A status move made Electric is absorbed (heal 1/4).",
});
add("F2-EL5", "swsh", {
  title: "SwSh: Electrify a charged Snorlax on Electric Terrain; its Body Slam (now Electric) gets Charge and the terrain (TW04)", outcomes: true,
  field: { terrain: "Electric" },
  slots: slots(act(fast("swsh", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(lax(8)), idle(lax(16)), act(lax(0, { charged: true }), "Body Slam", OL)),
  checks: "TW04: Charge ×2 and Electric Terrain ×1.3 apply to the electrified move.",
});
add("F2-EL6", "usum", {
  title: "USUM: Electrify a Normalize Delcatty; its Thunderbolt into Gyarados (TV09f, TW02)", outcomes: true,
  slots: slots(act(fast("usum", mon("Heliolisk", "Dry Skin")), "Electrify", PR), idle(mon("Gyarados", "Moxie")), idle(lax(16)), act(mon("Delcatty", "Normalize"), "Thunderbolt", OR)),
  checks: "Normalize then Electrify: Electric, with Normalize's 1.2x.",
});
add("F2-EL7", "swsh", {
  title: "SwSh: Electrify into Jolteon after Jolteon moved: it fails (TV09g)", outcomes: true,
  slots: slots(act(mon("Heliolisk", "Dry Skin"), "Electrify", PR), idle(lax(8)), idle(lax(16)), act(fast("swsh", mon("Jolteon", "Volt Absorb")), "Thunderbolt", OL)),
  checks: "electrify onTryHit: fails if the target already moved.",
});
// ---- Ion Deluge (TV10, K56, TV10b, TW11) ----
add("F2-ID1", "usum", {
  title: "USUM: Lanturn's Ion Deluge; a Normalize Delcatty's Thunderbolt and a Pixilate Sylveon's Hyper Voice (TV10, K56)", outcomes: true,
  slots: slots(act(mon("Lanturn", "Volt Absorb", { evs: { spe: 252 } }), "Ion Deluge"), idle(mon("Gyarados", "Moxie")), act(mon("Delcatty", "Normalize"), "Thunderbolt", OR), act(mon("Sylveon", "Pixilate"), "Hyper Voice")),
  checks: "Ion Deluge makes Normal moves Electric: Normalize's becomes Electric; Pixilate's Fairy is untouched.",
});
add("F2-ID2", "usum", {
  title: "USUM: Ion Deluge; Snorlax's Body Slam at Raichu's ally redirected; its Yawn... into Lanturn absorbed (TW11, TV10b)", outcomes: true,
  slots: slots(act(mon("Lanturn", "Volt Absorb", { evs: { spe: 252 }, hp: 100 }), "Ion Deluge"), idle(mon("Raichu", "Lightning Rod")), act(lax(8), "Yawn", OL), act(lax(0), "Body Slam", OL)),
  checks: "Both retyped Normal moves: Body Slam redirected to Raichu; Yawn absorbed by Lanturn.",
});
// ---- Tar Shot (TV11, TV11b, TV11c) ----
add("F2-TS1", "sv", {
  title: "Coalossal's Tar Shot into Forretress (−1 Speed); Arcanine's Flamethrower then 8x (TV11; SV has no Ferrothorn)", outcomes: true,
  slots: slots(act(mon("Coalossal", "Flash Fire"), "Tar Shot", PR), act(mon("Arcanine", "Intimidate", { nature: "Brave", ivs: { spe: 0 } }), "Flamethrower", PR), idle(lax(0)), idle(mon("Forretress", "Sturdy", { level: 100 }))),
  checks: "tarshot: Fire ×2 on top of 4x.",
});
add("F2-TS2", "swsh", {
  title: "SwSh: Tar Shot's −1 Speed re-sorts the turn, then Fire 2x (gen 8)", outcomes: true,
  slots: slots(act(mon("Coalossal", "Flash Fire", { evs: { spe: 252 } }), "Tar Shot", PR), act(mon("Arcanine", "Intimidate"), "Flamethrower", PR), idle(lax(0)), act(mon("Ferrothorn", "Iron Barbs", { evs: { spe: 252 } }), "Gyro Ball", OR)),
  checks: "Gen 8's dynamic order after a Speed drop.",
});
add("F2-TS3", "sv", {
  title: "Tar Shot into a Garchomp that Terastallized (Steel) this turn: no Tar Shot volatile (TV11b)", outcomes: true,
  slots: slots(act(mon("Coalossal", "Flash Fire"), "Tar Shot", PR), act(mon("Arcanine", "Intimidate", { nature: "Brave", ivs: { spe: 0 } }), "Flamethrower", PR), idle(lax(0)), { ...mon("Garchomp", "Rough Skin", { teraType: "Steel", choice: "terastallize" }), action: { move: null } }),
  checks: "tarshot onStart fails on a Terastallized target.",
});
add("F2-TS3b", "sv", {
  title: "A carried Tar Shot on Garchomp, which Terastallizes (Steel) this turn: Fire still ×2 (TV11c)", outcomes: true,
  slots: slots(idle(lax(0)), act(mon("Arcanine", "Intimidate"), "Flamethrower", PR), idle(lax(8)), { ...carried(mon("Garchomp", "Rough Skin", { teraType: "Steel", choice: "terastallize" }), { tarShot: true }), action: { move: null } }),
  checks: "TV11c: the volatile from before Terastallizing keeps working.",
});
// ---- Foresight, Odor Sleuth, Miracle Eye (TV12, TV12b, TV13) ----
add("F2-FS1", "usum", {
  title: "USUM: Foresight on Gengar; Lucario's Close Combat then hits it (TV12)", outcomes: true,
  slots: slots(act(fast("usum", mon("Blastoise", "Torrent")), "Foresight", PR), act(mon("Lucario", "Inner Focus"), "Close Combat", PR), idle(lax(0)), idle(mon("Gengar", "Cursed Body"))),
  checks: "foresight: Normal and Fighting hit a Ghost.",
});
add("F2-FS2", "usum", {
  title: "USUM: Odor Sleuth on Gengar, then Lucario's Close Combat (the same volatile)", outcomes: true,
  slots: slots(act(fast("usum", mon("Arcanine", "Intimidate")), "Odor Sleuth", PR), act(mon("Lucario", "Inner Focus"), "Close Combat", PR), idle(lax(0)), idle(mon("Gengar", "Cursed Body"))),
  checks: "TV12: Odor Sleuth adds the foresight volatile.",
});
add("F2-FS2b", "usum", {
  title: "USUM: Miracle Eye on Umbreon, then Foresight on it: it already has miracleeye, Foresight still applies? (TV12b)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Miracle Eye", PR), act(mon("Blastoise", "Torrent"), "Foresight", PR), idle(lax(0)), idle(mon("Umbreon", "Synchronize"))),
  checks: "TV12b: the failure the oracle shows.",
});
add("F2-ME1", "usum", {
  title: "USUM: Miracle Eye on Bisharp; Espeon's Psychic then hits it (TV13)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Miracle Eye", PR), act(mon("Espeon", "Synchronize"), "Psychic", PR), idle(lax(0)), idle(mon("Bisharp", "Inner Focus"))),
  checks: "miracleeye: Psychic hits a Dark type.",
});
// ---- Telekinesis (K37, TV14b, TW06, TW10) ----
add("F2-TK1", "usum", {
  title: "USUM: Telekinesis on Snorlax (100 HP); a foe's Earthquake misses it; Grassy Terrain does not heal it (K37, TV14b)", outcomes: true,
  field: { terrain: "Grassy" },
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Telekinesis", PR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(0)), idle(lax(8, { hp: 100 }))),
  checks: "telekinesis: floating (Ground immune, no Grassy heal).",
});
add("F2-TK2", "usum", {
  title: "USUM: a carried Telekinesis (2 left) on Snorlax; Lucario's Quick Attack into it on Psychic Terrain (TW06)", outcomes: true,
  field: { terrain: "Psychic" },
  slots: slots(idle(lax(16)), act(mon("Lucario", "Inner Focus"), "Quick Attack", PR), idle(lax(0)), idle(carried(lax(8), { telekinesis: 2 }))),
  checks: "TW06: a floating target is not protected by Psychic Terrain (not grounded).",
});
add("F2-TK2b", "usum", {
  title: "USUM: Telekinesis into Snorlax under Gravity: it fails (TW10, TV14d)", outcomes: true,
  field: { gravity: true },
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Telekinesis", PR), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "telekinesis onTry fails under Gravity.",
});
// ---- Embargo (K26, TV15, TV15b, TV15c, TV15d) ----
add("F2-EM1", "usum", {
  title: "USUM: Embargo on an Air Balloon Snorlax; a foe's Earthquake then hits it (K26, TV15)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Embargo", PR), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(0)), idle(lax(8, { item: "Air Balloon" }))),
  checks: "Embargo suppresses the Air Balloon: grounded.",
});
add("F2-EM1b", "usum", {
  title: "USUM: Embargo on a Life Orb Lapras before its Body Slam: no Life Orb boost or recoil (TV15c)", outcomes: true,
  slots: slots(act(mon("Lapras", "Shell Armor", { item: "Life Orb" }), "Body Slam", PL), idle(lax(0)), idle(lax(8)), act(fast("usum", mon("Alakazam", "Inner Focus")), "Embargo", OL)),
  checks: "TV15c: the suppressed Life Orb.",
});
add("F2-EM2", "usum", {
  title: "USUM: Embargo on a Leftovers Snorlax (150 HP); Bisharp's Knock Off still removes it (×1.5) (TV15b)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Embargo", PR), act(mon("Bisharp", "Inner Focus"), "Knock Off", PR), idle(lax(0)), idle(lax(8, { item: "Leftovers", hp: 150 }))),
  checks: "Knock Off reads the item though Embargo suppresses it.",
});
add("F2-EM2b", "usum", {
  title: "USUM: Embargo on a Leftovers Snorlax (150 HP): no Leftovers at the end of turn (TV15d)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Embargo", PR), idle(lax(0)), idle(lax(16)), idle(lax(8, { item: "Leftovers", hp: 150 }))),
  checks: "embargo: Leftovers suppressed (residual 5.4 before Embargo's 21).",
});
// ---- Heal Block, Psychic Noise (K35, TV16, TV16b-d, TW07) ----
add("F2-HB1", "usum", {
  title: "USUM: Heal Block on the foes; then Venusaur's Giga Drain (100 HP) heals nothing and Lanturn absorbs no HP from a Thunderbolt (K35, TV16)", outcomes: true,
  slots: slots(act(fast("usum", mon("Bronzong", "Levitate")), "Heal Block"), act(mon("Raichu", "Static"), "Thunderbolt", PL), idle(mon("Lanturn", "Volt Absorb", { hp: 100 })), act(mon("Venusaur", "Chlorophyll", { hp: 100 }), "Giga Drain", OL)),
  checks: "TV16: Heal Block stops drain heals and absorb heals (the absorb still blocks the move).",
});
add("F2-HB2", "usum", {
  title: "USUM: Heal Block; a Body Slam into a Sitrus Snorlax (150 HP): the Sitrus is kept; a heal-blocked Recover fails (TV16b, TW07)", outcomes: true,
  slots: slots(act(fast("usum", mon("Bronzong", "Levitate")), "Heal Block"), act(mon("Lapras", "Shell Armor"), "Body Slam", PR), act(mon("Blissey", "Natural Cure", { hp: 100 }), "Soft-Boiled"), idle(lax(8, { item: "Sitrus Berry", hp: 150 }))),
  checks: "The heal-blocked Sitrus is not eaten; Soft-Boiled fails.",
});
add("F2-HB3", "usum", {
  title: "USUM: Heal Block against an Aroma Veil side; a Mental Herb Snorlax's Recover (TV16c, TV16d)", outcomes: true,
  slots: slots(act(fast("usum", mon("Bronzong", "Levitate")), "Heal Block"), idle(lax(0)), idle(mon("Aromatisse", "Aroma Veil")), act(mon("Blissey", "Natural Cure", { item: "Mental Herb", hp: 100 }), "Soft-Boiled")),
  checks: "Aroma Veil protects its side from Heal Block (Mental Herb unused).",
});
add("F2-PN1", "sv", {
  title: "Psychic Noise into a Sitrus Blissey (300 HP); its later Soft-Boiled fails; a later hit does not let it eat the Sitrus", outcomes: true,
  slots: slots(act(fast("sv", mon("Bruxish", "Strong Jaw")), "Psychic Noise", PR), act(mon("Kingambit", "Defiant"), "Iron Head", PR), idle(lax(0)), act(mon("Blissey", "Natural Cure", { item: "Sitrus Berry", hp: 300 }), "Soft-Boiled")),
  checks: "SPEC2: the Psychic Noise guard gone: Heal Block in later steps.",
});
add("F2-PN2", "champions", {
  title: "Champions: Farigiraf's Psychic Noise before a Volt Absorb hit and a drain", outcomes: true,
  slots: slots(act(fast("champions", mon("Farigiraf", "Armor Tail")), "Psychic Noise", PL), act(mon("Raichu", "Static"), "Thunderbolt", PL), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), act(mon("Venusaur", "Chlorophyll", { hp: 100 }), "Giga Drain", OL)),
  checks: "Champions: Heal Block from Psychic Noise (2 turns).",
});
// ---- Nightmare (K36, TV17b, TV17c) ----
add("F2-NM1", "usum", {
  title: "USUM: Nightmare on a sleeping Snorlax; on a Comatose Komala too (K36, TV17c)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Nightmare", PR), act(fast("usum", mon("Gengar", "Cursed Body")), "Nightmare", PL), idle(mon("Komala", "Comatose")), idle(lax(8, { status: "slp" }))),
  checks: "Nightmare −1/4 at residual 11; Komala counts as asleep.",
});
add("F2-NM2", "usum", {
  title: "USUM: Nightmare on a Snorlax whose sleep ends at its own move (1 turn left): the Nightmare ends (TV17b)", outcomes: true,
  slots: slots(act(fast("usum", mon("Alakazam", "Inner Focus")), "Nightmare", PR), idle(lax(0)), idle(lax(16)), act(carried(lax(8, { status: "slp" }), { sleep: { attempts: 1, rest: true } }), "Body Slam", OL)),
  checks: "Rest's sleep (3 turns) after 2 attempts... (the oracle decides): it wakes, Nightmare ends.",
});
// ---- Octolock (K17, TV18, TV18b, TV18c) ----
add("F2-OL1", "champions", {
  title: "Champions: Grapploct's Octolock on a Defiant Kingambit: the drops set off Defiant twice; a Clear Body foe (K17, TV18c)", outcomes: true,
  slots: slots(act(mon("Grapploct", "Technician"), "Octolock", PR), idle(lax(0)), idle(lax(2)), idle(mon("Kingambit", "Defiant"))),
  checks: "Octolock at 14: −1/−1 through boost(): Defiant +2 per stat.",
});
add("F2-OL2", "swsh", {
  title: "SwSh: a carried Octolock whose source faints this turn ends; a Ghost is not trapped (TV18, TV18b)", outcomes: true,
  slots: slots(idle(mon("Grapploct", "Technician", { hp: 1 })), idle(lax(0)), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OL), idle(carried(lax(8), { octolock: OL }))),
  checks: "octolock onResidual: the source is gone, it ends with no drop.",
});
// ---- Attract, Captivate (TV19, K40, K20, TV20) ----
add("F2-AT1", "sv", {
  title: "A female Alcremie's Attract on a male Garchomp; its Dragon Claw then works 1/2; a Mental Herb ally... (TV19c, K40)", outcomes: true,
  slots: slots(act(fast("sv", mon("Alcremie", "Sweet Veil", { gender: "F" })), "Attract", PR), idle(lax(0)), idle(lax(16)), act(mon("Garchomp", "Rough Skin", { gender: "M" }), "Dragon Claw", OL)),
  checks: "attract onBeforeMove: 1/2 immobilised.",
});
add("F2-AT1b", "sv", {
  title: "Attract on a male Garchomp holding Mental Herb: the Herb cures it at once", outcomes: true,
  slots: slots(act(fast("sv", mon("Alcremie", "Sweet Veil", { gender: "F" })), "Attract", PR), idle(lax(0)), idle(lax(16)), act(mon("Garchomp", "Rough Skin", { gender: "M", item: "Mental Herb" }), "Dragon Claw", OL)),
  checks: "TV19c: Mental Herb ends the infatuation (Update).",
});
add("F2-AT2", "champions", {
  title: "Champions: Attract into an Oblivious Slowbro fails; into a male Garchomp it lands, and Garchomp's Dragon Claw then works 1/2 (TV19f; no Destiny Knot in Champions)", outcomes: true,
  slots: slots(act(fast("champions", mon("Absol", "Pressure", { gender: "F" })), "Attract", PR), act(fast("champions", mon("Aerodactyl", "Pressure", { gender: "F" })), "Attract", PL), idle(mon("Slowbro", "Oblivious", { gender: "M" })), act(mon("Garchomp", "Rough Skin", { gender: "M" }), "Dragon Claw", OL)),
  checks: "Oblivious blocks Attract; the landed infatuation's 1/2.",
});
add("F2-AT3", "swsh", {
  title: "SwSh: Attract, then its source faints first: the infatuation ends before the target moves (TV19d)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Alcremie", "Sweet Veil", { gender: "F", hp: 1 })), "Attract", PR), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { gender: "M", evs: { spe: 120 } }), "Dragon Claw", OL), act(mon("Gyarados", "Moxie", { gender: "M" }), "Waterfall", OR)),
  checks: "attract onBeforeMove: a source no longer active ends it.",
});
add("F2-AT3b", "swsh", {
  title: "SwSh: Attract into a foe beside an Aroma Veil ally: blocked (TV19e)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Alcremie", "Sweet Veil", { gender: "F" })), "Attract", PR), idle(lax(0)), idle(mon("Aromatisse", "Aroma Veil")), idle(mon("Gyarados", "Moxie", { gender: "M" }))),
  checks: "Aroma Veil protects its side.",
});
add("F2-AT4", "usum", {
  title: "USUM: a carried infatuation; a genderless target and a same-gender one for Attract (TV19)", outcomes: true,
  slots: slots(act(carried(mon("Garchomp", "Rough Skin", { gender: "M" }), { attract: PR }), "Dragon Claw", PR), act(mon("Clefable", "Magic Guard", { gender: "F" }), "Attract", PL), idle(mon("Magnezone", "Sturdy")), idle(lax(8, { gender: "F" }))),
  checks: "The carried 1/2; Attract fails into a genderless Magnezone.",
});
add("F2-CP1", "usum", {
  title: "USUM: Captivate (−2 Sp. Atk to opposite-gender foes); a genderless foe and an Oblivious one are unaffected (K20, TV20)", outcomes: true,
  slots: slots(act(mon("Clefable", "Magic Guard", { gender: "F" }), "Captivate"), idle(lax(0)), idle(mon("Magnezone", "Sturdy")), idle(mon("Slowbro", "Oblivious", { gender: "M" }))),
  checks: "Captivate: gender check, Oblivious immunity (gen 7).",
});
add("F2-CP2", "usum", {
  title: "USUM: Captivate into a Defiant Bisharp and a Competitive Milotic: the stage reactions", outcomes: true,
  slots: slots(act(mon("Clefable", "Magic Guard", { gender: "F" }), "Captivate"), idle(lax(0)), idle(mon("Milotic", "Competitive", { gender: "M" })), idle(mon("Bisharp", "Defiant", { gender: "M" }))),
  checks: "Defiant +2 Atk, Competitive +2 Sp. Atk after the drop.",
});
// ---- Powder (K34, TV21, TV21b, TW08) ----
add("F2-PW1", "usum", {
  title: "USUM: Vivillon's Powder on Arcanine; its Flare Blitz explodes (1/4) and its Will-O-Wisp too (K34, TV21)", outcomes: true,
  slots: slots(act(fast("usum", mon("Vivillon", "Compound Eyes")), "Powder", PR), act(mon("Charizard", "Blaze"), "Will-O-Wisp", PL), idle(lax(0)), act(mon("Arcanine", "Intimidate"), "Flare Blitz", OL)),
  checks: "powder onTryMove: a Fire move explodes for 1/4 of max HP.",
});
add("F2-PW2", "usum", {
  title: "USUM: Powder on a Grass type fails; a Magic Guard Fire user takes no damage; Heavy Rain stops nothing? (TV21b, TW08)", outcomes: true,
  field: { weather: "Heavy Rain" },
  slots: slots(act(fast("usum", mon("Vivillon", "Compound Eyes")), "Powder", PR), act(fast("usum", mon("Vivillon", "Compound Eyes")), "Powder", PL), idle(mon("Clefable", "Magic Guard")), idle(mon("Venusaur", "Chlorophyll"))),
  checks: "Powder fails on Grass; the oracle decides Heavy Rain.",
});
// ---- Protean, Libero, Roost, Burn Up, Double Shock (TV22, TW19, TV22b, TV23, TV23b, TV24, TV24b) ----
add("F2-PR1", "sv", {
  title: "Greninja (Protean) uses Ice Beam (Ice type); then Arcanine's Flamethrower into it is 2x (TV22)", outcomes: true,
  slots: slots(act(fast("sv", mon("Greninja", "Protean")), "Ice Beam", PR), idle(lax(0)), idle(lax(16)), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)),
  checks: "SPEC2 A2: world types: Protean makes Greninja pure Ice.",
});
add("F2-PR2", "champions", {
  title: "Champions: Greninja's Protean was used on an earlier turn (Water type now); its Ice Beam changes nothing (TW19)", outcomes: true,
  slots: slots(act(fast("champions", mon("Greninja", "Protean", { types: ["Water"], appBuild: { abilityActive: false } })), "Ice Beam", PR), idle(lax(0)), idle(lax(2)), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)),
  checks: "Gen 9 Protean once per entry: no second change.",
});
add("F2-PR3", "swsh", {
  title: "SwSh: Cinderace (Libero) Acrobatics (Flying); then a foe's Earthquake misses it (TV22b)", outcomes: true,
  slots: slots(act(fast("swsh", mon("Cinderace", "Libero")), "Acrobatics", PR), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Earthquake"), idle(lax(8))),
  checks: "Gen 8 Libero on every move: pure Flying.",
});
add("F2-RO1", "sv", {
  title: "Corvisquire's Roost (pure Flying → Normal for the turn); a foe's Low Kick then hits it 2x (TV23)", outcomes: true,
  slots: slots(act(mon("Corvisquire", "Keen Eye", { hp: 60 }), "Roost"), idle(lax(0)), act(mon("Kingambit", "Defiant"), "Low Kick", OL), idle(lax(8))),
  checks: "Roost on a pure Flying type leaves Normal for the turn.",
});
add("F2-RO2", "champions", {
  title: "Champions: Corviknight's Roost (Steel this turn); an Earthquake hits it; back at the end (TV23b)", outcomes: true,
  slots: slots(act(fast("champions", mon("Corviknight", "Pressure", { hp: 100 })), "Roost"), idle(lax(0)), act(mon("Garchomp", "Rough Skin"), "Earthquake"), idle(lax(1))),
  checks: "Roost removes Flying until the end of turn: Earthquake hits.",
});
add("F2-BU1", "champions", {
  title: "Champions: Arcanine's Burn Up (it becomes typeless); a foe's Hydro Pump into it is neutral (TV24)", outcomes: true,
  slots: slots(act(fast("champions", mon("Arcanine", "Intimidate")), "Burn Up", PR), idle(lax(0)), idle(lax(2)), act(mon("Blastoise", "Torrent"), "Hydro Pump", OL)),
  checks: "Burn Up removes the Fire type: ???",
});
for (const game of ["sv", "champions"] as Game[]) {
  add("F2-DS", game, {
    title: "Pawmot's Double Shock (it loses Electric, Fighting left); a foe's Stomping Tantrum then hits it neutral (TV24b)", outcomes: true,
    slots: slots(act(fast(game, mon("Pawmot", "Iron Fist")), "Double Shock", PR), idle(lax(0)), act(mon("Garchomp", "Rough Skin", { nature: "Brave" }), "Stomping Tantrum", OL), idle(lax(k(game, 1)))),
    checks: "Double Shock: ???/Fighting.",
  });
}
// ---- Carried types (TV26) ----
add("F2-TY1", "sv", {
  title: "Gyarados Soaked on an earlier turn (Water) Terastallizes (Water) this turn; its Waterfall's STAB", outcomes: true,
  slots: slots(act(mon("Gyarados", "Moxie", { types: ["Water"], teraType: "Water", choice: "terastallize" }), "Waterfall", PR), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "TV26: the types before Tera and the Tera STAB (2x).",
});
add("F2-TY2", "champions", {
  title: "Champions: a carried added Ghost (Trick-or-Treat) on Snorlax; Lucario's Close Combat into it misses (Ghost); Octolock", outcomes: true,
  slots: slots(idle(lax(0)), act(mon("Lucario", "Inner Focus"), "Close Combat", PR), act(mon("Grapploct", "Technician"), "Octolock", OL), idle(lax(2, { addedType: "Ghost" }))),
  checks: "The carried added type: Ghost immune to Fighting.",
});
// ---- The reasons left (types-volatiles §9) ----
add("F2-G1", "sv", {
  title: "Conversion with its moves unknown: the reason",
  notEstimated: "Conversion needs Porygon2's first move.",
  slots: slots(act(mon("Porygon2", "Download"), "Conversion"), idle(lax(0)), act(lax(16), "Body Slam", OL), idle(lax(8))),
  checks: "REASONS.needsFirstMove.",
});
add("F2-G2", "sv", {
  title: "Attract into a species with both genders and no gender set: the reason",
  notEstimated: "Attract needs Arcanine's gender.",
  slots: slots(act(mon("Alcremie", "Sweet Veil", { gender: "F" }), "Attract", PR), idle(lax(0)), idle(lax(16)), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)),
  checks: "REASONS.needsGender (Q10).",
});
add("F2-G3", "usum", {
  title: "USUM: Natural Gift under Embargo: the reason",
  notEstimated: "Natural Gift with Embargo is not modelled in 2v2.",
  slots: slots(act(carried(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry" }), { embargo: 2 }), "Natural Gift", PR), idle(lax(0)), idle(lax(16)), idle(lax(8))),
  checks: "REASONS.combo for Natural Gift under Embargo.",
});

/** SPEC2's F2- cases (Step 1's F2-CC are in cases-status2-step1.ts). */
export const F2_CASES: Case[] = cases;
void OR; void PL;
