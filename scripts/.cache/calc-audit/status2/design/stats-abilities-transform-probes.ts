// FAMILY 1 design probes (status2: stats, abilities, Transform): whole turns in pinned Showdown c23d2e94 on the earlier
// design's exact harness (status-eot/design/addendum-sim.ts: every random decision enumerated by decision-prefix replay,
// every move hits, crits only when certain, the lowest roll unless `rolls` says otherwise). Each probe settles a point the
// design (stats-abilities-transform.md) rests on and that CENSUS 1's K probes (census-moves-probes.out) do not already
// show; controls run beside the claim where it is a difference. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/stats-abilities-transform-probes.ts [SA01 ...] > scripts/.cache/calc-audit/status2/design/stats-abilities-transform-probes.out
import { enumerate, report, type AProbe } from "../../status-eot/design/addendum-sim";
import type { Game, Mon } from "../../status-eot/design/status-sim";

const LINES = /^\|(move|cant|-fail|-immune|-miss|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-setboost|-swapboost|-copyboost|-invertboost|-clearnegativeboost|-status|-curestatus|-start|-end|-ability|-endability|-transform|-prepare|-singleturn|-crit|-supereffective|-resisted|-block|-weather|-fieldstart|-fieldend)\|/;
// Level 50, 31 IVs, 0 EVs, Serious: Speed = base + 20.
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] }; // 70
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] }; // 25
const blis: Mon = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] }; // 75
const jolt = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Jolteon", ability: "Volt Absorb", moves, gender: "M", ...over }); // 150
const lapras = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Lapras", ability: "Shell Armor", moves, ...over }); // 80
const lax = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, gender: "F", ...over }); // 50
const gyara = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Gyarados", ability: "Intimidate", moves, ...over }); // 101
const gambit = (moves: string[], over: Partial<Mon> = {}): Mon => ({ species: "Kingambit", ability: "Defiant", moves, ...over }); // 70
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: LINES, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const all = (b: any) => [...b.p1.active, ...b.p2.active];
const hps = (b: any) => all(b).map((p: any) => `${p.name} ${p.hp}${p.status ? ` ${p.status}` : ""}`).join(", ");
const order = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|move|")).map((l) => l.split("|")[2].split(": ")[1]).join(" > ");
const abilities = (b: any) => all(b).map((p: any) => `${p.name}:${p.ability}`).join(" ");
const stages = (p: any) => Object.entries(p.boosts).filter(([, v]) => v).map(([k, v]) => `${k}${(v as number) > 0 ? "+" : ""}${v}`).join(" ") || "0";
const boosts = (b: any) => all(b).map((p: any) => `${p.name}[${stages(p)}]`).join(" ");
const items = (b: any) => all(b).map((p: any) => `${p.name}:${p.item || "-"}`).join(" ");
const vols = (b: any) => all(b).map((p: any) => `${p.name}{${Object.keys(p.volatiles).join(",")}}`).join(" ");
const stored = (p: any) => `${p.name} ${JSON.stringify(p.storedStats)}`;
const types = (b: any) => all(b).map((p: any) => `${p.name}:${p.getTypes().join("/")}`).join(" ");
const layers = (p: any) => (p.volatiles.stockpile ? `stockpile ${p.volatiles.stockpile.layers} (def ${p.volatiles.stockpile.def}, spd ${p.volatiles.stockpile.spd})` : "no stockpile");
/** Stages back to 0 after the leads' entry abilities (Intimidate, Download), so a probe starts clean. */
const clear = (b: any) => { for (const p of all(b)) for (const k of Object.keys(p.boosts)) p.boosts[k] = 0; };
const run = (id: string, title: string, probe: Partial<AProbe>) => {
  if (!want(id)) return;
  try { report(`${id} ${probe.game ?? "sv"}: ${title}`, enumerate(base(probe))); }
  catch (error) { console.log(`\n### ${id} ${probe.game ?? "sv"}: ${title}\n  ERROR ${error instanceof Error ? error.message : String(error)}`); }
};

// ---- Stat stages ------------------------------------------------------------------------------------------------------
// SA01. Acupressure on the ally (PS/data/moves.ts:146-162): sample over the 7 stages below +6, 1/7 each; the Speed pick
// re-sorts the rest of the turn from generation 8 (PS/sim/battle.ts:2919-2926) and not in generation 7.
for (const game of ["sv", "usum"] as Game[]) run("SA01", "Jolteon Acupressure on its ally Shuckle (Jolly 252 Spe, 62); Lapras (80), Chansey (70)", {
  game, mons: [jolt(["Acupressure"]), { ...slow, nature: "Jolly", evs: { spe: 252 } }, lapras(["Splash"]), still],
  turns: [["move 1 -2, move 1", "move 1, move 1"]], inspect: (b) => `${order(b)} || Shuckle[${stages(b.p1.active[1])}]`,
});
// SA02. Acupressure's +2 read by a later Stored Power of the ally: accuracy and evasion count (PS/sim/pokemon.ts positiveBoosts).
run("SA02", "Jolteon Acupressure on its ally Espeon; Espeon Stored Power into Snorlax", {
  mons: [jolt(["Acupressure"]), { species: "Espeon", ability: "Synchronize", moves: ["Stored Power"] }, lax(["Splash"]), still],
  turns: [["move 1 -2, move 1 1", "move 1, move 1"]], inspect: (b) => `Espeon[${stages(b.p1.active[1])}] || ${hps(b)}`,
});
// SA02b. Acupressure picks among the stages below +6 before Contrary inverts the +2 (a Contrary Shuckle at +6 Attack: 6 picks, −2 each).
run("SA02b", "Shuckle (Contrary, +6 Atk) Acupressure on itself", {
  mons: [{ ...slow, ability: "Contrary", moves: ["Acupressure"] }, still, lax(["Splash"]), blis],
  turns: [["move 1 -1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.atk = 6; }, inspect: (b) => `Shuckle[${stages(b.p1.active[0])}]`,
});
// SA03. Psych Up (PS/data/moves.ts:14221-14239): no protect flag (passes Protect), a direct copy of every stage and the
// crit volatiles, no boost event (no Opportunist copy); White Herb restores the copied drop at the move's AfterMove.
run("SA03", "Jolteon (White Herb) Psych Up on Kingambit (Protect; +2 Atk, −2 Def, +1 evasion, Focus Energy); Espathra (Opportunist, foe of Jolteon)", {
  mons: [jolt(["Psych Up"], { item: "White Herb" }), lapras(["Splash"]), gambit(["Protect"]), { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { const k = b.p2.active[0]; k.boosts.atk = 2; k.boosts.def = -2; k.boosts.evasion = 1; k.addVolatile("focusenergy"); },
  inspect: (b) => `${boosts(b)} || ${items(b)} || ${vols(b)}`,
});
// SA03b. Psych Up into a Substitute (bypasssub).
run("SA03b", "Jolteon Psych Up on Kingambit behind a Substitute (+2 Atk)", {
  mons: [jolt(["Psych Up"]), lapras(["Splash"]), gambit(["Splash"]), blis],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = 2; b.p2.active[0].addVolatile("substitute"); },
  inspect: (b) => `${boosts(b)} || ${vols(b)}`,
});
// SA04. Heart Swap (SV/USUM, protect + bypasssub): blocked by Protect.
run("SA04", "Jolteon Heart Swap on Kingambit (Protect, +2 Atk)", {
  mons: [jolt(["Heart Swap"]), lapras(["Splash"]), gambit(["Protect"]), blis],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = 2; }, inspect: (b) => boosts(b),
});
// SA04b. Heart Swap: a direct swap of all seven stages; White Herb restores the user's received drop; no Opportunist copy of the received rise.
run("SA04b", "Jolteon (White Herb) Heart Swap on Kingambit (−2 Atk, +2 SpA, +1 accuracy); Espathra (Opportunist, foe of Jolteon)", {
  mons: [jolt(["Heart Swap"], { item: "White Herb" }), lapras(["Splash"]), gambit(["Splash"]), { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { const k = b.p2.active[0]; k.boosts.atk = -2; k.boosts.spa = 2; k.boosts.accuracy = 1; },
  inspect: (b) => `${boosts(b)} || ${items(b)}`,
});
// SA04c. Heart Swap gives the user a drop: no Eject Pack (onAfterBoost only runs from boost()).
run("SA04c", "Jolteon (Eject Pack) Heart Swap on Kingambit (−2 Atk)", {
  mons: [jolt(["Heart Swap"], { item: "Eject Pack" }), lapras(["Splash"]), gambit(["Splash"]), blis],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = -2; }, inspect: (b) => `${boosts(b)} || ${items(b)}`,
});
// SA04d. Champions Guard Swap: the target's swapped Defense stage is read by the later Body Slam.
for (const swap of [true, false]) run("SA04d", `Jolteon ${swap ? "Guard Swap" : "Splash"} on Snorlax (+2 Def, +1 SpD); Lapras Body Slam into Snorlax`, {
  game: "champions", mons: [jolt([swap ? "Guard Swap" : "Splash"]), lapras(["Body Slam"]), lax(["Splash"]), still],
  turns: [[swap ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.def = 2; b.p2.active[0].boosts.spd = 1; },
  inspect: (b) => `${boosts(b)} || ${hps(b)}`,
});
// SA08. Topsy-Turvy (direct write): White Herb restores the inverted drop at AfterMove; no Opportunist copy of the inverted rise.
run("SA08", "Jolteon Topsy-Turvy on Kingambit (White Herb; +2 Atk, −2 Def); Espathra (Opportunist) beside Jolteon", {
  mons: [jolt(["Topsy-Turvy"]), { species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, gambit(["Splash"], { item: "White Herb" }), blis],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { const k = b.p2.active[0]; k.boosts.atk = 2; k.boosts.def = -2; },
  inspect: (b) => `${boosts(b)} || ${items(b)}`,
});
// SA09. Stockpile ×4 then Spit Up (PS/data/moves.ts:17663-17685, 17961-18013): the 4th fails at 3 layers; Spit Up has 300 power,
// then the Stockpile's End lowers Def and SpD by the counted amounts.
run("SA09", "Snorlax Stockpile on four turns, then Spit Up into Chansey", {
  mons: [lax(["Stockpile", "Spit Up"]), still, blis, slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"], ["move 2 1, move 1", "move 1, move 1"]],
  inspect: (b) => `Snorlax[${stages(b.p1.active[0])}] ${layers(b.p1.active[0])} || ${hps(b)}`,
});
// SA09b. Champions: Stockpile at +6 Defense counts only Sp. Def; Swallow heals a quarter (100 → 158 of 235) and lowers only Sp. Def.
run("SA09b", "Snorlax (+6 Def, 100 HP) Stockpile, then Swallow", {
  game: "champions", mons: [lax(["Stockpile", "Swallow"]), still, blis, slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.def = 6; b.p1.active[0].sethp(100); },
  inspect: (b) => `Snorlax[${stages(b.p1.active[0])}] ${layers(b.p1.active[0])} || ${hps(b)}`,
});
// SA09c. Contrary Stockpile: −1/−1, counted; its End (Swallow) gives them back through boost() (+1/+1 with Contrary).
run("SA09c", "Shuckle (Contrary, 50 HP) Stockpile, then Swallow", {
  mons: [{ ...slow, ability: "Contrary", moves: ["Stockpile", "Swallow"] }, still, blis, lax(["Splash"])],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(50); },
  inspect: (b) => `Shuckle[${stages(b.p1.active[0])}] ${layers(b.p1.active[0])} || ${hps(b)}`,
});
// SA10. Stuff Cheeks at +6 Defense: the boost changes nothing, so the Berry is not eaten (the move fails).
run("SA10", "Snorlax (+6 Def, Sitrus, 200 HP) Stuff Cheeks", {
  mons: [lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), still, blis, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].boosts.def = 6; b.p1.active[0].sethp(200); },
  inspect: (b) => `${boosts(b)} || ${items(b)} || ${hps(b)}`,
});
// SA10b. Stuff Cheeks under a foe's Unnerve: eatItem(true) still eats.
run("SA10b", "Snorlax (Sitrus, 100 HP) Stuff Cheeks; Aerodactyl (Unnerve) foe", {
  mons: [lax(["Stuff Cheeks"], { item: "Sitrus Berry" }), still, { species: "Aerodactyl", ability: "Unnerve", moves: ["Splash"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(100); },
  inspect: (b) => `${boosts(b)} || ${items(b)} || ${hps(b)}`,
});
// SA12. No Retreat twice: the second use fails while its volatile stands (PS/data/moves.ts:12798-12803).
run("SA12", "Jolteon No Retreat on two turns", {
  mons: [jolt(["No Retreat"]), still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]], inspect: (b) => `Jolteon[${stages(b.p1.active[0])}] || ${vols(b)}`,
});
// SA13. Minimize's ×2 (onSourceModifyDamage, chainModify(2)) chained with Reflect's 2732/4096 (doubles): every roll.
for (const mini of [true, false]) run("SA13", `Jolteon ${mini ? "Minimize" : "Splash"} behind Reflect; Snorlax Body Slam into Jolteon (all rolls)`, {
  mons: [jolt([mini ? "Minimize" : "Splash"]), still, lax(["Body Slam"]), slow], rolls: "all",
  turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.addSideCondition("reflect", b.p1.active[0]); }, inspect: (b) => `Jolteon ${b.p1.active[0].hp}`,
});

// ---- Stored stats -----------------------------------------------------------------------------------------------------
// SA06. Guard Split averages the stored Def and SpD; Wonder Room swaps them only when a stat is read (PS/sim/pokemon.ts:568-575):
// the Body Slam into the split Shuckle reads its stored SpD (182) under Wonder Room, its stored Def (165) without.
for (const room of [true, false]) run("SA06", `Jolteon Guard Split on Shuckle; Lapras Body Slam into Shuckle${room ? " (Wonder Room)" : ""}`, {
  mons: [jolt(["Guard Split"]), lapras(["Body Slam"]), { species: "Shuckle", ability: "Sturdy", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1 1", "move 1, move 1"]], setup: room ? (b) => { b.field.addPseudoWeather("wonderroom", b.p1.active[0]); } : undefined,
  inspect: (b) => `${stored(b.p2.active[0])} || ${hps(b)}`,
});
// SA06b. Power Split: Foul Play into the split Snorlax reads its stored Attack (floor((85 + 130) / 2) = 107).
for (const split of [true, false]) run("SA06b", `Jolteon ${split ? "Power Split" : "Splash"} on Snorlax; Umbreon Foul Play into Snorlax`, {
  mons: [jolt([split ? "Power Split" : "Splash"]), { species: "Umbreon", ability: "Synchronize", moves: ["Foul Play"] }, lax(["Splash"]), still],
  turns: [[split ? "move 1 1, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], inspect: (b) => `${stored(b.p2.active[0])} || ${hps(b)}`,
});
// SA07. Power Trick on two turns: the second use removes the volatile and its End swaps back (onRestart).
run("SA07", "Shuckle (level 100) Power Trick on two turns", {
  mons: [{ species: "Shuckle", ability: "Sturdy", moves: ["Power Trick"], level: 100 }, still, lax(["Splash"]), slow],
  turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} || ${vols(b)}`,
});
// SA07b. Champions Power Shift (the Champions mod's only change: isNonstandard null): Atk and Def swapped like Power Trick.
run("SA07b", "Shuckle Power Shift (Champions)", {
  game: "champions", mons: [{ species: "Shuckle", ability: "Sturdy", moves: ["Power Shift"] }, still, lax(["Splash"]), blis],
  turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} || ${vols(b)}`,
});

// ---- Ability changes --------------------------------------------------------------------------------------------------
// SA14. Skill Swap giving Prankster: from generation 8 the queued actions' priorities are recomputed after each action
// (PS/sim/battle.ts:2642-2647), so Snorlax's Yawn moves next at +1; generation 7 keeps the turn's start priorities.
for (const game of ["sv", "usum"] as Game[]) run("SA14", "Whimsicott (Prankster) Skill Swap with Snorlax; Snorlax Yawn into Lapras; Lapras (80), Chansey (70) Splash", {
  game, mons: [{ species: "Whimsicott", ability: "Prankster", moves: ["Skill Swap"] }, lapras(["Splash"]), lax(["Yawn"]), still],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]], inspect: (b) => `${order(b)} || ${abilities(b)}`,
});
// SA14b. Skill Swap gives Trace (set without its Start before the turn): its Start seeks, the next Update copies a random
// adjacent foe's copyable ability (sample, 1/2), and a copied Intimidate's Start lowers the foes at once.
run("SA14b", "Jolteon Skill Swap with its ally Gardevoir (Trace); foes Gyarados (Intimidate), Snorlax (Thick Fat)", {
  mons: [jolt(["Skill Swap"]), { species: "Gardevoir", ability: "Synchronize", moves: ["Splash"] }, gyara(["Splash"]), lax(["Splash"])],
  turns: [["move 1 -2, move 1", "move 1, move 1"]],
  setup: (b) => { clear(b); const g = b.p1.active[1]; g.ability = "trace"; g.baseAbility = "trace"; g.abilityState = b.initEffectState({ id: "trace", target: g }); },
  inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// SA14c. Skill Swap takes an activated Flash Fire: its End removes the flashfire volatile, so the ally's later Flamethrower
// has no boost, and the receiver's Flash Fire starts inactive. Between allies the -activate line names no ability.
for (const swap of [true, false]) run("SA14c", `Jolteon ${swap ? "Skill Swap" : "Splash"} with its ally Arcanine (Flash Fire active); Arcanine Flamethrower into Snorlax`, {
  mons: [jolt([swap ? "Skill Swap" : "Splash"]), { species: "Arcanine", ability: "Flash Fire", moves: ["Flamethrower"] }, lax(["Splash"]), still],
  turns: [[swap ? "move 1 -2, move 1 1" : "move 1, move 1 1", "move 1, move 1"]], setup: (b) => { b.p1.active[1].addVolatile("flashfire"); },
  inspect: (b) => `${abilities(b)} || ${vols(b)} || ${hps(b)}`,
});
// SA14e. Skill Swap into an Ability Shield holder fails (SetAbility).
run("SA14e", "Jolteon Skill Swap with Snorlax (Ability Shield)", {
  mons: [jolt(["Skill Swap"]), still, lax(["Splash"], { item: "Ability Shield" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => abilities(b),
});
// SA14f. Skill Swap gives Insomnia to a sleeping ally: its onUpdate cures at the move's Update, and the ally then moves.
run("SA14f", "Hypno (Insomnia) Skill Swap with its sleeping ally Snorlax; Snorlax Body Slam into Chansey", {
  mons: [{ species: "Hypno", ability: "Insomnia", moves: ["Skill Swap"] }, lax(["Body Slam"]), still, slow],
  turns: [["move 1 -2, move 1 1", "move 1, move 1"]],
  setup: (b) => { const s = b.p1.active[1]; s.setStatus("slp", null, null, true); s.statusState.time = 3; s.statusState.startTime = 3; },
  inspect: (b) => `${abilities(b)} || ${hps(b)}`,
});
// SA15. Role Play (no protect flag) through Protect, copying Intimidate: its Start lowers both foes (the protecting one too).
run("SA15", "Jolteon Role Play on Gyarados (Intimidate, Protect)", {
  mons: [jolt(["Role Play"]), lapras(["Splash"]), gyara(["Protect"]), still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: clear, inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// SA16. Simple Beam ends Unnerve: the user's Sitrus Berry (60/140, kept by the Unnerve) is eaten at that move's Update.
run("SA16", "Jolteon (Timid 252 Spe, Sitrus, 60 HP) Simple Beam into Aerodactyl (Unnerve)", {
  mons: [jolt(["Simple Beam"], { item: "Sitrus Berry", nature: "Timid", evs: { spe: 252 } }), lapras(["Splash"]), { species: "Aerodactyl", ability: "Unnerve", moves: ["Splash"] }, still],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(60); }, inspect: (b) => `${abilities(b)} || ${items(b)} || ${hps(b)}`,
});
// SA17. Gastro Acid on Cloud Nine in rain: the rain acts again for the later Water Pulse (1.5x).
for (const acid of [true, false]) run("SA17", `Jolteon ${acid ? "Gastro Acid" : "Splash"} into Golduck (Cloud Nine); Lapras Water Pulse into Snorlax; rain`, {
  mons: [jolt([acid ? "Gastro Acid" : "Splash"]), lapras(["Water Pulse"]), { species: "Golduck", ability: "Cloud Nine", moves: ["Splash"] }, lax(["Splash"])],
  turns: [[acid ? "move 1 1, move 1 2" : "move 1, move 1 2", "move 1, move 1"]], setup: (b) => { b.field.setWeather("raindance", "debug"); },
  inspect: (b) => `${vols(b)} || ${hps(b)}`,
});
// SA21. Skill Swap gives Download: its Start reads the foes' Defense and Sp. Def with their stages (getStat boosted,
// unmodified): Snorlax at +6 Def tips it to Sp. Atk (365 ≥ 255).
run("SA21", "Jolteon Skill Swap with its ally Porygon2 (Download); Snorlax at +6 Def, Chansey", {
  mons: [jolt(["Skill Swap"]), { species: "Porygon2", ability: "Download", moves: ["Splash"] }, lax(["Splash"]), still],
  turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => { clear(b); b.p2.active[0].boosts.def = 6; }, inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
});
// SA27. An Intimidate given mid-turn (Entrainment) meets the Intimidate-only reactions: Inner Focus, Rattled and Guard Dog
// from generation 8 (PS/data/mods/gen7/abilities.ts removes Inner Focus's, Rattled's and the others' handlers).
for (const [game, ally] of [["sv", "Lucario/Inner Focus"], ["usum", "Lucario/Inner Focus"], ["sv", "Sudowoodo/Rattled"], ["usum", "Sudowoodo/Rattled"], ["sv", "Mabosstiff/Guard Dog"]] as [Game, string][]) {
  const [species, ability] = ally.split("/");
  run("SA27", `Gyarados (Intimidate) Entrainment into Chansey; ${species} (${ability}) beside Gyarados`, {
    game, mons: [gyara(["Entrainment"]), { species, ability, moves: ["Splash"] }, still, blis],
    turns: [["move 1 1, move 1", "move 1, move 1"]], setup: clear, inspect: (b) => `${abilities(b)} || ${boosts(b)}`,
  });
}

// ---- Transform --------------------------------------------------------------------------------------------------------
// SA19. Transform into Gyarados: the copied Intimidate's Start lowers both foes; Ditto is then Water/Flying (High Horsepower immune).
run("SA19", "Ditto Transform into Gyarados (Intimidate); Snorlax High Horsepower into Ditto", {
  mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"] }, still, gyara(["Splash"]), lax(["High Horsepower"])],
  turns: [["move 1 1, move 1", "move 1, move 1 1"]], setup: clear, inspect: (b) => `${abilities(b)} || ${types(b)} || ${boosts(b)} || ${hps(b)}`,
});
// SA19b. Transform into a Substitute fails (gen 5+).
run("SA19b", "Ditto Transform into Snorlax behind a Substitute", {
  mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"] }, still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("substitute"); }, inspect: (b) => `${b.p1.active[0].species.name} ${b.p1.active[0].transformed}`,
});
// SA19c. Transform copies the weight (weighthg): Low Kick into the transformed Ditto has 120 power (460 kg), 20 (4 kg) untransformed.
for (const t of [true, false]) run("SA19c", `Ditto ${t ? "Transform into Snorlax" : "Splash"}; Shuckle Low Kick into Ditto`, {
  mons: [{ species: "Ditto", ability: "Limber", moves: [t ? "Transform" : "Splash"] }, still, lax(["Splash"]), { species: "Shuckle", ability: "Sturdy", moves: ["Low Kick"] }],
  turns: [[t ? "move 1 1, move 1" : "move 1, move 1", "move 1, move 1 1"]], inspect: (b) => `${b.p1.active[0].weighthg} hg || ${hps(b)}`,
});
// SA19d. Transform copies the stored stats as they are (PS/sim/pokemon.ts transformInto: storedStats[stat] = pokemon.storedStats[stat]),
// whatever the levels: a level-100 Ditto into a level-50 Snorlax has Snorlax's level-50 stats and keeps its own level and HP.
run("SA19d", "Ditto (level 100) Transform into Snorlax (level 50)", {
  mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"], level: 100 }, still, lax(["Splash"]), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], inspect: (b) => `${stored(b.p1.active[0])} level ${b.p1.active[0].level} maxhp ${b.p1.active[0].maxhp}`,
});
// SA19e. Transform into a Pokémon that Terastallized this turn copies its types before Tera (getTypes(true, true)): the
// transformed Ditto is Normal, so Shuckle's Low Kick is super effective on it.
run("SA19e", "Snorlax Terastallizes (Ghost); Ditto Transform into Snorlax; Shuckle Low Kick into Ditto", {
  mons: [{ species: "Ditto", ability: "Limber", moves: ["Transform"] }, still, lax(["Splash"], { teraType: "Ghost" }), { species: "Shuckle", ability: "Sturdy", moves: ["Low Kick"] }],
  turns: [["move 1 1, move 1", "move 1 terastallize, move 1 1"]], inspect: (b) => `${types(b)} || ${hps(b)}`,
});
