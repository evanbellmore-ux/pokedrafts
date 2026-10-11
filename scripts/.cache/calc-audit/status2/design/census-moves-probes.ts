// CENSUS 1 probes (status2 design, the 73 kind-L status moves): one or more whole turns in pinned Showdown c23d2e94 for the
// moves whose effect on the rest of the turn or on the end of turn census-moves.md states, on the earlier design's exact
// harness (status-eot/design/addendum-sim.ts: every random decision enumerated, every move hits, crits only when certain,
// the lowest roll). Where the claim is a difference, the probe runs with a control (the move replaced by Splash).
// (census-probes.ts in this folder is CENSUS 2's; this file is CENSUS 1's.) Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-moves-probes.ts [K1 ...] > scripts/.cache/calc-audit/status2/design/census-moves-probes.out
import { enumerate, report, type AProbe } from "../../status-eot/design/addendum-sim";
import type { Game, Mon } from "../../status-eot/design/status-sim";

const LINES = /^\|(move|cant|-fail|-immune|-miss|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-setboost|-swapboost|-copyboost|-invertboost|-status|-curestatus|-start|-end|-singleturn|-sidestart|-sideend|-fieldstart|-fieldend|-fieldactivate|-ability|-endability|-transform|-clearallboost|-swapsideconditions|-prepare|-crit|-supereffective|-resisted|-block|-weather)\|/;
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] }; // Speed 70
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] }; // Speed 25
const jolt = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Jolteon", ability: "Volt Absorb", moves, gender: "M", ...over }); // Speed 150
const lapras = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Lapras", ability: "Shell Armor", moves, ...over }); // Speed 80
const lax = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, gender: "F", ...over }); // Speed 50
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: LINES, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const all = (b: any) => [...b.p1.active, ...b.p2.active];
const hps = (b: any) => all(b).map((p: any) => `${p.name} ${p.hp}${p.status ? ` ${p.status}` : ""}`).join(", ");
const order = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|move|")).map((l) => l.split("|")[2].split(": ")[1]).join(" > ");
const types = (b: any) => all(b).map((p: any) => `${p.name}:${p.getTypes().join("/")}`).join(" ");
const abilities = (b: any) => all(b).map((p: any) => `${p.name}:${p.ability}`).join(" ");
const stages = (p: any) => Object.entries(p.boosts).filter(([, v]) => v).map(([k, v]) => `${k}${(v as number) > 0 ? "+" : ""}${v}`).join(" ") || "0";
const boosts = (b: any) => all(b).map((p: any) => `${p.name}[${stages(p)}]`).join(" ");
const items = (b: any) => all(b).map((p: any) => `${p.name}:${p.item || "-"}`).join(" ");
const vols = (b: any) => all(b).map((p: any) => `${p.name}{${Object.keys(p.volatiles).join(",")}}`).join(" ");
const stored = (p: any) => `${p.name} ${JSON.stringify(p.storedStats)}`;
const run = (id: string, title: string, probe: Partial<AProbe>) => { if (want(id)) report(`${id} ${probe.game ?? "sv"}: ${title}`, enumerate(base(probe))); };

// ---- Type changes -----------------------------------------------------------------------------------------------------
// K1. Soak (data/moves.ts:17187): Garchomp becomes Water: Lapras's Thunderbolt now hits it (2x), and the sand chips it at the end of turn.
for (const soak of [true, false]) run("K1", `Jolteon ${soak ? "Soak" : "Splash"} into Garchomp; Lapras Thunderbolt into Garchomp; sandstorm`, {
  mons: [jolt([soak ? "Soak" : "Splash"]), lapras(["Thunderbolt"]), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, slow],
  turns: [[soak ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.field.setWeather("sandstorm", "debug"), inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// K2. Forest's Curse (data/moves.ts:6126, addType): a third type counts in the effectiveness (sim/pokemon.ts:2138 getTypes).
for (const curse of [true, false]) run("K2", `Jolteon ${curse ? "Forest's Curse" : "Splash"} into Gyarados; Lapras Ice Beam into Gyarados`, {
  mons: [jolt([curse ? "Forest's Curse" : "Splash"]), lapras(["Ice Beam"]), { species: "Gyarados", ability: "Moxie", moves: ["Splash"] }, slow],
  turns: [[curse ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// K2b. Champions: Trick-or-Treat on Snorlax: Lucario's Close Combat is then immune.
run("K2b", "Jolteon Trick-or-Treat into Snorlax; Lucario Close Combat into Snorlax", {
  game: "champions", mons: [jolt(["Trick-or-Treat"]), { species: "Lucario", ability: "Inner Focus", moves: ["Close Combat"] }, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// K3. Reflect Type (data/moves.ts:14884): Jolteon becomes Dragon/Ground; Snorlax's Thunderbolt into it is then immune.
run("K3", "Jolteon Reflect Type on Garchomp; Snorlax Thunderbolt into Jolteon", {
  mons: [jolt(["Reflect Type"], { ability: "Static" }), still, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(["Thunderbolt"])],
  turns: [["move 1 1, move 1", "move 1, move 1 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
// K3b. Soak into a Terastallized target fails (sim/pokemon.ts:2119 setType).
run("K3b", "Garchomp Terastallizes (Steel); Jolteon Soak into Garchomp", {
  mons: [jolt(["Soak"]), still, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"], teraType: "Steel" }, slow],
  turns: [["move 1 1, move 1", "move 1 terastallize, move 1"]], inspect: (b) => types(b),
});
// K4. Conversion 2 (data/moves.ts:2814): Snorlax used Body Slam this turn; Shuckle (Bug/Rock) takes a random type that resists Normal: Steel or Ghost (sample, 1/2 each).
run("K4", "Snorlax Body Slam into Chansey; Shuckle Conversion 2 on Snorlax", {
  mons: [{ ...slow, moves: ["Conversion 2"] }, still, lax(["Body Slam"]), lapras(["Splash"])],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => types(b),
});

// ---- Ability changes --------------------------------------------------------------------------------------------------
// K5. Skill Swap (sim/battle.ts:1311): Bronzong's Levitate goes to Snorlax; Shuckle's Earthquake then hits Bronzong and misses Snorlax.
run("K5", "Bronzong (Levitate) Skill Swap with Snorlax; Shuckle Earthquake", {
  mons: [{ species: "Bronzong", ability: "Levitate", moves: ["Skill Swap"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Earthquake"] }, lax(["Splash"]), still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${hps(b)}`,
});
// K6. Entrainment (data/moves.ts:4860): Snorlax gets Intimidate; its Start lowers Gyarados's and Chansey's Attack.
run("K6", "Gyarados (Intimidate) Entrainment into Snorlax", {
  mons: [{ species: "Gyarados", ability: "Intimidate", moves: ["Entrainment"] }, still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// K7. Gastro Acid (data/moves.ts:6427) on a Levitate Bronzong: Shuckle's Earthquake then hits it.
run("K7", "Jolteon Gastro Acid into Bronzong; Shuckle Earthquake", {
  mons: [jolt(["Gastro Acid"]), { species: "Shuckle", ability: "Gluttony", moves: ["Earthquake"] }, { species: "Bronzong", ability: "Levitate", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// K8. Simple Beam then the target's own Swords Dance: +4.
run("K8", "Jolteon Simple Beam into Snorlax; Snorlax Swords Dance", {
  mons: [jolt(["Simple Beam"]), still, lax(["Swords Dance"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// K9. Doodle (data/moves.ts:3814, SV): Jolteon and Lapras both get Intimidate; each Start lowers the foes' Attack (−2 in all).
run("K9", "Jolteon Doodle on Gyarados (Intimidate)", {
  mons: [jolt(["Doodle"]), lapras(["Splash"]), { species: "Gyarados", ability: "Intimidate", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// K9b. Role Play copying Speed Boost: the end of turn reads the new ability.
run("K9b", "Jolteon Role Play on Yanmega (Speed Boost)", {
  mons: [jolt(["Role Play"]), still, { species: "Yanmega", ability: "Speed Boost", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// K9c. Worry Seed's Insomnia: a later Spore fails (a sleeping target is cured: status-eot Q2b).
run("K9c", "Jolteon Worry Seed into Snorlax; Breloom Spore into Snorlax", {
  mons: [jolt(["Worry Seed"]), { species: "Breloom", ability: "Poison Heal", moves: ["Spore"] }, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${abilities(b)} || ${hps(b)}`,
});

// ---- Stored stats -----------------------------------------------------------------------------------------------------
// K10. Speed Swap (data/moves.ts:17431): Shuckle gets 150 Speed; generation 8+ re-sorts the queue after the action, generation 7 does not.
for (const game of ["sv", "usum"] as Game[]) run("K10", "Jolteon Speed Swap with Shuckle; Lapras (80), Snorlax (50), Shuckle act after", {
  game, mons: [jolt(["Speed Swap"]), lapras(["Splash"]), lax(["Splash"]), slow],
  turns: [["move 1 2, move 1", "move 1, move 1"]], inspect: (b) => `${order(b)} || ${stored(b.p2.active[1])}`,
});
// K11. Power Trick (data/moves.ts:13812): a level-100 Shuckle swaps Attack and Defense; Snorlax's Body Slam into it.
for (const trick of [true, false]) run("K11", `Shuckle ${trick ? "Power Trick" : "Splash"}; Snorlax Body Slam into Shuckle`, {
  mons: [{ species: "Shuckle", ability: "Sturdy", moves: [trick ? "Power Trick" : "Splash"], level: 100, nature: "Jolly", evs: { spe: 252 } }, still, lax(["Body Slam"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} || ${hps(b)}`,
});
// K12. Guard Split and Power Split (data/moves.ts:7950, 13760): averaged stored stats; the later hits read them.
run("K12", "Jolteon Guard Split on Shuckle; Lapras Body Slam into Shuckle", {
  mons: [jolt(["Guard Split"]), lapras(["Body Slam"]), { species: "Shuckle", ability: "Sturdy", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} | ${stored(b.p2.active[0])} || ${hps(b)}`,
});
run("K12b", "Jolteon Power Split on Snorlax; Snorlax Body Slam into Chansey", {
  mons: [jolt(["Power Split"]), still, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} | ${stored(b.p2.active[0])} || ${hps(b)}`,
});
// K13. Transform (sim/pokemon.ts:1270): Ditto copies Snorlax (stats but HP, types, ability, stages); Snorlax's Body Slam into it.
run("K13", "Ditto Transform into Snorlax (+2 Def); Snorlax Body Slam into Ditto", {
  mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"] }, still, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.def = 2; },
  inspect: (b) => `${stored(b.p1.active[0])} ${b.p1.active[0].species.name} ${b.p1.active[0].ability} ${b.p1.active[0].maxhp} [${stages(b.p1.active[0])}] || ${hps(b)}`,
});

// ---- Stage moves ------------------------------------------------------------------------------------------------------
// K14. Topsy-Turvy: a direct write, no boost event (no Defiant, no Eject Pack).
run("K14", "Jolteon Topsy-Turvy on Kingambit (Defiant, +2 Atk, Eject Pack)", {
  mons: [jolt(["Topsy-Turvy"]), lapras(["Splash"]), { species: "Kingambit", ability: "Defiant", item: "Eject Pack", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = 2; }, inspect: (b) => `${boosts(b)} || ${items(b)}`,
});
// K15. Minimize (data/moves.ts:11918): Snorlax's Body Slam into Jolteon doubles.
for (const mini of [true, false]) run("K15", `Jolteon ${mini ? "Minimize" : "Splash"}; Snorlax Body Slam into Jolteon`, {
  mons: [jolt([mini ? "Minimize" : "Splash"]), still, lax(["Body Slam"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => hps(b),
});
// K16. Tar Shot (data/moves.ts:18946): Arcanine's Flamethrower into Snorlax doubles; Speed −1.
for (const tar of [true, false]) run("K16", `Jolteon ${tar ? "Tar Shot" : "Splash"} into Snorlax; Arcanine Flamethrower into Snorlax`, {
  mons: [jolt([tar ? "Tar Shot" : "Splash"]), { species: "Arcanine", ability: "Intimidate", moves: ["Flamethrower"] }, lax(["Splash"]), slow],
  turns: [[tar ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${boosts(b)} || ${hps(b)}`,
});
// K17. Octolock (SwSh): Defense and Sp. Def −1 at the end of turn (order 14).
run("K17", "Jolteon Octolock into Bisharp (Defiant)", {
  game: "swsh", mons: [jolt(["Octolock"]), still, { species: "Bisharp", ability: "Defiant", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${boosts(b)} || ${vols(b)}`,
});
// K18. Autotomize (SwSh): a level-100 Ferrothorn 110 kg -> 10 kg; Conkeldurr's Low Kick into it (100 -> 40 power).
for (const auto of [true, false]) run("K18", `Ferrothorn (level 100) ${auto ? "Autotomize" : "Splash"}; Conkeldurr Low Kick into Ferrothorn`, {
  game: "swsh", mons: [{ species: "Conkeldurr", ability: "Guts", moves: ["Low Kick"] }, still,
    { species: "Ferrothorn", ability: "Iron Barbs", moves: [auto ? "Autotomize" : "Splash"], level: 100, nature: "Jolly", evs: { spe: 252 } }, lax(["Splash"])],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${b.p2.active[0].weighthg} hg || ${hps(b)}`,
});
// K19. Acupressure on a Substitute ally (no bypasssub: blocked).
run("K19", "Jolteon Acupressure on its ally Snorlax behind a Substitute", {
  mons: [jolt(["Acupressure"]), lax(["Splash"]), still, slow],
  turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[1].addVolatile("substitute"), inspect: (b) => boosts(b),
});
// K20. Captivate (USUM): Sp. Atk −2 on opposite-gender foes; Oblivious immune.
run("K20", "Jolteon (M) Captivate; Snorlax (F), Jynx (F, Oblivious)", {
  game: "usum", mons: [jolt(["Captivate"]), still, lax(["Splash"]), { species: "Jynx", ability: "Oblivious", moves: ["Splash"], gender: "F" }],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// K21. Geomancy with and without Power Herb (SwSh).
for (const herb of [true, false]) run("K21", `Jolteon Geomancy ${herb ? "with" : "without"} Power Herb`, {
  game: "swsh", mons: [jolt(["Geomancy"], herb ? { item: "Power Herb" } : {}), still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${boosts(b)} || ${vols(b)} || ${items(b)}`,
});
// K22. Flower Shield (SwSh): every Grass type in play, a foe's too.
run("K22", "Jolteon Flower Shield; Venusaur (ally) and Ferrothorn (foe)", {
  game: "swsh", mons: [jolt(["Flower Shield"]), { species: "Venusaur", ability: "Overgrow", moves: ["Splash"] }, { species: "Ferrothorn", ability: "Iron Barbs", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// K23. Rototiller (USUM): grounded Grass types; a Flying Grass type is immune.
run("K23", "Jolteon Rototiller; Venusaur (ally), Tropius (foe, Flying)", {
  game: "usum", mons: [jolt(["Rototiller"]), { species: "Venusaur", ability: "Overgrow", moves: ["Splash"] }, { species: "Tropius", ability: "Harvest", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// K24. Tidy Up (SV): removes every Substitute (Snorlax's from before the turn); Lapras's Body Slam then hits Snorlax.
run("K24", "Jolteon Tidy Up; Lapras Body Slam into Snorlax (Substitute)", {
  mons: [jolt(["Tidy Up"]), lapras(["Body Slam"]), lax(["Splash"]), slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].addVolatile("substitute"), inspect: (b) => `${vols(b)} || ${boosts(b)} || ${hps(b)}`,
});

// ---- Items ------------------------------------------------------------------------------------------------------------
// K25. Magic Room started mid-turn (data/moves.ts:10755): Lapras's Life Orb, Snorlax's Sitrus and Chansey's Leftovers stop working.
for (const room of [true, false]) run("K25", `Jolteon ${room ? "Magic Room" : "Splash"}; Lapras (Life Orb) Body Slam into Snorlax (Sitrus, 150); Chansey Leftovers at 200`, {
  mons: [jolt([room ? "Magic Room" : "Splash"]), lapras(["Body Slam"], { item: "Life Orb" }), lax(["Splash"], { item: "Sitrus Berry" }), { ...still, item: "Leftovers" }],
  turns: [["move 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(200); }, inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// K26. Embargo (USUM) on a Sitrus holder: no Sitrus after Lapras's hit.
run("K26", "Jolteon Embargo into Snorlax (Sitrus, 150); Lapras Body Slam into Snorlax", {
  game: "usum", mons: [jolt(["Embargo"]), lapras(["Body Slam"]), lax(["Splash"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(150), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// K27. Corrosive Gas (SwSh, allAdjacent): every adjacent Pokémon's item, its ally's too; Lapras's later hit has no Life Orb.
run("K27", "Jolteon Corrosive Gas; Lapras (Life Orb) Body Slam into Snorlax (Leftovers)", {
  game: "swsh", mons: [jolt(["Corrosive Gas"]), lapras(["Body Slam"], { item: "Life Orb" }), lax(["Splash"], { item: "Leftovers" }), { ...slow, item: "Sitrus Berry" }],
  turns: [["move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// K28. Recycle (data/moves.ts:14822): Snorlax eats its Sitrus after Jolteon's hit, then Recycles it and eats it again at the Update.
run("K28", "Jolteon Thunderbolt into Snorlax (Sitrus, 100); Snorlax Recycle", {
  mons: [jolt(["Thunderbolt"]), still, lax(["Recycle"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(100), inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// K29. Stuff Cheeks (data/moves.ts:18253): Def +2, then the Sitrus is eaten at any HP.
run("K29", "Snorlax (Sitrus, 200) Stuff Cheeks", {
  mons: [jolt(["Splash"]), still, lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.active[0].sethp(200), inspect: (b) => `${items(b)} || ${boosts(b)} || ${hps(b)}`,
});
// K30. Teatime (data/moves.ts:19036): every Pokémon with a Berry eats it; Good as Gold refuses it (TryHit).
run("K30", "Jolteon Teatime; Snorlax (Sitrus, 150), Gholdengo (Sitrus, Good as Gold, 100), Lapras (Lum, paralysed)", {
  mons: [jolt(["Teatime"]), lapras(["Splash"], { item: "Lum Berry" }), lax(["Splash"], { item: "Sitrus Berry" }), { species: "Gholdengo", ability: "Good as Gold", item: "Sitrus Berry", moves: ["Splash"] }],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[1].sethp(100); b.p1.active[1].setStatus("par", null, null, true); },
  inspect: (b) => `${items(b)} || ${hps(b)}`,
});
// K31. Swallow after a Stockpile (turn 1): heals modify(maxhp, 0.25) and the Stockpile's Def/Sp. Def +1 go (stockpile onEnd boost).
run("K31", "Snorlax (100) Stockpile, then Swallow", {
  mons: [jolt(["Splash"]), still, lax(["Stockpile", "Swallow"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 2, move 1"]], setup: (b) => b.p2.active[0].sethp(100),
  inspect: (b) => `${boosts(b)} || ${hps(b)} || ${vols(b)}`,
});

// ---- Volatiles that change later moves --------------------------------------------------------------------------------
// K32. Electrify (data/moves.ts:4557) on a Pokémon still to move: its Body Slam is Electric (Garchomp immune); on one that moved: fails.
run("K32", "Jolteon Electrify into Snorlax; Snorlax Body Slam into Garchomp", {
  game: "champions", mons: [jolt(["Electrify"]), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
run("K32b", "Snorlax Electrify into Jolteon after Jolteon moved", {
  game: "champions", mons: [lax(["Electrify"]), still, jolt(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => vols(b),
});
// K33. Ion Deluge (USUM, priority +1): Normal moves are Electric this turn.
run("K33", "Shuckle Ion Deluge; Snorlax Body Slam into Garchomp", {
  game: "usum", mons: [{ species: "Shuckle", ability: "Gluttony", moves: ["Ion Deluge"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(["Body Slam"]), still],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// K34. Powder (USUM): Arcanine's Flare Blitz fails and Arcanine loses round(maxhp / 4).
run("K34", "Jolteon Powder into Arcanine; Arcanine Flare Blitz into Chansey", {
  game: "usum", mons: [jolt(["Powder"]), still, { species: "Arcanine", ability: "Intimidate", moves: ["Flare Blitz"] }, slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// K35. Heal Block (USUM, allAdjacentFoes): Snorlax's Recover fails at BeforeMove; Chansey's Leftovers heals nothing.
run("K35", "Jolteon Heal Block; Snorlax (100) Recover; Chansey (200, Leftovers)", {
  game: "usum", mons: [jolt(["Heal Block"]), slow, lax(["Recover"]), { ...still, item: "Leftovers" }],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(100); b.p2.active[1].sethp(200); }, inspect: (b) => hps(b),
});
// K36. Nightmare (USUM): a sleeping Snorlax loses a quarter at order 11 (it ends when the sleep ends: sim/pokemon.ts:1677).
run("K36", "Jolteon Nightmare into a sleeping Snorlax (3 turns left)", {
  game: "usum", mons: [jolt(["Nightmare"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { const p = b.p2.active[0]; p.setStatus("slp", null, null, true); p.statusState.time = 3; p.statusState.startTime = 3; },
  inspect: (b) => hps(b),
});
// K37. Telekinesis (USUM): Shuckle's Earthquake misses Snorlax (Ground immunity).
run("K37", "Jolteon Telekinesis into Snorlax; Shuckle Earthquake", {
  game: "usum", mons: [jolt(["Telekinesis"]), { species: "Shuckle", ability: "Gluttony", moves: ["Earthquake"] }, lax(["Splash"]), still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// K38. Foresight and Miracle Eye (USUM): Normal hits a Ghost, Psychic hits a Dark type.
run("K38", "Jolteon Foresight into Gengar; Lapras Body Slam into Gengar", {
  game: "usum", mons: [jolt(["Foresight"]), lapras(["Body Slam"]), { species: "Gengar", ability: "Cursed Body", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
run("K38b", "Jolteon Miracle Eye into Umbreon; Espeon Psychic into Umbreon", {
  game: "usum", mons: [jolt(["Miracle Eye"]), { species: "Espeon", ability: "Synchronize", moves: ["Psychic"] }, { species: "Umbreon", ability: "Synchronize", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// K39. Mud Sport (USUM): Electric moves at 1352/4096 power for five turns.
for (const sport of [true, false]) run("K39", `Jolteon ${sport ? "Mud Sport" : "Splash"}; Snorlax Thunderbolt into Lapras`, {
  game: "usum", mons: [jolt([sport ? "Mud Sport" : "Splash"]), lapras(["Splash"]), lax(["Thunderbolt"]), slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// K40. Attract with Mental Herb: cured at the Update, before the infatuated Pokémon moves.
run("K40", "Jolteon (M) Attract into Snorlax (F, Mental Herb); Snorlax Body Slam into Chansey", {
  mons: [jolt(["Attract"]), still, lax(["Body Slam"], { item: "Mental Herb" }), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// K41. Psycho Shift (USUM): Jolteon's burn goes to Snorlax; Snorlax's Body Slam is then halved and the burn hits it at the end of turn.
run("K41", "Jolteon (burned) Psycho Shift into Snorlax; Snorlax Body Slam into Chansey", {
  game: "usum", mons: [jolt(["Psycho Shift"]), still, lax(["Body Slam"]), slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], setup: (b) => b.p1.active[0].setStatus("brn", null, null, true), inspect: (b) => hps(b),
});
// K42. Heal Bell: the ally's sleep is cured before it moves; in USUM (data/mods/gen7/moves.ts:303) a Soundproof user is not cured.
for (const game of ["sv", "usum"] as Game[]) run("K42", "Exploud (Soundproof, poisoned) Heal Bell; Snorlax (asleep) Body Slam into Chansey", {
  game, mons: [{ species: "Exploud", ability: "Soundproof", moves: ["Heal Bell"] }, lax(["Body Slam"]), still, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[0].setStatus("psn", null, null, true); const p = b.p1.active[1]; p.setStatus("slp", null, null, true); p.statusState.time = 3; p.statusState.startTime = 3; },
  inspect: (b) => hps(b),
});
// K43. Aromatherapy (SwSh) cures the bench too.
run("K43", "Jolteon Aromatherapy; the bench Snorlax is poisoned", {
  game: "swsh", mons: [jolt(["Aromatherapy"]), still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.pokemon[2].setStatus("psn", null, null, true),
  inspect: (b) => b.p1.pokemon.map((p: any) => `${p.name}:${p.status || "-"}`).join(" "),
});
// K44. Purify (SwSh): the target's poison cured, the user heals ceil(maxhp / 2).
run("K44", "Jolteon (50 HP) Purify into a poisoned Snorlax", {
  game: "swsh", mons: [jolt(["Purify"]), still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(50); b.p2.active[0].setStatus("psn", null, null, true); }, inspect: (b) => hps(b),
});

// ---- Side and field ---------------------------------------------------------------------------------------------------
// K45. Defog (data/moves.ts:3448; gen 7 data/mods/gen7/moves.ts:125 keeps the terrain): Reflect off the target's side, evasion −1, terrain cleared from gen 8.
for (const game of ["sv", "usum"] as Game[]) run("K45", "Jolteon Defog into Snorlax (Reflect, Electric Terrain); Lapras Body Slam into Snorlax", {
  game, mons: [jolt(["Defog"]), lapras(["Body Slam"]), lax(["Splash"]), slow],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.addSideCondition("reflect", "debug"); b.field.setTerrain("electricterrain", "debug"); },
  inspect: (b) => `terrain ${b.field.terrain || "-"} p2 ${Object.keys(b.p2.sideConditions).join(",") || "-"} || ${boosts(b)} || ${hps(b)}`,
});
// K46. Court Change (SwSh): the opponent's Tailwind moves to Jolteon's side; generation 8 re-sorts the later actions.
run("K46", "Jolteon Court Change with Tailwind on the opponent's side; Lapras (80), Snorlax (50), Chansey (70)", {
  game: "swsh", mons: [jolt(["Court Change"]), lapras(["Splash"]), lax(["Splash"]), still],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.p2.addSideCondition("tailwind", "debug"),
  inspect: (b) => `${order(b)} || p1 ${Object.keys(b.p1.sideConditions).join(",")} p2 ${Object.keys(b.p2.sideConditions).join(",") || "-"}`,
});
// K47. Crafty Shield (SwSh): Snorlax's Thunder Wave into Lapras and Lapras's own Aromatic Mist into Jolteon are blocked.
run("K47", "Jolteon Crafty Shield; Snorlax Thunder Wave into Lapras; Lapras Aromatic Mist into Jolteon", {
  game: "swsh", mons: [jolt(["Crafty Shield"]), lapras(["Aromatic Mist"]), lax(["Thunder Wave"]), slow],
  turns: [["move 1, move 1 -1", "move 1 2, move 1"]], inspect: (b) => `${hps(b)} || ${boosts(b)}`,
});
// K48. Mat Block (SwSh, first turn): Snorlax's Body Slam into Lapras is blocked, Chansey's Thunder Wave is not.
run("K48", "Jolteon Mat Block; Snorlax Body Slam into Lapras; Chansey Thunder Wave into Lapras", {
  game: "swsh", mons: [jolt(["Mat Block"]), lapras(["Splash"]), lax(["Body Slam"]), { ...still, moves: ["Thunder Wave"] }],
  turns: [["move 1, move 1", "move 1 2, move 1 2"]], inspect: (b) => hps(b),
});
// K49. Magic Coat (SwSh): Snorlax's Thunder Wave into Jolteon comes back.
run("K49", "Jolteon Magic Coat; Snorlax Thunder Wave into Jolteon", {
  game: "swsh", mons: [jolt(["Magic Coat"]), still, lax(["Thunder Wave"]), slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]], inspect: (b) => hps(b),
});
// K50. Snatch (USUM, priority +4): Snorlax's Swords Dance is Jolteon's instead.
run("K50", "Jolteon Snatch; Snorlax Swords Dance", {
  game: "usum", mons: [jolt(["Snatch"]), still, lax(["Swords Dance"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// K51. Mist (SV): Snorlax's Snarl lowers no Sp. Atk on Jolteon's side.
run("K51", "Jolteon Mist; Snorlax Snarl", {
  mons: [jolt(["Mist"]), lapras(["Splash"]), lax(["Snarl"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => boosts(b),
});
// K52. Lucky Chant (USUM): Snorlax's Frost Breath into Garchomp is no critical hit.
for (const chant of [true, false]) run("K52", `Jolteon ${chant ? "Lucky Chant" : "Splash"}; Snorlax Frost Breath into Garchomp`, {
  game: "usum", mons: [jolt([chant ? "Lucky Chant" : "Splash"]), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(["Frost Breath"]), slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]], inspect: (b) => hps(b),
});
// K53. Wonder Room started mid-turn: Lapras's Body Slam into Chansey reads Chansey's Sp. Def.
for (const room of [true, false]) run("K53", `Jolteon ${room ? "Wonder Room" : "Splash"}; Lapras Body Slam into Chansey`, {
  mons: [jolt([room ? "Wonder Room" : "Splash"]), lapras(["Body Slam"]), still, slow],
  turns: [["move 1, move 1 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// K54. Camouflage (USUM) on Electric Terrain: Electric type.
run("K54", "Kecleon Camouflage on Electric Terrain", {
  game: "usum", mons: [{ species: "Kecleon", ability: "Color Change", moves: ["Camouflage"] }, still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => b.field.setTerrain("electricterrain", "debug"), inspect: (b) => types(b),
});
// K55. Electrify on a Pixilate Sylveon: Pixilate (ModifyType −1) makes Hyper Voice Fairy and marks it, Electrify (−2) makes it
// Electric; whether Pixilate's 4915/4096 still applies shows against the same Sylveon with Cute Charm.
for (const ability of ["Pixilate", "Cute Charm"]) run("K55", `Jolteon Electrify into Sylveon (${ability}); Sylveon Hyper Voice`, {
  mons: [jolt(["Electrify"], { ability: "Static" }), { species: "Gyarados", ability: "Moxie", moves: ["Splash"] }, { species: "Sylveon", ability, moves: ["Hyper Voice"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// K56. Ion Deluge with Pixilate (USUM): Hyper Voice stays Fairy (Pixilate's ModifyType runs first).
run("K56", "Shuckle Ion Deluge; Sylveon (Pixilate) Hyper Voice", {
  game: "usum", mons: [{ species: "Shuckle", ability: "Gluttony", moves: ["Ion Deluge"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Sylveon", ability: "Pixilate", moves: ["Hyper Voice"] }, still],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => hps(b),
});
// K57. Psycho Shift whose status fails on the target (a burn into a Fire type): is the user still cured (self.onHit)?
run("K57", "Jolteon (burned) Psycho Shift into Arcanine (Fire)", {
  game: "usum", mons: [jolt(["Psycho Shift"]), still, { species: "Arcanine", ability: "Intimidate", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => b.p1.active[0].setStatus("brn", null, null, true), inspect: (b) => hps(b),
});
