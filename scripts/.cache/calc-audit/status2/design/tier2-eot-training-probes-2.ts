// TIER 2 (Training rollout reasons) probes, part 2: the move states and prelude events behind bridge.ts / splits.ts /
// prelude.ts's rollout reasons, on pinned Showdown c23d2e94 (Champions format unless stated) through guards-sim.ts.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-2.ts > scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-2.out 2> scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-2.err
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

type Id = "p1a" | "p1b" | "p2a" | "p2b";
const LINES = /^\|(move|switch|drag|cant|-weather|-fieldstart|-fieldend|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|-start|-end|-mega|detailschange|-status|-curestatus|-singleturn|faint|turn|-hint)\|/;
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);
const lax = (n: number, name = `Lax${n}`, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n }, name, ...extra });
const sleepOf = (p: any) => p?.status === "slp" ? `slp time ${p.statusState.time}/${p.statusState.startTime}` : p?.status || "-";

// TR01: a recharging Pokémon's BeforeMove stops at mustrecharge (priority 11, PS/data/conditions.ts:364-378) before sleep
// (10): its sleep counter is not lowered, and no wake or confusion check runs. The bridge maps Recharge to "No move", which
// the engine runs through sleep (doubles-status.ts sleepCheck).
run("TR01 champions Hyper Beam, then put to sleep by a slower Venusaur: turn 2 is the recharge", {
  game: "champions", turns: [["move 1 1, move 1", "move 1 1, move 1"], ["move 1, move 1", "move 2, move 1"]],
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Hyper Beam"], evs: { spe: 32 }, name: "Chomp" }, lax(1),
    { species: "Venusaur", ability: "Overgrow", moves: ["Sleep Powder", "Splash"], name: "Saur" }, lax(2)],
  inspect: (b) => `Chomp ${sleepOf(b.p1.active[0])} v:${Object.keys(b.p1.active[0].volatiles).join(",") || "-"}`,
}, { hp: false });
// TR02: a Pokémon that switches in this turn takes no BeforeMove: an asleep one keeps its counter (the bridge gives it "No move").
run("TR02 champions an asleep Snorlax switched in on turn 1: its counter after the turn", {
  game: "champions", turns: [["switch 3, move 1", "move 1, move 1"]], bench: { p1: [lax(5, "Sleeper")] },
  setup: (b) => { const s = b.p1.pokemon[2]; s.status = "slp"; s.statusState.id = "slp"; s.statusState.startTime = 3; s.statusState.time = 3; },
  mons: [lax(3, "Out"), lax(1), lax(2), lax(4)],
  inspect: (b) => `p1a ${b.p1.active[0].name} ${sleepOf(b.p1.active[0])}`,
}, { hp: false });
run("TR02b champions control: the same sleeper in place using Splash (No move) loses one", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const s = b.p1.active[0]; s.setStatus("slp", null, null, true); s.statusState.startTime = 3; s.statusState.time = 3; },
  mons: [lax(5, "Sleeper"), lax(1), lax(2), lax(4)],
  inspect: (b) => `p1a ${b.p1.active[0].name} ${sleepOf(b.p1.active[0])}`,
}, { hp: false });
// TR03: a confused Protect user with a stall counter (Protect last turn) under Gravity: confusion (3) runs, then the stall
// check at PrepareHit (1/3). Splash under Gravity stops at Gravity's BeforeMove (6) before confusion.
run("TR03 champions confused Protect with counter 3 under Gravity", {
  game: "champions", chances: ["confusion"], turns: [["move 1, move 1", "move 1 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; b.field.addPseudoWeather("gravity", "debug"); p.addVolatile("confusion"); p.volatiles.confusion.time = 4; p.addVolatile("stall"); p.volatiles.stall.counter = 3; p.volatiles.stall.duration = 2; },
  mons: [lax(5, "Prot", { moves: ["Protect"] }), lax(1), lax(2, "Foe", { moves: ["Tackle"] }), lax(4)],
});
run("TR03b champions the same confused Pokémon using Splash under Gravity", {
  game: "champions", chances: ["confusion"], turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; b.field.addPseudoWeather("gravity", "debug"); p.addVolatile("confusion"); p.volatiles.confusion.time = 4; },
  mons: [lax(5, "Prot"), lax(1), lax(2), lax(4)],
});
// TR04: two switches out at one Speed (the switch action's Speed is the leaving Pokémon's): the entry order is a tie;
// Drought and Drizzle → the later one's weather.
run("TR04 champions tied switches bring in Torkoal (Drought) and Politoed (Drizzle)", {
  game: "champions", turns: [["switch 3, move 1", "switch 3, move 1"]], bench: { p1: [{ species: "Torkoal", ability: "Drought", moves: ["Splash"], name: "Tork" }], p2: [{ species: "Politoed", ability: "Drizzle", moves: ["Splash"], name: "Toed" }] },
  mons: [lax(3, "OutA"), lax(1), lax(3, "OutB"), lax(2)],
  inspect: (b) => `weather ${b.field.weather || "-"}`,
}, { hp: false });
// TR05: two Mega Evolutions at one Speed (megaEvo order 104, sorted by Speed, ties shuffled: PS/sim/battle-queue.ts:174-197):
// Charizard Mega Y's Drought and Tyranitar Mega's Sand Stream → the later one's weather. prelude.ts checks switch ties only.
run("TR05 champions tied Mega Evolutions: Charizard (Drought) and Tyranitar (Sand Stream)", {
  game: "champions", turns: [["move 1 mega, move 1", "move 1 mega, move 1"]],
  setup: (b) => { for (const p of [b.p1.active[0], b.p2.active[0]]) { p.storedStats.spe = 120; p.speed = 120; } },
  mons: [{ species: "Charizard", ability: "Blaze", item: "Charizardite Y", moves: ["Splash"], name: "Zard" }, lax(1),
    { species: "Tyranitar", ability: "Sand Stream", item: "Tyranitarite", moves: ["Splash"], name: "Ttar" }, lax(2)],
  inspect: (b) => `weather ${b.field.weather || "-"}`,
}, { hp: false });
// TR06: Payback into a Pokémon that switched in this turn is not doubled (target.newlySwitched: PS/data/moves.ts:13191-13198),
// whatever the order; into a Pokémon that has moved it is.
run("TR06a champions Payback into a Pokémon that switched in this turn", {
  game: "champions", turns: [["move 1 1, move 1", "switch 3, move 1"]], bench: { p2: [lax(6, "New")] },
  mons: [{ species: "Tyranitar", ability: "Unnerve", moves: ["Payback"], name: "Ttar" }, lax(1), lax(9, "Out"), lax(2)],
});
run("TR06b champions Payback into a faster Pokémon that has moved", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].storedStats.spe = 300; },
  mons: [{ species: "Tyranitar", ability: "Unnerve", moves: ["Payback"], name: "Ttar" }, lax(1), lax(20, "Fast"), lax(2)],
});
// TR07: Fake Out after its first turn fails at its own onTry, after BeforeMove: a confused user can still hurt itself, and
// Gravity does not stop it (Splash it would).
run("TR07 champions confused Incineroar's second-turn Fake Out under Gravity", {
  game: "champions", chances: ["confusion"], turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; b.field.addPseudoWeather("gravity", "debug"); p.addVolatile("confusion"); p.volatiles.confusion.time = 4; p.activeMoveActions = 1; },
  mons: [{ species: "Incineroar", ability: "Blaze", moves: ["Fake Out"], name: "Inci" }, lax(1), lax(2, "Foe"), lax(4)],
});
// TR08: Magic Room with 1 turn left ends at 27.6; a Sitrus Berry holder under half eats at the final Update.
run("TR08 champions Magic Room (1 turn left) and a Sitrus holder at 100/235", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.addPseudoWeather("magicroom", "debug"); b.field.pseudoWeather.magicroom.duration = 1; b.p1.active[0].sethp(100); },
  mons: [lax(5, "Berry", { item: "Sitrus Berry" }), lax(1), lax(2), lax(4)],
});
run("TR08b champions the same with 2 turns left: no Sitrus", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.field.addPseudoWeather("magicroom", "debug"); b.field.pseudoWeather.magicroom.duration = 2; b.p1.active[0].sethp(100); },
  mons: [lax(5, "Berry", { item: "Sitrus Berry" }), lax(1), lax(2), lax(4)],
});
// TR09: Struggle (PS/data/moves.ts:18212-18233): typeless, a random foe (randomNormal), recoil clampIntRange(round(baseMaxhp/4), 1)
// as directDamage (PS/sim/battle-actions.ts:1381-1389).
run("TR09 champions Struggle by Snorlax (random foe, 1/4 recoil)", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; for (const s of p.moveSlots) s.pp = 0; },
  mons: [lax(5, "Strug", { moves: ["Tackle"] }), lax(1), { species: "Gengar", ability: "Cursed Body", moves: ["Splash"], name: "Gengar" }, lax(2, "Foe")],
}, {});
// TR10: Analytic after a switch this turn: the newcomer has no queued action (sim/battle-queue.ts willMove), so a user that
// moves after every queued action is boosted.
run("TR10a champions Analytic Starmie (Speed 1) moves after every queued action; the foe across switched in", {
  game: "champions", turns: [["move 1 1, move 1", "switch 3, move 1"]], bench: { p2: [lax(6, "New")] },
  setup: (b) => { b.p1.active[0].storedStats.spe = 1; },
  mons: [{ species: "Starmie", ability: "Analytic", moves: ["Hydro Pump"], name: "Star" }, lax(1), lax(9, "Out"), lax(2)],
});
run("TR10b champions control: the foe across stays in and moves after Starmie (Speed 0): no boost", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[0].storedStats.spe = 1; b.p2.active[0].storedStats.spe = 0; },
  mons: [{ species: "Starmie", ability: "Analytic", moves: ["Hydro Pump"], name: "Star" }, lax(1), lax(6, "New"), lax(2)],
});
// TR09b/c: Struggle's recoil (applyRecoilDamage after move.totalDamage > 0) into a Substitute, and into Protect.
run("TR09b champions Struggle into a lone foe's Substitute (40 HP)", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; for (const s of p.moveSlots) s.pp = 0; b.p2.active[1].faint(); b.faintMessages(); b.p2.active[0].addVolatile("substitute"); b.p2.active[0].volatiles.substitute.hp = 40; },
  mons: [lax(5, "Strug", { moves: ["Tackle"] }), lax(1), lax(2, "Subbed"), lax(3, "Gone")], bench: { p2: [] },
  inspect: (b) => `sub:${b.p2.active[0].volatiles.substitute?.hp ?? "gone"} strug:${b.p1.active[0].hp}`,
});
run("TR09c champions Struggle into a lone foe's Protect", {
  game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; for (const s of p.moveSlots) s.pp = 0; b.p2.active[1].faint(); b.faintMessages(); },
  mons: [lax(5, "Strug", { moves: ["Tackle"] }), lax(1), lax(20, "Prot", { moves: ["Protect"] }), lax(3, "Gone")], bench: { p2: [] },
});
// TR11: the recharge turn of a confused Pokémon: mustrecharge (11) stops BeforeMove before confusion (3): no self-hit, and
// the confusion's turn is not counted (its time is lowered only in confusion's own onBeforeMove).
run("TR11 champions a confused Pokémon's recharge turn", {
  game: "champions", chances: ["confusion"], turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { const p = b.p1.active[0]; p.addVolatile("confusion"); p.volatiles.confusion.time = 4; p.addVolatile("mustrecharge"); },
  mons: [lax(5, "Beamer", { moves: ["Hyper Beam"] }), lax(1), lax(2), lax(4)],
  inspect: (b) => `confusion time ${b.p1.active[0].volatiles.confusion?.time ?? "-"} v:${Object.keys(b.p1.active[0].volatiles).join(",")}`,
});
