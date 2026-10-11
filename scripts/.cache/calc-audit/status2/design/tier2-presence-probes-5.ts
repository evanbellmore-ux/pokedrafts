// TIER 2 (presence) probes, part 5: edge cases the design relies on. Counter after its recorded attacker fainted; Counter
// after a hit Disguise took; Counter with Parental Bond (USUM); Round pulling a fainted Pokémon's Round; the combined
// Water Pledge into a Protect (the rainbow?); Dancer's copy and Fusion (a dance between Fusion Flare and Bolt).
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-presence-probes-5.ts > scripts/.cache/calc-audit/status2/design/tier2-presence-probes-5.out
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const state = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.status ? " " + p.status : ""}) ${boosts(p)}`;
}).join(" | ");
const L = /^\|(move|switch|-heal|-damage|-boost|-unboost|-activate|-fail|-immune|-miss|cant|-start|-end|-sidestart|-waiting|-singleturn|-hitcount|faint|detailschange|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const run = (title: string, probe: Probe, opts: Parameters<typeof report>[2] = {}) => report(title, enumerate({ lines: L, inspect: state, ...probe }), opts);

showTrace("E1 Counter after its physical attacker fainted (KO'd by the Counter user's ally): no target / the other foe?", {
  game: "sv", turns: [["move 1, move 1 1", "move 1 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(1); },
  mons: [{ species: "Wobbuffet", ability: "Shadow Tag", moves: ["Counter"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"], name: "AllyTackle", evs: { spe: 60 } },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
}, L);
showTrace("E2 Counter after a physical hit Disguise took (0 damage)", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Mimikyu", ability: "Disguise", moves: ["Counter"] }, lax(1), { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, lax(2)],
}, L);
run("E3 Counter with Parental Bond (USUM Kangaskhan-Mega, Mega Evolved before the turn): two hits of 2x each? (lowest rolls)", {
  game: "usum", turns: [["move 1, move 1", "move 1 1, move 1"]], rolls: "lowest",
  setup: (b) => { const k = b.p1.active[0]; k.formeChange("Kangaskhan-Mega", null, true); k.setAbility("parentalbond"); },
  mons: [{ species: "Kangaskhan", ability: "Scrappy", item: "Kangaskhanite", moves: ["Counter"], evs: { hp: 252, def: 252 } }, lax(1),
    { species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "LaxBulk" }],
});
showTrace("E4 Round: the first queued Round is a fainted Pokémon's (KO'd before): it is pulled and does nothing; the living Round is not", {
  game: "sv", turns: [["move 1 2, move 1 1", "move 1 2, move 1 1"]], setup: (b) => { b.p2.active[1].sethp(1); },
  mons: [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Altaria", ability: "Natural Cure", moves: ["Round"], name: "AltRound", evs: { spe: 100 } },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "SlowRound" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Round"], name: "FaintedRound", evs: { spe: 200 } }],
}, L);
showTrace("E5 combined Water Pledge (Fire Pledge first) into a Protect: the rainbow?", {
  game: "swsh", turns: [["move 1 1, move 1 1", "move 1, move 1"]],
  mons: [{ species: "Charizard", ability: "Blaze", moves: ["Fire Pledge"], evs: { spe: 252 } }, { species: "Blastoise", ability: "Torrent", moves: ["Water Pledge"] },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "FoeProtect" }, lax(2)],
}, L);
run("E6 Fusion Flare, a foe's Swords Dance copied by a Dancer in between, then Fusion Bolt (lowest rolls)", {
  game: "sv", turns: [["move 1 2, move 1 2", "move 1, move 1"]], rolls: "lowest",
  mons: [{ species: "Reshiram", ability: "Turboblaze", moves: ["Fusion Flare"], evs: { spe: 252 } }, { species: "Zekrom", ability: "Teravolt", moves: ["Fusion Bolt"] },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"] }, { species: "Oricorio", ability: "Dancer", moves: ["Splash"], name: "Ori" }],
});
showTrace("E7 Instruct on an ally whose last move this turn was a Dancer copy only (lastMove unchanged by external moves)", {
  game: "sv", turns: [["move 1, move 1 -1", "move 1, move 1"]],
  mons: [{ species: "Oricorio", ability: "Dancer", moves: ["Splash"], evs: { spe: 0 } }, { species: "Oranguru", ability: "Inner Focus", moves: ["Instruct"] },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
}, L);
showTrace("E8 Copycat after a Dancer's copy of Swords Dance: copies Swords Dance", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Oricorio", ability: "Dancer", moves: ["Splash"], evs: { spe: 0 } }, { species: "Clefable", ability: "Magic Guard", moves: ["Copycat"] },
    { species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, lax(2)],
}, L);
