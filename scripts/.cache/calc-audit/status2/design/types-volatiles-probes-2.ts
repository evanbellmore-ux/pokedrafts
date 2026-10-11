// FAMILY 2 (types and volatiles) probes, second batch: the follow-ups types-volatiles-probes.out left open (TV09's Lightning Rod
// holder redirected Jolteon's own Electrify; TV14's Prankster Telekinesis met Psychic Terrain), and the details the design
// needs for the calculation hooks. Same harness; run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/types-volatiles-probes-2.ts [TW01 ...] > scripts/.cache/calc-audit/status2/design/types-volatiles-probes-2.out
import { enumerate, report, type AProbe } from "../../status-eot/design/addendum-sim";
import type { Mon } from "../../status-eot/design/status-sim";

const LINES = /^\|(move|cant|-fail|-immune|-miss|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-status|-curestatus|-start|-end|-singleturn|-fieldactivate|-ability|-prepare|-crit|-supereffective|-resisted|-block|-zpower|-terastallize|-fieldstart|-weather)\|/;
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const jolt = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Jolteon", ability: "Quick Feet", moves, gender: "M", ...over });
const lax = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, gender: "F", ...over });
const mon = (species: string, ability: string, moves: string[], over: Partial<Mon> = {}): Mon => ({ species, ability, moves, ...over });
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: LINES, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const all = (b: any) => [...b.p1.active, ...b.p2.active];
const hps = (b: any) => all(b).map((p: any) => `${p.name} ${p.hp}${p.status ? ` ${p.status}` : ""}`).join(", ");
const types = (b: any) => all(b).map((p: any) => `${p.name}:${p.getTypes().join("/")}${p.addedType ? `(+${p.addedType})` : ""}`).join(" ");
const stages = (p: any) => Object.entries(p.boosts).filter(([, v]) => v).map(([k, v]) => `${k}${(v as number) > 0 ? "+" : ""}${v}`).join(" ") || "0";
const boosts = (b: any) => all(b).map((p: any) => `${p.name}[${stages(p)}]`).join(" ");
const vols = (b: any) => all(b).map((p: any) => `${p.name}{${Object.keys(p.volatiles).join(",")}}`).join(" ");
const run = (id: string, title: string, probe: Partial<AProbe>) => { if (want(id)) report(`${id} ${probe.game ?? "sv"}: ${title}`, enumerate(base(probe))); };

// TW01. Lightning Rod takes an electrified move (ModifyType before getMoveTargets): the Lightning Rod holder itself uses
// Electrify (its own move is not redirected to itself), then Snorlax's Body Slam aimed at its ally goes to it. SwSh, Champions.
for (const game of ["swsh", "champions"] as const) run("TW01", "Raichu (Lightning Rod) Electrify into Snorlax; Snorlax Body Slam into Jolteon (Raichu's ally)", {
  game, mons: [jolt(["Splash"]), mon("Raichu", "Lightning Rod", ["Electrify"]), lax(["Body Slam"]), slow],
  turns: [["move 1, move 1 1", "move 1 1, move 1"]], inspect: (b) => `${hps(b)} || ${boosts(b)}`,
});
// TW02. Electrify without Normalize (USUM): Delcatty (Cute Charm) Thunderbolt into Gyarados, 4x with no 1.2x: compare TV09f's
// 104 (Normalize's 1.2x kept).
run("TW02", "USUM: Jolteon Electrify into Delcatty (Cute Charm); Delcatty Thunderbolt into Gyarados", {
  game: "usum", mons: [jolt(["Electrify"]), mon("Gyarados", "Moxie", ["Splash"]), mon("Delcatty", "Cute Charm", ["Thunderbolt"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// TW03. Electrify and an own-type move: Weather Ball in rain (Water, 100 power) becomes Electric with its doubled power (SwSh).
for (const elec of [true, false]) run("TW03", `SwSh: Jolteon ${elec ? "Electrify" : "Splash"} into Snorlax; Snorlax Weather Ball into Gyarados; rain`, {
  game: "swsh", mons: [jolt([elec ? "Electrify" : "Splash"]), mon("Gyarados", "Moxie", ["Splash"]), lax(["Weather Ball"]), slow],
  turns: [[elec ? "move 1 1, move 1" : "move 1, move 1", "move 1 2, move 1"]], setup: (b) => b.field.setWeather("raindance", "debug"), inspect: (b) => hps(b),
});
// TW04. Electrify and Electric Terrain (grounded user: 1.3x) and Charge (2x) on the electrified move (SwSh). Control: Splash.
for (const elec of [true, false]) run("TW04", `SwSh: Jolteon ${elec ? "Electrify" : "Splash"} into Snorlax (Charge); Snorlax Body Slam into Gyarados; Electric Terrain`, {
  game: "swsh", mons: [jolt([elec ? "Electrify" : "Splash"]), mon("Gyarados", "Moxie", ["Splash"]), lax(["Body Slam"]), slow],
  turns: [[elec ? "move 1 1, move 1" : "move 1, move 1", "move 1 2, move 1"]],
  setup: (b) => { b.field.setTerrain("electricterrain", "debug"); b.p2.active[0].addVolatile("charge"); }, inspect: (b) => `${hps(b)} || ${vols(b)}`,
});
// TW05. The Curse glitch in SwSh and USUM (Trick-or-Treat into a position-1 Pokémon with a queued non-Ghost Curse).
for (const game of ["swsh", "usum"] as const) run("TW05", "Jolteon Trick-or-Treat into Snorlax at position 1 (queued Curse)", {
  game, mons: [jolt(["Trick-or-Treat"]), { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow, lax(["Curse"])],
  turns: [["move 1 2, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)} || ${boosts(b)} || ${vols(b)}`,
});
// TW06. Telekinesis from the turn before: under Psychic Terrain a foe's priority move reaches the lifted Pokémon (not grounded).
for (const tk of [true, false]) run("TW06", `USUM: turn 1 Jolteon ${tk ? "Telekinesis" : "Splash"} into Snorlax; turn 2 Lucario Quick Attack into Snorlax; Psychic Terrain`, {
  game: "usum", mons: [jolt([tk ? "Telekinesis" : "Splash", "Splash"]), mon("Lucario", "Inner Focus", ["Splash", "Quick Attack"]), lax(["Splash"]), slow],
  turns: [[tk ? "move 1 1, move 1" : "move 1, move 1", "move 1, move 1"], ["move 2, move 2 1", "move 1, move 1"]],
  setup: (b) => b.field.setTerrain("psychicterrain", "debug"), inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TW07. Heal Block and Shell Bell (USUM): the heal-blocked attacker's Shell Bell heals nothing; Leech Seed's heal-blocked seeder
// gains nothing at the end of turn.
run("TW07", "USUM: Jolteon Heal Block; Venusaur (Shell Bell, 100) Sludge Bomb into Jolteon; Lanturn (100) seeded Jolteon before", {
  game: "usum", mons: [jolt(["Heal Block"]), still, mon("Venusaur", "Chlorophyll", ["Sludge Bomb"], { item: "Shell Bell" }), mon("Lanturn", "Volt Absorb", ["Splash"])],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
  setup: (b) => { b.p2.active[0].sethp(100); b.p2.active[1].sethp(100); b.p1.active[0].addVolatile("leechseed", b.p2.active[1]); },
  inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TW08. Powder in Heavy Rain (USUM): the rain's TryMove (priority 1) fizzles the Fire move first, so Powder does no damage.
run("TW08", "USUM: Jolteon Powder into Arcanine; Arcanine Flamethrower into Chansey; Heavy Rain", {
  game: "usum", mons: [jolt(["Powder"]), still, mon("Arcanine", "Intimidate", ["Flamethrower"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => b.field.setWeather("primordialsea", "debug"), inspect: (b) => hps(b),
});
// TW09. Magic Powder bounced by Magic Bounce (Champions): the user becomes Psychic.
run("TW09", "Champions: Jolteon Magic Powder into Espeon (Magic Bounce)", {
  game: "champions", mons: [jolt(["Magic Powder"]), still, mon("Espeon", "Magic Bounce", ["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TW10. Gravity used this turn ends a Telekinesis (and grounds it) (USUM): turn 1 Telekinesis, turn 2 Gravity then Earthquake.
run("TW10", "USUM: turn 1 Jolteon Telekinesis into Snorlax; turn 2 Jolteon Gravity, Shuckle Earthquake", {
  game: "usum", mons: [jolt(["Telekinesis", "Gravity"]), mon("Shuckle", "Sturdy", ["Splash", "Earthquake"]), lax(["Splash"]), still],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 2", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TW11. Ion Deluge and a Pixilate status move: no change (Fairy), the K56 rule for status moves; and Lightning Rod takes a
// Normal move under Ion Deluge (USUM).
run("TW11", "USUM: Shuckle Ion Deluge; Snorlax Body Slam into Jolteon whose ally Raichu has Lightning Rod", {
  game: "usum", mons: [jolt(["Splash"]), mon("Raichu", "Lightning Rod", ["Splash"]), lax(["Body Slam"]), { ...slow, moves: ["Ion Deluge"] }],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${hps(b)} || ${boosts(b)}`,
});
// TW12. Electrify on a Pokémon that switched in this turn and has no move queued: it does not fail (activeTurns 0) (SwSh).
run("TW12", "SwSh: Snorlax switches in for Chansey; Jolteon Electrify into Snorlax", {
  game: "swsh", mons: [jolt(["Electrify"]), slow, still, mon("Lapras", "Shell Armor", ["Splash"])],
  turns: [["move 1 1, move 1", "switch 3, move 1"]], inspect: (b) => vols(b),
});
// TW13. Forest's Curse then Soak, all four games where both exist: the added type goes with setType (SwSh, USUM).
for (const game of ["swsh", "usum"] as const) run("TW13", "Jolteon Forest's Curse into Gyarados; Lapras Soak into Gyarados", {
  game, mons: [jolt(["Forest's Curse"]), mon("Lapras", "Shell Armor", ["Soak"]), mon("Gyarados", "Moxie", ["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TW14. Reflect Type in Champions (Tera does not exist there): copies a Forest's-Cursed target's added type.
run("TW14", "Champions: Jolteon Forest's Curse into Gyarados; Lucario Reflect Type on Gyarados", {
  game: "champions", mons: [jolt(["Forest's Curse"]), mon("Lucario", "Inner Focus", ["Reflect Type"]), mon("Gyarados", "Moxie", ["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TW15. The queued non-Ghost Curse of a Pokémon that became a Ghost type, at position 0 (no glitch), USUM and SwSh, to set
// against TW05 (position 1: generation 7 aims it at the ally, generation 8 at a random foe).
for (const game of ["usum", "swsh"] as const) run("TW15", "Jolteon Trick-or-Treat into Snorlax at position 0 (queued Curse)", {
  game, mons: [jolt(["Trick-or-Treat"]), { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, lax(["Curse"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)} || ${vols(b)}`,
});
// TW16. Pixilate on a Normal status move then Electrify (Champions): Yawn is Fairy, then Electric: Volt Absorb takes it.
run("TW16", "Champions: Jolteon Electrify into Sylveon (Pixilate); Sylveon Yawn into Raichu (Volt Absorb)", {
  game: "champions", mons: [jolt(["Electrify"]), mon("Raichu", "Volt Absorb", ["Splash"]), mon("Sylveon", "Pixilate", ["Yawn"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[1].sethp(100), inspect: (b) => `${hps(b)} || ${vols(b)}`,
});
// TW17. Color Change and a Substitute (USUM): Kecleon behind a Substitute hit by Thunderbolt.
run("TW17", "USUM: Jolteon Thunderbolt into Kecleon (Color Change) behind a Substitute; Garchomp Earthquake", {
  game: "usum", mons: [jolt(["Thunderbolt"]), still, mon("Kecleon", "Color Change", ["Splash"], { level: 100 }), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].addVolatile("substitute"), inspect: (b) => `${types(b)} || ${hps(b)} || ${vols(b)}`,
});
// TW18. Reflect Type on a Terastallized target that also has an added type (SV): getTypes(true) is the Tera type, and the
// added type is copied too (source.addedType = target.addedType).
run("TW18", "SV: turn 1 Trevenant Forest's Curse into Garchomp; turn 2 Garchomp Terastallizes (Water), Smeargle Reflect Type on it", {
  mons: [mon("Smeargle", "Own Tempo", ["Splash", "Reflect Type"]), mon("Trevenant", "Natural Cure", ["Forest's Curse", "Splash"]), mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Water" }), slow],
  turns: [["move 1, move 1 1", "move 1, move 1"], ["move 2 1, move 2", "move 1 terastallize, move 1"]], inspect: (b) => types(b),
});
// TW19. Protean in Champions: once per switch-in (turn 2's Flamethrower keeps it Ice), as in generation 9.
run("TW19", "Champions: Greninja (Protean) turn 1 Ice Beam, turn 2 Flamethrower", {
  game: "champions", mons: [mon("Greninja", "Protean", ["Ice Beam", "Flamethrower"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TW20. Protean in SwSh: every move (turn 2's Flamethrower makes it Fire).
run("TW20", "SwSh: Cinderace (Libero) turn 1 Acrobatics, turn 2 Pyro Ball", {
  game: "swsh", mons: [mon("Cinderace", "Libero", ["Acrobatics", "Pyro Ball"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]], inspect: (b) => types(b),
});
