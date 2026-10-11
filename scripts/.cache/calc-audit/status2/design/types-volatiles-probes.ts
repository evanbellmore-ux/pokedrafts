// FAMILY 2 (types and volatiles) probes, status2 design: whole turns in pinned Showdown c23d2e94 on the earlier design's exact
// harness (status-eot/design/addendum-sim.ts: every random decision enumerated, every move hits, chances below 100% fail
// unless enumerated, crits only when certain, the lowest roll). Each claim of types-volatiles.md that is not already a
// CENSUS 1 probe (census-moves-probes.out K1-K57) is checked here, with a control where the claim is a difference.
// Speeds at level 50, no EVs: Jolteon 150, Whimsicott 136, Greninja 142, Cinderace 139, Tornadus 131, Gengar 130, Raichu 130,
// Espeon 130, Pawmot 125, Garchomp 122, Charizard 120, Arcanine 115, Lucario 110, Delcatty 110, Gyarados 101, Venusaur 100,
// Victreebel 90, Bisharp 90, Corviknight 87, Umbreon 85, Komala 85, Lanturn 82, Lapras 80, Sylveon 80, Chansey 70, Clefable 65,
// Porygon 60, Kecleon 60, Snorlax 50, Aromatisse 49, Ferrothorn 40, Shuckle 25.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/types-volatiles-probes.ts [TV01 ...] > scripts/.cache/calc-audit/status2/design/types-volatiles-probes.out
import { enumerate, report, type AProbe } from "../../status-eot/design/addendum-sim";
import type { Mon } from "../../status-eot/design/status-sim";

const LINES = /^\|(move|cant|-fail|-immune|-miss|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-status|-curestatus|-start|-end|-singleturn|-fieldactivate|-ability|-prepare|-crit|-supereffective|-resisted|-block|-zpower|detailschange|-terastallize|-fieldstart)\|/;
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const jolt = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Jolteon", ability: "Quick Feet", moves, gender: "M", ...over });
const lapras = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Lapras", ability: "Shell Armor", moves, ...over });
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
const items = (b: any) => all(b).map((p: any) => `${p.name}:${p.item || "-"}`).join(" ");
const vols = (b: any) => all(b).map((p: any) => `${p.name}{${Object.keys(p.volatiles).join(",")}}`).join(" ");
const run = (id: string, title: string, probe: Partial<AProbe>) => { if (want(id)) report(`${id} ${probe.game ?? "sv"}: ${title}`, enumerate(base(probe))); };
const asleep = (p: any, turns = 3) => { p.setStatus("slp", null, null, true); p.statusState.time = turns; p.statusState.startTime = turns; };

// ==== Types: Soak, Magic Powder, Forest's Curse, Trick-or-Treat, Reflect Type, Conversion, Conversion 2, Camouflage ====

// TV01. Soak takes Gyarados's Flying type away: Thunderbolt 2x not 4x, then its ally's Earthquake hits it (grounded), and
// Grassy Terrain heals it at the end of turn (grounded). Control: Splash.
for (const soak of [true, false]) run("TV01", `Jolteon ${soak ? "Soak" : "Splash"} into Gyarados; Lapras Thunderbolt into Gyarados; Shuckle Earthquake; Grassy Terrain`, {
  mons: [jolt([soak ? "Soak" : "Splash"]), lapras(["Thunderbolt"]), mon("Gyarados", "Moxie", ["Splash"]), mon("Shuckle", "Sturdy", ["Earthquake"])],
  turns: [[soak ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.field.setTerrain("grassyterrain", "debug"),
  inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV01b. Soak on a Poison type with Black Sludge: it now loses 1/8 at the end of turn.
run("TV01b", "Jolteon Soak into Gengar (Black Sludge, 100 HP)", {
  mons: [jolt(["Soak"]), still, mon("Gengar", "Cursed Body", ["Splash"], { item: "Black Sludge" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(100), inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV01c. Soak fails: Arceus (setType), a Water type alone (getTypes().join() === 'Water').
run("TV01c", "Jolteon Soak into Arceus; Lapras Soak into Vaporeon", {
  mons: [jolt(["Soak"]), lapras(["Soak"]), mon("Arceus", "Multitype", ["Splash"]), mon("Vaporeon", "Water Absorb", ["Splash"])],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], inspect: (b) => types(b),
});
// TV01d. Soak into a Stellar Terastallized target fails (setType: terastallized, any Tera type).
run("TV01d", "Garchomp Terastallizes (Stellar); Jolteon Soak into Garchomp", {
  mons: [jolt(["Soak"]), still, mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Stellar" }), slow],
  turns: [["move 1 1, move 1", "move 1 terastallize, move 1"]], inspect: (b) => `${types(b)} tera:${b.p2.active[0].terastallized}`,
});
// TV01e. Soak after Forest's Curse this turn: the added Grass goes too (setType clears addedType); Ice Beam then 0.5x.
run("TV01e", "Jolteon Forest's Curse into Snorlax; Lapras Soak into Snorlax; Shuckle Ice Beam into Snorlax", {
  mons: [jolt(["Forest's Curse"]), lapras(["Soak"]), lax(["Splash"]), { ...slow, moves: ["Ice Beam"] }],
  turns: [["move 1 1, move 1 1", "move 1, move 1 -1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});

// TV02. Magic Powder (Champions): Gengar becomes Psychic; Lucario's Close Combat (immune before) now hits at 0.5x.
for (const powder of [true, false]) run("TV02", `Jolteon ${powder ? "Magic Powder" : "Splash"} into Gengar; Lucario Close Combat into Gengar`, {
  game: "champions", mons: [jolt([powder ? "Magic Powder" : "Splash"]), mon("Lucario", "Inner Focus", ["Close Combat"]), mon("Gengar", "Cursed Body", ["Splash"]), slow],
  turns: [[powder ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV02b. Magic Powder's powder flag: a Grass type is immune, Safety Goggles block it (Champions).
run("TV02b", "Jolteon Magic Powder into Venusaur; Lucario Magic Powder into Gengar (Safety Goggles)", {
  game: "champions", mons: [jolt(["Magic Powder"]), mon("Lucario", "Inner Focus", ["Magic Powder"]), mon("Venusaur", "Chlorophyll", ["Splash"]), mon("Gengar", "Cursed Body", ["Splash"], { item: "Safety Goggles" })],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], inspect: (b) => types(b),
});

// TV03. Forest's Curse gives STAB to the target's own Grass move (hasType includes the added type) and makes it immune to a
// later Spore (powder vs Grass). Control: Splash.
for (const curse of [true, false]) run("TV03", `Jolteon ${curse ? "Forest's Curse" : "Splash"} into Snorlax; Snorlax Seed Bomb into Chansey; Shuckle Spore into Snorlax`, {
  mons: [jolt([curse ? "Forest's Curse" : "Splash"]), still, lax(["Seed Bomb"]), { ...slow, moves: ["Spore"] }],
  turns: [[curse ? "move 1 1, move 1" : "move 1, move 1", "move 1 2, move 1 -1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV03b. Forest's Curse fails on a Grass type and on a Terastallized target (addType).
run("TV03b", "Jolteon Forest's Curse into Venusaur; Lapras Forest's Curse into a Tera-Water Garchomp", {
  mons: [jolt(["Forest's Curse"]), lapras(["Forest's Curse"]), mon("Venusaur", "Chlorophyll", ["Splash"]), mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Water" })],
  turns: [["move 1 1, move 1 2", "move 1, move 1 terastallize"]], inspect: (b) => types(b),
});

// TV04. Trick-or-Treat (Champions) then a Ghost move: Shadow Ball 2x into the Ghost-added Lucario. Control: Splash.
for (const tot of [true, false]) run("TV04", `Jolteon ${tot ? "Trick-or-Treat" : "Splash"} into Lucario; Gengar Shadow Ball into Lucario`, {
  game: "champions", mons: [jolt([tot ? "Trick-or-Treat" : "Splash"]), mon("Gengar", "Cursed Body", ["Shadow Ball"]), mon("Lucario", "Inner Focus", ["Splash"]), slow],
  turns: [[tot ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV04b. Trick-or-Treat replaces a Forest's Curse Grass (addType keeps one added type).
run("TV04b", "SwSh: Jolteon Forest's Curse into Snorlax; Gengar Trick-or-Treat into Snorlax", {
  game: "swsh", mons: [jolt(["Forest's Curse"]), mon("Gengar", "Cursed Body", ["Trick-or-Treat"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TV04c. The Curse glitch (data/moves.ts:19928-19934): a target at position 1 with a queued Curse; TV04d at position 0.
// Snorlax chose Curse as a non-Ghost type (its target: itself).
run("TV04c", "Champions: Jolteon Trick-or-Treat into Snorlax at position 1 (queued Curse)", {
  game: "champions", mons: [jolt(["Trick-or-Treat"]), lapras(["Splash"]), { ...slow, moves: ["Splash"] }, lax(["Curse"])],
  turns: [["move 1 2, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)} || ${boosts(b)} || ${vols(b)}`,
});
run("TV04d", "Champions: Jolteon Trick-or-Treat into Snorlax at position 0 (queued Curse)", {
  game: "champions", mons: [jolt(["Trick-or-Treat"]), lapras(["Splash"]), lax(["Curse"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)} || ${boosts(b)} || ${vols(b)}`,
});
// TV04e. A Ghost Curse user that loses Ghost before it moves (Soak): its Curse is the non-Ghost one (move.target = self).
run("TV04e", "SV: Gengar Curse into Lapras; Jolteon Soak into Gengar first", {
  mons: [jolt(["Soak"]), lapras(["Splash"]), mon("Gengar", "Cursed Body", ["Curse"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)} || ${boosts(b)} || ${vols(b)}`,
});

// TV05. Reflect Type of a Forest's-Cursed Gyarados: the user takes Water/Flying and the added Grass; Ice Beam into it is 2x.
run("TV05", "Jolteon Forest's Curse into Gyarados; Lapras Reflect Type on Gyarados; Shuckle Ice Beam into Lapras", {
  mons: [jolt(["Forest's Curse"]), lapras(["Reflect Type"]), mon("Gyarados", "Moxie", ["Splash"]), { ...slow, moves: ["Ice Beam"] }],
  turns: [["move 1 1, move 1 1", "move 1, move 1 2"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV05b. Reflect Type on a Terastallized target copies its Tera type (getTypes(true)); a Terastallized user fails.
run("TV05b", "Garchomp Terastallizes (Water); Jolteon Reflect Type on Garchomp; Lapras (Tera Fire) Reflect Type on Garchomp", {
  mons: [jolt(["Reflect Type"]), lapras(["Reflect Type"], { teraType: "Fire" }), mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Water" }), slow],
  turns: [["move 1 1, move 1 1 terastallize", "move 1 terastallize, move 1"]], inspect: (b) => types(b),
});
// TV05c. Reflect Type on a Burn Up user: a pure-Fire user's ??? alone fails it; TV05d: ???/Flying gives Flying.
run("TV05c", "Arcanine Burn Up into Chansey; Shuckle Reflect Type on Arcanine", {
  mons: [{ ...slow, moves: ["Reflect Type"] }, still, mon("Arcanine", "Intimidate", ["Burn Up"]), lax(["Splash"])],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => types(b),
});
run("TV05d", "Charizard Burn Up into Chansey; Shuckle Reflect Type on Charizard (???/Flying)", {
  mons: [{ ...slow, moves: ["Reflect Type"] }, still, mon("Charizard", "Blaze", ["Burn Up"]), lax(["Splash"])],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => types(b),
});

// TV06. Conversion: the type of the first move slot (Thunderbolt), whatever the move used; Earthquake into it is then 2x.
run("TV06", "Porygon (Thunderbolt, Conversion) Conversion; Shuckle Earthquake", {
  mons: [mon("Porygon", "Trace", ["Thunderbolt", "Conversion"]), still, lax(["Splash"]), mon("Shuckle", "Sturdy", ["Earthquake"])],
  turns: [["move 2, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});

// TV07. Conversion 2 reads the target's last move as used (lastMoveUsed: its type after ModifyType): Sylveon's Pixilate Hyper
// Voice is Fairy, so a type resisting Fairy (Fire, Poison, Steel) at random.
run("TV07", "Sylveon (Pixilate) Hyper Voice; Shuckle Conversion 2 on Sylveon", {
  mons: [{ ...slow, moves: ["Conversion 2"] }, still, mon("Sylveon", "Pixilate", ["Hyper Voice"]), lax(["Splash"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => types(b),
});
// TV07b. The last move from the turn before: Conversion 2 fails on turn 1 (no last move), and on turn 2 reads turn 1's Body Slam.
run("TV07b", "Turn 1 Porygon Conversion 2 on Snorlax, Snorlax Body Slam; turn 2 the same", {
  mons: [mon("Porygon", "Trace", ["Conversion 2"]), still, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"], ["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => types(b),
});

// TV08. Camouflage (USUM): Grassy Terrain Grass; no terrain Normal (Kecleon is Normal: fails).
run("TV08", "USUM: Kecleon Camouflage on Grassy Terrain", {
  game: "usum", mons: [mon("Kecleon", "Color Change", ["Camouflage"]), still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.field.setTerrain("grassyterrain", "debug"), inspect: (b) => types(b),
});
run("TV08b", "USUM: Kecleon Camouflage with no terrain", {
  game: "usum", mons: [mon("Kecleon", "Color Change", ["Camouflage"]), still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => types(b),
});

// ==== Move types: Electrify, Ion Deluge ===================================================================================

// TV09. Electrify then Lightning Rod: ModifyType runs before getMoveTargets (sim/battle-actions.ts useMoveInner), so the ally's
// Lightning Rod takes Snorlax's electrified Body Slam (immune, +1 Sp. Atk). Champions and SwSh.
for (const game of ["champions", "swsh"] as const) run("TV09", "Jolteon Electrify into Snorlax; Snorlax Body Slam into Jolteon; Raichu (Lightning Rod) is Jolteon's ally", {
  game, mons: [jolt(["Electrify"]), mon("Raichu", "Lightning Rod", ["Splash"]), lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${hps(b)} || ${boosts(b)}`,
});
// TV09b. Electrify keeps Pixilate's power boost (typeChangerBoosted), Champions (K55 ran in SV's custom game).
for (const ability of ["Pixilate", "Cute Charm"]) run("TV09b", `Champions: Jolteon Electrify into Sylveon (${ability}); Sylveon Hyper Voice`, {
  game: "champions", mons: [jolt(["Electrify"]), mon("Gyarados", "Moxie", ["Splash"]), mon("Sylveon", ability, ["Hyper Voice"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// TV09c. Electrify on a status move's user: its Yawn is Electric, so Lanturn's Volt Absorb takes it (status moves too).
run("TV09c", "SwSh: Jolteon Electrify into Snorlax; Snorlax Yawn into Lanturn (Volt Absorb, 100 HP)", {
  game: "swsh", mons: [jolt(["Electrify"]), mon("Lanturn", "Volt Absorb", ["Splash"]), lax(["Yawn"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[1].sethp(100), inspect: (b) => `${hps(b)} || ${vols(b)}`,
});
// TV09d. Electrify and a Max Move (SwSh): ModifyType runs before getActiveMaxMove, so a Dynamaxed Normal move is Max Lightning.
run("TV09d", "SwSh: Jolteon Electrify into Snorlax; Snorlax (Dynamax) Body Slam into Garchomp", {
  game: "swsh", mons: [jolt(["Electrify"]), mon("Garchomp", "Rough Skin", ["Splash"]), lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2 dynamax, move 1"]], inspect: (b) => `${hps(b)} || terrain ${b.field.terrain || "-"}`,
});
// TV09e. Electrify and a Z-Move (USUM): the Z-Move is picked first (Breakneck Blitz), then made Electric.
run("TV09e", "USUM: Jolteon Electrify into Snorlax (Normalium Z); Snorlax Z-Body Slam into Garchomp", {
  game: "usum", mons: [jolt(["Electrify"]), mon("Garchomp", "Rough Skin", ["Splash"]), lax(["Body Slam"], { item: "Normalium Z" }), slow],
  turns: [["move 1 1, move 1", "move 1 2 zmove, move 1"]], inspect: (b) => hps(b),
});
// TV09f. Electrify with Normalize (USUM, gen 7: Normalize's 1.2x): Delcatty's Thunderbolt becomes Normal, then Electric.
for (const elec of [true, false]) run("TV09f", `USUM: Jolteon ${elec ? "Electrify" : "Splash"} into Delcatty (Normalize); Delcatty Thunderbolt into Gyarados`, {
  game: "usum", mons: [jolt([elec ? "Electrify" : "Splash"]), mon("Gyarados", "Moxie", ["Splash"]), mon("Delcatty", "Normalize", ["Thunderbolt"]), slow],
  turns: [[elec ? "move 1 1, move 1" : "move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// TV09g. Electrify into a target that already moved this turn fails (onTryHit: willMove null and activeTurns > 0).
run("TV09g", "SwSh: Snorlax Electrify into Jolteon after Jolteon moved", {
  game: "swsh", mons: [lax(["Electrify"]), still, jolt(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => vols(b),
});

// TV10. Ion Deluge (USUM) with Normalize: Normal, then Electric, with Normalize's 1.2x kept. Control: Splash.
for (const deluge of [true, false]) run("TV10", `USUM: Shuckle ${deluge ? "Ion Deluge" : "Splash"}; Delcatty (Normalize) Thunderbolt into Gyarados`, {
  game: "usum", mons: [{ ...slow, moves: [deluge ? "Ion Deluge" : "Splash"] }, mon("Gyarados", "Moxie", ["Splash"]), mon("Delcatty", "Normalize", ["Thunderbolt"]), still],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// TV10b. A Normal status move under Ion Deluge (Yawn) into Volt Absorb.
run("TV10b", "USUM: Shuckle Ion Deluge; Snorlax Yawn into Lanturn (Volt Absorb, 100 HP)", {
  game: "usum", mons: [{ ...slow, moves: ["Ion Deluge"] }, mon("Lanturn", "Volt Absorb", ["Splash"]), lax(["Yawn"]), still],
  turns: [["move 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[1].sethp(100), inspect: (b) => `${hps(b)} || ${vols(b)}`,
});

// ==== Effectiveness volatiles: Tar Shot, Foresight, Odor Sleuth, Miracle Eye =============================================

// TV11. Tar Shot +1 on the first type only, once: Flamethrower into Ferrothorn (Grass/Steel, 4x) becomes 8x. Control: Splash.
for (const tar of [true, false]) run("TV11", `Jolteon ${tar ? "Tar Shot" : "Splash"} into Ferrothorn; Arcanine Flamethrower into Ferrothorn`, {
  mons: [jolt([tar ? "Tar Shot" : "Splash"]), mon("Arcanine", "Intimidate", ["Flamethrower"]), mon("Ferrothorn", "Iron Barbs", ["Splash"], { level: 100 }), slow],
  turns: [[tar ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${boosts(b)} || ${vols(b)} || ${hps(b)}`,
});
// TV11b. Tar Shot into a Terastallized target: the Speed drop lands, the volatile fails (onStart: terastallized).
run("TV11b", "Garchomp Terastallizes (Steel); Jolteon Tar Shot into Garchomp; Arcanine Flamethrower into Garchomp", {
  mons: [jolt(["Tar Shot"]), mon("Arcanine", "Intimidate", ["Flamethrower"]), mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Steel" }), slow],
  turns: [["move 1 1, move 1 1", "move 1 terastallize, move 1"]], inspect: (b) => `${boosts(b)} || ${vols(b)} || ${hps(b)}`,
});
// TV11c. Tar Shot from an earlier turn on a Pokémon that Terastallizes later: the Fire move reads its Tera type as the first type.
run("TV11c", "Turn 1 Jolteon Tar Shot into Garchomp; turn 2 Garchomp Terastallizes (Steel), Arcanine Flamethrower into Garchomp", {
  mons: [jolt(["Tar Shot", "Splash"]), mon("Arcanine", "Intimidate", ["Flamethrower", "Splash"]), mon("Garchomp", "Rough Skin", ["Splash"], { teraType: "Steel" }), slow],
  turns: [["move 1 1, move 2", "move 1, move 1"], ["move 2, move 1 1", "move 1 terastallize, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});

// TV12. Foresight (USUM): Close Combat into Gengar (Ghost/Poison) then hits at 0.5x; Odor Sleuth is the same volatile.
for (const move of ["Foresight", "Odor Sleuth", "Splash"]) run("TV12", `USUM: Jolteon ${move} into Gengar; Lucario Close Combat into Gengar`, {
  game: "usum", mons: [jolt([move]), mon("Lucario", "Inner Focus", ["Close Combat"]), mon("Gengar", "Cursed Body", ["Splash"]), slow],
  turns: [[move === "Splash" ? "move 1, move 1 1" : "move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV12b. Foresight fails on a Miracle Eye target (onTryHit).
run("TV12b", "USUM: Jolteon Miracle Eye into Umbreon; Lucario Foresight into Umbreon", {
  game: "usum", mons: [jolt(["Miracle Eye"]), mon("Lucario", "Inner Focus", ["Foresight"]), mon("Umbreon", "Synchronize", ["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => vols(b),
});
// TV13. Miracle Eye (USUM): Psychic into Bisharp (Dark/Steel) then 0.5x (Dark neutral, Steel resists). Control: Splash.
for (const eye of [true, false]) run("TV13", `USUM: Jolteon ${eye ? "Miracle Eye" : "Splash"} into Bisharp; Espeon Psychic into Bisharp`, {
  game: "usum", mons: [jolt([eye ? "Miracle Eye" : "Splash"]), mon("Espeon", "Synchronize", ["Psychic"]), mon("Bisharp", "Inner Focus", ["Splash"]), slow],
  turns: [[eye ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => hps(b),
});

// ==== Grounding and items: Telekinesis, Embargo ==========================================================================

// TV14. Telekinesis (USUM) with Prankster first: on Psychic Terrain a foe's priority move then reaches the lifted Pokémon (not
// grounded). Control: Splash.
for (const tk of [true, false]) run("TV14", `USUM: Whimsicott (Prankster) ${tk ? "Telekinesis" : "Splash"} into Snorlax; Lucario Quick Attack into Snorlax; Psychic Terrain`, {
  game: "usum", mons: [mon("Whimsicott", "Prankster", [tk ? "Telekinesis" : "Splash"]), mon("Lucario", "Inner Focus", ["Quick Attack"]), lax(["Splash"]), slow],
  turns: [[tk ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.field.setTerrain("psychicterrain", "debug"), inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV14b. Grassy Terrain does not heal a lifted Pokémon at the end of turn. Control: Splash.
for (const tk of [true, false]) run("TV14b", `USUM: Jolteon ${tk ? "Telekinesis" : "Splash"} into Snorlax (100 HP); Grassy Terrain`, {
  game: "usum", mons: [jolt([tk ? "Telekinesis" : "Splash"]), still, lax(["Splash"]), slow],
  turns: [[tk ? "move 1 1, move 1" : "move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("grassyterrain", "debug"); b.p2.active[0].sethp(100); }, inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV14c. Telekinesis fails: Diglett (an immune species), an Ingrained target.
run("TV14c", "USUM: Jolteon Telekinesis into Diglett; Lapras Telekinesis into an Ingrained Snorlax", {
  game: "usum", mons: [jolt(["Telekinesis"]), lapras(["Telekinesis"]), mon("Diglett", "Arena Trap", ["Splash"]), lax(["Splash"])],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], setup: (b) => b.p2.active[1].addVolatile("ingrain"), inspect: (b) => vols(b),
});
// TV14d. Under Gravity: the gravity flag stops it at BeforeMove.
run("TV14d", "USUM: Jolteon Telekinesis into Snorlax under Gravity", {
  game: "usum", mons: [jolt(["Telekinesis"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.field.addPseudoWeather("gravity", "debug"), inspect: (b) => vols(b),
});

// TV15. Embargo (USUM) on an Air Balloon holder: Earthquake now hits it (ignoringItem in isGrounded).
run("TV15", "USUM: Jolteon Embargo into Snorlax (Air Balloon); Shuckle Earthquake", {
  game: "usum", mons: [jolt(["Embargo"]), { ...slow, ability: "Sturdy", moves: ["Earthquake"] }, lax(["Splash"], { item: "Air Balloon" }), still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// TV15b. Knock Off into an embargoed holder keeps its 1.5x (onBasePower reads getItem). Control: Splash.
for (const emb of [true, false]) run("TV15b", `USUM: Jolteon ${emb ? "Embargo" : "Splash"} into Snorlax (Leftovers, 150); Bisharp Knock Off into Snorlax`, {
  game: "usum", mons: [jolt([emb ? "Embargo" : "Splash"]), mon("Bisharp", "Inner Focus", ["Knock Off"]), lax(["Splash"], { item: "Leftovers" }), slow],
  turns: [[emb ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// TV15c. An embargoed attacker: its Life Orb gives no power and costs nothing. Control: Splash.
for (const emb of [true, false]) run("TV15c", `USUM: Jolteon ${emb ? "Embargo" : "Splash"} into Lapras (Life Orb); Lapras Body Slam into Shuckle`, {
  game: "usum", mons: [lapras(["Body Slam"], { item: "Life Orb" }), still, jolt([emb ? "Embargo" : "Splash"]), slow],
  turns: [["move 1 2, move 1", emb ? "move 1 1, move 1" : "move 1, move 1"]], inspect: (b) => hps(b),
});
// TV15d. Embargo on a Leftovers holder: no heal at the end of turn. Control: Splash.
for (const emb of [true, false]) run("TV15d", `USUM: Jolteon ${emb ? "Embargo" : "Splash"} into Snorlax (Leftovers, 150)`, {
  game: "usum", mons: [jolt([emb ? "Embargo" : "Splash"]), still, lax(["Splash"], { item: "Leftovers" }), slow],
  turns: [[emb ? "move 1 1, move 1" : "move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${hps(b)}`,
});

// ==== Heal Block, Nightmare, Octolock =====================================================================================

// TV16. Heal Block (USUM): a heal-blocked attacker's Giga Drain heals nothing; Volt Absorb takes the Electric move but heals nothing.
run("TV16", "USUM: Jolteon Heal Block; Venusaur (100) Giga Drain into Jolteon; Lapras Thunderbolt into Lanturn (Volt Absorb, 100)", {
  game: "usum", mons: [jolt(["Heal Block"]), lapras(["Thunderbolt"]), mon("Venusaur", "Chlorophyll", ["Giga Drain"]), mon("Lanturn", "Volt Absorb", ["Splash"])],
  turns: [["move 1, move 1 2", "move 1 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(100); b.p2.active[1].sethp(100); }, inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV16b. A heal-blocked target's Sitrus Berry is not eaten (TryEatItem: TryHeal); the heal-blocked ally's Recover fails at BeforeMove.
run("TV16b", "USUM: Jolteon Heal Block; Lapras Body Slam into Snorlax (Sitrus, 150); Shuckle (50) Recover", {
  game: "usum", mons: [jolt(["Heal Block"]), lapras(["Body Slam"]), lax(["Splash"], { item: "Sitrus Berry" }), { ...slow, moves: ["Recover"] }],
  turns: [["move 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(50); }, inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// TV16c. Aroma Veil (its side) blocks Heal Block; TV16d: Mental Herb cures it at the Update.
run("TV16c", "USUM: Jolteon Heal Block; Aromatisse (Aroma Veil); Snorlax (Mental Herb, 100) Recover", {
  game: "usum", mons: [jolt(["Heal Block"]), still, mon("Aromatisse", "Aroma Veil", ["Splash"]), lax(["Recover"], { item: "Mental Herb" })],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[1].sethp(100), inspect: (b) => `${vols(b)} || ${items(b)} || ${hps(b)}`,
});
run("TV16d", "USUM: Jolteon Heal Block; Snorlax (Mental Herb, 100) Recover", {
  game: "usum", mons: [jolt(["Heal Block"]), still, lax(["Recover"], { item: "Mental Herb" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(100), inspect: (b) => `${vols(b)} || ${items(b)} || ${hps(b)}`,
});

// TV17. Nightmare (USUM): fails on an awake target; on a sleeper that wakes at its later BeforeMove it ends (no damage at the
// end of turn); on Comatose Komala it acts.
run("TV17", "USUM: Jolteon Nightmare into an awake Snorlax", {
  game: "usum", mons: [jolt(["Nightmare"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
run("TV17b", "USUM: Jolteon Nightmare into a sleeping Snorlax with 1 turn left (it wakes at its move)", {
  game: "usum", mons: [jolt(["Nightmare"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => asleep(b.p2.active[0], 1), inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
run("TV17c", "USUM: Jolteon Nightmare into Komala (Comatose)", {
  game: "usum", mons: [jolt(["Nightmare"]), still, mon("Komala", "Comatose", ["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});

// TV18. Octolock: a Ghost type is immune (trapped immunity); the lock ends when its source faints before the end of turn (SwSh);
// Champions as SwSh (Clear Body stops the drops).
run("TV18", "SwSh: Jolteon Octolock into Gengar", {
  game: "swsh", mons: [jolt(["Octolock"]), still, mon("Gengar", "Cursed Body", ["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${boosts(b)}`,
});
run("TV18b", "SwSh: Jolteon (1 HP) Octolock into Snorlax; Garchomp's Earthquake then knocks Jolteon out", {
  game: "swsh", mons: [jolt(["Octolock"]), still, lax(["Splash"]), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].sethp(1), inspect: (b) => `${vols(b)} || ${boosts(b)} || ${hps(b)}`,
});
run("TV18c", "Champions: Jolteon Octolock into Metagross (Clear Body); Lapras Octolock into Snorlax", {
  game: "champions", mons: [jolt(["Octolock"]), lapras(["Octolock"]), mon("Metagross", "Clear Body", ["Splash"]), lax(["Splash"])],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${boosts(b)}`,
});

// ==== Attract, Captivate, Powder ==========================================================================================

// TV19. Attract (SV): fails on the same gender and on a genderless target.
run("TV19", "SV: Jolteon (M) Attract into Snorlax (M); Lapras (F) Attract into Magnezone (genderless)", {
  mons: [jolt(["Attract"]), lapras(["Attract"], { gender: "F" }), lax(["Splash"], { gender: "M" }), mon("Magnezone", "Sturdy", ["Splash"])],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], inspect: (b) => vols(b),
});
// TV19b. Oblivious is immune (TryHit); Destiny Knot infatuates the source back.
run("TV19b", "SV: Jolteon (M) Attract into Snorlax (F, Oblivious); Lapras (M) Attract into Chansey (F, Destiny Knot)", {
  mons: [jolt(["Attract"]), lapras(["Attract"], { gender: "M" }), lax(["Splash"], { ability: "Oblivious" }), { ...still, gender: "F", item: "Destiny Knot" }],
  turns: [["move 1 1, move 1 2", "move 1, move 1"]], inspect: (b) => vols(b),
});
// TV19c. The infatuated Pokémon's move then stops with 1/2 (BeforeMove priority 2).
run("TV19c", "SV: Jolteon (M) Attract into Snorlax (F); Snorlax Body Slam into Chansey", {
  mons: [jolt(["Attract"]), still, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV19d. The source faints before the infatuated Pokémon moves: onUpdate ends it (source not active), no 1/2.
run("TV19d", "SV: Jolteon (M, 1 HP) Attract into Snorlax (F); Garchomp Earthquake (Jolteon faints); Snorlax Body Slam into Chansey", {
  mons: [jolt(["Attract"]), still, lax(["Body Slam"]), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[0].sethp(1), inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// TV19e. Aroma Veil on the target's side blocks Attract.
run("TV19e", "SV: Jolteon (M) Attract into Snorlax (F) whose ally has Aroma Veil", {
  mons: [jolt(["Attract"]), still, lax(["Splash"]), mon("Aromatisse", "Aroma Veil", ["Splash"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => vols(b),
});
// TV19f. Champions: the same 1/2 (Champions' Attract is the base move).
run("TV19f", "Champions: Jolteon (M) Attract into Snorlax (F); Snorlax Body Slam into Lapras", {
  game: "champions", mons: [jolt(["Attract"]), lapras(["Splash"]), lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});

// TV20. Captivate (USUM): opposite-gender foes only; a genderless foe is immune.
run("TV20", "USUM: Jolteon (M) Captivate; Snorlax (F), Magnezone (genderless)", {
  game: "usum", mons: [jolt(["Captivate"]), still, lax(["Splash"]), mon("Magnezone", "Sturdy", ["Splash"])],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});

// TV21. Powder (USUM): a Fire status move fails too (Will-O-Wisp), with the quarter lost.
run("TV21", "USUM: Jolteon Powder into Arcanine; Arcanine Will-O-Wisp into Chansey", {
  game: "usum", mons: [jolt(["Powder"]), still, mon("Arcanine", "Intimidate", ["Will-O-Wisp"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// TV21b. A Grass type is immune to Powder; Magic Guard keeps the HP (the move still fails).
run("TV21b", "USUM: Jolteon Powder into Victreebel (Grass); Lapras Powder into Clefable (Magic Guard); both Flamethrower into Jolteon", {
  game: "usum", mons: [jolt(["Powder"]), lapras(["Powder"]), mon("Victreebel", "Chlorophyll", ["Flamethrower"]), mon("Clefable", "Magic Guard", ["Flamethrower"])],
  turns: [["move 1 1, move 1 2", "move 1 1, move 1 1"]], inspect: (b) => hps(b),
});

// ==== The type changes guarded today: Protean, Libero, Roost, Burn Up, Double Shock, Color Change ========================

// TV22. Protean (SV: once per switch-in): Greninja's Ice Beam makes it Ice; Arcanine's later Flamethrower is 2x. Control: Torrent.
for (const ability of ["Protean", "Torrent"]) run("TV22", `SV: Greninja (${ability}) Ice Beam into Snorlax; Arcanine Flamethrower into Greninja`, {
  mons: [mon("Greninja", ability, ["Ice Beam"]), still, mon("Arcanine", "Intimidate", ["Flamethrower"]), lax(["Splash"])],
  turns: [["move 1 2, move 1", "move 1 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV22b. Libero's Acrobatics (Flying): ungrounded, so a foe's Earthquake misses it (SwSh: every move).
run("TV22b", "SwSh: Cinderace (Libero) Acrobatics into Snorlax; Garchomp (foe) Earthquake", {
  game: "swsh", mons: [mon("Cinderace", "Libero", ["Acrobatics"]), still, lax(["Splash"]), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV23. Roost: a pure Flying type is Normal (Close Combat 2x).
run("TV23", "SV: Tornadus (100 HP) Roost; Lucario Close Combat into Tornadus", {
  mons: [mon("Tornadus", "Defiant", ["Roost"]), still, mon("Lucario", "Inner Focus", ["Close Combat"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => b.p1.active[0].sethp(100), inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV23b. Roost on a Flying/Steel type: Steel, so a slower Earthquake hits it.
run("TV23b", "SV: Corviknight (100 HP) Roost; Shuckle Earthquake", {
  mons: [mon("Corviknight", "Pressure", ["Roost"]), still, mon("Shuckle", "Sturdy", ["Earthquake"]), lax(["Splash"])],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].sethp(100), inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV24. Burn Up: pure Fire to ??? (Hydro Pump neutral).
run("TV24", "SV: Arcanine Burn Up into Snorlax; Lapras Hydro Pump into Arcanine", {
  mons: [mon("Arcanine", "Intimidate", ["Burn Up"]), still, lax(["Splash"]), { ...slow, species: "Lapras", ability: "Shell Armor", moves: ["Hydro Pump"] }],
  turns: [["move 1 1, move 1", "move 1, move 1 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV24b. Double Shock: Electric/Fighting to ???/Fighting (Earthquake neutral).
run("TV24b", "SV: Pawmot Double Shock into Snorlax; Garchomp Earthquake", {
  mons: [mon("Pawmot", "Volt Absorb", ["Double Shock"]), still, lax(["Splash"]), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// TV25. Color Change (USUM, onAfterMoveSecondary): Kecleon hit by Thunderbolt becomes Electric; Earthquake then 2x. Control: Protean.
for (const ability of ["Color Change", "Protean"]) run("TV25", `USUM: Jolteon Thunderbolt into Kecleon (${ability}); Garchomp Earthquake`, {
  game: "usum", mons: [jolt(["Thunderbolt"]), still, mon("Kecleon", ability, ["Splash"]), mon("Garchomp", "Rough Skin", ["Earthquake"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});

// ==== Types and Tera across turns (the calculator's and Training's input) ================================================

// TV26. Soak on turn 1, Terastallization on turn 2 (SV): STAB from the pre-Tera types (getTypes(false, true): Water), the Tera
// type for defence. Garchomp's Hydro Pump has STAB as a Tera Steel; Lapras's Thunderbolt into it is Steel's 1x. Control: Splash.
for (const soak of [true, false]) run("TV26", `Turn 1 Jolteon ${soak ? "Soak" : "Splash"} into Garchomp; turn 2 Garchomp (Tera Steel) Hydro Pump into Chansey, Lapras Thunderbolt into Garchomp`, {
  mons: [jolt(["Soak", "Splash"]), lapras(["Splash", "Thunderbolt"]), mon("Garchomp", "Rough Skin", ["Splash", "Hydro Pump"], { teraType: "Steel" }), slow],
  turns: [[soak ? "move 1 1, move 1" : "move 2, move 1", "move 1, move 1"], ["move 2, move 2 1", "move 2 2 terastallize, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
