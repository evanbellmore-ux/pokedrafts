// TIER 2 (presence) probes, part 4: follow-ups to part 3 (Trace's random copy and Download's order where the sample and the
// speed tie can be enumerated: a simultaneous switch-in during a turn; Unburden at the turn's first Update with the status
// set silently; Ice Spinner ending a terrain under Quark Drive; Booster Energy when the sun ends; two Follow Me users;
// Present's heal into a Ghost type and a Substitute), and Sky Drop's first turn (USUM).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-4.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-4.out
import { enumerate, monAt, report, showTrace, start, trace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).join(",");
const state = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.item ? " " + p.item : ""}${p?.status ? " " + p.status : ""}) ${boosts(p)}${vols(p) ? " [" + vols(p) + "]" : ""} ${p?.ability ?? ""}`;
}).join(" | ");
const L = /^\|(move|switch|drag|-weather|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-fail|-immune|-miss|cant|-start|-end|-status|-curestatus|-sidestart|-singleturn|-prepare|-nothing|-fieldstart|-fieldend|-formechange|detailschange|upkeep|turn|error)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: L, inspect: state, ...probe }), opts);

// TR5: Trace activating on a switch-in during the turn (the sample over the adjacent foes is then enumerated). Two
// different copyable abilities: 1/2 each; one foe with a notrace ability (Commander n/a; use As One? Imposter): the other only.
run("TR5 Trace on a switch-in mid-turn against Rough Skin and Levitate: the copy (1/2 each)", {
  game: "sv", turns: [["switch 3, move 1", "move 1, move 1"]], inspect: (b: any) => `trace copied ${b.p1.active[0].ability}`,
  bench: { p1: [{ species: "Gardevoir", ability: "Trace", moves: ["Splash"], name: "Tracer" }] },
  mons: [lax(1), lax(2), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, { species: "Hydreigon", ability: "Levitate", moves: ["Splash"] }],
});
// DL4: Download faster than Dauntless Shield at the lead (Choice Scarf Porygon-Z): Download reads Zamazenta before its +1 Def.
const dl = (b: any) => `Porygon-Z ${boosts(b.p1.active[0])}; Zamazenta ${boosts(b.p2.active[0])}`;
{
  const probe: Probe = { game: "sv", turns: [], mons: [{ species: "Porygon-Z", ability: "Download", item: "Choice Scarf", moves: ["Splash"], evs: { spe: 252 }, nature: "Timid" }, lax(1),
    { species: "Zamazenta", ability: "Dauntless Shield", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { def: 252 }, name: "LaxDef" }] };
  const b = start(probe);
  console.log(`\n== DL4 Download faster than Dauntless Shield at the lead\n  ${(b.log as string[]).filter((l) => /^\|(-boost|-ability)\|/.test(l)).join("\n  ")}\n  ${dl(b)}`);
  const z = b.p2.active[0], s = b.p2.active[1];
  console.log(`  foes' Def ${z.getStat("def", false, true)} + ${s.getStat("def", false, true)}, Sp. Def ${z.getStat("spd", false, true)} + ${s.getStat("spd", false, true)} (now, Zamazenta at +1 Def)`);
}
// DL5: a simultaneous switch-in at one Speed during a turn (both sides' Pokémon fainted at the same time? use two switches
// at the end of turn after both fainted to Explosion): Download vs Dauntless Shield in a speed tie.
run("DL5 replacements after a double faint: Download and Dauntless Shield switch in together at one Speed (the order 1/2)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.p1.active[0].sethp(1); b.p2.active[0].sethp(1); },
  answer: (b: any) => [b.p1.activeRequest?.forceSwitch ? "switch 3, pass" : "", b.p2.activeRequest?.forceSwitch ? "switch 3, pass" : ""],
  inspect: (b: any) => `${b.p1.active[0].name} ${boosts(b.p1.active[0])}; ${b.p2.active[0].name} ${boosts(b.p2.active[0])}`,
  bench: { p1: [{ species: "Porygon2", ability: "Download", moves: ["Splash"], name: "Porygon2", evs: { spe: 0 } }], p2: [{ species: "Bronzong", ability: "Levitate", item: "Electric Seed", moves: ["Splash"], name: "Bronzong" }] },
  mons: [{ species: "Electrode", ability: "Soundproof", moves: ["Explosion"], evs: { spe: 252 } }, lax(1, "LaxA"), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Victim" }, lax(2, "LaxB")],
});

// UB2: Unburden at the turn's first Update (status set silently so the Lum Berry waits for that Update).
for (const game of ["sv", "usum", "champions"] as const) {
  showTrace(`UB2 ${game}: a paralysed Unburden holder with Lum Berry (silent status): order against a foe faster than it paralysed, slower than it doubled`, {
    game, turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: (b) => { b.p1.active[0].status = "par"; b.p1.active[0].statusState = b.initEffectState({ id: "par", target: b.p1.active[0] }); },
    mons: [{ species: game === "usum" ? "Hawlucha" : "Sneasler", ability: "Unburden", item: "Lum Berry", moves: ["Tackle"] }, lax(1),
      { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: game === "champions" ? { spe: 4 } : { spe: 0 } }, lax(2)],
  }, /^\|(move|-enditem|-curestatus|cant)\|/);
}

// FC2b: Electric Terrain from before the turn; Ice Spinner ends it after its hit: a Quark Drive foe loses the boost; with
// Booster Energy it uses the Energy and keeps it.
for (const item of ["", "Booster Energy"]) {
  showTrace(`FC2b Ice Spinner ends Electric Terrain: Quark Drive Iron Hands${item ? " with Booster Energy" : ""}`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setTerrain("electricterrain", "debug"); },
    mons: [{ species: "Baxcalibur", ability: "Thermal Exchange", moves: ["Ice Spinner"], evs: { spe: 252 } }, lax(1),
      { species: "Iron Hands", ability: "Quark Drive", ...(item ? { item } : {}), moves: ["Splash"] }, lax(2)],
  }, /^\|(move|-fieldstart|-fieldend|-activate|-start|-end|-enditem|-damage)\|/);
}
// FC3b: sun from a Drought lead, 1 turn left: Protosynthesis from the sun; Booster Energy used when the sun ends.
showTrace("FC3b sun (Drought lead, 1 turn left) ends at the end of turn: Protosynthesis with Booster Energy", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.weatherState.duration = 1; },
  mons: [{ species: "Torkoal", ability: "Drought", moves: ["Splash"] }, { species: "Great Tusk", ability: "Protosynthesis", item: "Booster Energy", moves: ["Splash"] }, lax(1), lax(2)],
}, /^\|(-weather|-activate|-enditem|-end|-start|upkeep|turn)\|/);
showTrace("FC3c the same without Booster Energy: the boost ends with the sun", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.weatherState.duration = 1; },
  mons: [{ species: "Torkoal", ability: "Drought", moves: ["Splash"] }, { species: "Great Tusk", ability: "Protosynthesis", moves: ["Splash"] }, lax(1), lax(2)],
}, /^\|(-weather|-activate|-enditem|-end|-start|upkeep|turn)\|/);
showTrace("FC11 Sunny Day with a Cloud Nine holder in: Protosynthesis does not activate (effective weather none)", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Torkoal", ability: "Shell Armor", moves: ["Sunny Day"], evs: { spe: 252 } }, { species: "Great Tusk", ability: "Protosynthesis", moves: ["Splash"] },
    { species: "Golduck", ability: "Cloud Nine", moves: ["Splash"] }, lax(2)],
}, /^\|(move|-weather|-activate|-start|-end)\|/);
showTrace("FC12 a Cloud Nine holder fainting under sun: Protosynthesis activates then", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.field.setWeather("sunnyday", "debug"); b.p2.active[0].sethp(1); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Great Tusk", ability: "Protosynthesis", moves: ["Splash"] },
    { species: "Golduck", ability: "Cloud Nine", moves: ["Splash"] }, lax(2)],
}, /^\|(move|-weather|-activate|-start|-end|faint|-damage)\|/);

// RT4b/RT5: two Follow Me users at one Speed, the move aimed at the later-entered one; and a Lightning Rod that re-entered.
{
  const eo = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => `${id} ${monAt(b, id as any)?.name} eo ${monAt(b, id as any)?.abilityState?.effectOrder}`).join(", ");
  const rtTrace = (title: string, probe: Probe) => {
    const b = start(probe);
    console.log(`\n== ${title}\n  start: ${eo(b)}`);
    for (const line of trace(probe, /^\|(move|-activate|-ability|-boost|switch|-immune|-damage)\|/)) console.log(`  ${line}`);
  };
  rtTrace("RT4b two Follow Me users at one Speed, the move aimed at FMB (entered later): FMA (entered first) takes it", {
    game: "sv", turns: [["move 1 2, move 1", "move 1, move 1"]],
    mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, lax(1),
      { species: "Snorlax", ability: "Thick Fat", moves: ["Follow Me"], name: "FMA" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Follow Me"], name: "FMB" }],
  });
  rtTrace("RT5 the attacker's ally Lightning Rod switched out and back on earlier turns: the foe's Rod (entered first now) takes it", {
    game: "sv", turns: [["move 2, switch 3", "move 1, move 1"], ["move 2, switch 3", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Thunderbolt", "Splash"], evs: { spe: 252 } }, { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "RodAlly" },
      { species: "Raichu", ability: "Lightning Rod", moves: ["Splash"], name: "RodFoe" }, lax(2)],
    bench: { p1: [lax(3, "Swap")] },
  });
}

// RW8: Present's heal branch into a Ghost type (immune?) and into a Substitute (infiltrates).
run("RW8 Present into a Ghost type: immune in every branch?", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(100); },
  mons: [{ species: "Delibird", ability: "Hustle", moves: ["Present"], evs: { spe: 252 } }, lax(1), { species: "Gengar", ability: "Cursed Body", moves: ["Splash"] }, lax(3)],
});
run("RW9 Present into a Substitute: the heal passes it (infiltrates), the damage hits the Substitute", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(150); b.p2.active[0].addVolatile("substitute"); },
  mons: [{ species: "Delibird", ability: "Hustle", moves: ["Present"], evs: { spe: 252 } }, lax(1), lax(2), lax(3)],
});
run("RW10 Echoed Voice after an earlier turn's use, then an ally's second Echoed Voice this turn: both at the same power", {
  game: "sv", turns: [["move 1 1, move 2", "move 1, move 1"], ["move 1 1, move 1 1", "move 1, move 1"]], rolls: "lowest",
  mons: [{ species: "Jigglypuff", ability: "Competitive", moves: ["Echoed Voice"], evs: { spe: 252 } }, { species: "Jigglypuff", ability: "Competitive", moves: ["Echoed Voice", "Splash"], name: "Puff2" }, lax(2), lax(3)],
});

// SD: Sky Drop (USUM): the first turn lifts the target; both are semi-invulnerable; the target cannot move.
showTrace("SD1 Sky Drop lifts a slower foe: its own move is lost; the foe's partner's move at the user misses; Thunder hits", {
  game: "usum", turns: [["move 1 1, move 1", "move 1 1, move 1 1"]],
  mons: [{ species: "Hawlucha", ability: "Limber", moves: ["Sky Drop"], evs: { spe: 252 } }, lax(1),
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"] }, { species: "Raikou", ability: "Pressure", moves: ["Dragon Claw"], name: "RaikouDC" }],
}, L);
showTrace("SD2 Sky Drop: a heavy target (200 kg+) fails; an ally target fails; a target behind a Substitute fails", {
  game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Hawlucha", ability: "Limber", moves: ["Sky Drop"], evs: { spe: 252 } }, lax(1), { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Heavy" }, lax(2)],
}, L);
showTrace("SD3 Sky Drop's second turn: the drop (Flying target immune), damage; Gravity in between?", {
  game: "usum", turns: [["move 1 1, move 1", "move 1, move 1"], ["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Hawlucha", ability: "Limber", moves: ["Sky Drop"], evs: { spe: 252 } }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Splash"] }, lax(2)],
}, L);
