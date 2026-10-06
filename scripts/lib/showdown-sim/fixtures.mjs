// Fixture teams and the scripted chooser the showdown-sim gate and tests replay (moved from the Training design probes
// scripts/.cache/training/design/probe/{teams.mjs,run-battle.mjs}). Both teams are Reg M-C legal: 6 each, distinct items,
// one Mega Stone each. The chooser uses its own LCG and never the battle's PRNG.
import { createHash } from "node:crypto";

export const FORMAT = "gen9championsvgc2026regmc";

const sp = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species, item, ability, moves, nature, evs) => ({ name: species, species, item, ability, moves, nature, evs, ivs: IV, level: 50, gender: "" });

export const PLAYER = [
  set("Incineroar", "Sitrus Berry", "Intimidate", ["Fake Out", "Flare Blitz", "Parting Shot", "Protect"], "Careful", sp(32, 2, 16, 0, 16, 0)),
  set("Charizard", "Charizardite Y", "Blaze", ["Heat Wave", "Air Slash", "Solar Beam", "Protect"], "Modest", sp(2, 0, 0, 32, 0, 32)),
  set("Whimsicott", "Focus Sash", "Prankster", ["Tailwind", "Moonblast", "Encore", "Protect"], "Timid", sp(2, 0, 0, 32, 0, 32)),
  set("Garchomp", "Life Orb", "Rough Skin", ["Earthquake", "Dragon Claw", "Rock Slide", "Protect"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
  set("Rotom-Wash", "Leftovers", "Levitate", ["Hydro Pump", "Thunderbolt", "Will-O-Wisp", "Protect"], "Modest", sp(32, 0, 2, 32, 0, 0)),
  set("Kingambit", "Black Glasses", "Defiant", ["Kowtow Cleave", "Sucker Punch", "Iron Head", "Protect"], "Adamant", sp(32, 32, 0, 0, 2, 0)),
];

export const AI = [
  set("Gyarados", "Gyaradosite", "Intimidate", ["Waterfall", "Crunch", "Dragon Dance", "Protect"], "Adamant", sp(2, 32, 0, 0, 0, 32)),
  set("Pelipper", "Mystic Water", "Drizzle", ["Hurricane", "Weather Ball", "Tailwind", "Protect"], "Modest", sp(32, 0, 0, 32, 2, 0)),
  set("Sneasler", "White Herb", "Unburden", ["Fake Out", "Close Combat", "Dire Claw", "Protect"], "Jolly", sp(2, 32, 0, 0, 0, 32)),
  set("Archaludon", "Expert Belt", "Stamina", ["Electro Shot", "Flash Cannon", "Draco Meteor", "Protect"], "Modest", sp(32, 0, 0, 32, 2, 0)),
  set("Farigiraf", "Lum Berry", "Armor Tail", ["Trick Room", "Psychic", "Hyper Voice", "Protect"], "Quiet", sp(32, 0, 2, 32, 0, 0)),
  set("Dragonite", "Choice Scarf", "Multiscale", ["Extreme Speed", "Outrage", "Iron Head", "Fire Punch"], "Adamant", sp(2, 32, 0, 0, 0, 32)),
];

/**
 * Log hashes of the 20 fixture battles on the pinned TypeScript source under tsx (design probe out/source-gen5.json):
 * seeds [k + 1, 2, 3, 4], the chooser below, sha256 of the log without `|t:|` lines, first 16 hex digits.
 */
export const SOURCE_LOG_HASHES = [
  "504c7128cc093cc2", "5a4517ee0ed45a5e", "18a3afd10254010b", "cfb7cb47caef744f", "6bfc48e6cda6258f",
  "d32efb4ea3bada09", "6e9d29d80d5ab625", "c72c7f7f505f44a9", "18ceb89113f90937", "f6dedbbe8722be9b",
  "7e71325d54eb5ab1", "0ea2eac8c167b2db", "ff1dc5fc90731b7e", "a606ee60edf08b3d", "1d11d6c3d9218e8a",
  "67df3af3dc45e806", "182f6bdce7aed932", "aa8332ce3f544baa", "cefafa63fa14a5e6", "fc20ffc16257e263",
];

export const FIXTURE_BATTLES = 20;
export const fixtureSeed = (k) => [k + 1, 2, 3, 4];

/** The probe chooser (run-battle.mjs): an LCG from 12345 + k; random team order; 1 in 10 switches; random Mega. */
export function createChooser(k) {
  let lcg = 12345 + k;
  const rand = (n) => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return (lcg >>> 8) % n; };
  const megaUsed = { p1: false, p2: false };
  return function choose(sideId, request) {
    if (!request || request.wait) return "";
    if (request.teamPreview) {
      const order = [1, 2, 3, 4, 5, 6];
      for (let i = 5; i > 0; i--) { const j = rand(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      return `team ${order.slice(0, request.maxChosenTeamSize ?? 4).join("")}`;
    }
    const used = new Set();
    const bench = () => request.side.pokemon.map((p, j) => ({ p, j })).filter(({ p, j }) => !p.active && !p.condition.endsWith(" fnt") && !used.has(j));
    if (request.forceSwitch) {
      return request.forceSwitch.map((must) => {
        const options = bench();
        if (!must || !options.length) return "pass";
        const pick = options[rand(options.length)]; used.add(pick.j); return `switch ${pick.j + 1}`;
      }).join(", ");
    }
    let megaThisTurn = false;
    const choice = request.active.map((active, i) => {
      const mon = request.side.pokemon[i];
      if (mon.condition.endsWith(" fnt") || mon.commanding) return "pass";
      const options = bench();
      if (!active.trapped && !active.maybeTrapped && options.length && rand(10) === 0) {
        const pick = options[rand(options.length)]; used.add(pick.j); return `switch ${pick.j + 1}`;
      }
      const moves = active.moves.map((m, j) => ({ m, j })).filter(({ m }) => !m.disabled && (m.pp ?? 1) > 0);
      if (!moves.length) return "move 1";
      const { m, j } = moves[rand(moves.length)];
      const ally = -(2 - i);
      const target = ["normal", "any", "adjacentFoe"].includes(m.target) ? ` ${1 + rand(2)}` : m.target === "adjacentAlly" ? ` ${ally}` : m.target === "adjacentAllyOrSelf" ? ` ${-(i + 1)}` : "";
      const mega = active.canMegaEvo && !megaUsed[sideId] && !megaThisTurn && rand(2) === 0 ? " mega" : "";
      if (mega) megaThisTurn = true;
      return `move ${j + 1}${target}${mega}`;
    }).join(", ");
    if (choice.includes("mega")) megaUsed[sideId] = true;
    return choice;
  };
}

export const stripLog = (log) => log.filter((line) => !line.startsWith("|t:|")).join("\n");
export const logHash = (log) => createHash("sha256").update(stripLog(log)).digest("hex").slice(0, 16);

/**
 * Plays fixture battle k on a simulator module ({ Battle, State }). Clones at turns 3 and 8 (serialize → deserialize →
 * restart, same PRNG state) must write the same next-turn log as a second clone: `cloneChecks` counts them.
 */
export function playFixtureBattle(sim, k) {
  const { Battle, State } = sim;
  const choose = createChooser(k);
  const battle = new Battle({ formatid: FORMAT, seed: fixtureSeed(k) });
  battle.setPlayer("p1", { name: "You", team: structuredClone(PLAYER) });
  battle.setPlayer("p2", { name: "Training", team: structuredClone(AI) });
  const cloneChecks = { same: 0, differ: 0 };
  let guard = 0;
  while (!battle.ended && guard++ < 200) {
    const r1 = battle.p1.activeRequest, r2 = battle.p2.activeRequest;
    const c1 = choose("p1", r1), c2 = choose("p2", r2);
    if (r1?.active && r2?.active && (battle.turn === 3 || battle.turn === 8)) {
      const json = JSON.stringify(State.serializeBattle(battle));
      const a = State.deserializeBattle(json); a.restart(() => {});
      const b = State.deserializeBattle(json); b.restart(() => {});
      const before = a.log.length;
      a.makeChoices(c1, c2); b.makeChoices(c1, c2);
      // |t:| lines carry the wall clock (sim/battle.ts): compare without them.
      if (stripLog(a.log.slice(before)) === stripLog(b.log.slice(before))) cloneChecks.same++;
      else cloneChecks.differ++;
    }
    battle.makeChoices(c1, c2);
  }
  return { ended: battle.ended, winner: battle.winner, turns: battle.turn, logHash: logHash(battle.log), cloneChecks };
}
