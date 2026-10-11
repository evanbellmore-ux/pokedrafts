// ADDENDUM probes, batch 1: Ally Switch (positions). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/addendum-probes-1.ts [A1 ...] > scripts/.cache/calc-audit/status-eot/design/addendum-probes-1.out
import { at, enumerate, report, type AProbe } from "./addendum-sim";
import type { Mon } from "./status-sim";

const L = /^\|(move|cant|swap|-fail|-damage|-heal|-activate|-start|-end|-immune|-miss|faint|-singleturn)\|/;
const still: Mon = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
/** Who stands where after the turn (position: name), and the order of the turn's |move| lines. */
const where = (b: any) => `p1: ${b.p1.active.map((p: any) => p.name).join(",")} | p2: ${b.p2.active.map((p: any) => p.name).join(",")}`;
const moveOrder = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|move|")).map((l) => l.split("|").slice(2, 5).join(">")).slice(-4).join(" ; ");
const damageOrder = (b: any) => (b.log as string[]).filter((l) => l.startsWith("|-damage|") && !l.includes("[from]")).map((l) => l.split("|")[2]).join(", ");

// A1. Ally Switch: priority +2 in every game here (data/moves.ts:309; gen8 mod keeps it, gen6 mod has +1); a +1 move aimed at
// the switcher's old position hits the Pokémon now standing there; Fake Out (+3) still comes first.
for (const game of ["sv", "champions", "swsh", "usum"] as const) if (want("A1")) {
  report(`A1 ${game}: Snorlax (p1b, Speed 50) Ally Switch; Lapras Aqua Jet (+1) at p1a's position (Jolteon before the swap)`, enumerate(base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
      { species: "Lapras", ability: "Shell Armor", moves: ["Aqua Jet"] }, slow],
    turns: [["move 1, move 1", "move 1 1, move 1"]],
    inspect: (b) => `${where(b)} || ${moveOrder(b)}`,
  })), { lines: false });
}
if (want("A1")) report("A1b sv: Fake Out (+3) on the Ally Switch user comes first: it flinches, no swap", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Fake Out"] }, slow],
  turns: [["move 1, move 1", "move 1 2, move 1"]],
  inspect: (b) => `${where(b)} || ${moveOrder(b)}`,
})));

// A2. A move its user aims at its ally, after the ally's Ally Switch: the user now stands at the aimed position
// (sim/battle.ts:2456-2462 getTarget returns null for adjacentAlly/any/normal at its own loc) -> [notarget], -fail.
for (const move of ["Body Slam", "Heal Pulse", "Pollen Puff", "Aromatic Mist", "Dragon Darts"]) if (want("A2")) {
  report(`A2 sv: Jolteon (p1a) ${move} at its ally (-2); the ally Snorlax Ally Switches first`, enumerate(base({
    mons: [{ species: move === "Dragon Darts" ? "Dragapult" : "Jolteon", ability: "Infiltrator", moves: [move] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
      { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow],
    turns: [["move 1 -2, move 1", "move 1, move 1"]],
    setup: (b) => { b.p1.active[1].sethp(100); },
    inspect: (b) => `${where(b)} || HP ${b.p1.active.map((p: any) => `${p.name} ${p.hp}`).join(", ")}`,
  })));
}

// A3. Redirection follows the Pokémon: Follow Me's user after its partner's Ally Switch still takes a move aimed at its old position.
if (want("A3")) report("A3 sv: p2b Jolteon (fast) Ally Switch, then p2a Clefable Follow Me; Snorlax Body Slam at loc 1 (p2a position)", enumerate(base({
  mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, still, { species: "Clefable", ability: "Magic Guard", moves: ["Follow Me"] },
    { species: "Jolteon", ability: "Volt Absorb", moves: ["Ally Switch"] }],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${where(b)} || ${moveOrder(b)} || damaged ${damageOrder(b)}`,
})));

// A4. Stalwart / Propeller Tail / Snipe Shot keep the Pokémon chosen at queue time (sim/battle-queue.ts:268 originalTarget,
// sim/battle.ts:2444-2447): after the foe's Ally Switch they still hit it, at its new position.
for (const [species, ability, move] of [["Duraludon", "Stalwart", "Body Slam"], ["Inteleon", "Torrent", "Snipe Shot"], ["Snorlax", "Thick Fat", "Body Slam"]] as const) if (want("A4")) {
  report(`A4 sv: ${species} (${ability}) ${move} at loc 1 (Lapras at p2a); p2b Jolteon Ally Switches first`, enumerate(base({
    mons: [{ species, ability, moves: [move] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Jolteon", ability: "Volt Absorb", moves: ["Ally Switch"] }],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    inspect: (b) => `${where(b)} || damaged ${damageOrder(b)}`,
  })), { lines: false });
}

// A5. Spread order after the foe side's swap: getMoveTargets lists adjacentFoes by position (sim/pokemon.ts:732-735 side.foes()).
if (want("A5")) report("A5 sv: p2b Jolteon Ally Switch; Snorlax Rock Slide (both foes): damage order by new positions", enumerate(base({
  mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Rock Slide"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Jolteon", ability: "Volt Absorb", moves: ["Ally Switch"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${where(b)} || damaged ${damageOrder(b)}`,
})), { lines: false });

// A6. Leech Seed heals whoever stands at the seeder's slot (data/moves.ts:10218-10227 getAtSlot(sourceSlot)); the seeded
// Pokémon keeps its volatile wherever it stands.
if (want("A6")) report("A6 sv: Lapras (p2a) seeded by p1a Jolteon (carried); this turn Snorlax (p1b) Ally Switches: who gains at the end", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow],
  setup: (b) => { b.p1.active[0].sethp(50); b.p1.active[1].sethp(50); b.p2.active[0].addVolatile("leechseed", b.p1.active[0]); },
  inspect: (b) => `${where(b)} || HP ${[...b.p1.active, ...b.p2.active].map((p: any) => `${p.name} ${p.hp}`).join(", ")}`,
})));
if (want("A6")) report("A6b sv: the seeded Lapras (p2a) Ally Switches: still drained, the seeder Jolteon (p1a) gains", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Ally Switch"] }, slow],
  setup: (b) => { b.p1.active[0].sethp(50); b.p2.active[0].addVolatile("leechseed", b.p1.active[0]); },
  inspect: (b) => `${where(b)} || HP ${[...b.p1.active, ...b.p2.active].map((p: any) => `${p.name} ${p.hp}`).join(", ")}`,
})));

// A7. A Wish (slot condition) heals whoever stands at its slot at the end of turn (data/moves.ts:20925-20944; sim/battle.ts:1597-1601
// swaps side.active, not slotConditions).
if (want("A7")) report("A7 sv: a Wish lands on p1a's slot this end of turn; p1b Snorlax Ally Switches into it", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow],
  setup: (b) => {
    b.p1.active[0].sethp(50); b.p1.active[1].sethp(50);
    b.p1.addSlotCondition(b.p1.active[0], "wish", b.p1.active[0]);
    // Lands at this end of turn: residual needs getOverflowedTurnCount() (turn - 1 = 0 on turn 1) > startingTurn (sim/battle.ts:3318-3320).
    b.p1.slotConditions[0].wish.startingTurn = -1;
  },
  inspect: (b) => `${where(b)} || HP ${b.p1.active.map((p: any) => `${p.name} ${p.hp}`).join(", ")}`,
})));

// A8. The repeat counter (gen 9 only: data/moves.ts:311-352; gen8 mod removes onPrepareHit, data/mods/gen8/moves.ts:2-6; gen7
// inherits gen8): a second use on the next turn succeeds 1/3.
for (const game of ["sv", "champions", "swsh", "usum"] as const) if (want("A8")) {
  report(`A8 ${game}: Snorlax Ally Switch two turns running`, enumerate(base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
      { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow],
    turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]],
    inspect: where,
  })), { lines: false });
}

// A9. Ally Switch fails with a fainted ally (data/moves.ts:322-328): fainted before the turn, and fainted earlier this turn.
if (want("A9")) report("A9 sv: p1a fainted before the turn; Snorlax (p1b) Ally Switch", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, slow],
  turns: [["pass, move 1", "move 1, move 1"]],
  setup: (b) => { b.p1.active[0].faint(); b.faintMessages(); },
  inspect: where,
})));
if (want("A9")) report("A9b sv: Fake Out knocks out p1a (1 HP) first; then Snorlax (p1b) Ally Switch", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Fake Out"] }, slow],
  turns: [["move 1, move 1", "move 1 1, move 1"]],
  setup: (b) => { b.p1.active[0].sethp(1); },
  inspect: where,
})));

// A10. A random-target move and a fainted-foe retarget after a swap read the positions as they are then (getRandomTarget).
if (want("A10")) report("A10 sv: Outrage-like randomNormal (Thrash) from Snorlax after p2b Jolteon Ally Switch", enumerate(base({
  mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Thrash"] }, still, { species: "Lapras", ability: "Shell Armor", moves: ["Splash"] }, { species: "Jolteon", ability: "Volt Absorb", moves: ["Ally Switch"] }],
  turns: [["move 1, move 1", "move 1, move 1"]],
  inspect: (b) => `${where(b)} || damaged ${damageOrder(b)}`,
})), { lines: false });

// A11. The counter moves at PrepareHit (onPrepareHit addVolatile -> onRestart randomChance), before onHit's fainted-ally
// failure: a use that fails for a fainted ally still passes the 1/counter roll and multiplies the counter (Training's streak).
if (want("A11")) report("A11 sv: turn 1 Snorlax Ally Switch; turn 2 Lapras Extreme Speed knocks out its ally (1 HP) first, then Snorlax Ally Switch", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Ally Switch"] },
    { species: "Lapras", ability: "Shell Armor", moves: ["Extreme Speed", "Splash"] }, slow],
  turns: [["move 1, move 1", "move 2, move 1"], ["move 1, move 1", "move 1 2, move 1"]],
  setup: (b) => { b.p1.active[0].sethp(1); },
  inspect: (b) => `${where(b)} || Snorlax allyswitch volatile ${JSON.stringify(b.p1.active.find((p: any) => p.name === "Snorlax")?.volatiles.allyswitch ? { counter: b.p1.active.find((p: any) => p.name === "Snorlax").volatiles.allyswitch.counter, duration: b.p1.active.find((p: any) => p.name === "Snorlax").volatiles.allyswitch.duration } : null)}`,
})));
