// Training belief calibration (SPEC §14.5, addendum A1.4 usage priors).
//   npx tsx scripts/training/belief-eval.ts [--battles 40] [--seats maxdamage:maxdamage]
// On Pool A (each player spread is a prior candidate under the rule prior and the usage prior), under `open` and `closed`:
// - after a member's third resolved observation the true candidate is the most likely one for ≥ 70% of members (and, with
//   open sheets, its posterior is ≥ 0.5 for ≥ 70%), and it never falls below 0.01 for ≥ 99% of members;
// - speed order (each AI active vs each player active, every decision from turn 3): the Brier score of P(player faster)
//   improves on the prior's by ≥ 20%;
// Reported on Pool V: the mean absolute error of the believed Speed stat (MAP) at turns 1, 3 and 5.
import { join } from "node:path";
import { getBuildStats } from "@/app/lib/battle/model";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import { createBeliefModel } from "@/app/(app)/training/ai/belief/model";
import { sameSpread } from "@/app/(app)/training/ai/belief/prior";
import type { Belief, BeliefModel, SetCandidate } from "@/app/(app)/training/ai/belief/types";
import { buildFromCandidate } from "@/app/(app)/training/ai/battle-facts";
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, type InfoSettings } from "@/app/(app)/training/model/info";
import type { PublicMon, PublicState } from "@/app/(app)/training/model/public-state";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import { sheetFromSets, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch } from "./lib/match";
import { createSeat, ensureSeats, isSeatName } from "./lib/providers";
import { gateTable, mean, parseArgs, pct, writeJson, writeText, type GateRow } from "./lib/report";
import { teamPair, type TeamPair } from "./lib/teams";

const STAGE = (stage: number) => stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
/** Speed as SPEC 10.6 compares it, without Trick Room: stat × stage × paralysis ½ × Choice Scarf 1.5 × Tailwind 2. */
function speedOf(build: BattleBuild, mon: PublicMon, tailwind: boolean): number {
  const stat = getBuildStats(build, runtime)?.spe ?? 0;
  return stat * STAGE(mon.boosts.spe) * (mon.status === "par" ? 0.5 : 1) * (build.itemId === "choicescarf" ? 1.5 : 1) * (tailwind ? 2 : 1);
}
const posterior = (candidates: readonly SetCandidate[]) => {
  const top = Math.max(...candidates.map((candidate) => candidate.logWeight));
  const weights = candidates.map((candidate) => Math.exp(candidate.logWeight - top));
  const total = weights.reduce((sum, w) => sum + w, 0);
  return candidates.map((candidate, i) => ({ candidate, p: weights[i] / total }));
};
type Truth = { key: string; speciesId: string; points: Record<string, number>; nature: string; itemId: string; abilityId: string; build: BattleBuild };
/** The truth's candidate: its item, ability and spread (the belief merges spreads it cannot tell apart: ai/belief/prior.ts sameSpread). */
const isTruth = (candidate: SetCandidate, truth: Truth) => candidate.itemId === truth.itemId && candidate.abilityId === truth.abilityId
  && sameSpread(candidate, { points: truth.points as SetCandidate["points"], nature: truth.nature });

type MemberTrack = { observations: number; atThird: number | null; minAfter: number; minEver: number; mapAtThird: boolean | null };
type Collected = {
  members: Record<string, MemberTrack>;
  brier: { posterior: number[]; prior: number[] };
  speedError: Record<1 | 3 | 5, number[]>;
};

function observationsOf(inputs: AiInputs, key: string): number {
  return inputs.observations.reduce((count, turn) => count
    + turn.order.filter((entry) => entry.first.key === key || entry.second.key === key).length
    + turn.damage.filter((entry) => entry.attacker.key === key || entry.defender.key === key).length, 0);
}

async function evaluate(pair: TeamPair, info: InfoSettings, index: number, seats: [string, string], collected: Collected, label: string): Promise<void> {
  const usage = loadTrainingUsage();
  const adapted = { p1: toShowdownTeam(pair.p1.team.members, runtime), p2: toShowdownTeam(pair.p2.team.members, runtime) };
  const truths: Truth[] = adapted.p1.sets.map(({ key, set }) => {
    const member = pair.p1.team.members.find((entry) => entry.key === key)!;
    const candidate = { points: set.evs, nature: set.nature, itemId: member.build.itemId, abilityId: member.build.abilityId };
    return { key, speciesId: member.speciesId, ...candidate, build: buildFromCandidate(member.speciesId, candidate, runtime) };
  });
  const sheet = redactSheet(sheetFromSets(adapted.p1), info.aiKnows);
  const model: BeliefModel = createBeliefModel(info.aiKnows, { usage });
  const prior: BeliefModel = createBeliefModel(info.aiKnows, { usage });
  model.start(sheet, runtime);
  prior.start(sheet, runtime);
  const priorBelief: Belief = prior.snapshot();
  await runMatch({
    seats: { p1: createSeat(seats[1] as never, runtime, null), p2: createSeat(seats[0] as never, runtime, null) },
    teams: { p1: pair.p1.team, p2: pair.p2.team }, info, runtime, usage, seedRun: `belief:${label}`, index,
    observer: {
      inputs(side, kind, inputs) {
        if (side !== "p2" || !inputs || kind !== "turn") return;
        model.observe(inputs, runtime);
        const belief = model.snapshot();
        const state: PublicState = inputs.public;
        for (const truth of truths) {
          const memberBelief = belief.members[truth.key];
          if (!memberBelief) continue;
          const publicKey = `p1:${truth.key}`;
          const id = `${label}#${index}:${truth.key}`;
          const track = collected.members[id] ??= { observations: 0, atThird: null, minAfter: 1, minEver: 1, mapAtThird: null };
          const p = posterior(memberBelief.candidates).filter((entry) => isTruth(entry.candidate, truth)).reduce((sum, entry) => sum + entry.p, 0);
          track.observations = observationsOf(inputs, publicKey);
          track.minEver = Math.min(track.minEver, p);
          if (track.observations >= 3) {
            if (track.atThird === null) {
              track.atThird = p;
              const ranked = posterior(memberBelief.candidates).sort((a, b) => b.p - a.p);
              track.mapAtThird = !!ranked[0] && isTruth(ranked[0].candidate, truth);
            }
            track.minAfter = Math.min(track.minAfter, p);
          }
          const mon = state.mons[publicKey];
          if (!mon || mon.position === null || mon.fainted) continue;
          const turn = state.turn as 1 | 3 | 5;
          if (turn === 1 || turn === 3 || turn === 5) {
            const map = memberBelief.candidates[0];
            if (map) collected.speedError[turn].push(Math.abs((getBuildStats(buildFromCandidate(truth.speciesId, map, runtime), runtime)?.spe ?? 0) - (getBuildStats(truth.build, runtime)?.spe ?? 0)));
          }
          if (state.turn < 3) continue;
          // P(player faster) against each AI active, posterior vs prior (the AI's own speed is exact).
          const tailwind = (side: "p1" | "p2") => state.sides[side].conditions.some((condition) => condition.id === "tailwind");
          for (const own of adapted.p2.sets) {
            const ownMon = state.mons[`p2:${own.key}`];
            if (!ownMon || ownMon.position === null || ownMon.fainted) continue;
            const member = pair.p2.team.members.find((entry) => entry.key === own.key)!;
            const ownSpeed = speedOf(buildFromCandidate(member.speciesId, { points: own.set.evs, nature: own.set.nature, itemId: member.build.itemId, abilityId: member.build.abilityId }, runtime), ownMon, tailwind("p2"));
            const truthSpeed = speedOf(truth.build, mon, tailwind("p1"));
            const outcome = truthSpeed > ownSpeed ? 1 : truthSpeed === ownSpeed ? 0.5 : 0;
            const chance = (candidates: readonly SetCandidate[]) => posterior(candidates).reduce((sum, { candidate, p: weight }) => {
              const speed = speedOf(buildFromCandidate(truth.speciesId, candidate, runtime), mon, tailwind("p1"));
              return sum + weight * (speed > ownSpeed ? 1 : speed === ownSpeed ? 0.5 : 0);
            }, 0);
            collected.brier.posterior.push((chance(memberBelief.candidates) - outcome) ** 2);
            collected.brier.prior.push((chance(priorBelief.members[truth.key]?.candidates ?? []) - outcome) ** 2);
          }
        }
      },
    },
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const battles = Number(args.battles ?? 40);
  const [p2, p1] = String(args.seats ?? "maxdamage:maxdamage").split(":");
  if (!isSeatName(p2) || !isSeatName(p1)) throw new Error(`Unknown --seats ${String(args.seats)}.`);
  await ensureSeats([p2, p1]);
  const rows: GateRow[] = [];
  const out: Record<string, unknown> = {};
  for (const [name, info] of [["open", DEFAULT_INFO], ["closed", { aiKnows: CLOSED_TEAM_SHEETS, youSee: DEFAULT_INFO.youSee }]] as const) {
    for (const pool of ["A", "V"] as const) {
      const collected: Collected = { members: {}, brier: { posterior: [], prior: [] }, speedError: { 1: [], 3: [], 5: [] } };
      for (let index = 0; index < battles; index++) {
        const pair = teamPair(`belief-${pool}`, index, pool === "A" ? ["A"] : ["V"], runtime);
        await evaluate(pair, info, index, [p2, p1], collected, `${name}-${pool}`);
      }
      const tracked = Object.values(collected.members).filter((track) => track.atThird !== null);
      const atLeastHalf = tracked.filter((track) => track.atThird! >= 0.5).length;
      const neverLow = tracked.filter((track) => track.minAfter >= 0.01).length;
      const mapHits = tracked.filter((track) => track.mapAtThird).length;
      const brierPost = mean(collected.brier.posterior), brierPrior = mean(collected.brier.prior);
      const improvement = brierPrior > 0 ? 1 - brierPost / brierPrior : Number.NaN;
      out[`${name}-${pool}`] = { members: tracked.length, atLeastHalf, neverLow, mapHits, brierPost, brierPrior, improvement, pairs: collected.brier.posterior.length,
        speedMAE: { 1: mean(collected.speedError[1]), 3: mean(collected.speedError[3]), 5: mean(collected.speedError[5]) } };
      if (pool === "A") {
        // With Stat Points closed, three observations often leave several items and spreads equally likely, so the
        // closed gate asks for the truth to rank first; the ≥ 0.5 posterior stays a gate for open sheets only.
        const halfGated = name === "open";
        rows.push({ gate: `Pool A ${name}: truth posterior ≥ 0.5 after 3 observations${halfGated ? "" : " (report)"}`, threshold: halfGated ? "≥ 70% of members" : "share of members", result: `${atLeastHalf}/${tracked.length} (${pct(atLeastHalf / tracked.length)})`, status: !halfGated ? "report" : tracked.length && atLeastHalf / tracked.length >= 0.7 ? "pass" : "fail" });
        rows.push({ gate: `Pool A ${name}: truth is the most likely candidate after 3 observations`, threshold: "≥ 70% of members", result: `${mapHits}/${tracked.length} (${pct(mapHits / tracked.length)})`, status: tracked.length && mapHits / tracked.length >= 0.7 ? "pass" : "fail" });
        rows.push({ gate: `Pool A ${name}: truth never below 0.01`, threshold: "≥ 99% of members", result: `${neverLow}/${tracked.length} (${pct(neverLow / tracked.length)})`, status: tracked.length && neverLow / tracked.length >= 0.99 ? "pass" : "fail" });
        rows.push({ gate: `Pool A ${name}: speed-order Brier vs prior (turn ≥ 3)`, threshold: "≥ 20% better", result: `${brierPost.toFixed(4)} vs ${brierPrior.toFixed(4)} (${pct(improvement)}), n=${collected.brier.posterior.length}`, status: improvement >= 0.2 ? "pass" : "fail" });
      } else {
        rows.push({ gate: `Pool V ${name}: believed Speed MAE (report)`, threshold: "turns 1 / 3 / 5", result: `${mean(collected.speedError[1]).toFixed(1)} / ${mean(collected.speedError[3]).toFixed(1)} / ${mean(collected.speedError[5]).toFixed(1)}`, status: "report" });
      }
    }
  }
  const dir = join(process.cwd(), "scripts", ".cache", "training", "belief");
  writeJson(join(dir, "belief-eval.json"), out);
  const text = `${gateTable(rows)}\n`;
  writeText(join(dir, "belief-eval.txt"), text);
  process.stdout.write(text);
  if (rows.some((row) => row.status === "fail")) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${(error as Error).stack ?? String(error)}\n`); process.exitCode = 1; });
