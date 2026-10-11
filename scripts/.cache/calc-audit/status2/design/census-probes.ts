// CENSUS 2 probes on pinned Showdown c23d2e94 (the runnable copy scripts/.cache/calc-audit/showdown): the protocol lines
// that settle what Showdown does at the guards the user named. Plain seeded battles (accuracy forced to hit, chances below
// 100% fail), one turn each, the relevant log lines printed in order.
//
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/design/census-probes.ts > scripts/.cache/calc-audit/status2/design/census-probes.out
import * as sim from "../../showdown/sim/index.ts";

const { Battle } = sim as any;
type Mon = { species: string; ability?: string; item?: string; moves?: string[]; nature?: string; evs?: Record<string, number>; level?: number };
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const setOf = (m: Mon, name = m.species) => ({
  name, species: m.species, gender: "", item: m.item ?? "", ability: m.ability ?? "", moves: m.moves?.length ? m.moves : ["Splash"],
  nature: m.nature ?? "Serious", evs: { ...ZERO, ...m.evs }, ivs: IV31, level: m.level ?? 50, happiness: 255,
});
const BENCH: Mon = { species: "Snorlax", ability: "Thick Fat", moves: ["Tackle"] };

function battle(format: string, p1: Mon[], p2: Mon[]) {
  const b = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
  b.setPlayer("p1", { team: [...p1, BENCH].map((m, i) => setOf(m, i === p1.length ? "Bench" : m.species)) });
  b.setPlayer("p2", { team: [...p2, BENCH].map((m, i) => setOf(m, i === p2.length ? "Bench" : m.species)) });
  if (b.requestState === "teampreview") b.makeChoices("team 123", "team 123");
  // Every move hits; added effects below 100% fail (secondaries roll random(100): 99, as the oracle forces it, 2v2/verify/sim-dfs.ts).
  b.randomChance = function (n: number, d: number) { return n >= d || (d === 100 && new Error().stack!.includes("hitStepAccuracy")); };
  const random = b.random.bind(b);
  b.random = function (m?: number, n?: number) { return m === 100 && n === undefined ? 99 : random(m, n); };
  return b;
}
const show = (title: string, b: any, from: number, keep: RegExp) => {
  console.log(`\n== ${title}`);
  for (const line of (b.log as string[]).slice(from)) if (keep.test(line)) console.log(`  ${line}`);
  console.log(`  requestState=${b.requestState} turn=${b.turn} midTurn=${b.midTurn}`);
};
const LINES = /^\|(move|switch|drag|-heal|-damage|-boost|-unboost|-enditem|-item|-transform|-activate|-ability|turn|upkeep|-weather|-fail|-miss|-immune|cant)\|/;

// P1: Matcha Gotcha into two foes heals once per target, in hit order (PS/sim/battle.ts:2170-2172 inside spreadDamage's loop).
{
  const b = battle("gen9doublescustomgame", [{ species: "Sinistcha", ability: "Hospitality", moves: ["Matcha Gotcha"] }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Snorlax", ability: "Thick Fat" }, { species: "Blissey", ability: "Natural Cure" }]);
  b.p1.active[0].sethp(40);
  const at = b.log.length;
  b.makeChoices("move 1, move 1", "move 1, move 1");
  show("P1 Matcha Gotcha: one drain heal per target", b, at, LINES);
}
// P2: U-turn with a later action: the switch request comes mid-turn (PS/sim/battle.ts:2876-2914); the replacement takes
// the later move aimed at that position; the replacement does not act this turn.
{
  const b = battle("gen9doublescustomgame", [{ species: "Rillaboom", ability: "Grassy Surge", moves: ["U-turn"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Snorlax", ability: "Thick Fat" }, { species: "Torkoal", ability: "Shell Armor", moves: ["Tackle"] }]);
  const at = b.log.length;
  b.makeChoices("move 1 1, move 1", "move 1, move 1 1");
  show("P2a U-turn: after the U-turn action", b, at, LINES);
  const at2 = b.log.length;
  b.makeChoices("switch 3", "");
  show("P2b U-turn: the replacement switches in, then the rest of the turn", b, at2, LINES);
}
// P3: Opportunist copies a foe's rise at that move's AfterMove (PS/data/abilities.ts:3041 onAnyAfterMove), before the next action.
{
  const b = battle("gen9doublescustomgame", [{ species: "Garchomp", ability: "Rough Skin", moves: ["Swords Dance"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Espathra", ability: "Opportunist", moves: ["Splash"] }, { species: "Torkoal", ability: "Shell Armor", moves: ["Tackle"] }]);
  const at = b.log.length;
  b.makeChoices("move 1, move 1", "move 1, move 1 1");
  show("P3 Opportunist copying Swords Dance", b, at, LINES);
}
// P4: Eject Pack after Icy Wind's Speed drop: used at the move's AfterMove, switch request mid-turn (PS/data/items.ts:1705).
{
  const b = battle("gen9doublescustomgame", [{ species: "Glalie", ability: "Inner Focus", moves: ["Icy Wind"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Snorlax", ability: "Thick Fat", item: "Eject Pack" }, { species: "Torkoal", ability: "Shell Armor", moves: ["Tackle"] }]);
  const at = b.log.length;
  b.makeChoices("move 1, move 1", "move 1, move 1 1");
  show("P4a Eject Pack after Icy Wind", b, at, LINES);
  const at2 = b.log.length;
  if (b.requestState === "switch") b.makeChoices("", "switch 3");
  show("P4b Eject Pack: the replacement, then the rest of the turn", b, at2, LINES);
}
// P5: Imposter in doubles copies the foe across (PS/data/abilities.ts:2115: foe.active[length - 1 - position]).
{
  const b = battle("gen9doublescustomgame", [{ species: "Snorlax", ability: "Thick Fat" }, { species: "Ditto", ability: "Imposter" }],
    [{ species: "Garchomp", ability: "Rough Skin" }, { species: "Torkoal", ability: "Shell Armor" }]);
  show("P5 Imposter at the lead (p1b copies the foe across)", b, 0, /^\|-transform\|/);
}
// P6: Harvest in sun restores the eaten Sitrus at 28.2, and the final Update eats it again (PS/data/abilities.ts:1800).
{
  const b = battle("gen9doublescustomgame", [{ species: "Exeggutor", ability: "Harvest", item: "Sitrus Berry", moves: ["Splash"] }, { species: "Torkoal", ability: "Drought" }],
    [{ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }]);
  b.p1.active[0].sethp(30);
  const at = b.log.length;
  b.makeChoices("move 1, move 1", "move 1, move 1");
  show("P6 Harvest in sun at a low HP", b, at, /^\|(-heal|-enditem|-item|upkeep|turn|-weather)\|/);
}
// P7: Pickup takes an item another active Pokémon used this turn (PS/data/abilities.ts:3262), at 28.2.
{
  const b = battle("gen9doublescustomgame", [{ species: "Zigzagoon", ability: "Pickup", moves: ["Splash"] }, { species: "Snorlax", ability: "Thick Fat", item: "Sitrus Berry", moves: ["Splash"] }],
    [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { atk: 252 } }, { species: "Torkoal", ability: "Shell Armor", moves: ["Splash"] }]);
  b.p1.active[1].sethp(130);
  const at = b.log.length;
  b.makeChoices("move 1, move 1", "move 1 2, move 1");
  show("P7 Pickup after an ally's Sitrus", b, at, /^\|(-heal|-enditem|-item|upkeep|turn|move|-damage)\|/);
}
// P8: Stored Power reads accuracy and evasion stages (PS/sim/pokemon.ts:1201 positiveBoosts over every boost).
{
  const b = battle("gen9doublescustomgame", [{ species: "Espathra", ability: "Speed Boost", moves: ["Double Team", "Stored Power"] }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Snorlax", ability: "Thick Fat" }, { species: "Torkoal", ability: "Shell Armor" }]);
  b.makeChoices("move 1, move 1", "move 1, move 1");
  const user = b.p1.active[0];
  const move = b.dex.getActiveMove("storedpower");
  console.log(`\n== P8 Stored Power after Double Team: boosts ${JSON.stringify(user.boosts)}; basePowerCallback ${move.basePowerCallback.call(b, user, b.p2.active[0], move)}`);
}
// P9: Red Card drags its attacker out at random (PS/data/items.ts:5142 forceSwitchFlag; PS/sim/battle.ts:2821-2829 dragIn,
// :1570 getRandomSwitchable sample): no request.
{
  const b = battle("gen9doublescustomgame", [{ species: "Garchomp", ability: "Rough Skin", moves: ["Dragon Claw"], evs: { spe: 252 } }, { species: "Snorlax", ability: "Thick Fat" }],
    [{ species: "Snorlax", ability: "Thick Fat", item: "Red Card" }, { species: "Torkoal", ability: "Shell Armor", moves: ["Tackle"] }]);
  const at = b.log.length;
  b.makeChoices("move 1 1, move 1", "move 1, move 1 1");
  show("P9 Red Card", b, at, LINES);
}
