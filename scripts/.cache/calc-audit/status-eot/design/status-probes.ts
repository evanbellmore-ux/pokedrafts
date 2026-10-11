// Status-move architect's design probes, batch 1 (status moves inside the turn), on pinned Showdown c23d2e94 through
// status-sim.ts (exact enumeration of every random decision, the turn run through the residual phase). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes.ts [P1 P2 ...] > scripts/.cache/calc-audit/status-eot/design/status-probes.out
import { enumerate, report, start, type Probe } from "./status-sim";

const L = /^\|(move|cant|-status|-curestatus|-start|-end|-activate|-fail|-immune|-damage|-heal|-boost|-unboost|-item|-enditem|-ability|-sethp|-swap|-singleturn|-clearallboost|-copyboost|-transform|-miss)\|/;
// Fillers with distinct Speeds (no tie shuffles): Blissey 75, Chansey 71, Shuckle 25 (level 50, 31 IVs, neutral).
const splash = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const still = { species: "Chansey", ability: "Natural Cure", moves: ["Splash"] };
const slow = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<Probe>): Probe => ({ game: "sv", mons: [splash, still, splash, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);

function speeds(p: Probe) {
  const b = start(p);
  return [...b.p1.active, ...b.p2.active].map((m: any) => `${m.side.id}${"ab"[m.position]} ${m.species.name} spe ${m.getStat("spe")} atk ${m.storedStats.atk} def ${m.storedStats.def} hp ${m.maxhp}`).join(" | ");
}

// P1. Sleep inflicted this turn: the target cannot wake at its first BeforeMove (startTime random(2,5) in SV/SwSh/USUM,
// sample([2,3,3]) in Champions; slp onBeforeMove time-- and wakes at <= 0), except Early Bird (time -= 2): 1/3 wakes at once.
if (want("P1")) for (const game of ["sv", "champions", "usum"] as const) {
  const p = base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis"] }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 1 1, move 1", "move 1 1, move 1"]],
  });
  console.log(`\n${game} speeds: ${speeds(p)}`);
  report(`P1 ${game}: Hypnosis (Jolteon) into Snorlax, then Snorlax's Body Slam`, enumerate(p));
  report(`P1b ${game}: Hypnosis into Early Bird Kangaskhan (slower), then its Body Slam`,
    enumerate({ ...p, mons: [p.mons[0], splash, { species: "Kangaskhan", ability: "Early Bird", moves: ["Body Slam"] }, slow] }));
}

// P2. Yawn: no sleep at this turn's end (duration 2, onResidualOrder 23, onEnd trySetStatus), sleep at the next turn's end.
if (want("P2")) report("P2 sv: Yawn turn 1, Splash turn 2", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Yawn", "Splash"] }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
  lines: /^\|(-status|-start|-end)\|/,
})));

// P3. Thunder Wave on a faster foe: paralysis halves its Speed; from gen 8 the queue is sorted again after each action, so it
// moves after a slower Pokémon (gen 7: the order stays as sorted at the turn's start).
if (want("P3")) for (const game of ["sv", "champions", "usum", "swsh"] as const) {
  const p = base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] },
      { species: "Lapras", ability: "Shell Armor", moves: ["Ice Shard", "Body Slam"] }, { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] }],
    turns: [["move 1 1, move 1 1", "move 2 2, move 1"]],
    lines: /^\|(move|cant)\|/,
  });
  console.log(`\n${game} speeds: ${speeds(p)}`);
  report(`P3 ${game}: Thunder Wave into Lapras (80 -> 40), Snorlax 50 Body Slam into Lapras, Lapras Body Slam into Snorlax`, enumerate(p), { outcomes: true, lines: false });
}

// P4. Confusion inflicted this turn: 33% self-hit (randomChance(33, 100)) at its BeforeMove (confusion time random(2,6): no
// snap-out on the first), 40 BP typeless from its own Attack and Defense with stages (getConfusionDamage), 16 rolls.
if (want("P4")) for (const game of ["sv", "champions", "usum"] as const) {
  const p = base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Confuse Ray", "Swagger"] }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 1 1, move 1", "move 1 2, move 1"]],
    rolls: "all",
  });
  console.log(`\n${game} speeds: ${speeds(p)}`);
  report(`P4 ${game}: Confuse Ray into Snorlax, Snorlax Body Slam into Blissey (p1b)`, enumerate(p), { lines: false });
  report(`P4b ${game}: Swagger into Snorlax (+2 Atk, confused), self-hit reads +2 Atk`, enumerate({ ...p, turns: [["move 2 1, move 1", "move 1 2, move 1"]] }), { lines: false });
}

// P5. Taunt before the target's status move: it fails at BeforeMove (taunt onBeforeMovePriority 5).
if (want("P5")) report("P5 sv: Taunt into Snorlax, then its Curse", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Taunt"] }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Curse"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
})));

// P6. Will-O-Wisp before the target's physical attack halves its damage (burn in getDamage).
if (want("P6")) for (const first of ["Will-O-Wisp", "Splash"]) {
  report(`P6 sv: ${first} into Snorlax, then Snorlax Body Slam into Blastoise (lowest rolls)`, enumerate(base({
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: [first] }, { species: "Blastoise", ability: "Torrent", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [[first === "Splash" ? "move 1, move 1" : "move 1 1, move 1", "move 1 2, move 1"]],
  })), { lines: false });
}

// P7. Paralysis inflicted this turn: full paralysis at the target's own move, 1/4 (1/8 in Champions).
if (want("P7")) for (const game of ["sv", "champions"] as const) {
  report(`P7 ${game}: Thunder Wave into Snorlax, then Snorlax Body Slam`, enumerate(base({
    game,
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunder Wave"] }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 1 1, move 1", "move 1 2, move 1"]],
    lines: /^\|(cant|-status)\|/,
  })));
}

// P8. Freeze from before the turn: SV thaws 1/5 at each BeforeMove (no counter); Champions startTime 3, time-- each
// BeforeMove, thaws at <= 0 or 1/4 (a counter the build does not carry).
if (want("P8")) for (const game of ["sv", "champions"] as const) {
  report(`P8 ${game}: Snorlax frozen before the turn, Body Slam on turns 1, 2, 3`, enumerate(base({
    game,
    mons: [splash, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, slow],
    turns: [["move 1, move 1", "move 1 2, move 1"], ["move 1, move 1", "move 1 2, move 1"], ["move 1, move 1", "move 1 2, move 1"]],
    setup: (b) => { b.p2.active[0].setStatus("frz", null, null, true); },
    lines: /^\|(cant|-curestatus)\|/,
  })), { outcomes: true, lines: false });
}

// P9. Attract: 50% immobilised (attract onBeforeMovePriority 2), opposite genders only.
if (want("P9")) report("P9 sv: Attract (M Jolteon) into F Snorlax, then Snorlax Body Slam", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Attract"], gender: "M" }, splash, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], gender: "F" }, slow],
  turns: [["move 1 1, move 1", "move 1 2, move 1"]],
  lines: /^\|(cant|-start|-activate)\|/,
})));
