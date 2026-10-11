// Track A3: the stored 2v2 cases whose app result A3's code changes (for V1's changed-cases.ts and the integrator's app-diff):
// (1) a case whose not-estimated reason A3 removes (an A3 move, or a received Seed / Room Service); (2) a case with E2 outcomes
// that sets a clocked side condition (Tailwind, the screens, Safeguard, Mist, Lucky Chant: sides.clock "set") or a room, a
// Sport, Gravity or Trick Room (World.fieldSet) during the turn; (3) any case that uses an A3 move.
import { CASES } from "../../2v2/verify/cases";
const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const A3 = new Set(["magiccoat", "snatch", "craftyshield", "matblock", "luckychant", "mist", "mudsport", "watersport", "magicroom", "wonderroom", "courtchange", "defog",
  "corrosivegas", "bestow", "recycle", "teatime", "stuffcheeks", "aromatherapy", "healbell", "purify", "psychoshift"]);
const CLOCKED = new Set(["tailwind", "reflect", "lightscreen", "auroraveil", "safeguard", "mist", "luckychant", "trickroom", "gravity", "magicroom", "wonderroom", "mudsport", "watersport"]);
const rows: string[] = [];
for (const c of CASES) {
  const moves = Object.values(c.slots).map((m) => (m.action.move ? id(m.action.move) : ""));
  const reason = `${c.notEstimated ?? ""} ${c.endNotEstimated ?? ""}`;
  const why: string[] = [];
  if (moves.some((m) => A3.has(m))) why.push(`A3 move ${moves.filter((m) => A3.has(m)).join("+")}`);
  if (/received by .* is not modelled/.test(reason) && !/Booster Energy/.test(reason)) why.push("received Seed / Room Service");
  if (c.outcomes && moves.some((m) => CLOCKED.has(m))) why.push(`E2 clock/fieldSet (${moves.filter((m) => CLOCKED.has(m)).join("+")})`);
  if (why.length) rows.push(`${c.id}\t${why.join("; ")}${reason.trim() ? `\t[stored reason: ${reason.trim()}]` : ""}`);
}
console.log(rows.join("\n"));
console.log(`${rows.length} cases`);
