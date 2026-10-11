// Status-move architect's probes, batch 4: the counters behind a sleep / confusion from earlier turns (the posterior the
// engine uses with the `attempts` input). Run: npx --no-install tsx scripts/.cache/calc-audit/status-eot/design/status-probes-4.ts
import { enumerate, type Probe } from "./status-sim";

const blissey = { species: "Blissey", ability: "Natural Cure", moves: ["Splash"] };
const shuckle = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
function perTurn(title: string, p: Probe, wake: RegExp) {
  const r = enumerate(p);
  // P(the event happens on turn t | it had not happened before turn t).
  const turns = p.turns.length;
  const firstAt = new Array(turns + 1).fill(0);
  for (const o of r.outcomes) {
    const at = o.lines.findIndex((l) => wake.test(l));
    const turn = at < 0 ? turns : o.lines.slice(0, at + 1).filter((l) => l.startsWith("|turn|")).length;
    firstAt[at < 0 ? turns : turn] += o.weight;
  }
  let left = 1;
  const cond = firstAt.slice(0, turns).map((mass) => { const c = left > 1e-12 ? mass / left : 0; left -= mass; return +c.toFixed(6); });
  console.log(`${title} (${r.runs} runs): P(first on attempt k | not before), k = 1..${turns}: ${cond.join(", ")}; never: ${+firstAt[turns].toFixed(6)}`);
}
const turns = (n: number, first: [string, string]): [string, string][] => [first, ...Array.from({ length: n - 1 }, () => ["move 2, move 1", "move 1 1, move 1"] as [string, string])];
for (const game of ["sv", "champions", "usum"] as const) {
  perTurn(`${game} sleep from Hypnosis on turn 1 (target moves after it): wake`, {
    game, mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis", "Splash"] }, blissey, { species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"] }, shuckle],
    turns: turns(5, ["move 1 1, move 1", "move 1 1, move 1"]), lines: /^\|(turn|-curestatus)\|/,
  }, /^\|-curestatus\|p2a/);
  perTurn(`${game} sleep, Early Bird: wake`, {
    game, mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Hypnosis", "Splash"] }, blissey, { species: "Kangaskhan", ability: "Early Bird", moves: ["Body Slam"] }, shuckle],
    turns: turns(4, ["move 1 1, move 1", "move 1 1, move 1"]), lines: /^\|(turn|-curestatus)\|/,
  }, /^\|-curestatus\|p2a/);
  perTurn(`${game} confusion from Confuse Ray on turn 1: snap out`, {
    game, mons: [{ species: "Jolteon", ability: "Volt Absorb", moves: ["Confuse Ray", "Splash"] }, blissey, { species: "Snorlax", ability: "Thick Fat", moves: ["Splash"] }, shuckle],
    turns: turns(6, ["move 1 1, move 1", "move 1, move 1"]).map(([a]) => [a, "move 1, move 1"] as [string, string]), lines: /^\|(turn|-end\|p2a: Snorlax\|confusion)/,
  }, /^\|-end\|p2a: Snorlax\|confusion/);
}
