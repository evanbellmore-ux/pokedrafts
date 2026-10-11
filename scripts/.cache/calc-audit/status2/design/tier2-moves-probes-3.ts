// TIER 2 (moves phase) probes, part 3: intact Disguise / Ice Face against multi-hit moves, Parental Bond, 0-damage
// reactions and a confusion self-hit; Focus Band; Berries between hits; Sparkling Aria's faint timing; gen 7 Gale
// Wings; Assurance after the target's own recoil; Pain Split into a Dynamaxed Pokémon; Sleep Talk; Uproar; Safeguard
// against a later damaging move's status. Pinned Showdown c23d2e94 through guards-sim.ts. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status2/design/tier2-moves-probes-3.ts [ID ...] > scripts/.cache/calc-audit/status2/design/tier2-moves-probes-3.out
import { enumerate, monAt, report, showTrace, type Mon, type Probe } from "./guards-sim";

const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const boosts = (p: any) => {
  if (!p) return "-";
  const parts = Object.entries(p.boosts as Record<string, number>).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join(" ") : "0";
};
const vols = (p: any) => Object.keys(p?.volatiles ?? {}).filter((v) => !["stall"].includes(v)).join(",") || "-";
const who = (b: any) => ["p1a", "p1b", "p2a", "p2b"].map((id) => {
  const p = monAt(b, id as any);
  return `${id}:${p?.name}(${p?.hp}/${p?.maxhp}${p?.status ? " " + p.status : ""}${p?.item ? " @" + p.item : ""} ${p?.species?.id}) ${boosts(p)} [${vols(p)}]`;
}).join(" | ");
const LINES = /^\|(move|cant|-miss|-heal|-damage|-boost|-unboost|-enditem|-item|-ability|-activate|-block|-fail|-immune|-start|-end|-status|-curestatus|-formechange|detailschange|-hitcount|-sethp|-supereffective|-resisted|-singleturn|turn)\|/;
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const trace = (id: string, title: string, probe: Probe, keep: RegExp = LINES) => { if (want(id)) showTrace(`${id} ${title}`, probe, keep); };
const run = (id: string, title: string, probe: Probe) => { if (want(id)) report(`${id} ${title}`, enumerate({ lines: LINES, inspect: who, ...probe }), { lines: true }); };

// ---- Disguise and Ice Face against a multi-hit move: the first hit 0, the form at the Update between hits (+ the gen 8+ chip), later hits into the busted form ----
for (const game of ["sv", "usum"] as const) {
  trace(`T2-FA01-${game}`, `${game}: Double Hit (2 hits) into an intact Mimikyu: hit 1 takes no damage, ${game === "sv" ? "the 1/8 chip at the Update, " : ""}hit 2 into the busted form`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Kangaskhan", ability: "Scrappy", moves: ["Double Hit"], evs: { spe: 252 }, name: "Kanga" }, lax(1),
      { species: "Mimikyu", ability: "Disguise", moves: ["Splash"], name: "Kyu" }, lax(2)],
  });
}
trace("T2-FA02", "swsh: Dual Wingbeat (physical, 2 hits) into an intact Eiscue: hit 1 takes no damage, Noice Face at the Update, hit 2 into Noice (its lower Defense)", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Eiscue", ability: "Ice Face", moves: ["Splash"], name: "Cue" }, lax(2)],
});
trace("T2-FA02c", "swsh: control: the same Dual Wingbeat into Eiscue-Noice from the start", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { spe: 252 }, name: "Nite" }, lax(1),
    { species: "Eiscue-Noice", ability: "Ice Face", moves: ["Splash"], name: "Cue" }, lax(2)],
});
trace("T2-FA03", "champions: Kangaskhan-Mega (Parental Bond) Crunch into an intact Mimikyu: the first strike takes no damage, the second (x0.25) into the busted form", {
  game: "champions", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Kangaskhan-Mega", ability: "Parental Bond", moves: ["Crunch"], evs: { spe: 32 }, name: "Kanga" }, lax(1),
    { species: "Mimikyu", ability: "Disguise", moves: ["Splash"], name: "Kyu" }, lax(2)],
});
for (const [id, item, move, title] of [
  ["T2-FA04", "Rocky Helmet", "Crunch", "a contact hit into an intact Mimikyu with Rocky Helmet: does the 0-damage hit hurt the attacker?"],
  ["T2-FA05", "Leftovers", "Knock Off", "Knock Off into an intact Mimikyu with Leftovers: is the item knocked off?"],
  ["T2-FA06", "Air Balloon", "Crunch", "a hit into an intact Mimikyu with Air Balloon: does it pop?"],
  ["T2-FA07", "Kee Berry", "Crunch", "a physical hit into an intact Mimikyu with Kee Berry: is it eaten?"],
  ["T2-FA08", "Sticky Barb", "Crunch", "a contact hit into an intact Mimikyu with Sticky Barb: does the Barb move?"],
  ["T2-FA09", "Leftovers", "Thief", "Thief (no item) into an intact Mimikyu with Leftovers: is it taken?"],
  ["T2-FA10", "Leftovers", "Fire Spin", "Fire Spin into an intact Mimikyu: is it trapped?"],
  ["T2-FA11", "Leftovers", "Salt Cure", "Salt Cure into an intact Mimikyu: the salt cure volatile?"],
] as const) {
  trace(id, `sv: ${title}`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: [move], evs: { spe: 252 }, name: "Lax" }, lax(1),
      { species: "Mimikyu", ability: "Disguise", item, moves: ["Splash"], name: "Kyu" }, lax(2)],
  });
}
trace("T2-FA12", "sv: a Magician Delphox (no item) Flamethrower into an intact Mimikyu with Leftovers: does Magician take it?", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Delphox", ability: "Magician", moves: ["Flamethrower"], evs: { spe: 252 }, name: "Fox" }, lax(1),
    { species: "Mimikyu", ability: "Disguise", item: "Leftovers", moves: ["Splash"], name: "Kyu" }, lax(2)],
});
// ---- A confused Mimikyu's self-hit: Disguise takes it (effectType Move); gen 8+ chip; gen 7 none ----
for (const game of ["sv", "usum"] as const) {
  trace(`T2-FA13-${game}`, `${game}: a confused intact Mimikyu hurts itself (forced): Disguise takes it`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1"]], force: ["confusion"],
    mons: [{ species: "Mimikyu", ability: "Disguise", moves: ["Shadow Claw"], evs: { spe: 252 }, name: "Kyu" }, lax(1), lax(2), lax(3)],
    setup: (b) => { b.p1.active[0].addVolatile("confusion"); b.p1.active[0].volatiles.confusion.time = 3; },
  });
}
// ---- Focus Band on a confusion self-hit (effectType Move): 1/10 ----
run("T2-FB01", "sv: a confused Snorlax at 10 HP with Focus Band hurts itself (forced self-hit): Focus Band 1/10", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]], force: ["confusion"],
  mons: [{ species: "Snorlax", ability: "Thick Fat", item: "Focus Band", moves: ["Splash"], evs: { spe: 252 }, name: "Band" }, lax(1), lax(2), lax(3)],
  setup: (b) => { b.p1.active[0].addVolatile("confusion"); b.p1.active[0].volatiles.confusion.time = 3; b.p1.active[0].sethp(10); },
});
// ---- Berries between hits: a Ganlon (Def +1) eaten at the Update after hit 1 weakens hit 2; Starf's random stat ----
trace("T2-BE01", "sv: Dual Wingbeat into a Ganlon Berry Snorlax at 70 HP: hit 1 takes it to its quarter line, Ganlon +1 Def, hit 2 weaker", {
  game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 }, nature: "Adamant", name: "Nite" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", item: "Ganlon Berry", moves: ["Splash"], name: "Gan" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(110); },
});
run("T2-BE02", "swsh: Dual Wingbeat into a Starf Berry Snorlax at 110 HP: Starf at the Update between hits (+2 to a random stat), hit 2 reads it", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Dragonite", ability: "Inner Focus", moves: ["Dual Wingbeat"], evs: { atk: 252, spe: 252 }, nature: "Adamant", name: "Nite" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", item: "Starf Berry", moves: ["Splash"], name: "Starf" }, lax(2)],
  setup: (b) => { b.p2.active[0].sethp(110); },
});
// ---- Sparkling Aria: a Life Orb faint after the hits still cures; a faint during the hits (Rowap Berry) does not ----
trace("T2-AR01", "sv: Primarina at 5 HP with Life Orb: Sparkling Aria hits a burned foe; Life Orb knocks it out after the hits; the burn is cured", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Primarina", ability: "Torrent", item: "Life Orb", moves: ["Sparkling Aria"], evs: { spe: 252 }, name: "Prim" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "Ally" },
    { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Burned" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "Prot" }],
  setup: (b) => { b.p1.active[0].sethp(5); b.p2.active[0].setStatus("brn"); },
}, /^\|(move|-damage|-curestatus|-enditem|faint|-activate)\|/);
trace("T2-AR02", "sv: Primarina at 5 HP (no item): Sparkling Aria hits a burned foe holding Rowap Berry, which knocks Primarina out in the hit: no cure", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Primarina", ability: "Torrent", moves: ["Sparkling Aria"], evs: { spe: 252 }, name: "Prim" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "Ally" },
    { species: "Snorlax", ability: "Thick Fat", item: "Rowap Berry", moves: ["Splash"], name: "Burned" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Protect"], name: "Prot" }],
  setup: (b) => { b.p1.active[0].sethp(5); b.p2.active[0].setStatus("brn"); },
}, /^\|(move|-damage|-curestatus|-enditem|faint|-activate)\|/);
// ---- Gale Wings in gen 7: the priority sorted at the turn's start stays (no re-sort) while the HP falls before it moves ----
for (const game of ["usum", "sv"] as const) {
  trace(`T2-GW01-${game}`, `${game}: Talonflame at full HP; a foe's Fake Out hits it first; its Brave Bird at Bruxish? (Dazzling: usum) / Armor Tail Farigiraf (sv)`, {
    game, turns: [["move 1 1, move 1", "move 1, move 1 1"]],
    mons: [{ species: "Talonflame", ability: "Gale Wings", moves: ["Brave Bird"], evs: { spe: 252 }, name: "Talon" }, lax(1),
      game === "usum" ? { species: "Bruxish", ability: "Dazzling", moves: ["Splash"], name: "Brux" } : { species: "Farigiraf", ability: "Armor Tail", moves: ["Splash"], name: "Giraf" }, { species: "Dragonite", ability: "Inner Focus", moves: ["Extreme Speed"], name: "Speedy" }],
  }, /^\|(move|cant|-damage|-activate|-fail|-block)\|/);
}
// ---- Assurance: hurtThisTurn from the target's own recoil and Life Orb ----
trace("T2-AS01", "sv: a foe's Flare Blitz (recoil) first; then Assurance into it (doubled)", {
  game: "sv", turns: [["move 1, move 1 1", "move 1 2, move 1"]],
  mons: [lax(1), { species: "Incineroar", ability: "Blaze", moves: ["Assurance"], name: "Roar" },
    { species: "Arcanine", ability: "Intimidate", moves: ["Flare Blitz"], evs: { spe: 252 }, name: "Arc" }, lax(2)],
});
trace("T2-AS01c", "sv: control: the foe's Splash; then Assurance into it", {
  game: "sv", turns: [["move 1, move 1 1", "move 2, move 1"]],
  mons: [lax(1), { species: "Incineroar", ability: "Blaze", moves: ["Assurance"], name: "Roar" },
    { species: "Arcanine", ability: "Intimidate", moves: ["Flare Blitz", "Splash"], evs: { spe: 252 }, name: "Arc" }, lax(2)],
});
// ---- Pain Split into a Dynamaxed foe: its undynamaxed HP is averaged, its HP changes by the undynamaxed difference ----
trace("T2-PS01", "swsh: Gengar (100 HP) Pain Split into a Dynamaxed Snorlax at 300/470 (it attacks after)", {
  game: "swsh", turns: [["move 1 1, move 1", "move 1 2 dynamax, move 1"]],
  mons: [{ species: "Gengar", ability: "Cursed Body", moves: ["Pain Split"], evs: { spe: 252 }, name: "Gar" }, lax(1),
    { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], name: "Max" }, lax(2)],
  setup: (b) => { b.p1.active[0].sethp(100); b.p2.active[0].sethp(150); },
}, /^\|(move|-damage|-heal|-sethp|-start)\|/);
// ---- Sleep Talk asleep: a uniform pick of its callable moves; the called move's target at random ----
run("T2-ST01", "sv: an asleep Snorlax (Sleep Talk, Body Slam, Earthquake, Protect) uses Sleep Talk", {
  game: "sv", turns: [["move 1, move 1", "move 1, move 1"]],
  mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Sleep Talk", "Body Slam", "Earthquake", "Protect"], evs: { spe: 252 }, name: "Talker" }, lax(1), lax(2), lax(3)],
  setup: (b) => { b.p1.active[0].setStatus("slp"); b.p1.active[0].statusState.time = 3; },
});
// ---- Uproar: wakes every sleeper at its hit; then no Pokémon can fall asleep while it lasts ----
trace("T2-UP01", "sv: Uproar wakes an asleep foe and an asleep ally; a later Spore fails; a later Rest fails", {
  game: "sv", turns: [["move 1, move 1", "move 1 1, move 1"]],
  mons: [{ species: "Exploud", ability: "Soundproof", moves: ["Uproar"], evs: { spe: 252 }, name: "Loud" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Rest"], name: "Rester" },
    { species: "Amoonguss", ability: "Effect Spore", moves: ["Spore"], name: "Shroom" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Sleeper" }],
  setup: (b) => { b.p2.active[1].setStatus("slp"); b.p2.active[1].statusState.time = 3; b.p1.active[1].sethp(100); },
}, /^\|(move|cant|-fail|-curestatus|-status|-start|-end|-heal)\|/);
// ---- Safeguard set this turn keeps a later foe's damaging move's 100% status off; Infiltrator passes ----
trace("T2-SG01", "sv: Safeguard; then a foe's Nuzzle (100% par) at the side: blocked; an Infiltrator foe's Nuzzle? (Infiltrator Dragapult has no Nuzzle: use Seviper? sv: Infiltrator Chandelure's Inferno? no: use Hypnosis-free: Infiltrator Brambleghast? : fall back to Nuzzle by Pachirisu only", {
  game: "sv", turns: [["move 1, move 1", "move 1 2, move 1"]],
  mons: [{ species: "Florges", ability: "Flower Veil", moves: ["Safeguard"], evs: { spe: 252 }, name: "Guard" }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], name: "Lax" },
    { species: "Pachirisu", ability: "Run Away", moves: ["Nuzzle"], name: "Pachi" }, lax(2)],
}, /^\|(move|-damage|-status|-activate|-sidestart)\|/);
