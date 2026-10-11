// CRITIC probes for ADDENDUM.md (hits into a Substitute, Ally Switch, Trick). Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/critic-probes-1.ts [K1 ...] > scripts/.cache/calc-audit/status-eot/design/critic-probes-1.out
// Uses the addendum harness (addendum-sim.ts): exact enumeration, the oracle's forcing, `inspect` at the residual pick.
import { enumerate, report, type AProbe } from "./addendum-sim";
import type { Mon } from "./status-sim";
import * as sim from "../../showdown/sim/index.ts";

const { Battle } = sim as any;
const L = /^\|(move|cant|swap|-fail|-damage|-heal|-activate|-start|-end|-immune|-enditem|-item|-hitcount|faint)\|/;
const still: Mon = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const slow: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
const base = (over: Partial<AProbe>): AProbe => ({ game: "sv", mons: [still, still, still, slow], turns: [["move 1, move 1", "move 1, move 1"]], lines: L, ...over });
const only = process.argv.slice(2);
const want = (id: string) => !only.length || only.includes(id);
const all4 = (b: any) => [...b.p1.active, ...b.p2.active];
const state = (b: any) => all4(b).map((p: any) => `${p.name} ${p.hp}/${p.maxhp}${p.item ? ` [${p.item}]` : ""}${p.volatiles?.substitute ? ` (sub ${p.volatiles.substitute.hp})` : ""}`).join(", ");
const subOn = (hp: number, who: [string, number] = ["p2", 0]) => (b: any) => {
  const p = b[who[0]].active[who[1]];
  p.addVolatile("substitute");
  p.volatiles.substitute.hp = hp;
};

// K1. timesAttacked (Rage Fist's count, sim/battle-actions.ts:993-998: `target.timesAttacked += hit - 1` for the LAST hit's
// targets) after a multi-hit move into a Substitute: none while every hit met the Substitute; every hit of the move (the
// Substitute's included) once a hit after the break reached the Pokémon. Annihilape then uses Rage Fist (min(350, 50 + 50 x count)) into its ally Shuckle.
for (const [label, hp] of [["30-HP Substitute (breaks on hit 1 or 2)", 30], ["300-HP Substitute (never breaks)", 300], ["no Substitute", 0]] as const) if (want("K1")) {
  report(`K1 sv: Skill Link Cloyster Icicle Spear (5 hits) into Annihilape behind a ${label}; Annihilape then Rage Fist into its ally Shuckle`, enumerate(base({
    mons: [{ species: "Cloyster", ability: "Skill Link", moves: ["Icicle Spear"], evs: { spe: 252 } }, still,
      { species: "Annihilape", ability: "Defiant", moves: ["Rage Fist"] }, slow],
    turns: [["move 1 1, move 1", "move 1 -2, move 1"]],
    setup: hp ? subOn(hp) : undefined,
    inspect: (b) => `${state(b)} | Annihilape timesAttacked ${b.p2.active[0].timesAttacked}`,
  })));
}

// K2. Drain into a Substitute (data/moves.ts:18366-18368 heal(ceil(taken*drain))) with the attacker's Big Root and the
// target's Liquid Ooze: Big Root's chainModify is applied at the end of TryHeal, after Liquid Ooze has dealt its `damage`
// argument (sim/battle.ts runEvent modifier); and Liquid Ooze acts before heal()'s full-HP check (sim/battle.ts:2271-2275).
for (const [label, item, hp] of [["Big Root, 40 HP", "Big Root", 40], ["no item, full HP", "", 0], ["Big Root, full HP", "Big Root", 0]] as const) if (want("K2")) {
  report(`K2 sv: Sylveon (${label}) Draining Kiss into Liquid Ooze Tentacruel's 23-HP Substitute`, enumerate(base({
    mons: [{ species: "Sylveon", ability: "Pixilate", moves: ["Draining Kiss"], ...(item ? { item } : {}) }, still, { species: "Tentacruel", ability: "Liquid Ooze", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => { subOn(23)(b); if (hp) b.p1.active[0].sethp(hp); },
    inspect: state,
  })));
}

// K4. Ally Switch and the tracking moves aimed at the user's OWN ally: getTarget returns the original target when it is
// still active (sim/battle.ts:2444-2447) before the self-position failure (:2456-2462), so Snipe Shot and a Stalwart user
// hit the ally that switched, instead of failing [notarget] as a plain move does (A2).
for (const [species, ability, move] of [["Inteleon", "Torrent", "Snipe Shot"], ["Duraludon", "Stalwart", "Flash Cannon"], ["Snorlax", "Thick Fat", "Body Slam"]] as const) if (want("K4")) {
  report(`K4 sv: ${species} (${ability}, p1a) ${move} at its ally Lapras (-2); Lapras Ally Switches first`, enumerate(base({
    mons: [{ species, ability, moves: [move] }, { species: "Lapras", ability: "Shell Armor", moves: ["Ally Switch"] }, still, slow],
    turns: [["move 1 -2, move 1", "move 1, move 1"]],
    inspect: (b) => `p1: ${b.p1.active.map((p: any) => `${p.name} ${p.hp}/${p.maxhp}`).join(", ")}`,
  })));
}

// K5. A contact multi-hit move (Dual Wingbeat, 40 BP: Technician) into a Substitute in front of Mummy: no DamagingHit for
// a hit on the Substitute, so the attacker keeps Technician for every hit into it (Showdown); the engine's multi-hit loop
// swaps the ability on contact after hit 1 (@smogon/calc dist/mechanics/util.js checkMultihitBoost), so its hit-2 values
// read no Technician. K5b: the same Substitute with Mummy replaced by Run Away gives the two Technician hits.
for (const [label, hp] of [["300-HP Substitute", 300], ["no Substitute", 0]] as const) if (want("K5")) {
  report(`K5 sv: Technician Scizor Dual Wingbeat (lowest rolls) into Mummy Cofagrigus, ${label}`, enumerate(base({
    mons: [{ species: "Scizor", ability: "Technician", moves: ["Dual Wingbeat"] }, still, { species: "Cofagrigus", ability: "Mummy", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: hp ? subOn(hp) : undefined,
    inspect: (b) => `${state(b)} | Scizor ability ${b.p1.active[0].ability}`,
  })));
}
if (want("K5")) report("K5b sv: Technician Scizor Dual Wingbeat (lowest rolls) into Cofagrigus with Run Away in place of Mummy, 300-HP Substitute", enumerate(base({
  mons: [{ species: "Scizor", ability: "Technician", moves: ["Dual Wingbeat"] }, still, { species: "Cofagrigus", ability: "Mummy", moves: ["Splash"] }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: (b) => { subOn(300)(b); b.p2.active[0].setAbility("runaway"); },
  inspect: (b) => `${state(b)} | Scizor ability ${b.p1.active[0].ability}`,
})));

// K6. Knock Off into a Substitute in front of a resist Berry that would act: Colbur's onSourceModifyDamage returns for
// hitSub (data/items.ts), while Knock Off's onBasePower still sees a removable item (x1.5). So the calculation into the
// Substitute must see an ordinary held item in place of the Berry (Leftovers), not no item.
for (const item of ["Colbur Berry", "Leftovers", ""]) if (want("K6")) {
  report(`K6 sv: Snorlax Knock Off (lowest roll) into Alakazam ${item ? `holding ${item}` : "(no item)"} behind a 300-HP Substitute`, enumerate(base({
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Knock Off"] }, still, { species: "Alakazam", ability: "Inner Focus", moves: ["Splash"], ...(item ? { item } : {}) }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: subOn(300),
    inspect: state,
  })));
}

// K7. Steel Beam and Brave Bird into a Substitute: the self-cost and recoil come once, in the Substitute's hit
// (applyRecoilDamage(damage)); after the hit loop move.totalDamage is 0, so no second cost (sim/battle-actions.ts:978-980).
// Shell Bell with no damage to the Pokémon heals nothing (data/items.ts shellbell: move.totalDamage).
for (const [label, mon, sub] of [
  ["Steel Beam, 300-HP Substitute", { species: "Metagross", ability: "Clear Body", moves: ["Steel Beam"] }, 300],
  ["Brave Bird with Shell Bell, 300-HP Substitute", { species: "Talonflame", ability: "Flame Body", moves: ["Brave Bird"], item: "Shell Bell" }, 300],
] as const) if (want("K7")) {
  report(`K7 sv: ${label}`, enumerate(base({
    mons: [mon as Mon, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, slow],
    turns: [["move 1 1, move 1", "move 1, move 1"]],
    setup: (b) => { subOn(sub)(b); b.p1.active[0].sethp(Math.floor(b.p1.active[0].maxhp * 0.9)); },
    inspect: state,
  })));
}

// K8. A contact multi-hit move whose first hit breaks the Substitute: Rocky Helmet hits back for the hits on the Pokémon only
// (DamagingHit runs for the Pokémon's hits, not for the Substitute's: sim/battle-actions.ts:1062-1064, 1121).
if (want("K8")) report("K8 sv: Technician Scizor Dual Wingbeat (lowest rolls) into Rocky Helmet Snorlax behind a 10-HP Substitute", enumerate(base({
  mons: [{ species: "Scizor", ability: "Technician", moves: ["Dual Wingbeat"] }, still, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], item: "Rocky Helmet" }, slow],
  turns: [["move 1 1, move 1", "move 1, move 1"]],
  setup: subOn(10),
  inspect: state,
})));

// K3. Shed Tail: the Substitute the replacement gets has its maker's HP, floor(Shed Tail user's maxhp / 4)
// (data/moves.ts shedtail volatileStatus substitute: onStart on the user; sim/pokemon.ts copyVolatileFrom), not the
// replacement's own quarter. Run by hand (the replacement is chosen at the switch request).
if (want("K3")) {
  const team = (names: [string, string, string][]) => names.map(([species, ability, move]) => ({
    name: species, species, ability, item: "", moves: [move], nature: "Serious", evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, happiness: 255, gender: "",
  }));
  const b = new Battle({ formatid: "gen9doublescustomgame", seed: [1, 2, 3, 4] });
  b.setPlayer("p1", { team: team([["Cyclizar", "Regenerator", "Shed Tail"], ["Blissey", "Natural Cure", "Splash"], ["Shedinja", "Wonder Guard", "Splash"]]) });
  b.setPlayer("p2", { team: team([["Lapras", "Shell Armor", "Splash"], ["Shuckle", "Gluttony", "Splash"], ["Snorlax", "Thick Fat", "Splash"]]) });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  b.makeChoices("move 1, move 1", "move 1, move 1");
  if (b.requestState === "switch") b.makeChoices("switch 3, pass", "pass");
  const cyclizar = b.p1.pokemon.find((p: any) => p.name === "Cyclizar");
  const shedinja = b.p1.active.find((p: any) => p.name === "Shedinja");
  console.log("\n### K3 sv: Cyclizar (252 HP EVs) Shed Tail, Shedinja comes in");
  console.log(`  Cyclizar maxhp ${cyclizar.maxhp} (quarter ${Math.floor(cyclizar.maxhp / 4)}); Shedinja maxhp ${shedinja?.maxhp}; Shedinja substitute hp ${shedinja?.volatiles?.substitute?.hp}`);
  console.log("  lines:");
  for (const line of (b.log as string[]).filter((l) => /\|(move|switch|-start|-end|-damage)\|/.test(l))) console.log(`     ${line}`);
}
