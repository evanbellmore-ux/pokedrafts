// FAMILY 4 probes, part 3: details the designs of guards.md rest on (Big Root with Liquid Ooze on a drain, Focus Band's
// branch, Glaive Rush's 2x, a priority move into an ally under Psychic Terrain or a priority shield, Round's reorder),
// on pinned Showdown c23d2e94 through guards-sim.ts.
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/guards-probes-3.ts > scripts/.cache/calc-audit/status2/design/guards-probes-3.out
import { enumerate, report, showTrace, type Mon, type Probe } from "./guards-sim";

const LINES = /^\|(move|switch|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|cant|-start|-end|-singleturn|-fieldstart|-hint|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: LINES, ...probe }), opts);

// G8: a drain's TryHeal: Big Root's onTryHeal (priority 1) runs before Liquid Ooze's onSourceTryHeal: the damage is the boosted amount?
showTrace("G8 Matcha Gotcha with Big Root into a Liquid Ooze target and a plain one", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(80); },
  mons: [{ species: "Sinistcha", ability: "Hospitality", item: "Big Root", moves: ["Matcha Gotcha"], evs: { spa: 252, spe: 252 }, nature: "Modest" }, lax(4),
    { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"], name: "Ooze" }, { ...lax(12), name: "Plain" }],
}, LINES);
showTrace("G8b the same without Big Root (the raw drain amounts)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(80); },
  mons: [{ species: "Sinistcha", ability: "Hospitality", moves: ["Matcha Gotcha"], evs: { spa: 252, spe: 252 }, nature: "Modest" }, lax(4),
    { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"], name: "Ooze" }, { ...lax(12), name: "Plain" }],
}, LINES);
// O1: Focus Band: randomChance(1, 10) on each hit that would knock out (onDamage), one world each.
run("O1 Focus Band against a knockout hit: 1/10 to survive at 1 HP", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(30); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { atk: 252, spe: 252 } }, lax(4), { ...lax(8), item: "Focus Band", name: "Band" }, lax(12)],
}, { lines: false });
run("O1b Focus Band against a two-hit Dual Wingbeat whose each hit can knock out: per hit", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(20); },
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 } }, lax(4), { ...lax(8), item: "Focus Band", name: "Band" }, lax(12)],
}, { lines: false });
// Q1: Glaive Rush doubles the damage its user takes (onSourceModifyDamage) until its next move.
showTrace("Q1 Glaive Rush, then a later hit into its user", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Baxcalibur", ability: "Thermal Exchange", moves: ["Glaive Rush"], evs: { spe: 252 }, name: "Bax" }, lax(4), lax(8), { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "Hitter" }],
}, /^\|(move|-damage)\|/);
showTrace("Q1b the same Tackle without Glaive Rush (Bax uses Splash)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1 1"]],
  mons: [{ species: "Baxcalibur", ability: "Thermal Exchange", moves: ["Splash"], evs: { spe: 252 }, name: "Bax" }, lax(4), lax(8), { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "Hitter" }],
}, /^\|(move|-damage)\|/);
// R1: a priority move into the user's ally: Psychic Terrain and a priority shield only stop a foe's (onTryHit / onFoeTryMove).
showTrace("R1 Prankster-less priority (Quick Attack) into its own ally on Psychic Terrain, the ally with Armor Tail", {
  game: "sv", turns: [["move 1 -2, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("psychicterrain", "debug"); },
  mons: [{ species: "Pikachu", ability: "Static", moves: ["Quick Attack"], evs: { spe: 252 } }, { species: "Farigiraf", ability: "Armor Tail", moves: ["Splash"], name: "Ally" }, lax(8), lax(12)],
}, /^\|(move|-damage|-activate|cant|-fail)\|/);
// N1: Round: a second Round user later in the turn moves right after the first (prioritizeAction) with 2x power.
showTrace("N1 two Round users: the second moves next with 2x power", {
  game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
  mons: [{ species: "Alcremie", ability: "Sweet Veil", moves: ["Round"], evs: { spe: 252 }, name: "Cream" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "Slow" },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"], name: "Mid" }, lax(12)],
}, /^\|(move|-damage)\|/);
// E9: Fling by a Sheer Force user: Sheer Force's onModifyMove runs before Fling's onPrepareHit pushes the item's secondary,
// so the status still lands (and the move is not Sheer-Force-boosted).
showTrace("E9 Fling Flame Orb by a Sheer Force user", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Nidoking", ability: "Sheer Force", item: "Flame Orb", moves: ["Fling"], evs: { spe: 252 } }, lax(4), { ...lax(8), name: "Target" }, lax(12)],
}, /^\|(move|-damage|-enditem|-status)\|/);
showTrace("E9b the same Fling by a non-Sheer Force Nidoking (damage comparison)", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Nidoking", ability: "Poison Point", item: "Flame Orb", moves: ["Fling"], evs: { spe: 252 } }, lax(4), { ...lax(8), name: "Target" }, lax(12)],
}, /^\|(move|-damage|-enditem|-status)\|/);
