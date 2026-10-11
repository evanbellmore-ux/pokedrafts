// ADDENDUM probes, batch 3: damaging hits into a Substitute. Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/addendum-probes-3.ts [U1 ...] > scripts/.cache/calc-audit/status-eot/design/addendum-probes-3.out
// A Substitute "from an earlier turn" is set with addVolatile('substitute') (data/moves.ts:18328-18341 onStart: hp =
// floor(maxhp/4)) and, where a case needs another value, its effectState.hp.
import { enumerate, report, type AProbe } from "./addendum-sim";
import type { Mon } from "./status-sim";

const L = /^\|(move|cant|-fail|-immune|-activate|-item|-enditem|-damage|-heal|-boost|-unboost|-status|-start|-end|-crit|-hitcount|-fieldend|-sideend|switch|drag|-singleturn|-ohko)\|/;
// No two Pokémon of a case share a Speed: every speedSort of a tie is enumerated (2^k runs).
const still: Mon = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const subOf = (p: any) => (p.volatiles?.substitute ? `sub ${p.volatiles.substitute.hp}` : "no sub");
const all4 = (b: any) => [...b.p1.active, ...b.p2.active];
const state = (b: any) => all4(b).map((p: any) => `${p.name} ${p.hp}${p.item ? ` [${p.item}]` : ""}${p.volatiles?.substitute ? ` (sub ${p.volatiles.substitute.hp})` : ""}`).join(", ");
/** Put a Substitute with `hp` on p2a (the defender in most cases) without its HP cost. */
const subOn = (hp?: number, who: [string, number] = ["p2", 0]) => (b: any) => {
  const p = b[who[0]].active[who[1]];
  p.addVolatile("substitute");
  if (hp !== undefined) p.volatiles.substitute.hp = hp;
};
const attacker = (species: string, ability: string, moves: string[], extra: Partial<Mon> = {}): Mon => ({ species, ability, moves, ...extra });
const target = (species: string, ability: string, extra: Partial<Mon> = {}): Mon => ({ species, ability, moves: ["Splash"], ...extra });

// U1. Damage into a Substitute is capped at its HP; at 0 it breaks (-end); the Pokémon's HP does not change (data/moves.ts:18343-18371).
if (want("U1")) report("U1 sv: Lapras Ice Beam (every roll) into Snorlax's 40-HP Substitute", enumerate(base({
  mons: [attacker("Lapras", "Shell Armor", ["Ice Beam"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], rolls: "all", setup: subOn(40), inspect: (b) => `${subOf(b.p2.active[0])} | Snorlax ${b.p2.active[0].hp}`,
})), { lines: false });

// U2. Recoil and drain from the damage the Substitute took (capped): applyRecoilDamage(round(capped * 33/100)), drain
// heal(ceil(capped * 3/4)) -- ceil here, not the round a hit on the Pokémon uses (sim/battle.ts spreadDamage).
if (want("U2")) report("U2 sv: Talonflame Brave Bird into a 30-HP Substitute (recoil from 30)", enumerate(base({
  mons: [attacker("Talonflame", "Flame Body", ["Brave Bird"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(30), inspect: state,
})));
if (want("U2")) report("U2b sv: Talonflame Brave Bird into a 200-HP Substitute (recoil from the damage)", enumerate(base({
  mons: [attacker("Talonflame", "Flame Body", ["Brave Bird"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(200), inspect: state,
})));
for (const [label, extra] of [["", {}], [" with Big Root", { item: "Big Root" }]] as const) if (want("U2")) {
  report(`U2c sv: Sylveon (40 HP) Draining Kiss into a 23-HP Substitute${label}: heal ceil(23*3/4) = 18`, enumerate(base({
    mons: [attacker("Sylveon", "Pixilate", ["Draining Kiss"], extra), still, target("Snorlax", "Thick Fat"), slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { subOn(23)(b); b.p1.active[0].sethp(40); }, inspect: state,
  })));
}
if (want("U2")) report("U2d sv: Sylveon (40 HP) Draining Kiss into Liquid Ooze Tentacruel's 23-HP Substitute", enumerate(base({
  mons: [attacker("Sylveon", "Pixilate", ["Draining Kiss"]), still, target("Tentacruel", "Liquid Ooze"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { subOn(23)(b); b.p1.active[0].sethp(40); }, inspect: state,
})));

// U3. Life Orb after a hit on a Substitute (useMoveInner AfterMoveSecondarySelf: the move hit); Shell Bell heals nothing
// (move.totalDamage counts no Substitute damage: sim/battle-actions.ts hitStepMoveHitLoop damage[i] = md === true ? 0).
for (const item of ["Life Orb", "Shell Bell", "Normal Gem"]) if (want("U3")) {
  report(`U3 sv: Snorlax (100 HP) Body Slam with ${item} into Chansey's Substitute`, enumerate(base({
    mons: [attacker("Snorlax", "Thick Fat", ["Body Slam"], { item }), still, target("Chansey", "Natural Cure"), slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { subOn(80)(b); b.p1.active[0].sethp(100); }, inspect: state,
  })));
}

// U4. A multi-hit move: the hits into the Substitute until it breaks, then the rest into the Pokémon (each hit runs
// spreadMoveHit -> TryPrimaryHit while the volatile is up); Rocky Helmet hits back only for the hits on the Pokémon.
if (want("U4")) report("U4 sv: Skill Link Cloyster Icicle Spear (5 hits, lowest rolls) into a 30-HP Substitute; Snorlax has Rocky Helmet", enumerate(base({
  mons: [attacker("Cloyster", "Skill Link", ["Icicle Spear"]), still, target("Snorlax", "Thick Fat", { item: "Rocky Helmet" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(30), inspect: state,
})));
if (want("U4")) report("U4b sv: Breloom Bullet Seed (2-5 hits, lowest rolls) into a 50-HP Substitute", enumerate(base({
  mons: [attacker("Breloom", "Technician", ["Bullet Seed"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(50), inspect: state,
})), { lines: false });
if (want("U4")) report("U4c sv: Weavile Triple Axel (20/40/60, lowest rolls) into a 10-HP Substitute", enumerate(base({
  mons: [attacker("Weavile", "Pressure", ["Triple Axel"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(10), inspect: state,
})));
if (want("U4")) report("U4d sv: Skill Link Cloyster Icicle Spear into a 30-HP Substitute; Snorlax has a Focus Sash at full HP", enumerate(base({
  mons: [attacker("Cloyster", "Skill Link", ["Icicle Spear"], { level: 100, evs: { atk: 252 } }), still, target("Snorlax", "Thick Fat", { item: "Focus Sash", level: 5 }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(10), inspect: state,
})));

// U5. A spread move hits the Substitute with the spread modifier (getDamage: move.spreadHit): two identical Snorlax, one behind a big Substitute.
if (want("U5")) report("U5 sv: Garchomp Rock Slide into two identical Snorlax, p2a behind a 200-HP Substitute", enumerate(base({
  mons: [attacker("Garchomp", "Rough Skin", ["Rock Slide"]), still, target("Snorlax", "Thick Fat"), target("Snorlax", "Thick Fat", { evs: { spe: 4 } })],
  turns: [["move 1, move 1", "move 1, move 1"]], setup: subOn(200), inspect: state,
})));

// U6. Sound moves and Infiltrator pass it (onTryPrimaryHit returns for bypasssub and move.infiltrates).
for (const [species, ability, move] of [["Sylveon", "Cute Charm", "Hyper Voice"], ["Dragapult", "Infiltrator", "Dragon Claw"]] as const) if (want("U6")) {
  report(`U6 sv: ${species} (${ability}) ${move} into Snorlax's Substitute`, enumerate(base({
    mons: [attacker(species, ability, [move]), still, target("Snorlax", "Thick Fat"), slow],
    turns: [[move === "Hyper Voice" ? "move 1, move 1" : "move 1 1, move 1", "move 1, move 1"]], setup: subOn(), inspect: state,
  })));
}

// U7. Nothing of the Pokémon behind it reacts (targets[i] = null after HIT_SUBSTITUTE: no DamagingHit, onHit, AfterHit,
// AfterMoveSecondary on it): Rough Skin, Rocky Helmet, Weakness Policy, Occa Berry (not eaten, damage not halved: its
// hitSub check), Knock Off (x1.5 kept, no item removed), Stamina; Air Balloon pops (data/items.ts:203-210 onAfterSubDamage).
for (const [label, atk, def] of [
  ["Garchomp Dragon Claw into Rough Skin Garchomp", attacker("Garchomp", "Rough Skin", ["Dragon Claw"]), target("Garchomp", "Rough Skin", { evs: { spe: 4 } })],
  ["Snorlax Body Slam into Rocky Helmet Chansey", attacker("Snorlax", "Thick Fat", ["Body Slam"]), target("Chansey", "Natural Cure", { item: "Rocky Helmet" })],
  ["Lapras Ice Beam into Weakness Policy Garchomp", attacker("Lapras", "Shell Armor", ["Ice Beam"]), target("Garchomp", "Rough Skin", { item: "Weakness Policy" })],
  ["Charizard Flamethrower into Occa Berry Ferrothorn", attacker("Charizard", "Blaze", ["Flamethrower"]), target("Ferrothorn", "Iron Barbs", { item: "Occa Berry" })],
  ["Charizard Flamethrower into Ferrothorn (no Berry)", attacker("Charizard", "Blaze", ["Flamethrower"]), target("Ferrothorn", "Iron Barbs")],
  ["Snorlax Knock Off into Leftovers Chansey", attacker("Snorlax", "Thick Fat", ["Knock Off"]), target("Chansey", "Natural Cure", { item: "Leftovers" })],
  ["Snorlax Knock Off into item-less Chansey", attacker("Snorlax", "Thick Fat", ["Knock Off"]), target("Chansey", "Natural Cure")],
  ["Snorlax Body Slam into Stamina Mudsdale", attacker("Snorlax", "Thick Fat", ["Body Slam"]), target("Mudsdale", "Stamina")],
  ["Snorlax Body Slam into Air Balloon Chansey", attacker("Snorlax", "Thick Fat", ["Body Slam"]), target("Chansey", "Natural Cure", { item: "Air Balloon" })],
] as const) if (want("U7")) {
  report(`U7 sv: ${label}, behind a 300-HP Substitute`, enumerate(base({
    mons: [atk as Mon, still, def as Mon, slow], turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(300),
    inspect: (b) => `${state(b)} | target boosts ${JSON.stringify(b.p2.active[0].boosts)}`,
  })));
}

// U8. The user's own effects still happen (selfDrops and secondaries run for a null target; moveHit(null, ...) still runs a
// secondary's self): Close Combat's drops, Flame Charge's Speed +1; U-turn switches out; nothing on the target: Fake Out's
// flinch, Nuzzle's paralysis, Dragon Tail's drag (forceSwitch needs a target).
for (const [label, atk, def, choice] of [
  ["Close Combat", attacker("Lucario", "Inner Focus", ["Close Combat"]), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["Flame Charge", attacker("Talonflame", "Flame Body", ["Flame Charge"]), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["Fake Out (the target then moves)", attacker("Lapras", "Shell Armor", ["Fake Out"]), target("Snorlax", "Thick Fat", { moves: ["Body Slam"] }), "move 1 1"],
  ["Nuzzle", attacker("Pachirisu", "Volt Absorb", ["Nuzzle"]), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["Dragon Tail", attacker("Garchomp", "Rough Skin", ["Dragon Tail"], { evs: { spe: 252 } }), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["U-turn", attacker("Talonflame", "Flame Body", ["U-turn"]), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["Rapid Spin (user seeded)", attacker("Forretress", "Sturdy", ["Rapid Spin"], { evs: { spe: 252 } }), target("Snorlax", "Thick Fat"), "move 1 1"],
  ["Ice Spinner on Psychic Terrain", attacker("Baxcalibur", "Thermal Exchange", ["Ice Spinner"]), target("Snorlax", "Thick Fat"), "move 1 1"],
] as const) if (want("U8")) {
  report(`U8 sv: ${label} into Snorlax's 300-HP Substitute`, enumerate(base({
    mons: [atk as Mon, still, def as Mon, slow], turns: [[`${choice}, move 1`, `move 1${(def as Mon).moves?.[0] === "Body Slam" ? " 1" : ""}, move 1`]],
    setup: (b) => {
      subOn(300)(b);
      if (label.startsWith("Rapid Spin")) b.p1.active[0].addVolatile("leechseed", b.p2.active[0]);
      if (label.startsWith("Ice Spinner")) b.field.setTerrain("psychicterrain", "debug");
    },
    inspect: (b) => `${state(b)} | user boosts ${JSON.stringify(b.p1.active[0].boosts)} | target ${b.p2.active[0].status || "-"} | user volatiles ${Object.keys(b.p1.active[0].volatiles).join(",") || "-"} | terrain ${b.field.terrain || "-"} | request ${b.requestState} | p1a switchFlag ${b.p1.active[0].switchFlag}`,
  })));
}

// U9. An intact Disguise behind a Substitute: the Substitute takes the hit at full effectiveness (disguise onEffectiveness and
// onCriticalHit return for hitSub: data/abilities.ts:984-1001); Mimikyu stays disguised.
if (want("U9")) report("U9 sv: Gengar Shadow Ball into Mimikyu's 300-HP Substitute", enumerate(base({
  mons: [attacker("Gengar", "Cursed Body", ["Shadow Ball"]), still, target("Mimikyu", "Disguise"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(300), inspect: (b) => `${state(b)} | species ${b.p2.active[0].species.id}`,
})));

// U10. A Substitute made this turn (floor(maxhp/4), its user's HP cost), then hit; a Substitute broken by a hit lets a later
// status move through.
if (want("U10")) report("U10 sv: Jolteon Substitute (35), Lapras Ice Beam breaks it, Shuckle Will-O-Wisp then lands", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Quick Feet", moves: ["Substitute"] }, still, attacker("Lapras", "Shell Armor", ["Ice Beam"]), attacker("Shuckle", "Gluttony", ["Will-O-Wisp"])],
  turns: [["move 1, move 1", "move 1 1, move 1 1"]], inspect: (b) => `${state(b)} | Jolteon status ${b.p1.active[0].status || "-"}`,
})));
if (want("U10")) report("U10b sv: Jolteon Substitute (35); Shuckle (weak) Splash...; a 200-HP sub on Jolteon blocks Will-O-Wisp", enumerate(base({
  mons: [{ species: "Jolteon", ability: "Quick Feet", moves: ["Splash"] }, still, attacker("Lapras", "Shell Armor", ["Ice Beam"], { level: 5 }), attacker("Shuckle", "Gluttony", ["Will-O-Wisp"])],
  turns: [["move 1, move 1", "move 1 1, move 1 1"]], setup: subOn(200, ["p1", 0]), inspect: (b) => `${state(b)} | Jolteon status ${b.p1.active[0].status || "-"}`,
})));

// U11. A certain critical hit into a Substitute: the crit's damage (getDamage), capped.
if (want("U11")) report("U11 sv: Lapras Frost Breath (always crit) into a 300-HP Substitute", enumerate(base({
  mons: [attacker("Lapras", "Shell Armor", ["Frost Breath"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(300), inspect: state,
})));

// U12. Fixed damage into a Substitute: Super Fang reads the Pokémon's HP (not the Substitute's), capped; Seismic Toss the level.
for (const [move, sub] of [["Super Fang", 300], ["Super Fang", 30], ["Seismic Toss", 300]] as const) if (want("U12")) {
  report(`U12 sv: ${move} into Snorlax (200 HP) behind a ${sub}-HP Substitute`, enumerate(base({
    mons: [attacker("Raticate", "Guts", [move]), still, target("Snorlax", "Thick Fat"), slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]], setup: (b) => { b.p2.active[0].sethp(200); subOn(sub)(b); }, inspect: state,
  })));
}

// U13. A Substitute starting ends a partial trap (data/moves.ts:18336-18339): no Fire Spin damage at this end of turn.
if (want("U13")) report("U13 sv: Snorlax (trapped by Fire Spin from Charizard) uses Substitute; end of turn", enumerate(base({
  mons: [target("Charizard", "Blaze"), still, { species: "Snorlax", ability: "Thick Fat", moves: ["Substitute"] }, slow],
  turns: [["move 1, move 1", "move 1, move 1"]],
  setup: (b) => { b.p2.active[0].addVolatile("partiallytrapped", b.p1.active[0], b.dex.moves.get("firespin")); },
  inspect: (b) => `${state(b)} | Snorlax volatiles ${Object.keys(b.p2.active[0].volatiles).join(",")}`,
})));

// U14. Focus Punch behind a Substitute keeps its focus (the focuspunch condition's onHit needs the Hit event, not run for a
// Substitute hit).
if (want("U14")) report("U14 sv: Breloom (300-HP Substitute) Focus Punch; Lapras Ice Beam into it first", enumerate(base({
  mons: [attacker("Breloom", "Technician", ["Focus Punch"]), still, attacker("Lapras", "Shell Armor", ["Ice Beam"], { evs: { spe: 252 } }), slow],
  turns: [["move 1 1, move 1", "move 1 1, move 1"]], setup: subOn(300, ["p1", 0]), inspect: state,
})));

// U15. Magician takes an item from a Pokémon behind a Substitute (its onAfterMoveSecondarySelf reads move.hitTargets).
if (want("U15")) report("U15 sv: Magician Delphox Flamethrower into Leftovers Snorlax's Substitute", enumerate(base({
  mons: [attacker("Delphox", "Magician", ["Flamethrower"]), still, target("Snorlax", "Thick Fat", { item: "Leftovers" }), slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]], setup: subOn(300), inspect: state,
})));

// U16. Other games: champions, usum, swsh (and a Z-Move / a Max Move into a Substitute).
for (const game of ["champions", "usum", "swsh"] as const) if (want("U16")) {
  report(`U16 ${game}: Lapras Ice Beam into a 40-HP Substitute; Cloyster Icicle Spear (Skill Link) into a 30-HP one`, enumerate(base({
    game,
    mons: [attacker("Lapras", "Shell Armor", ["Ice Beam"]), attacker("Cloyster", "Skill Link", ["Icicle Spear"]), target("Snorlax", "Thick Fat"), target("Chansey", "Natural Cure")],
    turns: [["move 1 1, move 1 2", "move 1, move 1"]], setup: (b) => { subOn(40)(b); subOn(30, ["p2", 1])(b); }, inspect: state,
  })));
}
if (want("U16")) report("U16b usum: Z-Move (Subzero Slammer) into a 300-HP Substitute", enumerate(base({
  game: "usum",
  mons: [attacker("Lapras", "Shell Armor", ["Ice Beam"], { item: "Icium Z" }), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1 zmove, move 1", "move 1, move 1"]], setup: subOn(300), inspect: state,
})));
if (want("U16")) report("U16c swsh: Max Move (Max Hailstorm) into a 300-HP Substitute", enumerate(base({
  game: "swsh",
  mons: [attacker("Lapras", "Shell Armor", ["Ice Beam"]), still, target("Snorlax", "Thick Fat"), slow],
  turns: [["move 1 1 dynamax, move 1", "move 1, move 1"]], setup: subOn(300), inspect: (b) => `${state(b)} | weather ${b.field.weather || "-"}`,
})));

// U17. Self-cost moves into a Substitute: the Substitute's onTryPrimaryHit calls applyRecoilDamage(taken) for any hit with
// damage, which for Mind Blown / Steel Beam / Chloroblast is the half-HP cost (sim/battle-actions.ts:1382); the cost after the
// hits needs move.totalDamage > 0 (:981-983), which only a hit on a Pokémon adds. One target behind a Substitute: one cost;
// Mind Blown into a Substitute and a second Pokémon: two costs.
for (const [label, move, setup] of [
  ["Steel Beam into a 300-HP Substitute", "Steel Beam", (b: any) => subOn(300)(b)],
  ["Mind Blown into p2a's 300-HP Substitute and p2b (no Substitute)", "Mind Blown", (b: any) => subOn(300)(b)],
  ["Mind Blown into two 300-HP Substitutes", "Mind Blown", (b: any) => { subOn(300)(b); subOn(300, ["p2", 1])(b); }],
] as const) if (want("U17")) {
  report(`U17 sv: Blacephalon (Magic Bounce) ${label}`, enumerate(base({
    mons: [attacker("Blacephalon", "Beast Boost", [move]), still, target("Snorlax", "Thick Fat"), target("Chansey", "Natural Cure")],
    turns: [[move === "Mind Blown" ? "move 1, move 1" : "move 1 1, move 1", "move 1, move 1"]], setup: (b) => (setup as (b: any) => void)(b), inspect: state,
  })));
}
