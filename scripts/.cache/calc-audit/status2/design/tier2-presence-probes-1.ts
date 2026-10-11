// TIER 2 (presence) probes, part 1: Commander, Poison Puppeteer, Dancer, Round, Fusion Bolt / Fusion Flare, Spotlight,
// Flame Burst, Beak Blast, Shell Trap, on pinned Showdown c23d2e94 through guards-sim.ts (exact enumeration).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-1.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-1.out
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",");
export const state = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}${p?.status ? " " + p.status : ""}) ${boosts(p)}${vols(p) ? " [" + vols(p) + "]" : ""}`;
}).join(" | ");
export const L = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|cant|-start|-end|-status|-curestatus|-sidestart|-singleturn|-waiting|-combine|-prepare|-nothing|-crit|-supereffective|-resisted|-fieldstart|-fieldend|upkeep|turn|error)\|/;
export const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
export const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: L, inspect: state, ...probe }), opts);

const PART = process.argv[2] ?? "all";
const on = (key: string) => PART === "all" || PART === key;

const tatsu: Mon = { species: "Tatsugiri", ability: "Commander", moves: ["Splash"], evs: { spe: 252 } };
const dozo: Mon = { species: "Dondozo", ability: "Unaware", moves: ["Order Up", "Wave Crash"] };

// ---------------------------------------------------------------------------------------------------------------------
// C. Commander (PS/data/abilities.ts:604-640, PS/data/conditions.ts:807-844, PS/sim/battle-actions.ts:621-640)
// ---------------------------------------------------------------------------------------------------------------------
if (on("C")) {
  // C1: at the lead Commander activates (Dondozo +2 x5). A foe's single-target move at Tatsugiri misses; Earthquake from
  // the other foe hits Dondozo (and the user's own ally) but misses Tatsugiri. Tatsugiri has no action (auto-pass).
  showTrace("C1 lead: Commander, then moves at the commanding Tatsugiri (single target and spread)", {
    game: "sv", turns: [["move 2 2", "move 1 1, move 1"]],
    mons: [tatsu, dozo, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"], name: "Chomp2" }],
  }, L);
  // C2: Dondozo knocked out by the first move; at the next Update Tatsugiri stops commanding and the later move hits it.
  showTrace("C2 Dondozo fainted first: the later move at Tatsugiri hits", {
    game: "sv", turns: [["move 2 2", "move 1 2, move 1 1"]], setup: (b) => { b.p1.active[1].sethp(1); },
    mons: [tatsu, dozo, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp2" }],
  }, L);
  // C3: sandstorm and poison at the end of turn still reach a commanding Tatsugiri.
  showTrace("C3 sand and poison on a commanding Tatsugiri at the end of turn", {
    game: "sv", turns: [["move 2 1", "move 1, move 1"]], setup: (b) => { b.field.setWeather("sandstorm", "debug"); b.p1.active[0].setStatus("psn"); },
    mons: [tatsu, dozo, lax(1), lax(2)],
  }, L);
  // C4: Order Up's self boost by Tatsugiri's form (Curly Atk, Droopy Def, Stretchy Spe).
  for (const species of ["Tatsugiri", "Tatsugiri-Droopy", "Tatsugiri-Stretchy"]) {
    showTrace(`C4 Order Up with ${species}`, { game: "sv", turns: [["move 1 1", "move 1, move 1"]], mons: [{ ...tatsu, species }, dozo, lax(1), lax(2)] }, /^\|(move|-boost|-damage)\|/);
  }
  // C5: Roar into Dondozo fails (onDragOut false); Perish Song: Tatsugiri unaffected.
  showTrace("C5 Roar and Dragon Tail into Dondozo fail; Perish Song misses Tatsugiri", {
    game: "sv", turns: [["move 1", "move 1 2, move 1"], ["move 1", "move 2 2, move 1"]],
    mons: [tatsu, { ...dozo, moves: ["Splash"] }, { species: "Arcanine", ability: "Intimidate", moves: ["Roar", "Dragon Tail"], evs: { spe: 252 } }, { species: "Gengar", ability: "Cursed Body", moves: ["Perish Song"] }],
  }, L);
  // C6: Neutralizing Gas at the lead (Weezing faster or slower).
  for (const spe of [252, 0]) {
    showTrace(`C6 Neutralizing Gas lead (Weezing Speed EVs ${spe})`, { game: "sv", turns: [["move 1, move 2 1", "move 1, move 1"]],
      mons: [{ ...tatsu, evs: { spe: 0 } }, dozo, { species: "Weezing-Galar", ability: "Neutralizing Gas", moves: ["Splash"], evs: { spe } }, lax(1)] }, /^\|(-activate|-ability|-boost|move)\|/);
  }
  // C7: Helping Hand by Dondozo's ally side? Dondozo uses Wave Crash with Tatsugiri commanding: recoil; Tatsugiri's Storm Drain? (Commander only).
  // C7: a foe's Icy Wind (spread) misses Tatsugiri: no Speed drop on it.
  showTrace("C7 Icy Wind misses Tatsugiri; Dondozo -1 Spe", {
    game: "sv", turns: [["move 2 1", "move 1, move 1"]],
    mons: [tatsu, dozo, { species: "Glalie", ability: "Inner Focus", moves: ["Icy Wind"], evs: { spe: 252 } }, lax(1)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// P. Poison Puppeteer (PS/data/abilities.ts:3357-3368)
// ---------------------------------------------------------------------------------------------------------------------
if (on("P")) {
  run("P1 Pecharunt Toxic into a foe that moves later: confused (and its confusion check runs)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]],
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Toxic"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(2)],
  });
  showTrace("P2 Pecharunt's Poison Gas (spread): both foes; Own Tempo; Lum Berry", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Poison Gas"], evs: { spe: 252 } }, lax(1),
      { species: "Slowbro", ability: "Own Tempo", moves: ["Splash"] }, { species: "Garchomp", ability: "Rough Skin", item: "Lum Berry", moves: ["Splash"] }],
  }, L);
  showTrace("P3 Pecharunt's ally's Toxic: no confusion (source is not Pecharunt); Persim Berry target of Pecharunt's Toxic", {
    game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Toxic"], evs: { spe: 252 } }, { species: "Glimmora", ability: "Toxic Debris", moves: ["Toxic"] },
      { species: "Garchomp", ability: "Rough Skin", item: "Persim Berry", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("P4 Pecharunt's Toxic into an already confused foe", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("confusion"); },
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Toxic"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(2)],
  }, L);
  showTrace("P5 Pecharunt's Toxic into its own ally: confused too (target !== source only)", {
    game: "sv", turns: [["move 1 -2, move 1", "move 1, move 1"]],
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Toxic"], evs: { spe: 252 } }, lax(1, "Ally"), lax(2), lax(3)],
  }, L);
  showTrace("P6 a Poison-type foe or a Steel type: Toxic fails, no confusion; Misty Terrain grounded foe", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("mistyterrain", "debug"); },
    mons: [{ species: "Pecharunt", ability: "Poison Puppeteer", moves: ["Toxic"], evs: { spe: 252 } }, lax(1), lax(2), lax(3)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// D. Dancer (PS/sim/battle-actions.ts:317-345)
// ---------------------------------------------------------------------------------------------------------------------
const orico = (n = 0, name = "Oricorio", extra: Partial<Mon> = {}): Mon => ({ species: "Oricorio", ability: "Dancer", moves: ["Splash"], evs: { spe: n * 8 }, name, ...extra });
if (on("D")) {
  showTrace("D1 a foe's Swords Dance: Oricorio copies at once (+2 Atk), then its own action later", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [orico(), lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("D2 two Dancers: the slower stored Speed copies first", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [orico(10, "OriFast"), orico(1, "OriSlow"), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("D3 ally's Fiery Dance into foe A: the Dancer targets foe A; a foe's Fiery Dance into the Dancer's ally: the Dancer targets that foe", {
    game: "sv", turns: [["move 1, move 1 1", "move 1, move 1 2"]],
    mons: [orico(), { species: "Volcarona", ability: "Flame Body", moves: ["Fiery Dance"], evs: { spe: 252 } },
      lax(1), { species: "Volcarona", ability: "Flame Body", moves: ["Fiery Dance"], name: "VolcFoe", evs: { spe: 200 } }],
  }, L);
  run("D4 a paralysed Dancer: its copy meets full paralysis (BeforeMove runs)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("par"); },
    mons: [orico(), lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
  });
  showTrace("D5 Swords Dance at +6 (fails?): copy?; Petal Dance copied: no lock on the Dancer (turn 2 shows it)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].boosts.atk = 6; },
    mons: [orico(0, "Oricorio", { moves: ["Tackle"] }), lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, { species: "Lilligant", ability: "Own Tempo", moves: ["Petal Dance"], name: "Lilli" }],
  }, L);
  showTrace("D6 a sleeping Dancer does not copy; its counter goes down", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("slp"); b.p1.active[0].statusState.time = 3; },
    mons: [orico(), lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("D7 Teeter Dance copied (USUM)", {
    game: "usum", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [orico(), lax(1), { species: "Spinda", ability: "Own Tempo", moves: ["Teeter Dance"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("D8 a Dancer that already moved copies again; a Dancer under Taunt cannot copy Swords Dance (BeforeMove)", {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[1].addVolatile("taunt"); },
    mons: [orico(30, "OriFast", { moves: ["Tackle"] }), orico(1, "OriTaunted"), { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"] }, lax(2)],
  }, L);
  showTrace("D9 Quiver Dance by the Dancer's own ally: copied (any Pokémon but the user)", {
    game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
    mons: [orico(), { species: "Volcarona", ability: "Flame Body", moves: ["Quiver Dance"], evs: { spe: 252 } }, lax(1), lax(2)],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// R. Round (PS/data/moves.ts:15499-15524, PS/sim/battle-queue.ts:277-287 prioritizeAction)
// ---------------------------------------------------------------------------------------------------------------------
if (on("R")) {
  showTrace("R1 two Rounds (ally slowest) with a foe in between: the second moves right after the first", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1 1, move 1"]],
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Round"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 100 } }, lax(2)],
  }, L);
  showTrace("R2 a foe's Round after the user's: prioritized too (any queued Round)", {
    game: "champions", turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Round"], evs: { spe: 32 } }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 20 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" }],
  }, L);
  showTrace("R3 three Rounds: each pulls the next", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1 1, move 1 2"]],
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Round"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 100 } }, { species: "Jigglypuff", ability: "Competitive", moves: ["Round"], name: "Puff" }],
  }, L);
  run("R4 Round's power: first Round 60, second 120 (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Round"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" }, lax(1), lax(2)],
  });
  run("R4c control: LaxRound's Round alone (lowest rolls)", {
    game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Splash"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" }, lax(1), lax(2)],
  });
  run("R5 the first Round user fully paralysed: no pull; the second Round at its own place (lowest rolls)", {
    game: "sv", turns: [["move 1 1, move 1 1", "move 1 2, move 1"]], setup: (b) => { b.p1.active[0].setStatus("par"); }, rolls: "lowest",
    mons: [{ species: "Altaria", ability: "Natural Cure", moves: ["Round"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "LaxRound" },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 100 } }, lax(2)],
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// F. Fusion Bolt / Fusion Flare (PS/data/moves.ts:6354-6390; lastSuccessfulMoveThisTurn PS/sim/battle-actions.ts:309)
// ---------------------------------------------------------------------------------------------------------------------
const reshi: Mon = { species: "Reshiram", ability: "Turboblaze", moves: ["Fusion Flare"], evs: { spe: 252 } };
const zek: Mon = { species: "Zekrom", ability: "Teravolt", moves: ["Fusion Bolt"] };
if (on("F")) {
  run("F1 Fusion Flare then Fusion Bolt (lowest rolls)", { game: "sv", turns: [["move 1 1, move 1 1", "move 1, move 1"]], rolls: "lowest", mons: [reshi, zek, lax(1), lax(2)] });
  run("F1c control: Fusion Bolt alone", { game: "sv", turns: [["move 1, move 1 1", "move 1, move 1"]], rolls: "lowest", mons: [{ ...reshi, moves: ["Splash"] }, zek, lax(1), lax(2)] });
  run("F2 Flare, a foe's Splash in between (Garchomp, 122 Speed), then Bolt (lowest rolls)", { game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
    mons: [reshi, zek, { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(2)] });
  run("F3 Flare, a foe's Swords Dance in between (succeeds), then Bolt (lowest rolls)", { game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
    mons: [reshi, zek, { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"] }, lax(2)] });
  run("F3b Flare, a foe's Swords Dance at +6 in between, then Bolt (lowest rolls)", { game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
    setup: (b) => { b.p2.active[0].boosts.atk = 6; },
    mons: [reshi, zek, { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"] }, lax(2)] });
  run("F3c Flare, a fully paralysed foe in between (Garchomp 252 Speed EVs), then Bolt (lowest rolls)", { game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
    setup: (b) => { b.p2.active[0].setStatus("par"); },
    mons: [{ ...reshi, evs: { spe: 252 }, nature: "Timid" }, zek, { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 }, nature: "Jolly" }, lax(2)] });
  showTrace("F4 Flare into a Protect (blocked), then Bolt", { game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [reshi, zek, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], evs: { spe: 255 }, name: "LaxProtect" }, lax(2)] }, /^\|(move|-damage|-activate|-singleturn|-fail)\|/);
  showTrace("F5 Flare, a fully paralysed foe in between, then Bolt", { game: "sv", turns: [["move 1 1, move 1 1", "move 1 1, move 1"]],
    setup: (b) => { b.p2.active[0].setStatus("par"); },
    mons: [reshi, zek, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)] }, /^\|(move|-damage|cant)\|/);
  showTrace("F6 Flare, the target fainted in between? Flare that KOs, then Bolt into the other", { game: "sv", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    setup: (b) => { b.p2.active[0].sethp(1); },
    mons: [reshi, zek, lax(1), lax(2)] }, /^\|(move|-damage|faint)\|/);
}

// ---------------------------------------------------------------------------------------------------------------------
// S. Spotlight (USUM; PS/data/moves.ts:17764-17795)
// ---------------------------------------------------------------------------------------------------------------------
if (on("S")) {
  showTrace("S1 Spotlight on foe A: the user's ally's move at foe B goes to foe A", {
    game: "usum", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Spotlight"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(1, "FoeA"), lax(2, "FoeB")],
  }, L);
  showTrace("S2 Spotlight on its own ally: the foes' moves at the user go to the ally", {
    game: "usum", turns: [["move 1 -2, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Spotlight"], evs: { spe: 252 } }, lax(1, "Ally"),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp2" }],
  }, L);
  showTrace("S3 Spotlight and Follow Me: Spotlight (2) wins over Follow Me (1)", {
    game: "usum", turns: [["move 1 1, move 1 2", "move 1, move 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Spotlight"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] },
      lax(1, "FoeA"), { species: "Clefable", ability: "Magic Guard", moves: ["Follow Me"], name: "FoeB" }],
  }, L);
  showTrace("S4 Spotlight into Protect: fails; into Magic Bounce: reflected onto the user", {
    game: "usum", turns: [["move 1 1, move 1 1", "move 1, move 1 1"]],
    mons: [{ species: "Clefable", ability: "Magic Guard", moves: ["Spotlight"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] },
      { species: "Espeon", ability: "Magic Bounce", moves: ["Splash"], name: "FoeA" }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "FoeB" }],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// B. Flame Burst (USUM; PS/data/moves.ts:5564-5585)
// ---------------------------------------------------------------------------------------------------------------------
if (on("B")) {
  run("B1 Flame Burst into foe A: foe B loses 1/16 at the hit; Sitrus at its Update", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[1].sethp(110); },
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1), lax(2, "FoeA"), { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Splash"], name: "FoeB" }],
  });
  showTrace("B2 Flame Burst: Magic Guard partner takes nothing; into a Substitute still splashes", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("substitute"); },
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1), lax(2, "FoeA"), { species: "Clefable", ability: "Magic Guard", moves: ["Splash"], name: "FoeB" }],
  }, L);
  showTrace("B2b Flame Burst into a Substitute: the partner (no Magic Guard) still loses 1/16 (onAfterSubDamage)", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].addVolatile("substitute"); },
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1), lax(2, "FoeA"), lax(3, "FoeB")],
  }, L);
  showTrace("B3 Flame Burst: partner at 6 HP faints; into the user's own ally: the ally's partner is the user", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[1].sethp(6); },
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1), lax(2, "FoeA"), lax(3, "FoeB")],
  }, L);
  showTrace("B4 Flame Burst into its own ally: the splash hits the user", {
    game: "usum", turns: [["move 1 -2, move 1", "move 1, move 1"]],
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1, "Ally"), lax(2), lax(3)],
  }, L);
  showTrace("B5 Flame Burst into a Flash Fire foe (absorbed): no splash", {
    game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Charizard", ability: "Blaze", moves: ["Flame Burst"], evs: { spe: 252 } }, lax(1), { species: "Heatran", ability: "Flash Fire", moves: ["Splash"], name: "FoeA" }, lax(3, "FoeB")],
  }, L);
}

// ---------------------------------------------------------------------------------------------------------------------
// K. Beak Blast (PS/data/moves.ts:1119-1146) and Shell Trap (PS/data/moves.ts:16277-16312)
// ---------------------------------------------------------------------------------------------------------------------
if (on("K")) {
  showTrace("K1 Beak Blast: a contact move into it before it moves burns the attacker; a non-contact one does not", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Toucannon", ability: "Keen Eye", moves: ["Beak Blast"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], name: "Chomp2", evs: { spe: 200 } }],
  }, L);
  run("K2 Beak Blast user fully paralysed: does the volatile stay for a later contact move (Dragon Tail, -6)?", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].setStatus("par"); },
    mons: [{ species: "Toucannon", ability: "Keen Eye", moves: ["Beak Blast"], evs: { spe: 252 } }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Tail"], evs: { spe: 4 } }, lax(2)],
  });
  run("K3 Beak Blast: a two-hit contact move (Dual Wingbeat) into it: burned after the first hit", {
    game: "sv", turns: [["move 1 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Toucannon", ability: "Keen Eye", moves: ["Beak Blast"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dual Wingbeat"], evs: { spe: 252 } }, lax(2)],
  });
  run("K3c control: Dual Wingbeat into Toucannon using Splash", {
    game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
    mons: [{ species: "Toucannon", ability: "Keen Eye", moves: ["Splash"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dual Wingbeat"], evs: { spe: 252 } }, lax(2)],
  });
  showTrace("K4 Shell Trap hit by a foe's physical move: moves next, before the slower foe", {
    game: "usum", turns: [["move 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Turtonator", ability: "Shell Armor", moves: ["Shell Trap"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp2" }],
  }, L);
  showTrace("K5 Shell Trap not hit (special move, ally's physical move): fails", {
    game: "usum", turns: [["move 1, move 1 -1", "move 1 1, move 1"]],
    mons: [{ species: "Turtonator", ability: "Shell Armor", moves: ["Shell Trap"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "AllyTackle", evs: { spe: 100 } },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Earth Power"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("K6 Shell Trap: a physical hit into its Substitute: fails?", {
    game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].addVolatile("substitute"); },
    mons: [{ species: "Turtonator", ability: "Shell Armor", moves: ["Shell Trap"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
  }, L);
  showTrace("K7 Shell Trap hit twice (two foes): moves after the first hit", {
    game: "swsh", turns: [["move 1, move 1", "move 1 1, move 1 1"]],
    mons: [{ species: "Turtonator", ability: "Shell Armor", moves: ["Shell Trap"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], name: "Chomp2", evs: { spe: 200 } }],
  }, L);
}
