// INPUTS ARCHITECT probes (status2): what an earlier-turn input changes in this turn on pinned Showdown c23d2e94, through
// the guards harness (guards-sim.ts: exact enumeration, every move hits, no critical hit unless certain, added effects below
// 100% fail, lowest rolls unless asked; `setup` writes the state from earlier turns before turn 1; multi-turn runs play the
// earlier turn itself). Every probe has a control. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/inputs-probes-1.ts [IN-P01 ...] > scripts/.cache/calc-audit/status2/design/inputs-probes-1.out
import { Dex, enumerate, monAt, report, showTrace, start, type Mon, type Probe } from "./guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",") || "-";
const who = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}${p?.status ? " " + p.status : ""}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ");
const LINES = /^\|(move|cant|-miss|-fail|-heal|-damage|-boost|-unboost|-enditem|-item|-activate|-immune|-start|-end|-status|-crit|-singlemove|-singleturn|faint|-fieldend|-prepare|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const shuckle: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const run = (title: string, probe: Probe, opts: { lines?: boolean; outcomes?: boolean } = { lines: true }) => report(title, enumerate({ lines: LINES, ...probe }), opts);

// IN-P01 (the stall counter, "Protecting moves in a row"): the stall volatile (PS/data/conditions.ts:439-462) set by a
// successful protecting move the turn before holds counter 3 (9 after two in a row, ×3 to 729); this turn's Protect
// passes its PrepareHit StallMove with randomChance(1, counter) (PS/data/moves.ts:13973-13978), else fails and the
// volatile is deleted. Control: no stall volatile (certain). Same in Champions (its protect is inherit, pp 5 only).
for (const game of ["sv", "champions"] as const) {
  for (const counter of [0, 3, 9] as const) {
    if (!want("IN-P01")) continue;
    run(`IN-P01 ${game}: Garchomp Protect with stall counter ${counter || "none (control)"}; a slower foe's Tackle into it`, {
      game, turns: [["move 1, move 1", "move 1 1, move 1"]],
      mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Protect"], evs: { spe: 252 } }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"] }, lax(1)],
      setup: (b) => { if (counter) { const g = b.p1.active[0]; g.addVolatile("stall"); g.volatiles.stall.counter = counter; } },
    });
  }
}

// IN-P02 (why the engine, not Training's splits.ts No-move stand-in, must take the failed Protect): a failed Protect has
// already passed BeforeMove, so a confused user can still hurt itself first and Gravity does not stop it (Protect has no
// gravity flag), while No move (Splash) under Gravity is stopped at BeforeMove priority 6, before confusion (3).
for (const [label, move] of [["Protect with stall 3", "Protect"], ["control: Splash (No move)", "Splash"]] as const) if (want("IN-P02")) {
  run(`IN-P02 sv: a confused Garchomp under Gravity uses ${label}`, {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Garchomp", ability: "Rough Skin", moves: [move], evs: { spe: 252 } }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"] }, lax(1)],
    chances: ["confusion"],
    setup: (b) => {
      const g = b.p1.active[0];
      if (move === "Protect") { g.addVolatile("stall"); g.volatiles.stall.counter = 3; }
      g.addVolatile("confusion"); g.volatiles.confusion.time = 4;
      b.field.addPseudoWeather("gravity", b.p1.active[1]);
    },
  });
}

// IN-P03 (a two-turn move charged last turn, "Charged last turn"): the charge turn adds twoturnmove + the move's volatile
// (Dig: semi-invulnerable, PS/data/moves.ts dig condition onInvulnerability); on the next turn the Pokémon is locked
// into the move, out of reach until its action (a faster foe's Tackle misses; Earthquake hits Dig at 2x), then it
// releases with no charge. Control: the same turn without the charge turn before it (Dig charges now).
for (const [label, turns] of [
  ["charged on turn 1, released on turn 2", [["move 2, move 2", "move 1 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]]],
  ["control: Dig chosen on turn 2 only (turn 1 Splash)", [["move 2, move 2", "move 2, move 1"], ["move 1 1, move 1", "move 1 1, move 1"]]],
] as const) if (want("IN-P03")) {
  run(`IN-P03 sv: Garchomp Dig, ${label}; turn 2: a faster Weavile Night Slash into it, Shuckle Earthquake`, {
    game: "sv", turns: turns as unknown as [string, string][],
    mons: [{ species: "Weavile", ability: "Pressure", moves: ["Night Slash", "Splash"], evs: { spe: 252 } }, { species: "Shuckle", ability: "Gluttony", moves: ["Earthquake", "Splash"] },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dig", "Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash", "Splash"] }],
    inspect: (b) => `turn ${b.turn}: Garchomp [${vols(b.p2.active[0])}]`,
  });
}
// Solar Beam released without sun; Phantom Force released through Protect.
for (const [label, move, protect] of [["Solar Beam (no sun)", "Solar Beam", false], ["Phantom Force into a Protect", "Phantom Force", true]] as const) if (want("IN-P03")) {
  run(`IN-P03b sv: Venusaur ${label}, charged on turn 1, released on turn 2`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1, move 1", protect ? "move 2, move 1" : "move 1, move 1"]],
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: [move] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash", "Protect"], evs: { spe: 252 } }, lax(1)],
  });
}

// IN-P04 (Laser Focus from last turn, USUM and SwSh): the laserfocus volatile (duration 2) makes every attack of the next
// turn a critical hit (onModifyCritRatio 5, clamped to 4: always). A use on the turn before is the volatile with 1 turn
// left at this turn's start. Control: none.
for (const game of ["usum", "swsh"] as const) for (const on of [true, false]) if (want("IN-P04")) {
  run(`IN-P04 ${game}: Kommo-o Close Combat into Snorlax, ${on ? "Laser Focus used last turn" : "control: no Laser Focus"}`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Kommo-o", ability: "Bulletproof", moves: ["Close Combat"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, lax(1)],
    setup: (b) => { if (on) { const k = b.p1.active[0]; k.addVolatile("laserfocus"); k.volatiles.laserfocus.duration = 1; } },
  });
}

// IN-P05 (Destiny Bond up from last turn): the destinybond volatile stays until its holder's next BeforeMove (priority -1)
// or a stopped action (MoveAborted), PS/data/moves.ts:3483-3526; so a faster foe that knocks it out this turn before it acts
// faints too. A second Destiny Bond fails in its PrepareHit while the volatile stands. Control: Splash on turn 1.
for (const [label, first] of [["Destiny Bond on turn 1 (last to move)", "move 1"], ["control: Splash on turn 1", "move 2"]] as const) if (want("IN-P05")) {
  run(`IN-P05 sv: slow Gengar ${label}; turn 2 a faster Weavile Night Slash knocks it out first`, {
    game: "sv", turns: [[`move 2, move 1`, `${first}, move 1`], [`move 1 1, move 1`, `move 3 1, move 1`]],
    mons: [{ species: "Weavile", ability: "Pressure", moves: ["Night Slash", "Splash"], evs: { spe: 252 } }, shuckle,
      { species: "Gengar", ability: "Cursed Body", moves: ["Destiny Bond", "Splash", "Shadow Ball"], ivs: { spe: 0 }, nature: "Brave" }, lax(1)],
    setup: (b) => { b.p2.active[0].sethp(1); },
    inspect: (b) => `Weavile ${b.p1.active[0]?.fainted ? "fainted" : b.p1.active[0]?.hp}`,
  });
}
if (want("IN-P05")) {
  run("IN-P05b sv: Gengar Destiny Bond on turn 1 and again on turn 2 (its volatile still up)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 1, move 1", "move 1, move 1"]],
    mons: [lax(3), shuckle, { species: "Gengar", ability: "Cursed Body", moves: ["Destiny Bond"], ivs: { spe: 0 } }, lax(1)],
  });
}

// IN-P06 (Telekinesis turns left): Telekinesis (USUM; duration 3, residual order 19) lifts its holder; with 1 turn left it
// ends at 19, so Yawn's sleep at order 23 meets Electric Terrain on a grounded Pokémon (no sleep). With 2 left it is still
// floating at 23 and falls asleep. Control pair: the two durations.
for (const left of [1, 2]) if (want("IN-P06")) {
  run(`IN-P06 usum: drowsy Snorlax with Telekinesis (${left} turn${left > 1 ? "s" : ""} left) under Electric Terrain`, {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(3), shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Lifted" }, lax(1)],
    setup: (b) => {
      const p = b.p2.active[0];
      p.addVolatile("telekinesis"); p.volatiles.telekinesis.duration = left;
      p.addVolatile("yawn"); p.volatiles.yawn.duration = 1;
      b.field.setTerrain("electricterrain", b.p1.active[0]);
      b.field.terrainState.duration = 4;
    },
  });
}

// IN-P07 (a field effect that ends this turn: "Ends this turn"): Misty Terrain (27.7) with 1 turn left ends before Flame
// Orb (28.3), which then burns; with 2 left it blocks it. Magic Room (27.6) with 1 left: Flame Orb burns and a Sitrus is
// eaten at the final Update; with 2 left neither. Gravity (27.2) with 1 left under Misty Terrain: a Flying Flame Orb holder
// is no longer grounded at 28.3, so Misty Terrain no longer protects it.
for (const left of [1, 2]) if (want("IN-P07")) {
  run(`IN-P07a sv: grounded Snorlax with Flame Orb, Misty Terrain with ${left} turn${left > 1 ? "s" : ""} left`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(3), shuckle, { species: "Snorlax", ability: "Thick Fat", item: "Flame Orb", moves: ["Splash"], name: "Orb" }, lax(1)],
    setup: (b) => { b.field.setTerrain("mistyterrain", b.p1.active[0]); b.field.terrainState.duration = left; },
    inspect: (b) => `Orb status ${b.p2.active[0].status || "none"}; terrain ${b.field.terrain || "none"}`,
  });
  run(`IN-P07b sv: Snorlax with Flame Orb and Snorlax with Sitrus at 100 HP, Magic Room with ${left} turn${left > 1 ? "s" : ""} left`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(3), shuckle, { species: "Snorlax", ability: "Thick Fat", item: "Flame Orb", moves: ["Splash"], name: "Orb" }, { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Splash"], evs: { spe: 16 }, name: "Sitrus" }],
    setup: (b) => { b.p2.active[1].sethp(100); b.field.addPseudoWeather("magicroom", b.p1.active[0]); b.field.pseudoWeather.magicroom.duration = left; },
    inspect: (b) => `Orb ${b.p2.active[0].status || "none"} item ${b.p2.active[0].item || "-"}; Sitrus ${b.p2.active[1].hp} item ${b.p2.active[1].item || "-"}`,
  });
  run(`IN-P07c sv: Flying Corviknight with Flame Orb under Misty Terrain (5), Gravity with ${left} turn${left > 1 ? "s" : ""} left`, {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [lax(3), shuckle, { species: "Corviknight", ability: "Pressure", item: "Flame Orb", moves: ["Splash"], name: "Orb" }, lax(1)],
    setup: (b) => {
      b.field.setTerrain("mistyterrain", b.p1.active[0]); b.field.terrainState.duration = 5;
      b.field.addPseudoWeather("gravity", b.p1.active[0]); b.field.pseudoWeather.gravity.duration = left;
    },
    inspect: (b) => `Orb status ${b.p2.active[0].status || "none"}; gravity ${b.field.pseudoWeather.gravity ? "up" : "ended"}`,
  });
}

// IN-P08 (entry order, "Entered first"): a redirect tie at equal priority and Speed goes to the holder whose ability state
// is older (PS/sim/battle.ts:413-419 compareRedirectOrder, :789-792: fastExit runEvent sorts with it, no shuffle); the
// leads' ability states are made p1a, p1b, p2a, p2b (battle.ts:2689-2699 then battle-actions.ts:142). Follow Me ties read
// the holders' ability states, not which Follow Me came first. Controls: re-initialising one holder's ability state
// (as a later entry or an ability change would) moves the tie to the other.
// The two holders tie at every speed sort, so these runs fix every tie shuffle (the battle's own PRNG for the rest) instead
// of enumerating: "first" keeps each tied run in place, "reversed" reverses each one. The queue is sorted several times,
// so both policies happened to leave A's Follow Me first; the redirect then follows the ability state, not the use order:
// with A's state re-made, B takes the Tackle although A's Follow Me came first.
function tieRun(title: string, probe: Probe, ties: "first" | "reversed") {
  const b = start(probe);
  b.prng.shuffle = (list: unknown[], from = 0, to = list.length) => { if (ties === "reversed") list.splice(from, to - from, ...list.slice(from, to).reverse()); };
  const at = b.log.length;
  for (const [c1, c2] of probe.turns) b.makeChoices(c1, c2);
  console.log(`
== ${title} (ties ${ties})`);
  for (const line of (b.log.slice(at) as string[]).filter((l) => /^\|(move|-activate|-damage|-immune|-boost|-singleturn)\|/.test(l))) console.log(`  ${line}`);
}
for (const [label, newer] of [["leads (Clefairy A older)", null], ["Clefairy A's ability state re-made (newer)", 0]] as const) for (const ties of ["first", "reversed"] as const) if (want("IN-P08")) {
  tieRun(`IN-P08a sv: two equal-Speed Clefairy (p2a A, p2b B) use Follow Me; a slower Snorlax Tackles B: ${label}`, {
    game: "sv", turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], ivs: { spe: 0 } }, shuckle,
      { species: "Clefairy", ability: "Friend Guard", moves: ["Follow Me"], name: "A" }, { species: "Clefairy", ability: "Friend Guard", moves: ["Follow Me"], name: "B" }],
    setup: (b) => { if (newer !== null) { const p = b.p2.active[newer]; p.abilityState = b.initEffectState({ id: p.ability, target: p }); } },
  }, ties);
}
for (const [label, newer] of [["leads (p1b Raichu older)", "p1"], ["p1b Raichu's ability state re-made (newer)", "p1re"]] as const) for (const ties of ["first", "reversed"] as const) if (want("IN-P08")) {
  tieRun(`IN-P08b sv: Lightning Rod Raichu as p1b (OwnRod) and as p2a (FoeRod), equal Speed; p1a Thunderbolt into p2b: ${label}`, {
    game: "sv", turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Rotom", ability: "Levitate", moves: ["Thunderbolt"] }, { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "OwnRod" },
      { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "FoeRod" }, lax(1)],
    setup: (b) => { if (newer === "p1re") { const p = b.p1.active[1]; p.abilityState = b.initEffectState({ id: p.ability, target: p }); } },
  }, ties);
}

// IN-P09 (Cud Chew, "Berry eaten last turn"): a Berry eaten during the moves sets counter 2 (eaten at a residual Update,
// counter 1: PS/data/abilities.ts:742-766); the residual at 28.2 counts down and re-eats it at 0, so a Berry eaten on
// turn 1 comes back at the end of turn 2. Control: the end of turn 1 (nothing).
if (want("IN-P09")) {
  run("IN-P09 sv: Farigiraf (Cud Chew, Sitrus) at 120 HP: turn 1 a foe hits it, Sitrus eaten; turns 1 and 2 end", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Splash"], evs: { spe: 252 } }, { species: "Shuckle", ability: "Sturdy", moves: ["Splash"] },
      { species: "Farigiraf", ability: "Cud Chew", item: "Sitrus Berry", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }],
    setup: (b) => { b.p2.active[0].sethp(120); },
    inspect: (b) => { const f = b.p2.active[0]; return `Farigiraf ${f.hp}/${f.maxhp} item ${f.item || "-"} chew ${(f.abilityState as any).berry?.id ?? "-"}:${(f.abilityState as any).counter ?? "-"}`; },
  });
}

// IN-P10 (Future Sight landing: the input needs the user's identity, not a snapshot): the landing (order 3) runs
// trySpreadMoveHit from data.source as it is when it lands (PS/data/conditions.ts:379-423): +2 Sp. Atk gained after the use
// counts; a user that switched out hits with its bench state (stages cleared). Lands two turns after the use
// (endingTurn = turn - 1 + 2 against the overflowed turn count). Controls: no boost, the benched user.
for (const [label, second] of [["turn 2 Nasty Plot (+2)", "move 2"], ["control: turn 2 Splash", "move 3"], ["turn 2 Nasty Plot, then switched out on turn 3", "move 2"]] as const) if (want("IN-P10")) {
  const benched = label.includes("switched");
  run(`IN-P10 sv: Hatterene Future Sight into Snorlax on turn 1; ${label}; it lands at the end of turn 3`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], [`${second}, move 1`, "move 1, move 1"], [benched ? "switch 3, move 1" : "move 3, move 1", "move 1, move 1"]],
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Future Sight", "Nasty Plot", "Splash"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Target" }, lax(1)],
    bench: { p1: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 40 }, name: "Bench" }] },
  }, { lines: false });
}
if (want("IN-P10")) {
  run("IN-P10b sv: Future Sight on turn 1 and again on turn 2 into the same Snorlax (one pending)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Future Sight"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Target" }, lax(1)],
  });
}

// IN-P11 (the battle's last move, "Copycat"): Copycat calls this.lastMove (PS/data/moves.ts copycat: the last move used
// in the battle, by anyone, kept across turns), so a Copycat that moves first this turn calls last turn's last move.
for (const move of ["Ember", "Tackle"] as const) if (want("IN-P11")) {
  run(`IN-P11 sv: turn 1 slowest Snorlax uses ${move} last; turn 2 fastest Liepard Copycat into it`, {
    game: "sv", turns: [["move 2, move 1", "move 1, move 1 1"], ["move 1, move 1", "move 1, move 2"]],
    mons: [{ species: "Liepard", ability: "Limber", moves: ["Copycat", "Splash"], evs: { spe: 252 } }, shuckle, lax(3), { species: "Snorlax", ability: "Thick Fat", moves: [move, "Splash"], ivs: { spe: 0 }, name: "Last" }],
  });
}

// IN-P12 (a side's faint last turn, "Retaliate"): side.faintedLastTurn (set when a Pokémon of the side faints, moved to
// faintedLastTurn at the next turn's start) doubles Retaliate (PS/data/moves.ts retaliate onBasePower). Control: no faint.
for (const faint of [true, false]) if (want("IN-P12")) {
  run(`IN-P12 sv: Shuckle ${faint ? "faints on turn 1" : "control: does not faint"}; turn 2 its ally Snorlax Retaliate into Garchomp`, {
    game: "sv", turns: [["move 2, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 2, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Retaliate", "Splash"] }, { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] },
      { species: "Garchomp", ability: "Rough Skin", moves: [faint ? "Earthquake" : "Splash", "Splash"], evs: { spe: 252 } }, lax(1)],
    bench: { p1: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 40 }, name: "Bench" }] },
    setup: (b) => { if (faint) b.p1.active[1].sethp(1); },
  }, { lines: false });
}

// IN-P13 (Echoed Voice from last turn): the echoedvoice field condition counts consecutive turns of any Echoed Voice
// (PS/data/moves.ts echoedvoice onTry / basePowerCallback): another Pokémon's use on the next turn has 80 power.
for (const first of ["Echoed Voice", "Splash"] as const) if (want("IN-P13")) {
  run(`IN-P13 sv: turn 1 Sylveon ${first}; turn 2 its ally Snorlax Echoed Voice into Garchomp`, {
    game: "sv", turns: [[first === "Splash" ? "move 2, move 2" : "move 1 1, move 2", "move 1, move 1"], ["move 2, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Sylveon", ability: "Cute Charm", moves: ["Echoed Voice", "Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Echoed Voice", "Splash"] },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(1)],
  }, { lines: false });
}

// IN-P14 (Dynamax turns left, SwSh): Dynamax lasts 3 turns (PS/data/conditions.ts dynamax duration 3); it ends at the end
// of its third turn, the HP shown scaled back. Turn by turn HP and maximum HP.
if (want("IN-P14")) {
  run("IN-P14 swsh: Snorlax Dynamaxes on turn 1, three turns of Max Quake into Garchomp; Garchomp Dragon Claw into it", {
    game: "swsh", turns: [["move 1 1 dynamax, move 1", "move 1 1, move 1"], ["move 1 1, move 1", "move 1 1, move 1"], ["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Earthquake"] }, shuckle, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(1)],
    inspect: (b) => { const s = b.p1.active[0]; return `turn ${b.turn} Snorlax ${s.hp}/${s.maxhp} dynamax ${s.volatiles.dynamax ? `up (${s.volatiles.dynamax.duration})` : "ended"}`; },
  }, { lines: false });
}

// IN-P15 (Psychic Noise's Heal Block from last turn, SV): Psychic Noise gives healblock with duration 2 (PS/data/moves.ts
// healblock durationCallback); on the next turn it has 1 turn left: Leftovers (5.4) still blocked, then it ends at 20.
if (want("IN-P15")) {
  run("IN-P15 sv: Farigiraf Psychic Noise into Snorlax (Leftovers, 150 HP) on turn 1; turns 2 and 3 Splash", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"], ["move 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Farigiraf", ability: "Armor Tail", moves: ["Psychic Noise", "Splash"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", item: "Leftovers", moves: ["Splash"], name: "Blocked" }, lax(1)],
    setup: (b) => { b.p2.active[0].sethp(150); },
    inspect: (b) => { const s = b.p2.active[0]; return `turn ${b.turn - 1} end: Blocked ${s.hp} healblock ${s.volatiles.healblock ? s.volatiles.healblock.duration : "-"}`; },
  }, { lines: false });
}

// IN-P16 (a carried accuracy or evasion stage read by this turn's move): Acupressure picks among the stats below +6
// (PS/data/moves.ts acupressure), so a carried evasion +6 leaves six. Control: no stage, seven.
for (const evasion of [6, 0]) if (want("IN-P16")) {
  run(`IN-P16 sv: Shuckle Acupressure on itself with evasion ${evasion > 0 ? "+" : ""}${evasion}`, {
    game: "sv", turns: [["move 1, move 1 -2", "move 1, move 1"]],
    mons: [lax(3), { species: "Shuckle", ability: "Gluttony", moves: ["Acupressure"] }, lax(2), lax(1)],
    setup: (b) => { b.p1.active[1].boosts.evasion = evasion; },
    inspect: (b) => `Shuckle ${boosts(b.p1.active[1])}`,
  }, { lines: false });
}

// IN-P17 (Taunt from an earlier turn): with 1 turn left it ends at residual 15 this turn; a Taunt into it this turn fails
// (no onRestart: addVolatile returns false). Control: 2 turns left (it stays).
for (const left of [1, 2]) if (want("IN-P17")) {
  run(`IN-P17 sv: Snorlax taunted (${left} turn${left > 1 ? "s" : ""} left); Grimmsnarl Taunts it again`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Grimmsnarl", ability: "Prankster", moves: ["Taunt"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "Taunted" }, lax(1)],
    setup: (b) => { const p = b.p2.active[0]; p.addVolatile("taunt"); p.volatiles.taunt.duration = left; },
    inspect: (b) => `Taunted taunt ${b.p2.active[0].volatiles.taunt ? b.p2.active[0].volatiles.taunt.duration : "-"}`,
  });
}

// IN-P18 (Battle Bond once a battle, SV: pokemon.bondTriggered): a KO raises Attack, Sp. Atk and Speed once; with
// bondTriggered already set it does nothing. Control: not triggered.
for (const used of [false, true]) if (want("IN-P18")) {
  run(`IN-P18 sv: Greninja-Bond knocks out a 1 HP Snorlax; Battle Bond ${used ? "already used" : "not used (control)"}`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Greninja-Bond", ability: "Battle Bond", moves: ["Water Shuriken"] }, shuckle, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, lax(1)],
    setup: (b) => { b.p2.active[0].sethp(1); if (used) b.p1.active[0].bondTriggered = true; },
    inspect: (b) => `Greninja ${boosts(b.p1.active[0])}`,
  }, { lines: false });
}

// IN-P19 (Leech Seed, Yawn, perish count, partial trap, Salt Cure from earlier turns: the existing carried fields the
// calculator never sets): one run each to pin the residual amounts the IN cases expect (Snorlax 50, 236 max HP).
if (want("IN-P19")) {
  const seeded = { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Seeded" } as Mon;
  showTrace("IN-P19 sv: Snorlax with Leech Seed (from Venusaur), Salt Cure, a drowsy Yawn and perish count 1", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Splash"] }, shuckle, seeded, lax(1)],
    setup: (b) => {
      const s = b.p2.active[0], v = b.p1.active[0];
      s.addVolatile("leechseed", v); s.addVolatile("saltcure", v); s.addVolatile("yawn"); s.volatiles.yawn.duration = 1;
      s.addVolatile("perishsong"); s.volatiles.perishsong.duration = 1;
    },
  }, /^\|(-damage|-heal|-status|-start|-end|faint|turn)\|/);
}

void Dex;
