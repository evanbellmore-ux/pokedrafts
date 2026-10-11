// status-eot SPEC §7 step 7: the earlier cases' app results before and after status-eot, with the allowed differences
// listed: (1) the turn facts (the removed "End-of-turn effects are not applied." and the new assumptions), (2) the new
// endOfTurn and swapped fields, (3) cases that were not estimated with the sleep, freeze, confusion, HP-status, Pollen Puff,
// Substitute-hit or notModelledBefore reason of a now-modelled move and are ready now (validated by the oracle), (4) a
// switch-out as the last action (the end of turn is not estimated). Anything else is a difference to explain.
//
// Run from the repo root:
//   node scripts/.cache/calc-audit/2v2/verify/app-diff.mjs [<new app-results dir>] [<old app-results dir>]
import fs from "node:fs";
import path from "node:path";

const [newDir = "scripts/.cache/calc-audit/2v2/verify/app-results", oldDir = "scripts/.cache/calc-audit/2v2/verify/before-status-eot/app-results"] = process.argv.slice(2);
const END_FACT = "End-of-turn effects are not applied.";
const NO_CRITS_FACT = "Every move hits; no critical hits; added effects below 100% do not happen.";
const CERTAIN_FACT = "Every move hits; critical hits only where certain; added effects below 100% do not happen.";
const BECAME_READY = [
  /^Sleep wears off at random\.$/, /^Freeze thaws at random\.$/, /^Confusion is not modelled in 2v2\.$/, /^Pollen Puff on an ally is not modelled\.$/,
  /^Hits on .*'s Substitute are not modelled\.$/, / is not modelled and comes before another move\.$/, / is not modelled\.$/,
];
const counts = {};
const unexplained = [];
const bump = (k) => (counts[k] = (counts[k] ?? 0) + 1);
for (const file of fs.readdirSync(oldDir).filter((f) => f.endsWith(".json"))) {
  const id = file.replace(/\.json$/, "");
  const target = path.join(newDir, file);
  if (!fs.existsSync(target)) { bump("missing in the new results (not a case any more)"); continue; }
  if (fs.readFileSync(path.join(oldDir, file), "utf8") === fs.readFileSync(target, "utf8")) { bump("the same file (a stale result of a case that is no longer in cases.ts)"); continue; }
  const a = JSON.parse(fs.readFileSync(path.join(oldDir, file), "utf8")).result;
  const b = JSON.parse(fs.readFileSync(target, "utf8")).result;
  if (!a || !b) { unexplained.push(`${id}: no result (${!a ? "old" : "new"})`); continue; }
  if (a.status !== b.status) {
    if (a.status === "not-estimated" && b.status === "ready" && BECAME_READY.some((re) => re.test(a.reason))) { bump(`became ready: ${a.reason}`); continue; }
    unexplained.push(`${id}: ${a.status}${a.reason ? ` (${a.reason})` : ""} → ${b.status}${b.reason ? ` (${b.reason})` : ""}`);
    continue;
  }
  if (a.status !== "ready") {
    if (a.reason === "Sleep wears off at random." && b.reason === "Sleep Talk is not modelled in 2v2.") bump("Sleep Talk while asleep: the sleep guard became notIn2v2(Sleep Talk) (SPEC §2.4)");
    else if (a.reason !== b.reason) unexplained.push(`${id}: reason "${a.reason}" → "${b.reason}"`);
    else bump("not estimated, the same reason");
    continue;
  }
  // New contract fields that the earlier results do not have: DoublesHP.conditions and losses, a status move's
  // "effect" hits (and a hit's change), and the step facts a status move now states (allowed: SPEC §3.1, §2.1).
  const hpOf = (hp) => hp && Object.fromEntries(Object.entries(hp).map(([k, v]) => [k, v && (({ conditions, losses, ...rest }) => rest)(v)]));
  // status-eot review L1: a certain critical hit's hit fact ("Wicked Blow is always a critical hit.", the ratio's) and the
  // turn's hit rule "critical hits only where certain" (allowed: the oracle's crit effect; compare.ts TURN_FACT_CERTAIN).
  const critFact = (f) => /is always a critical hit\.$|^Every hit is a critical hit \(/.test(f.text);
  const stepsOf = (steps) => steps.map(({ hits, facts, ...rest }) => ({ ...rest, hits: hits.filter((h) => h.kind !== "effect").map(({ change, ...h }) => ({ ...h, facts: (h.facts ?? []).filter((f) => !critFact(f)) })) }));
  const strip = (r) => JSON.stringify({ hp: hpOf(r.hp), steps: stepsOf(r.steps), start: r.start, startRows: r.startRows });
  const same = strip(a) === strip(b);
  const factsA = a.facts.filter((f) => f !== END_FACT), factsB = b.facts.map((f) => (f === CERTAIN_FACT ? NO_CRITS_FACT : f));
  const factsSame = JSON.stringify(factsA) === JSON.stringify(factsB);
  if (b.endOfTurn?.status === "not-estimated" && / switches out: the replacement is not known\.$/.test(b.endOfTurn.reason)) bump("a switch-out as the last action: end of turn not estimated");
  if (same && factsSame) { bump("ready, byte-equal after the moves (the removed End-of-turn fact, the new conditions, effect hits, status-move facts and L1 certain-crit facts aside)"); continue; }
  if (same) {
    const added = factsB.filter((f) => !factsA.includes(f)), removed = factsA.filter((f) => !factsB.includes(f));
    if (removed.length === 0 && added.every((f) => /^Assumes /.test(f))) { bump(`ready, the moves byte-equal, new assumption facts: ${added.join(" | ")}`); continue; }
    unexplained.push(`${id}: facts ${JSON.stringify(removed)} → ${JSON.stringify(added)}`);
    continue;
  }
  // Where the moves differ: the first difference.
  const sa = strip(a), sb = strip(b);
  let i = 0;
  while (i < sa.length && sa[i] === sb[i]) i++;
  unexplained.push(`${id}: after the moves at ${i}: …${sa.slice(Math.max(0, i - 100), i + 100)}… → …${sb.slice(Math.max(0, i - 100), i + 100)}…`);
}
for (const [k, v] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`${String(v).padStart(4)}  ${k}`);
console.log(`\n${unexplained.length} unexplained`);
for (const u of unexplained) console.log(`  ${u}`);
