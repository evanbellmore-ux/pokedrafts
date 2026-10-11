// TIER 2 (presence) probes, part 3: follow-ups to parts 1 and 2 (the swamp's Speed and the re-sort, Copycat's last turn,
// Instruct before the target moved, Metal Burst's rounding, Fusion with a fully paralysed Pokémon in between), and the
// start settle and field entries: redirect ties (effectOrder), Trace's random copy and Trace copying Intimidate, Download
// at the lead, Unburden at the turn's first Update, Wind Rider / Wind Power / Room Service, the field-settled abilities
// and items on a weather or terrain change, and the row moves (Present, Magnitude, Echoed Voice, Retaliate, Pursuit).
// Run from the repo root (optionally one part):
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-3.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-3.out
import { enumerate, monAt, report, showTrace, start, trace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",");
const state = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}${p?.status ? " " + p.status : ""}) ${boosts(p)}${vols(p) ? " [" + vols(p) + "]" : ""} ${p?.species?.name ?? ""}/${p?.ability ?? ""}`;
}).join(" | ");
const L = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|cant|-start|-end|-status|-curestatus|-sidestart|-sideend|-singleturn|-waiting|-combine|-prepare|-nothing|-crit|-supereffective|-resisted|-fieldstart|-fieldend|-hitcount|-formechange|detailschange|-transform|-clearallboost|upkeep|turn|error)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: L, inspect: state, ...probe }), opts);
const PART = process.argv[2] ?? "all";
const on = (key: string) => PART === "all" || PART === key;
/** The log lines of the battle's start (team preview to turn 1), filtered. */
const startLog = (title: string, probe: Probe, keep: RegExp = L) => {
  const b = start(probe);
  console.log(`\n== ${title}`);
  for (const line of (b.log as string[]).filter((l) => keep.test(l))) console.log(`  ${line}`);
  console.log(`  state: ${state(b)}`);
  return b;
};

// ---------------------------------------------------------------------------------------------------------------------
// FU. Follow-ups
// ---------------------------------------------------------------------------------------------------------------------
if (on("FU")) {
  const sp = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => `${id} spe ${monAt(b, id as any)?.getStat("spe")} (speed ${monAt(b, id as any)?.speed})`).join(", ");
  // FU1: the swamp's Speed: read each Pokémon's getStat('spe') at the residual (after the moves).
  run("FU1 swamp (sv): getStat('spe') after the combined Grass Pledge; the order of the two foes after it", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1 1"]], rolls: "lowest", inspect: sp,
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"], evs: { spe: 252 } }, { species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "FoeA" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "FoeChomp", evs: { spe: 60 } }],
  });
  run("FU1b swamp: the foe's Gyro Ball after it (sv), lowest rolls", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1 1"]], rolls: "lowest",
    mons: [{ species: "Venusaur", ability: "Overgrow", moves: ["Grass Pledge"], evs: { spe: 252 } }, { species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"] },
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "FoeA" }, { species: "Bronzong", ability: "Levitate", moves: ["Gyro Ball"], name: "FoeGyro" }],
  });
  showTrace("FU2 Copycat moving first in turn 2: copies the last move of turn 1 (FoeB's Tackle)", {
    game: "sv", turns: [["move 2, move 1", "move 1, move 1 1"], ["move 1, move 1", "move 1, move 2"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Copycat", "Splash"], evs: { spe: 252 } }, lax(1),
      { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "FoeA" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle", "Splash"], name: "FoeB" }],
  }, L);
  showTrace("FU3 Instruct on a slower ally that has not moved: its turn-1 Earthquake again, then its own Body Slam", {
    game: "sv", turns: [["move 1, move 2", "move 1, move 1"], ["move 2 -2, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Oranguru", ability: "Inner Focus", moves: ["Splash", "Instruct"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam", "Earthquake"], name: "Ally" }, lax(1), lax(2)],
  }, L);
  for (const rolls of ["lowest", "highest"] as const) run(`FU4 Metal Burst rounding: x1.5 of the damage (${rolls} rolls)`, {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls,
    mons: [{ species: "Bastiodon", ability: "Sturdy", moves: ["Metal Burst"], evs: { hp: 252, spd: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Pulse"], evs: { spe: 252 } }, lax(2)],
  });
  run("FU5 Fusion: Flare, a fully paralysed foe in between (Ninjask), then Bolt (lowest rolls)", {
    game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest", setup: (b) => { b.p2.active[0].setStatus("par"); },
    mons: [{ species: "Reshiram", ability: "Turboblaze", moves: ["Fusion Flare"], evs: { spe: 252 } }, { species: "Zekrom", ability: "Teravolt", moves: ["Fusion Bolt"] },
      { species: "Ninjask", ability: "Infiltrator", moves: ["Swords Dance"], evs: { spe: 252 }, nature: "Jolly" }, lax(2)],
  });
  run("FU6 Dancer after the Dancer copy: Fusion Flare? (n/a) - a Dancer copying Fiery Dance between Fusion Flare and Bolt (sv)", {
    game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Reshiram", ability: "Turboblaze", moves: ["Fusion Flare"], evs: { spe: 252 } }, { species: "Zekrom", ability: "Teravolt", moves: ["Fusion Bolt"] },
      { species: "Oricorio", ability: "Dancer", moves: ["Splash"] }, lax(2)],
  });
  run("FU7 Beak Blast: Dual Wingbeat into Beak Blast with a Guts attacker (no halving, Atk x1.5 after the burn)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Toucannon", ability: "Keen Eye", moves: ["Beak Blast"] }, lax(1), { species: "Ursaring", ability: "Guts", moves: ["Dual Wingbeat"], evs: { spe: 252 } }, lax(2)],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// RT. Redirect ties (PS/sim/battle.ts:413-419 compareRedirectOrder: priority, Speed, then the holder's abilityState.effectOrder)
// ---------------------------------------------------------------------------------------------------------------------
if (on("RT")) {
  const rod = (name: string, spe = 0): Mon => ({ species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], evs: { spe }, name, nature: "Serious" });
  const eo = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => `${id} ${monAt(b, id as any)?.name} effectOrder ${monAt(b, id as any)?.abilityState?.effectOrder}`).join(", ");
  const rtTrace = (title: string, probe: Probe) => {
    const b = start(probe);
    console.log(`
== ${title}
  start: ${eo(b)}`);
    for (const line of trace(probe, /^|(move|-activate|-ability|-boost|switch|-immune|-damage)|/)) console.log(`  ${line}`);
  };
  rtTrace("RT1 two Lightning Rods at one Speed, both foes of the attacker (lead order p2a then p2b): who takes Thunderbolt", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], evs: { spe: 252 } }, lax(1), rod("RodA"), rod("RodB")],
  });
  rtTrace("RT2 two Lightning Rods at one Speed: the attacker's ally and a foe (p1b and p2a): who takes it", {
    game: "sv", turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt"], evs: { spe: 252 } }, rod("RodAlly"), rod("RodFoe"), lax(2)],
  });
  rtTrace("RT3 the same, but p2a switched out and back (a newer effectOrder for RodFoe)", {
    game: "sv", turns: [["move 2, move 1", "switch 3, move 1"], ["move 2, move 1", "switch 3, move 1"], ["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt", "Splash"], evs: { spe: 252 } }, rod("RodAlly"), rod("RodFoe"), lax(2)],
    bench: { p2: [lax(3, "Swap")] },
  });
  rtTrace("RT4 two Follow Me users at one Speed on the same side (both centres): who takes the move", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(1),
      { species: "Clefable", ability: "Magic Guard", moves: ["Follow Me"], name: "FMA" }, { species: "Clefable", ability: "Magic Guard", moves: ["Follow Me"], name: "FMB" }],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// TR. Trace at the lead: a random adjacent foe (sample); copying Intimidate runs its Start (PS/data/abilities.ts trace)
// ---------------------------------------------------------------------------------------------------------------------
if (on("TR")) {
  const b = startLog("TR1 Trace at the lead with two different foe abilities (one decision: the first)", {
    game: "sv", turns: [], mons: [{ species: "Gardevoir", ability: "Trace", moves: ["Splash"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Hydreigon", ability: "Levitate", moves: ["Splash"] }],
  });
  void b;
  // Enumerate the lead: run one turn of Splash and read the traced ability at its end.
  run("TR2 Trace at the lead: the copy over the decisions (Rough Skin / Levitate)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b: any) => `trace copied ${b.p1.active[0].ability}`,
    mons: [{ species: "Gardevoir", ability: "Trace", moves: ["Splash"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Hydreigon", ability: "Levitate", moves: ["Splash"] }],
  });
  startLog("TR3 Trace copying Intimidate at the lead: both foes -1 Atk (with Defiant)", {
    game: "sv", turns: [], mons: [{ species: "Gardevoir", ability: "Trace", moves: ["Splash"] }, lax(1), { species: "Incineroar", ability: "Intimidate", moves: ["Splash"] }, { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }],
  });
  run("TR4 Trace with Intimidate and Defiant foes over the decisions: the copy and the stages", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Gardevoir", ability: "Trace", moves: ["Splash"] }, lax(1), { species: "Incineroar", ability: "Intimidate", moves: ["Splash"] }, { species: "Kingambit", ability: "Defiant", moves: ["Splash"] }],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// DL. Download at the lead (PS/data/abilities.ts download onStart: both foes' Defense and Sp. Def with stages)
// ---------------------------------------------------------------------------------------------------------------------
if (on("DL")) {
  startLog("DL1 Download at the lead vs Dauntless Shield Zamazenta (slower than Porygon-Z) and a Snorlax", {
    game: "sv", turns: [], mons: [{ species: "Porygon-Z", ability: "Download", moves: ["Splash"], evs: { spe: 252 } }, lax(1),
      { species: "Zamazenta", ability: "Dauntless Shield", moves: ["Splash"] }, lax(2)],
  }, /^\|(-boost|-ability|-activate|switch)\|/);
  startLog("DL2 Download at the lead vs a faster Dauntless Shield Zamazenta", {
    game: "sv", turns: [], mons: [{ species: "Porygon-Z", ability: "Download", moves: ["Splash"] }, lax(1),
      { species: "Zamazenta", ability: "Dauntless Shield", moves: ["Splash"], evs: { spe: 252 } }, lax(2)],
  }, /^\|(-boost|-ability|-activate|switch)\|/);
  run("DL3 Download at the lead with a Speed tie against Dauntless Shield: over the decisions", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], inspect: (b: any) => `Porygon-Z ${boosts(b.p1.active[0])}; Zamazenta ${boosts(b.p2.active[0])}`,
    mons: [{ species: "Porygon-Z", ability: "Download", moves: ["Splash"], evs: { spe: 4 } }, lax(1), { species: "Zamazenta", ability: "Dauntless Shield", moves: ["Splash"], evs: { spe: 0 } }, lax(2)],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// UB. Unburden at the turn's first Update (a curing Berry eaten before the first sort)
// ---------------------------------------------------------------------------------------------------------------------
if (on("UB")) {
  for (const game of ["sv", "usum", "champions"] as const) {
    showTrace(`UB1 ${game}: a paralysed Unburden Sneasler with Lum Berry, slower than a foe until the Berry`, {
      game, turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("par"); },
      mons: [{ species: game === "usum" ? "Hawlucha" : "Sneasler", ability: "Unburden", item: "Lum Berry", moves: ["Tackle"], evs: { spe: 0 } }, lax(1),
        { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: game === "champions" ? 32 : 252 } }, lax(2)],
    }, /^\|(move|-enditem|-curestatus|cant)\|/);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// AC. Wind Rider, Wind Power (onSideConditionStart tailwind), Room Service (onAnyPseudoWeatherChange)
// ---------------------------------------------------------------------------------------------------------------------
if (on("AC")) {
  showTrace("AC1 Tailwind with a Wind Rider ally (+1 Atk) and a Wind Power ally (charged); then the Wind Power holder's Thunderbolt", {
    game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Talonflame", ability: "Gale Wings", moves: ["Tailwind"], evs: { spe: 252 } }, { species: "Kilowattrel", ability: "Wind Power", moves: ["Thunderbolt"] },
      { species: "Brambleghast", ability: "Wind Rider", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("AC2 Tailwind on its own side with a Wind Rider ally; a foe's Wind Rider is not raised", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Talonflame", ability: "Gale Wings", moves: ["Tailwind"], evs: { spe: 252 } }, { species: "Brambleghast", ability: "Wind Rider", moves: ["Splash"], name: "RiderAlly" },
      { species: "Brambleghast", ability: "Wind Rider", moves: ["Splash"], name: "RiderFoe" }, lax(2)],
  }, L);
  showTrace("AC3 Trick Room with a Room Service holder (foe): -1 Spe, the item used (Unburden?)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Trick Room"] }, lax(1),
      { species: "Hawlucha", ability: "Unburden", item: "Room Service", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("AC4 Trick Room ending (used while up) with Room Service: not used; Room Service with Contrary", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("trickroom", "debug"); },
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Trick Room"] }, lax(1),
      { species: "Malamar", ability: "Contrary", item: "Splash Plate", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("AC5 Gravity starting while Trick Room is up: a Room Service holder that came in under Magic Room? (any pseudo-weather change)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.addPseudoWeather("trickroom", "debug"); b.p2.active[0].setItem("roomservice"); },
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Gravity"] }, lax(1), { species: "Hawlucha", ability: "Unburden", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("AC6 Room Service with Eject Pack? n/a (one item); Room Service drop with White Herb n/a; Room Service on a Clear Body holder (self drop: not blocked)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Hatterene", ability: "Magic Bounce", moves: ["Trick Room"] }, lax(1), { species: "Metagross", ability: "Clear Body", item: "Room Service", moves: ["Splash"] }, lax(2)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// FC. Field-settled abilities and items when the weather or terrain changes mid-turn
// ---------------------------------------------------------------------------------------------------------------------
if (on("FC")) {
  showTrace("FC1 Sunny Day: a Protosynthesis ally activates (its highest stat) before its own move", {
    game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Torkoal", ability: "Shell Armor", moves: ["Sunny Day"], evs: { spe: 252 } }, { species: "Great Tusk", ability: "Protosynthesis", moves: ["Headlong Rush"] }, lax(1), lax(2)],
  }, L);
  showTrace("FC2 Electric Terrain: a Quark Drive foe activates; then Ice Spinner (ally) ends the terrain after its hit: Quark Drive ends", {
    game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]],
    mons: [{ species: "Pincurchin", ability: "Lightning Rod", moves: ["Electric Terrain"], evs: { spe: 252 } }, { species: "Baxcalibur", ability: "Thermal Exchange", moves: ["Ice Spinner"] },
      { species: "Iron Hands", ability: "Quark Drive", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC3 sun ends at the end of turn (1 turn left): Protosynthesis with Booster Energy keeps the boost, the Energy used", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", "debug"); b.field.weatherState.duration = 1; },
    mons: [{ species: "Great Tusk", ability: "Protosynthesis", item: "Booster Energy", moves: ["Splash"] }, lax(1), lax(2), lax(3)],
  }, /^\|(-weather|-activate|-enditem|-end|-start|upkeep|turn)\|/);
  showTrace("FC4 Grassy Terrain mid-turn: a Grassy Seed holder uses it (+1 Def); Psychic Terrain with Psychic Seed", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Rillaboom", ability: "Overgrow", moves: ["Grassy Terrain"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", item: "Grassy Seed", moves: ["Splash"], name: "SeedAlly" },
      { species: "Hawlucha", ability: "Unburden", item: "Grassy Seed", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC5 Snowscape mid-turn: Eiscue-Noice gets its Ice Face back", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].formeChange("Eiscue-Noice", null, true); },
    mons: [{ species: "Abomasnow", ability: "Soundproof", moves: ["Snowscape"], evs: { spe: 252 } }, lax(1), { species: "Eiscue", ability: "Ice Face", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC6 Mimicry (champions): Grassy Terrain mid-turn makes Stunfisk-Galar Grass type; Misty", {
    game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Rillaboom", ability: "Overgrow", moves: ["Grassy Terrain"], evs: { spe: 32 } }, lax(1), { species: "Stunfisk-Galar", ability: "Mimicry", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC7 Forecast (champions): Rain Dance mid-turn: Castform-Rainy", {
    game: "champions", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Pelipper", ability: "Keen Eye", moves: ["Rain Dance"], evs: { spe: 32 } }, lax(1), { species: "Castform", ability: "Forecast", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC8 Flower Gift (swsh): Sunny Day mid-turn: Cherrim-Sunshine; the ally's Attack 1.5x after", {
    game: "swsh", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Torkoal", ability: "Drought", moves: ["Splash"] }, lax(1), { species: "Cherrim", ability: "Flower Gift", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC9 Protosynthesis already active from Booster Energy, then sun starts: no change; sun from a Drought? n/a", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Torkoal", ability: "Shell Armor", moves: ["Sunny Day"], evs: { spe: 252 } }, lax(1), { species: "Flutter Mane", ability: "Protosynthesis", item: "Booster Energy", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("FC10 Protosynthesis from sun, then Rain Dance replaces the sun: the boost ends (no Booster Energy)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", "debug"); },
    mons: [{ species: "Pelipper", ability: "Keen Eye", moves: ["Rain Dance"], evs: { spe: 252 } }, lax(1), { species: "Flutter Mane", ability: "Protosynthesis", moves: ["Splash"] }, lax(2)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// RW. Row moves: Present, Magnitude, Echoed Voice, Retaliate, Pursuit
// ---------------------------------------------------------------------------------------------------------------------
if (on("RW")) {
  run("RW1 Present (sv): 40% 40 power, 30% 80, 10% 120, 20% heal a quarter (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], rolls: "lowest", setup: (b) => { b.p2.active[0].sethp(150); },
    mons: [{ species: "Delibird", ability: "Hustle", moves: ["Present"], evs: { spe: 252 } }, lax(1), lax(2), lax(3)],
  });
  run("RW2 Magnitude (usum): 4-10 at 5/10/20/30/20/10/5 % (lowest rolls)", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Dugtrio", ability: "Arena Trap", moves: ["Magnitude"], evs: { spe: 252 } }, lax(1), lax(2), lax(3)],
  });
  run("RW3 Echoed Voice twice in one turn (ally then foe), first turn: both 40 (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Jigglypuff", ability: "Competitive", moves: ["Echoed Voice"], evs: { spe: 252 } }, lax(1), { species: "Jigglypuff", ability: "Competitive", moves: ["Echoed Voice"], name: "PuffFoe" }, lax(3)],
  });
  run("RW4 Echoed Voice on turn 2 after turn 1's: 80 (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Jigglypuff", ability: "Competitive", moves: ["Echoed Voice"], evs: { spe: 252 } }, lax(1), lax(2), lax(3)],
  });
  run("RW5 Retaliate the turn after an ally fainted: 140 (lowest rolls)", {
    game: "sv", turns: [["move 2, move 1", "move 1 2, move 1"], ["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest", setup: (b) => { b.p1.active[1].sethp(1); },
    mons: [{ species: "Herdier", ability: "Intimidate", moves: ["Retaliate", "Splash"], evs: { spe: 252 } }, lax(1, "Doomed"),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(3)],
  });
  showTrace("RW6 Pursuit (usum) with no switch: 40 power", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Tyranitar", ability: "Sand Stream", moves: ["Pursuit"] }, lax(1), lax(2), lax(3)],
  }, L);
  showTrace("RW7 Pursuit (usum) into a foe's U-turn: it hits the U-turner before it leaves, 80 power", {
    game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Tyranitar", ability: "Sand Stream", moves: ["Pursuit"] }, lax(1), { species: "Scizor", ability: "Technician", moves: ["U-turn"], evs: { spe: 252 } }, lax(3)],
  }, L);
}
