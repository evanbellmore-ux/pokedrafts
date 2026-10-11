// TIER 2 (presence) probes, part 2: the Counter family, Beat Up, the calling moves (Nature Power, Copycat, Me First,
// Instruct, Mirror Move, Sleep Talk, Assist, Metronome's pool), the Pledges, Custap Berry with Quick Draw or Mycelium
// Might, on pinned Showdown c23d2e94 through guards-sim.ts (exact enumeration).
// Run from the repo root (optionally one part: C, BU, N, CC, MF, I, MM, ST, AS, ME, PL, CU):
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-2.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-2.out
import { Dex, enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",");
const state = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}${p?.status ? " " + p.status : ""}) ${boosts(p)}${vols(p) ? " [" + vols(p) + "]" : ""}`;
}).join(" | ");
const L = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|cant|-start|-end|-status|-curestatus|-sidestart|-sideend|-singleturn|-waiting|-combine|-prepare|-nothing|-crit|-supereffective|-resisted|-fieldstart|-fieldend|-hitcount|upkeep|turn|error)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: L, inspect: state, ...probe }), opts);
const PART = process.argv[2] ?? "all";
const on = (key: string) => PART === "all" || PART === key;

// ---------------------------------------------------------------------------------------------------------------------
// C. Counter, Mirror Coat, Metal Burst, Comeuppance (PS/data/moves.ts:2987-3030, 11984-12025, 11656-11685, 2681-2710;
// PS/sim/battle-actions.ts:960-996 gotAttacked after the hit loop with the last hit's damage)
// ---------------------------------------------------------------------------------------------------------------------
if (on("C")) {
  run("C1 Counter: 2x the physical hit's damage, at the attacker (lowest rolls)", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  });
  run("C1all Counter: all rolls (the damage 2x each roll)", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "all",
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  });
  run("C2 Counter after a two-hit move (Dual Wingbeat): 2x the last hit only (lowest rolls)", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dual Wingbeat"], evs: { spe: 252 } }, lax(2)],
  });
  showTrace("C3 Counter after two physical hits from two foes: the later attacker", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp2", evs: { spe: 100 } }],
  }, L);
  showTrace("C4 Counter with Follow Me on the attacker's side: Follow Me (1) takes it before the counter redirect (-1)?", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } },
      { species: "Clefable", ability: "Magic Guard", moves: ["Follow Me"], name: "FollowMe" }],
  }, L);
  showTrace("C5 Counter with no physical hit (a special one): fails; Mirror Coat after the special hit", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 2"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, { species: "Wobbuffet", ability: "Shadow Tag", moves: ["Mirror Coat"], name: "Wobb2" },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], name: "Chomp2", evs: { spe: 200 } }],
  }, L);
  showTrace("C6 Counter after an ally's physical hit: fails (not a foe)", {
    game: "sv", turns: [["move 1, move 1 -1", "move 1, move 1"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "AllyTackle", evs: { spe: 100 } }, lax(1), lax(2)],
  }, L);
  run("C7 Metal Burst: 1.5x the last damage (lowest rolls; the rounding)", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "all",
    mons: [{ species: "Bastiodon", ability: "Sturdy", moves: ["Metal Burst"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], evs: { spe: 252 } }, lax(2)],
  });
  run("C8 Comeuppance (champions) after a special hit: 1.5x, at the attacker (lowest rolls)", {
    game: "champions", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Mabosstiff", ability: "Intimidate", moves: ["Comeuppance"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], evs: { spe: 32 } }, lax(2)],
  });
  showTrace("C9 Metal Burst moving before any hit: fails; Counter into a Ghost: immune", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Bastiodon", ability: "Sturdy", moves: ["Metal Burst"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(2)],
  }, L);
  showTrace("C10 Counter into a Ghost-type attacker (Shadow Claw): immune; Mirror Coat into a Dark-type attacker: immune", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 2"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, { species: "Wobbuffet", ability: "Shadow Tag", moves: ["Mirror Coat"], name: "Wobb2" },
      { species: "Gengar", ability: "Cursed Body", moves: ["Shadow Claw"], evs: { spe: 252 } }, { species: "Hydreigon", ability: "Levitate", moves: ["Dark Pulse"], evs: { spe: 200 } }],
  }, L);
  showTrace("C11 Metal Burst after a hit into its Substitute: damage 0 is recorded (1 HP?)", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].addVolatile("substitute"); },
    mons: [{ species: "Bastiodon", ability: "Sturdy", moves: ["Metal Burst"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("C12 Counter: the attacker switched places by Ally Switch after the hit: Counter goes to the slot", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } },
      { species: "Clefable", ability: "Magic Guard", moves: ["Ally Switch"], name: "Swapper", evs: { spe: 100 } }],
  }, L);
  showTrace("C13 Counter at a Sturdy attacker at full HP: Sturdy holds at 1; with Focus Sash", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"], evs: { hp: 252, def: 252 } }, lax(1), { species: "Magnezone", ability: "Sturdy", moves: ["Body Press"], evs: { spe: 252 } }, lax(2)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// BU. Beat Up (PS/data/moves.ts:1150-1172): the party in side.pokemon order, the user always, the others alive with no status
// ---------------------------------------------------------------------------------------------------------------------
if (on("BU")) {
  run("BU1 Beat Up: user, partner and two healthy bench members (lowest rolls; hit count)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], rolls: "lowest",
    bench: { p1: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Bench2" }] },
    mons: [{ species: "Houndoom", ability: "Flash Fire", moves: ["Beat Up"], evs: { spe: 252 } }, { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }, lax(1), lax(2)],
  });
  run("BU2 Beat Up: the partner poisoned this turn first (Toxic from a faster foe): one hit fewer", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 2, move 1"]], rolls: "lowest",
    bench: { p1: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Bench2" }] },
    mons: [{ species: "Houndoom", ability: "Flash Fire", moves: ["Beat Up"] }, { species: "Kingambit", ability: "Defiant", moves: ["Splash"] },
      { species: "Glimmora", ability: "Toxic Debris", moves: ["Toxic"], evs: { spe: 252 } }, lax(2)],
  });
  showTrace("BU3 Beat Up into its own Justified ally (champions): one Attack rise per hit", {
    game: "champions", turns: [["move 1 -2, move 1", "move 1, move 1"]],
    bench: { p1: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }] },
    mons: [{ species: "Houndoom", ability: "Flash Fire", moves: ["Beat Up"], evs: { spe: 32 } }, { species: "Arcanine", ability: "Justified", moves: ["Splash"] }, lax(1), lax(2)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// Calling moves
// ---------------------------------------------------------------------------------------------------------------------
if (on("N")) {
  for (const [game, terrain] of [["swsh", "electricterrain"], ["usum", "psychicterrain"], ["usum", ""]] as const) {
    showTrace(`N1 Nature Power (${game}) in ${terrain || "no terrain"}: the called move at the chosen target`, {
      game, turns: [["move 1 2, move 1", "move 1, move 1"]], setup: (b) => { if (terrain) b.field.setTerrain(terrain, "debug"); },
      mons: [{ species: "Bellossom", ability: "Chlorophyll", moves: ["Nature Power"], evs: { spe: 252 } }, lax(1), lax(2, "FoeA"), lax(3, "FoeB")],
    }, L);
  }
  showTrace("N2 Nature Power (swsh, Electric Terrain) into a foe beside a Lightning Rod: redirected; Taunted: cannot", {
    game: "swsh", turns: [["move 1 2, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("electricterrain", "debug"); },
    mons: [{ species: "Bellossom", ability: "Chlorophyll", moves: ["Nature Power"], evs: { spe: 252 } }, lax(1), { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "Rod" }, lax(3, "FoeB")],
  }, L);
  showTrace("N3 Nature Power (usum) by a Prankster user into a Dark type: the called move hits (not a status move)", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Whimsicott", ability: "Prankster", moves: ["Nature Power"] }, lax(1), { species: "Umbreon", ability: "Synchronize", moves: ["Splash"] }, lax(3)],
  }, L);
}
if (on("CC")) {
  run("CC1 Copycat after a foe's Dragon Claw: Dragon Claw at a random foe (1/2 each)", {
    game: "sv", turns: [["move 1, move 1", "move 1 2, move 1"]], rolls: "lowest",
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  });
  showTrace("CC2 Copycat moving first: last turn's last move (turn 1 ends with a foe's Tackle)", {
    game: "sv", turns: [["move 2, move 1", "move 1, move 1 1"], ["move 1, move 1", "move 2, move 2"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat", "Splash"], evs: { spe: 252 } }, lax(1),
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash", "Protect"], name: "FoeA" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle", "Protect"], name: "FoeB" }],
  }, L);
  showTrace("CC3 Copycat after a Protect: Protect (callable); after a failed move; after a Dancer copy", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat"] }, lax(1), { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "FoeA", evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("CC4 Copycat after a move that was blocked (Dragon Claw into Protect): copied (lastMove is the used move)", {
    game: "sv", turns: [["move 1, move 1", "move 1 2, move 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "AllyProtect", evs: { spe: 200 } },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("CC5 Copycat after a fully paralysed Pokémon (cant): the move before it", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1 1"]], setup: (b) => { b.p2.active[1].setStatus("par"); },
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "ParLax", evs: { spe: 252 } }],
  }, L);
}
if (on("MF")) {
  run("MF1 Me First (usum) before the target's Dragon Claw: Dragon Claw at 1.5x into it (lowest rolls)", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Absol", ability: "Justified", moves: ["Me First"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(2)],
  });
  run("MF1c control: Absol using Dragon Claw into Garchomp (lowest rolls)", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Absol", ability: "Justified", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(2)],
  });
  showTrace("MF2 Me First: the target moved already: fails; target's status move: fails; target's spread move: copied as spread", {
    game: "usum", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: "Absol", ability: "Justified", moves: ["Me First"], evs: { spe: 252 } }, { species: "Absol", ability: "Justified", moves: ["Me First"], name: "Absol2", evs: { spe: 252 } },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "ChompEQ" }],
  }, L);
}
if (on("I")) {
  showTrace("I1 Instruct (sv) on an ally that moved this turn: it moves again at once, same target", {
    game: "sv", turns: [["move 1 -2, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Oranguru", ability: "Inner Focus", moves: ["Instruct"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(1), lax(2)],
  }, L);
  showTrace("I2 Instruct on an ally that has not moved yet this turn: its last move from turn 1 (Earthquake), then its own move", {
    game: "sv", turns: [["move 1, move 2", "move 1, move 1"], ["move 2 -2, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Oranguru", ability: "Inner Focus", moves: ["Splash", "Instruct"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw", "Earthquake"] }, lax(1), lax(2)],
  }, L);
  showTrace("I3 Instruct on a foe that used Protect: Protect again (fails: consecutive)?; on a target with no last move: fails", {
    game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: "Oranguru", ability: "Inner Focus", moves: ["Instruct"] }, { species: "Oranguru", ability: "Inner Focus", moves: ["Instruct"], name: "Ora2" },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "FoeProtect" }, lax(2)],
  }, L);
  showTrace("I4 Instruct (champions) on an ally that moved with a single-target move whose target fainted since", {
    game: "champions", turns: [["move 1 -2, move 1 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(1); },
    mons: [{ species: "Oranguru", ability: "Inner Focus", moves: ["Instruct"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 32 } }, lax(1), lax(2)],
  }, L);
}
if (on("MM")) {
  showTrace("MM1 Mirror Move (usum) after the target's Dragon Claw this turn: Dragon Claw at the target", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 2, move 1"]],
    mons: [{ species: "Fearow", ability: "Keen Eye", moves: ["Mirror Move"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("MM2 Mirror Move before the target moved: its last move from turn 1; after a status move without mirror (Swords Dance): fails", {
    game: "usum", turns: [["move 2, move 1", "move 1 2, move 1"], ["move 1 1, move 1", "move 2, move 1"]],
    mons: [{ species: "Fearow", ability: "Keen Eye", moves: ["Mirror Move", "Splash"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw", "Swords Dance"] }, lax(2)],
  }, L);
}
if (on("ST")) {
  run("ST1 Sleep Talk (sv): a uniform pick over its callable moves, the called move at a random foe", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], rolls: "lowest", setup: (b) => { b.p1.active[0].setStatus("slp"); b.p1.active[0].statusState.time = 3; },
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Sleep Talk", "Body Slam", "Protect", "Solar Beam"], name: "Talker" }, lax(1), lax(2, "FoeA"), lax(3, "FoeB")],
  });
  run("ST2 Sleep Talk with Comatose (sv): Komala awake-asleep", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Komala", ability: "Comatose", moves: ["Sleep Talk", "Wood Hammer", "Sucker Punch"] }, lax(1), lax(2, "FoeA"), lax(3, "FoeB")],
  });
}
if (on("AS")) {
  run("AS1 Assist (usum): a uniform pick over the party's other moves (the partner and the bench)", {
    game: "usum", turns: [["move 1, move 2", "move 1, move 1"]], rolls: "lowest",
    bench: { p1: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw", "Protect"] }] },
    mons: [{ species: "Liepard", ability: "Prankster", moves: ["Assist"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Splash"], name: "Partner" }, lax(2, "FoeA"), lax(3, "FoeB")],
  });
}
if (on("ME")) {
  for (const [game, mod] of [["sv", "gen9"], ["swsh", "gen8"], ["usum", "gen7"]] as const) {
    const dex = Dex.mod(mod);
    const pool = dex.moves.all().filter((m: any) => (!m.isNonstandard || m.isNonstandard === "Unobtainable") && m.flags["metronome"]);
    console.log(`\nME1 Metronome pool (${game}): ${pool.length} moves, ${pool.filter((m: any) => m.category !== "Status").length} damaging`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PL. The Pledges (PS/data/moves.ts:5380, 7579, 20519)
// ---------------------------------------------------------------------------------------------------------------------
const pledge = (species: string, move: string, spe = 0, name?: string): Mon => ({ species, ability: "Blaze", moves: [move], evs: { spe }, ...(name ? { name } : {}) });
if (on("PL")) {
  run("PL1 Fire Pledge (fast) + Grass Pledge (slow ally) with a foe in between: the first waits, the second at once, Fire 150, sea of fire on the foes", {
    game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]], rolls: "lowest",
    mons: [pledge("Charizard", "Fire Pledge", 252), { species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 252 }, name: "FoeA" }, lax(2, "FoeB")],
  });
  run("PL2 Water Pledge + Fire Pledge (swsh): Water 150, rainbow on the user's side", {
    game: "swsh", turns: [["move 1 1, move 1 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"], evs: { spe: 252 } }, pledge("Charizard", "Fire Pledge"), lax(1, "FoeA"), lax(2, "FoeB")],
  });
  run("PL3 Grass Pledge + Water Pledge (usum): Grass 150, swamp on the foes (Speed x0.25: the foes' order after)", {
    game: "usum", turns: [["move 1 1, move 1 1", "move 1, move 1 1"]], rolls: "lowest",
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"], evs: { spe: 252 } }, { species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "FoeA" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "FoeChomp" }],
  });
  run("PL3sv Grass Pledge + Water Pledge (sv): swamp; the faster foe now slower than the slowest ally?", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1 1"]], rolls: "lowest",
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"], evs: { spe: 252 } }, { species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "FoeA" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "FoeChomp", evs: { spe: 60 } }],
  });
  showTrace("PL4 the same Pledge twice: no combination; the first Pledge user flinched: no combination", {
    game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [pledge("Charizard", "Fire Pledge", 252), pledge("Arcanine", "Fire Pledge"), lax(1, "FoeA"), lax(2, "FoeB")],
  }, L);
  showTrace("PL5 a foe's Pledge does not combine with the user's", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [pledge("Charizard", "Fire Pledge", 252), lax(1), { species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"] }, lax(2, "FoeB")],
  }, L);
  showTrace("PL6 combined Pledge into a Protect: the side condition is not set?", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]],
    mons: [pledge("Charizard", "Fire Pledge", 252), { species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "FoeProtect" }, lax(2, "FoeB")],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// CU. Custap Berry with Quick Draw (PS/data/abilities.ts quickdraw) or Mycelium Might; FractionalPriority (PS/sim/battle-queue.ts:249)
// ---------------------------------------------------------------------------------------------------------------------
if (on("CU")) {
  run("CU1 Quick Draw Slowbro-Galar at 1/4 HP with Custap, an attack: 30% Quick Draw (Berry kept), else Custap eaten", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(40); },
    mons: [{ species: "Slowbro-Galar", ability: "Quick Draw", item: "Custap Berry", moves: ["Shell Side Arm"] }, lax(1),
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 252 }, name: "FoeFast" }, lax(2)],
  });
  run("CU2 Mycelium Might Toedscruel at 1/4 HP with Custap, a status move: not eaten; an attack: eaten", {
    game: "sv", turns: [["move 1 1, move 2", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(20); },
    mons: [{ species: "Toedscruel", ability: "Mycelium Might", item: "Custap Berry", moves: ["Spore"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash", "Splash"], name: "Ally" },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 252 }, name: "FoeFast" }, lax(2)],
  });
  run("CU2b Mycelium Might with Custap, an attack: eaten", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(20); },
    mons: [{ species: "Toedscruel", ability: "Mycelium Might", item: "Custap Berry", moves: ["Earth Power"] }, lax(1),
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: 252 }, name: "FoeFast" }, lax(2)],
  });
}
