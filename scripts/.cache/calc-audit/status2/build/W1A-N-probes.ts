// Track N (status2 wave 1a) probes on pinned Showdown c23d2e94 through the design's guards-sim.ts harness (exact
// enumeration: every random decision replayed, every move hits, no critical hit, added effects below 100% fail; `stall`,
// `confusion` and `par` enumerated; every damage roll with "all"). Each scenario is a doubles-history.test.ts case: the same
// builds (level 50, 31 IVs, Serious, 0 EVs, or Stat Points in Champions, unless set), p1a = own-left, p1b = own-right,
// p2a = opponent-right, p2b = opponent-left. Champions' Stat Points: at most 32 a stat (FAST), its IVs are none.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/W1A-N-probes.ts [N01 ...] > scripts/.cache/calc-audit/status2/build/W1A-N-probes.out
import { enumerate, monAt, report, showTrace, type Game, type Mon, type Probe } from "../design/guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const LINES = /^\|(move|cant|-fail|-damage|-heal|-activate|-singleturn|-singlemove|-start|-end|-curestatus|-status|-ability|-boost|-immune|faint|turn)\|/;
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, rolls: "all", ...probe }), opts);
/** A Thick Fat Snorlax with 8n Speed EVs (Stat Points in Champions). */
const lax = (n: number, name: string, extra: Partial<Mon> = {}): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name, ...extra });
const FAST = (game: Game) => (game === "champions" ? 32 : 252);
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",") || "-";
const state = (p: any) => !p ? "-" : `${p.name} ${p.fainted ? "fainted" : `${p.hp}/${p.maxhp}`}${p.status ? ` ${p.status}` : ""} v:${vols(p)}`;
const all = (b: any) => (["p1a", "p1b", "p2a", "p2b"] as const).map((id) => `${id} ${state(monAt(b, id))}`).join(" | ");
const stall = (p: any, counter: number) => { p.addVolatile("stall"); p.volatiles.stall.counter = counter; };
const GAMES = ["sv", "champions", "usum", "swsh"] as const;

// N01: a carried stall counter c: 1/c passes, 1 − 1/c fails; 729 (the cap) too. Garchomp (Rough Skin) is faster than the
// Snorlax that uses Facade into it (Facade: every game's Snorlax learns it; no added effect).
const chomp = (game: Game, moves: string[]): Mon => ({ species: "Garchomp", ability: "Rough Skin", moves, evs: { spe: FAST(game) }, name: "Garchomp" });
const facade = (moves = ["Facade"]): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, name: "Hitter" });
for (const game of GAMES) for (const counter of [3, 9, 729]) if (want("N01")) {
  if (counter === 729 && game !== "sv") continue;
  run(`N01 ${game}: Garchomp Protect with stall ${counter}; Hitter's Facade into it`, {
    game, turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [chomp(game, ["Protect"]), lax(1, "Ally"), facade(), lax(2, "Lax")],
    setup: (b) => stall(b.p1.active[0], counter),
  });
}

// N02: Endure with stall 9 into a knocking-out hit (Garchomp at 20 HP).
for (const game of ["sv", "champions"] as const) if (want("N02")) {
  run(`N02 ${game}: Garchomp (20 HP) Endure with stall 9; Hitter's Facade into it`, {
    game, turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [chomp(game, ["Endure"]), lax(1, "Ally"), facade(), lax(2, "Lax")],
    setup: (b) => { const g = b.p1.active[0]; g.sethp(20); stall(g, 9); },
  });
}

// N03: a confused Garchomp under Gravity, Protect with stall 3 (IN-P02, TR03): confusion's self-hit 33/100 first, then the roll.
if (want("N03")) {
  run("N03 sv: confused Garchomp under Gravity, Protect with stall 3", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], chances: ["confusion"],
    mons: [chomp("sv", ["Protect"]), lax(1, "Ally"), facade(), lax(2, "Lax")],
    setup: (b) => { const g = b.p1.active[0]; stall(g, 3); g.addVolatile("confusion"); g.volatiles.confusion.time = 4; b.field.addPseudoWeather("gravity", b.p1.active[1]); },
  });
}

// N04: Quick Guard last turn, Protect this turn (CQ05a): Quick Guard leaves the counter 3 with no roll; this turn rolls 1/3.
if (want("N04")) {
  run("N04 sv: Quick Guard on turn 1, Protect on turn 2", {
    game: "sv", turns: [["move 1, move 1", "move 2, move 1"], ["move 2, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Hariyama", ability: "Thick Fat", moves: ["Quick Guard", "Protect"], evs: { spe: 252 }, name: "Guard" }, lax(1, "Ally"), facade(["Facade", "Splash"]), lax(2, "Lax")],
  }, { lines: false });
}

// N05: a Destiny Bond from last turn on Gengar (1 HP). (a) slower Gengar using Shadow Ball: a faster Weavile's Night Slash
// knocks it out first: Weavile faints. (b) faster Gengar using No move (Splash): BeforeMove −1 removes it; the slower Night
// Slash: Weavile lives. (c) faster Gengar using Destiny Bond again: its PrepareHit removes it and fails; Weavile lives.
// (d) faster Gengar asleep: MoveAborted removes it (CQ06b); (e) slower asleep Gengar: Weavile faints (CQ06a).
const gengar = (game: Game, fast: boolean, moves = ["Shadow Ball"]): Mon => ({ species: "Gengar", ability: "Cursed Body", moves, name: "Gengar", ...(fast ? { evs: { spe: FAST(game) }, nature: "Timid" } : { ivs: { spe: 0 }, nature: "Brave" }) });
const weavile = (game: Game, fast: boolean): Mon => ({ species: "Weavile", ability: "Pressure", moves: ["Night Slash"], name: "Weavile", ...(fast ? { evs: { spe: FAST(game) } } : { ivs: { spe: 0 }, nature: "Brave" }) });
const bonded = (b: any, sleep = false) => { const g = b.p2.active[0]; g.sethp(1); g.addVolatile("destinybond"); if (sleep) { g.setStatus("slp"); g.statusState.time = 3; g.statusState.startTime = 3; } };
for (const game of GAMES) if (want("N05")) {
  run(`N05a ${game}: slow Gengar (Destiny Bond up) Shadow Ball; a faster Weavile's Night Slash`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1"]], mons: [weavile(game, true), lax(1, "Ally"), gengar(game, false), lax(2, "Lax")],
    setup: (b) => bonded(b), inspect: all,
  }, { hp: false });
  run(`N05b ${game}: fast Gengar (Destiny Bond up) No move; a slower Weavile's Night Slash`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [weavile(game, false), lax(1, "Ally"), gengar(game, true, ["Splash"]), lax(2, "Lax")],
    setup: (b) => bonded(b), inspect: all,
  }, { hp: false });
  run(`N05c ${game}: fast Gengar (Destiny Bond up) Destiny Bond again; a slower Weavile's Night Slash`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]], mons: [weavile(game, false), lax(1, "Ally"), gengar(game, true, ["Destiny Bond"]), lax(2, "Lax")],
    setup: (b) => bonded(b), inspect: all,
  }, { hp: false });
  run(`N05d ${game}: fast asleep Gengar (Destiny Bond up) Shadow Ball; a slower Weavile's Night Slash`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1"]], mons: [weavile(game, false), lax(1, "Ally"), gengar(game, true), lax(2, "Lax")],
    setup: (b) => bonded(b, true), inspect: all,
  }, { hp: false });
  run(`N05e ${game}: slow asleep Gengar (Destiny Bond up) Shadow Ball; a faster Weavile's Night Slash`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1"]], mons: [weavile(game, true), lax(1, "Ally"), gengar(game, false), lax(2, "Lax")],
    setup: (b) => bonded(b, true), inspect: all,
  }, { hp: false });
}

// N06: the entry order of two equal-Speed Lightning Rod Raichu on opposite sides (CQ09): Jolteon (p2a) Thunderbolts p1b;
// the leads' ability states are p1a, p1b, p2a, p2b; re-made (a new effectOrder) for RodA, RodB takes it.
const rod = (name: string): Mon => ({ species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name });
for (const game of GAMES) for (const remake of [false, true]) if (want("N06")) {
  showTrace(`N06 ${game}: RodA (p1a) and RodB (p2b) Lightning Rod at one Speed; Bolt (p2a) Thunderbolt at p1b; ${remake ? "RodA's ability state re-made" : "the leads"}`, {
    game, turns: [["move 1, move 1", "move 1 2, move 1"]],
    mons: [rod("RodA"), lax(1, "Target"), { species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], name: "Bolt" }, rod("RodB")],
    setup: (b) => { if (remake) { const p = b.p1.active[0]; p.abilityState = b.initEffectState({ id: p.ability, target: p }); } },
  }, /^\|(move|-boost|-immune|-damage|-ability|turn)\|/);
}
// N07: two equal-Speed Clefairy (p2a A, p2b B) use Follow Me; a slower Snorlax's Facade at p2b: the older (A at the leads)
// takes it. One trace (first decisions, lowest rolls): a Speed tie among the actives shuffles at every eachEvent, which no
// exact enumeration bounds; compareRedirectOrder itself has no shuffle (IN-P08: both tie policies agree).
for (const game of ["sv", "usum"] as const) for (const remake of [false, true]) if (want("N07")) {
  showTrace(`N07 ${game}: Clefairy A (p2a) and B (p2b) Follow Me at one Speed; Hitter (p1a) Facade at B; ${remake ? "A's ability state re-made" : "the leads"}`, {
    game, turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [facade(), lax(1, "Ally"), { species: "Clefairy", ability: "Magic Guard", moves: ["Follow Me"], name: "A" }, { species: "Clefairy", ability: "Magic Guard", moves: ["Follow Me"], name: "B" }],
    setup: (b) => { if (remake) { const p = b.p2.active[0]; p.abilityState = b.initEffectState({ id: p.ability, target: p }); } },
  }, /^\|(move|-damage|-singleturn|turn)\|/);
}

// N08: the recharge (mustrecharge, BeforeMove 11): an asleep Snorlax that would wake now (statusState.time 1) stays asleep;
// a confused one hurts itself in none of the worlds; controls without the recharge.
for (const game of ["champions", "sv"] as const) for (const recharge of [true, false]) if (want("N08")) {
  run(`N08a ${game}: asleep Snorlax (wakes at this BeforeMove) ${recharge ? "recharging" : "control: Splash"}`, {
    game, turns: [["move 1, move 1", "move 1, move 1"]], mons: [lax(4, "Sleeper"), lax(1, "Ally"), lax(2, "Foe"), lax(3, "Lax")],
    setup: (b) => { const p = b.p1.active[0]; p.setStatus("slp"); p.statusState.time = 1; p.statusState.startTime = 3; if (recharge) p.addVolatile("mustrecharge"); },
    inspect: all,
  }, { hp: false });
  run(`N08b ${game}: confused Snorlax ${recharge ? "recharging" : "control: Splash"}`, {
    game, turns: [["move 1, move 1", "move 1, move 1"]], chances: ["confusion"], mons: [lax(4, "Beamer"), lax(1, "Ally"), lax(2, "Foe"), lax(3, "Lax")],
    setup: (b) => { const p = b.p1.active[0]; p.addVolatile("confusion"); p.volatiles.confusion.time = 4; if (recharge) p.addVolatile("mustrecharge"); },
    inspect: (b) => `${all(b)} | confusion time ${b.p1.active[0].volatiles.confusion?.time ?? "-"}`,
  }, { lines: true });
}

// N09: Fake Out and First Impression after the first turn (activeMoveActions 1 at the turn's start): (a) TR07, a confused
// Incineroar under Gravity (champions, sv); (b) Fake Out fails, the target is not flinched and moves; (c) First Impression.
const inci: Mon = { species: "Incineroar", ability: "Blaze", moves: ["Fake Out"], name: "Inci" };
for (const game of ["champions", "sv"] as const) if (want("N09")) {
  run(`N09a ${game}: confused Incineroar's Fake Out after its first turn under Gravity`, {
    game, chances: ["confusion"], turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [inci, lax(1, "Ally"), lax(2, "Foe"), lax(4, "Lax")],
    setup: (b) => { const p = b.p1.active[0]; b.field.addPseudoWeather("gravity", "debug"); p.addVolatile("confusion"); p.volatiles.confusion.time = 4; p.activeMoveActions = 1; },
  });
}
for (const game of ["sv", "usum", "swsh"] as const) for (const later of [true, false]) if (want("N09")) {
  run(`N09b ${game}: Incineroar's Fake Out ${later ? "after its first turn" : "on its first turn (control)"} at a slower Hitter, whose Facade is at it`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [inci, lax(1, "Ally"), facade(), lax(4, "Lax")],
    setup: (b) => { if (later) b.p1.active[0].activeMoveActions = 1; },
  });
}
for (const game of ["usum", "swsh"] as const) if (want("N09")) {
  run(`N09c ${game}: Golisopod's First Impression after its first turn`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Golisopod", ability: "Emergency Exit", moves: ["First Impression"], name: "Golisopod", evs: { spe: 252 } }, lax(1, "Ally"), lax(2, "Foe"), lax(4, "Lax")],
    setup: (b) => { b.p1.active[0].activeMoveActions = 1; },
  });
}

// N10: Protean after the stall roll (PS/sim/battle-actions.ts:591-592: the move's own PrepareHit, then the PrepareHit event):
// an unused Protean Greninja's Protect with stall 3 changes its type to Normal only where the roll passes; where it fails
// Greninja stays Water/Dark, so Jolteon's Thunderbolt is super effective.
if (want("N10")) {
  run("N10 sv: Greninja (Protean, unused) Protect with stall 3; Jolteon's Thunderbolt into it", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Greninja", ability: "Protean", moves: ["Protect"], name: "Greninja" }, lax(1, "Ally"), { species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], name: "Bolt" }, lax(2, "Lax")],
    setup: (b) => stall(b.p1.active[0], 3),
    inspect: (b) => `Greninja ${b.p1.active[0].getTypes().join("/")}`,
  });
}
