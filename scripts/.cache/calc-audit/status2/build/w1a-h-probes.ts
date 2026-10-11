// Track H (wave 1a) probes on pinned Showdown c23d2e94 (guards-sim.ts's harness): the hidden state's open points.
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/build/w1a-h-probes.ts [ID ...]
import { showTrace, start, type Mon } from "../design/guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const lax = (n: number, name = `Lax${n}`, moves: string[] = ["Splash"]): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves, evs: { spe: n * 8 }, name });
const LINES = /^\|(move|cant|-miss|-heal|-damage|-boost|-unboost|-enditem|-activate|-fail|-immune|-start|-end|-fieldstart|-status|-prepare|-supereffective|-resisted|turn|upkeep)\|/;
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",") || "-";

// H01: a carried Fly whose release is stopped at BeforeMove (full paralysis) by a Pokémon that moves BEFORE a later Body
// Slam: does it stay hidden after its MoveAborted (twoturnmove onMoveAborted removes twoturnmove, whose onEnd removes fly)?
for (const [id, para] of [["H01", true], ["H01c", false]] as const) {
  if (!want(id)) continue;
  console.log(`\n== ${id} champions: turn 1 fast Dragonite Fly; turn 2 ${para ? "fully paralysed (forced)" : "no paralysis"} and still faster than a slow Body Slam at it`);
  const b: any = start({ game: "champions", turns: [], mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 32 }, nature: "Jolly", name: "Nite" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 0 }, name: "Rai" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Splash"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slammer" }] });
  b.randomChance = function (n: number, d: number) { return this.effect?.id === "par" ? para : n >= d; };
  b.random = function (m?: number, n?: number) { return n === undefined ? (m === 100 ? 99 : 0) : (m as number); };
  const at = b.log.length;
  b.makeChoices("move 1 1, move 1", "move 1, move 2");
  if (para) b.p1.active[0].setStatus("par");
  console.log(`  volatiles after turn 1: ${vols(b.p1.active[0])}; spe ${b.p1.active[0].getStat("spe")} vs ${b.p2.active[1].getStat("spe")}`);
  b.makeChoices("move 1, move 1", "move 1, move 1 1");
  for (const line of (b.log.slice(at) as string[]).filter((l) => LINES.test(l))) console.log(`  ${line}`);
  console.log(`  volatiles after turn 2: ${vols(b.p1.active[0])}`);
}

// H02: the same with sleep (turn 1 Fly; sleep set before turn 2, the sleep counter at 2): a faster sleeper, then a slow Body Slam.
if (want("H02")) {
  console.log(`\n== H02 champions: turn 1 fast Dragonite Fly; turn 2 asleep (set), faster than a slow Body Slam at it`);
  const b: any = start({ game: "champions", turns: [], mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Fly"], evs: { spe: 32 }, nature: "Jolly", name: "Nite" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 0 }, name: "Rai" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Splash"], evs: { spe: 0 }, ivs: { spe: 0 }, nature: "Brave", name: "Slammer" }] });
  b.randomChance = function (n: number, d: number) { return n >= d; };
  b.random = function (m?: number, n?: number) { return n === undefined ? (m === 100 ? 99 : 0) : (m as number); };
  const at = b.log.length;
  b.makeChoices("move 1 1, move 1", "move 1, move 2");
  b.p1.active[0].setStatus("slp");
  b.p1.active[0].statusState.time = 3;
  console.log(`  volatiles after turn 1: ${vols(b.p1.active[0])}`);
  b.makeChoices("move 1, move 1", "move 1, move 1 1");
  for (const line of (b.log.slice(at) as string[]).filter((l) => LINES.test(l))) console.log(`  ${line}`);
  console.log(`  volatiles after turn 2: ${vols(b.p1.active[0])}`);
}

// H03: the volatiles a charge leaves (E2's list): Solar Beam, Meteor Beam, Fly, Dig, Geomancy (usum), Sky Drop (usum).
for (const [game, species, ability, move] of [["sv", "Venusaur", "Overgrow", "Solar Beam"], ["sv", "Clefable", "Magic Guard", "Meteor Beam"], ["sv", "Dragonite", "Inner Focus", "Fly"],
  ["sv", "Garchomp", "Rough Skin", "Dig"], ["usum", "Xerneas", "Fairy Aura", "Geomancy"], ["usum", "Braviary", "Keen Eye", "Sky Drop"]] as const) {
  if (!want("H03")) break;
  const b: any = start({ game: game as any, turns: [], mons: [{ species, ability, moves: [move], evs: { spe: 252 }, name: "User" }, lax(1), lax(2, "Foe"), lax(3)] });
  b.makeChoices(move === "Geomancy" ? "move 1, move 1" : "move 1 1, move 1", "move 1, move 1");
  console.log(`H03 ${game} ${move}: user volatiles after the turn: ${vols(b.p1.active[0])}; foe: ${vols(b.p2.active[0])}`);
}
