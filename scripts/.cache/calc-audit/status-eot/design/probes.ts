// End-of-turn design probes on pinned Showdown c23d2e94. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/probes.ts [id]
import { show, turn, type Mon } from "./eotsim";

const m = (species: string, ability: string, moves: string[] = ["Splash"], extra: Partial<Mon> = {}): Mon => ({ species, ability, moves, ...extra });
const which = process.argv[2] ?? "all";
const run = (id: string, title: string, f: () => ReturnType<typeof turn>) => { if (which !== "all" && which !== id) return; try { show(`${id}. ${title}`, f()); } catch (e) { console.log(`
### ${id}. ${title}
 ERROR ${(e as Error).message}`); } };
const at = (b: any, slot: string) => (slot[1] === "1" ? b.p1 : b.p2).active["ab".indexOf(slot[2])];
const hpTo = (b: any, slot: string, frac: number) => { const p = at(b, slot); p.sethp(Math.floor(p.maxhp * frac)); };

// E1. Order 5 across Pokémon: Showdown sorts handlers by order, priority, SPEED, then subOrder (sim/battle.ts:404-411), so the
// faster Pokémon's Grassy Terrain heal (5.2) AND Leftovers (5.4) come before the slower Pokémon's Grassy heal.
run("E1", "order 5: speed before subOrder (Grassy 5.2 / Leftovers 5.4)", () => turn({
  game: "champions", p1: [m("Garchomp", "Rough Skin", ["Splash"], { item: "Leftovers" }), m("Snorlax", "Thick Fat", ["Splash"], { item: "Leftovers" })],
  p2: [m("Tyranitar", "Sand Stream"), m("Toxapex", "Regenerator")], c1: "move 1, move 1", c2: "move 1, move 1",
  setup: (b) => { b.field.clearWeather(); b.field.setTerrain("grassyterrain", "debug"); for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E2. The same under Trick Room: getActionSpeed is the room's (sim/pokemon.ts:641-649), so the slowest acts first.
run("E2", "order 5 under Trick Room", () => turn({
  game: "champions", p1: [m("Garchomp", "Rough Skin", ["Splash"], { item: "Leftovers" }), m("Snorlax", "Thick Fat", ["Splash"], { item: "Leftovers" })],
  p2: [m("Tyranitar", "Sand Stream"), m("Toxapex", "Regenerator")], c1: "move 1, move 1", c2: "move 1, move 1",
  setup: (b) => { b.field.clearWeather(); b.field.setTerrain("grassyterrain", "debug"); b.field.addPseudoWeather("trickroom", "debug"); for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E3. Leech Seed used this turn drains at this end of turn (order 8) into the user's slot.
run("E3", "Leech Seed used this turn drains now", () => turn({
  game: "champions", p1: [m("Venusaur", "Overgrow", ["Leech Seed"]), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1", setup: (b) => hpTo(b, "p1a", 0.5),
}));
// E4. Leech Seed whose source fainted during the moves: no drain (getAtSlot(sourceSlot) fainted -> return).
run("E4", "Leech Seed source knocked out later in the turn", () => turn({
  game: "champions", p1: [m("Venusaur", "Overgrow", ["Leech Seed"], { evs: { spe: 32 } }), m("Snorlax", "Thick Fat")], p2: [m("Snorlax", "Thick Fat", ["Body Slam"]), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1 1, move 1", setup: (b) => { at(b, "p1a").sethp(1); },
}));
// E5. Leech Seed into a slot whose Pokémon faints earlier in the same residual (sand at order 1): no drain at order 8.
run("E5", "Leech Seed source faints to sand first", () => turn({
  game: "champions", p1: [m("Venusaur", "Overgrow", ["Leech Seed"]), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); at(b, "p1a").sethp(1); },
}));
// E6. A partial trap set this turn damages this turn (duration 5-6, decremented to 4-5, not ended); Binding Band 1/6.
run("E6", "Fire Spin this turn damages at this end of turn", () => turn({
  game: "sv", p1: [m("Charizard", "Blaze", ["Fire Spin"]), m("Snorlax", "Thick Fat")], p2: [m("Snorlax", "Thick Fat"), m("Blastoise", "Torrent")],
  c1: "move 1 1, move 1", c2: "move 1, move 1",
}));
run("E6b", "Fire Spin, trapper knocked out after trapping: no trap damage", () => turn({
  game: "sv", p1: [m("Charizard", "Blaze", ["Fire Spin"], { evs: { spe: 252 } }), m("Snorlax", "Thick Fat")], p2: [m("Snorlax", "Thick Fat", ["Body Slam"]), m("Blastoise", "Torrent")],
  c1: "move 1 1, move 1", c2: "move 1 1, move 1", setup: (b) => { at(b, "p1a").sethp(1); },
}));
// E7. Sand then Sitrus at the Update after the weather (sim/battle.ts:474-477 eachEvent('Weather') then 'Update'), before Leftovers.
run("E7", "Sitrus at the weather's Update, then Leftovers", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Splash"], { item: "Sitrus Berry" }), m("Garchomp", "Rough Skin")], p2: [m("Tyranitar", "Sand Stream"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { const p = at(b, "p1a"); p.sethp(Math.floor(p.maxhp / 2) + 3); },
}));
run("E7b", "Burn takes it below half: Sitrus at the final Update", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Splash"], { item: "Sitrus Berry" }), m("Garchomp", "Rough Skin")], p2: [m("Gengar", "Cursed Body"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { const p = at(b, "p1a"); p.sethp(Math.floor(p.maxhp / 2) + 3); p.setStatus("brn", null, null, true); },
}));
// E8. Wish, Perish Song and Yawn used this turn change no HP this turn.
run("E8", "Wish, Perish Song, Yawn used this turn", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Wish"]), m("Gengar", "Cursed Body", ["Perish Song"])], p2: [m("Garchomp", "Rough Skin", ["Yawn"]), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1 2, move 1", setup: (b) => hpTo(b, "p1a", 0.4), turns: 2,
}));
// E9. Healer: Champions 1/2 (data/mods/champions/abilities.ts healer), main 3/10; the cure comes before the ally's poison (order 9).
run("E9", "Healer (Champions) cures the ally before its poison", () => turn({
  game: "champions", p1: [m("Audino", "Healer"), m("Garchomp", "Rough Skin")], p2: [m("Snorlax", "Thick Fat"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", chance: (id) => id === "healer" ? true : undefined, setup: (b) => at(b, "p1b").setStatus("psn", null, null, true),
}));
run("E9b", "Healer (SV) chance", () => turn({
  game: "sv", p1: [m("Audino", "Healer"), m("Garchomp", "Rough Skin")], p2: [m("Snorlax", "Thick Fat"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => at(b, "p1b").setStatus("psn", null, null, true),
}));
// E10. Salt Cure in Champions: 1/16 (Water/Steel 1/8), data/mods/champions/moves.ts saltcure.
run("E10", "Salt Cure (Champions) this turn", () => turn({
  game: "champions", p1: [m("Garganacl", "Purifying Salt", ["Salt Cure"]), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1", roll: 0,
}));
// E11. Weather with 1 turn left ends at the residual without its damage; Grassy Terrain with 1 turn left still heals (5.2, ends 27.7).
run("E11", "Sand and Grassy Terrain with one turn left", () => turn({
  game: "champions", p1: [m("Garchomp", "Rough Skin"), m("Snorlax", "Thick Fat")], p2: [m("Blastoise", "Torrent"), m("Gengar", "Cursed Body")],
  c1: "move 1, move 1", c2: "move 1, move 1",
  setup: (b) => { b.field.setWeather("sandstorm", "debug"); b.field.weatherState.duration = 1; b.field.setTerrain("grassyterrain", "debug"); b.field.terrainState.duration = 1; for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E12. Emergency Exit falling to half at the end of the turn: the switch request comes after the residual (HP unchanged).
run("E12", "Emergency Exit at the end of turn", () => turn({
  game: "champions", p1: [m("Golisopod", "Emergency Exit"), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { const p = at(b, "p1a"); p.sethp(Math.floor(p.maxhp / 2) + 2); p.setStatus("brn", null, null, true); },
}));
// E13. Yawn carried from last turn (duration 1): sleep at order 23 (trySetStatus), so Bad Dreams (28.2) hurts it the same turn.
run("E13", "Yawn ends -> sleep -> Bad Dreams (SV Darkrai)", () => turn({
  game: "sv", p1: [m("Snorlax", "Thick Fat"), m("Garchomp", "Rough Skin")], p2: [m("Darkrai", "Bad Dreams"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { at(b, "p1a").addVolatile("yawn", at(b, "p2a")); at(b, "p1a").volatiles.yawn.duration = 1; },
}));
// E14. Speed Boost on the first turn (activeTurns 1 at turn 1's residual).
run("E14", "Speed Boost at turn 1", () => turn({
  game: "champions", p1: [m("Blaziken", "Speed Boost"), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1",
}));
// E15. Toxic used this turn: stage 0 -> 1 at this residual (1/16). Poison Heal: heals 1/8.
run("E15", "Toxic this turn, then Poison Heal", () => turn({
  game: "champions", p1: [m("Gengar", "Cursed Body", ["Toxic"]), m("Gliscor", "Poison Heal")], p2: [m("Snorlax", "Thick Fat"), m("Garchomp", "Rough Skin")],
  c1: "move 1 1, move 1", c2: "move 1, move 1", setup: (b) => { hpTo(b, "p1b", 0.5); at(b, "p1b").setStatus("tox", null, null, true); }, turns: 2,
}));
// E16. A Dig user (underground) takes no sand; a Fly user takes sand but no Grassy Terrain heal (isSemiInvulnerable).
run("E16", "Dig / Fly charge turn at the end of turn", () => turn({
  game: "champions", p1: [m("Garchomp", "Rough Skin", ["Dig"]), m("Charizard", "Blaze", ["Fly"])], p2: [m("Snorlax", "Thick Fat"), m("Blastoise", "Torrent")],
  c1: "move 1 1, move 1 1", c2: "move 1, move 1",
  setup: (b) => { b.field.setWeather("sandstorm", "debug"); b.field.setTerrain("grassyterrain", "debug"); for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E17. U-turn as the last action: the replacement switches in before the residual (switch request mid-turn).
run("E17", "U-turn last: replacement before the end of turn", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["U-turn"]), m("Garchomp", "Rough Skin")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1",
}));
// E18. Harvest 1/2 outside the sun: a Berry eaten in the moves comes back at 28.2 and is eaten again at the final Update.
run("E18", "Harvest restores Sitrus and it is eaten again (chance forced)", () => turn({
  game: "sv", p1: [m("Exeggutor", "Harvest", ["Splash"], { item: "Sitrus Berry" }), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin", ["Dragon Claw"]), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1 1, move 1", chance: (id) => id === "harvest" ? true : undefined, setup: (b) => hpTo(b, "p1a", 0.4),
}));
// E19. Curse (Ghost) this turn: the user pays 1/2 at once, the target loses 1/4 at order 12 this turn.
run("E19", "Ghost Curse this turn", () => turn({
  game: "champions", p1: [m("Gengar", "Cursed Body", ["Curse"]), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1",
}));
// E20. Moody: two samples (the rise, then the drop among the rest).
run("E20", "Moody samples", () => turn({
  game: "champions", p1: [m("Glalie", "Moody"), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1",
}));
// E21. Shed Skin: randomChance(33, 100) at 5.3, before burn (10).
run("E21", "Shed Skin cures before burn (forced)", () => turn({
  game: "champions", p1: [m("Dragonite", "Multiscale"), m("Arbok", "Shed Skin")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", chance: (id) => id === "shedskin" ? true : undefined, setup: (b) => at(b, "p1b").setStatus("brn", null, null, true),
}));
// E22. Sand set by a move this turn damages this turn; Grassy Terrain set this turn heals this turn.
run("E22", "Sandstorm and Grassy Terrain used this turn", () => turn({
  game: "champions", p1: [m("Tyranitar", "Unnerve", ["Sandstorm"]), m("Rillaboom", "Overgrow", ["Grassy Terrain"])], p2: [m("Garchomp", "Rough Skin"), m("Blastoise", "Torrent")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E23. Two Pokémon with Leech Seed into one source near its maximum: the heals add (capped) whatever the order.
run("E23", "Leech Seed into a source from two slots; Big Root", () => turn({
  game: "sv", p1: [m("Venusaur", "Overgrow", ["Splash"], { item: "Big Root" }), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Blastoise", "Torrent")],
  c1: "move 1, move 1", c2: "move 1, move 1",
  setup: (b) => { hpTo(b, "p1a", 0.5); at(b, "p2a").addVolatile("leechseed", at(b, "p1a")); at(b, "p2b").addVolatile("leechseed", at(b, "p1a")); },
}));
// E24. Liquid Ooze on the seeded Pokémon: the source loses what it would have healed.
run("E24", "Leech Seed into Liquid Ooze", () => turn({
  game: "champions", p1: [m("Venusaur", "Overgrow", ["Leech Seed"]), m("Snorlax", "Thick Fat")], p2: [m("Tentacruel", "Liquid Ooze"), m("Toxapex", "Regenerator")],
  c1: "move 1 1, move 1", c2: "move 1, move 1",
}));
// E25. Perish count carried at 1: faints at order 24.
run("E25", "Perish 1 faints at the end of turn", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Splash"], { item: "Leftovers" }), m("Garchomp", "Rough Skin")], p2: [m("Gengar", "Cursed Body"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { hpTo(b, "p1a", 0.5); at(b, "p1a").addVolatile("perishsong"); at(b, "p1a").volatiles.perishsong.duration = 1; },
}));
// E26. Two same-speed Pokémon: a tie at order 9 (both poisoned) is shuffled; no HP difference. Logged order shows the shuffle.
run("E26", "Speed tie, both poisoned", () => turn({
  game: "champions", p1: [m("Garchomp", "Rough Skin"), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { at(b, "p1a").setStatus("psn", null, null, true); at(b, "p2a").setStatus("psn", null, null, true); },
}));
// E27. Bad Dreams holder faints to its own poison (order 9) before 28.2: no Bad Dreams.
run("E27", "Bad Dreams holder faints first", () => turn({
  game: "sv", p1: [m("Snorlax", "Thick Fat"), m("Garchomp", "Rough Skin")], p2: [m("Darkrai", "Bad Dreams"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { at(b, "p1a").setStatus("slp", null, null, true); at(b, "p2a").setStatus("psn", null, null, true); at(b, "p2a").sethp(1); },
}));
// E28. Toxic Orb at 28.3: status for next turn, no damage this turn.
run("E28", "Toxic Orb activates at the end of turn 1", () => turn({
  game: "champions", p1: [m("Gliscor", "Poison Heal", ["Splash"], { item: "Toxic Orb" }), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => hpTo(b, "p1a", 0.5),
}));
// E29. Mutual Leech Seed at equal Speed: the tie order changes the result (the drained Pokémon faints, then its seed's handler finds no source).
for (const [tag, ties] of [["a", ["p1a", "p2a"]], ["b", ["p2a", "p1a"]]] as const) {
  run(`E29${tag}`, `Mutual Leech Seed, tie order ${ties.join(" first, ")}`, () => turn({
    game: "sv", p1: [m("Venusaur", "Overgrow"), m("Snorlax", "Thick Fat")], p2: [m("Venusaur", "Overgrow"), m("Toxapex", "Regenerator")],
    c1: "move 1, move 1", c2: "move 1, move 1", ties: [...ties],
    setup: (b) => { at(b, "p1a").sethp(10); at(b, "p1a").addVolatile("leechseed", at(b, "p2a")); at(b, "p2a").addVolatile("leechseed", at(b, "p1a")); },
  }));
}
// E30. The weather's Update comes after every Pokémon's weather damage (eachEvent('Weather') then eachEvent('Update')).
run("E30", "Sitrus after all sand damage", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Splash"], { item: "Sitrus Berry" }), m("Gengar", "Cursed Body")], p2: [m("Blastoise", "Torrent"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); const p = at(b, "p1a"); p.sethp(Math.floor(p.maxhp / 2) + 3); },
}));
// E31. A Healer holder that faints to sand (order 1) cures no one at 5.3.
run("E31", "Healer holder faints to sand first", () => turn({
  game: "champions", p1: [m("Audino", "Healer"), m("Garchomp", "Rough Skin")], p2: [m("Snorlax", "Thick Fat"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", chance: (id) => id === "healer" ? true : undefined,
  setup: (b) => { b.field.setWeather("sandstorm", "debug"); at(b, "p1a").sethp(1); at(b, "p1b").setStatus("psn", null, null, true); },
}));
// E32. Tailwind set this turn doubles Speed for the residual sort (updateSpeed before fieldEvent, sim/battle.ts:2814).
run("E32", "Tailwind this turn reorders Leftovers", () => turn({
  game: "champions", p1: [m("Snorlax", "Thick Fat", ["Tailwind"], { item: "Leftovers" }), m("Toxapex", "Regenerator", ["Splash"], { item: "Leftovers" })],
  p2: [m("Blastoise", "Torrent", ["Splash"], { item: "Leftovers" }), m("Venusaur", "Overgrow", ["Splash"], { item: "Leftovers" })], c1: "move 1, move 1", c2: "move 1, move 1",
  setup: (b) => { for (const s of ["p1a", "p1b", "p2a", "p2b"]) hpTo(b, s, 0.5); },
}));
// E33. A trapper that faints earlier in the residual (sand) ends its trap at order 13 without damage.
run("E33", "Trapper faints to sand first", () => turn({
  game: "sv", p1: [m("Charizard", "Blaze", ["Fire Spin"]), m("Snorlax", "Thick Fat")], p2: [m("Snorlax", "Thick Fat"), m("Blastoise", "Torrent")],
  c1: "move 1 1, move 1", c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); at(b, "p1a").sethp(1); },
}));
// E34. Ingrain and Aqua Ring used this turn heal this turn (orders 7 and 6).
run("E34", "Ingrain and Aqua Ring this turn", () => turn({
  game: "champions", p1: [m("Venusaur", "Overgrow", ["Ingrain"]), m("Blastoise", "Torrent", ["Aqua Ring"])], p2: [m("Garchomp", "Rough Skin"), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { hpTo(b, "p1a", 0.5); hpTo(b, "p1b", 0.5); },
}));
// E35. G-Max Wildfire (SwSh): 1/6 to each non-Fire foe this turn (side condition onResidual 5.1, duration 4).
run("E35", "G-Max Wildfire this turn", () => turn({
  game: "swsh", p1: [m("Charizard", "Blaze", ["Flamethrower"], { gigantamax: true }), m("Snorlax", "Thick Fat")], p2: [m("Blastoise", "Torrent"), m("Venusaur", "Overgrow")],
  c1: "move 1 1 dynamax, move 1", c2: "move 1, move 1", turns: 1,
}));
// E36. Cloud Nine: no sand damage and no weather heal; Utility Umbrella keeps Dry Skin from the sun.
run("E36", "Cloud Nine stops the weather's residuals", () => turn({
  game: "sv", p1: [m("Golduck", "Cloud Nine"), m("Snorlax", "Thick Fat")], p2: [m("Blastoise", "Torrent"), m("Venusaur", "Overgrow")],
  c1: "move 1, move 1", c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); },
}));
// E37. A Dynamax this turn: its turn count goes 0 -> 1 (onResidual priority -100), it does not end (sim/battle.ts:1629 turns === 3).
run("E37", "Dynamax this turn does not end", () => turn({
  game: "swsh", p1: [m("Snorlax", "Thick Fat", ["Body Slam"]), m("Blastoise", "Torrent")], p2: [m("Venusaur", "Overgrow"), m("Gengar", "Cursed Body")],
  c1: ["move 1 1 dynamax, move 1", "move 1 1, move 1"], c2: "move 1, move 1", setup: (b) => { b.field.setWeather("sandstorm", "debug"); }, turns: 3,
}));
// E38. Harvest outside the sun: randomChance(1, 2); in the sun no chance call.
run("E38", "Harvest in the sun is certain", () => turn({
  game: "sv", p1: [m("Exeggutor", "Harvest", ["Splash"], { item: "Sitrus Berry" }), m("Snorlax", "Thick Fat")], p2: [m("Garchomp", "Rough Skin", ["Dragon Claw"]), m("Toxapex", "Regenerator")],
  c1: "move 1, move 1", c2: "move 1 1, move 1", setup: (b) => { b.field.setWeather("sunnyday", "debug"); hpTo(b, "p1a", 0.4); },
}));
