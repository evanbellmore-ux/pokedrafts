import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { createEngineProvider } from "@/app/(app)/training/ai/engine-provider";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { createRandom } from "@/app/(app)/training/model/random";
import { SITUATION_LEVELS, situationProblem, type SituationRequest, type TrainingSituation } from "@/app/(app)/training/model/situation";
import type { TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { createSetLegality, toShowdownTeam, validateTeams } from "@/app/(app)/training/sim/showdown-set";
import { FORMAT, TeamValidator } from "@/app/(app)/training/sim/sim";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { dealPosition, readyMadeTeam, type DealDeps } from "@/app/(app)/training/worker/situation-deal";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { AI_TEAM, memberFromSet, PLAYER } from "./training-sim-fixtures";

// Situations are never hopeless: the dealer gives your last Pokémon no status or lowered stat, and the forced-loss guard
// (worker-handler.ts forcedLoss) deals again any position the AI wins before you have played two turns in every playout
// (the engine deciding both sides; a turn spent only protecting is a stall) or that the AI's engine rates out of reach.
// The reported deal: your last Pokémon paralyzed, both of the AI's faster, no priority move, and each of them one-shots it.

const validator = new TeamValidator(FORMAT);
const deps: DealDeps = {
  usage: loadTrainingUsage(), legality: createSetLegality(validator, runtime), runtime,
  validate: (team) => { const adapted = toShowdownTeam(team.members, runtime); return validateTeams(adapted, adapted, validator).own; },
};
const SETTINGS = { difficulty: "safe", showRead: true, info: DEFAULT_INFO } as const;

/** The worker with the engine on both seats; `hexes`: its random draws in order (then a counter). */
function engineWorker(hexes: string[] = []) {
  const posted: FromWorker[] = [];
  let hex = 0;
  const worker = createTrainingWorker({
    post: (message) => posted.push(message), createProvider: (habits) => createEngineProvider({ runtime, habits }),
    now: () => 0, randomHex: () => hexes.shift() ?? String(++hex).padStart(32, "0"), deadlineMs: null,
  });
  worker.receive({ type: "load" });
  return { worker, posted };
}
async function dealt(posted: FromWorker[]) {
  for (let wait = 0; wait < 6000 && !posted.some((message) => message.type === "dealt" || message.type === "deal-error"); wait++) await new Promise((resolve) => setTimeout(resolve, 10));
  return posted.find((message) => message.type === "dealt" || message.type === "deal-error")!;
}

// Kingambit without Sucker Punch: nothing that moves first. Sneasler (Jolly) and Choice Scarf Dragonite outspeed it
// paralyzed or not, and Sneasler's Close Combat alone one-shots it. Protect (the variant) only puts that off.
const ownWith = (moves: string[]): TrainingTeam => ({
  label: "Probe player", members: PLAYER.map((set) => memberFromSet(set.species === "Kingambit" ? { ...set, moves } : set)),
});
const OWN = ownWith(["Kowtow Cleave", "Iron Head", "Low Kick", "Swords Dance"]);
const setupOf = (situation: TrainingSituation, own = OWN): TrainingSetup => ({ own, opponent: AI_TEAM, ...SETTINGS, situation });
const REPORTED: TrainingSituation = {
  request: { kind: "random", level: "very-hard" }, spot: null,
  own: { members: [{ key: "kingambit", hp: 35, status: "par" }, { key: "incineroar", hp: 0 }, { key: "charizard", hp: 0 }, { key: "whimsicott", hp: 0 }] },
  opponent: { members: [{ key: "sneasler", hp: 100 }, { key: "dragonite", hp: 100 }, { key: "gyarados", hp: 0 }, { key: "pelipper", hp: 0 }] },
};

describe("the forced-loss guard", () => {
  const { worker } = engineWorker();

  it("refuses the reported deal, paralyzed or not: both foes are faster and either one-shots your last Pokémon", async () => {
    expect(situationProblem(REPORTED, setupOf(REPORTED))).toBeNull();
    expect(await worker.forcedLoss(setupOf(REPORTED))).toBe(true);
    const unparalyzed: TrainingSituation = { ...REPORTED, own: { members: [{ key: "kingambit", hp: 35 }, ...REPORTED.own.members.slice(1)] } };
    expect(await worker.forcedLoss(setupOf(unparalyzed))).toBe(true);
  }, 120_000);

  it("refuses it with Protect too: turns spent only protecting are stalls, not turns played", async () => {
    expect(await worker.forcedLoss(setupOf(REPORTED, ownWith(["Kowtow Cleave", "Iron Head", "Low Kick", "Protect"])))).toBe(true);
  }, 120_000);

  it("passes a position you are still in after two turns", async () => {
    const even: TrainingSituation = {
      ...REPORTED,
      own: { members: ["kingambit", "incineroar", "charizard", "whimsicott"].map((key) => ({ key, hp: 100 })) },
      opponent: { members: ["sneasler", "dragonite", "gyarados", "pelipper"].map((key) => ({ key, hp: 100 })) },
    };
    expect(await worker.forcedLoss(setupOf(even))).toBe(false);
  }, 120_000);
});

describe("the dealer", () => {
  it("never deals your last Pokémon a status or a lowered stat (fully random; the others still get them)", () => {
    const random = createRandom("last-one-clean");
    const teams = { own: readyMadeTeam(random, deps, "Yours", "you"), opponent: readyMadeTeam(random, deps, "Theirs", "ai") };
    let alone = 0, statused = 0;
    for (const level of SITUATION_LEVELS) for (let n = 0; n < 300; n++) {
      const request: SituationRequest = { kind: "random", level };
      const standing = dealPosition(request, request, teams, random, runtime).own.members.filter((member) => member.hp > 0);
      if (standing.length === 1) {
        alone++;
        expect(standing[0].status).toBeUndefined();
        expect(Object.values(standing[0].boosts ?? {}).every((stage) => stage > 0)).toBe(true);
      } else statused += standing.filter((member) => member.status).length;
    }
    expect(alone).toBeGreaterThan(20);
    expect(statused).toBeGreaterThan(20);
  });

  it("gives up on custom choices that are hopeless with any teams, saying what to change", async () => {
    const { worker, posted } = engineWorker();
    const request: SituationRequest = {
      kind: "custom", custom: { own: { left: 1, hp: 10, leads: [{}, {}] }, opponent: { left: 4, hp: 100, leads: [{ atk: 6, spa: 6, spe: 6 }, { atk: 6, spa: 6, spe: 6 }] } },
    };
    worker.receive({ type: "deal", key: "k1", request, settings: SETTINGS });
    expect(await dealt(posted)).toEqual({
      type: "deal-error", key: "k1", message: "Every position dealt with these choices was hopeless for your side. Give your side more Pokémon, HP or stat stages.",
    });
  }, 120_000);

  it("deals again when the first position is a forced loss, and posts one the guard passes", async () => {
    const request: SituationRequest = { kind: "spot", spot: "last-one", level: "very-hard" };
    // The worker's first position for a random draw, as deal() makes it (its teams, then the position).
    const firstFor = (hex: string): TrainingSetup => {
      const random = createRandom(hex, "deal");
      const teams = { own: readyMadeTeam(random, deps, "Your ready-made team", "you"), opponent: readyMadeTeam(random, deps, "The AI's ready-made team", "ai") };
      return { ...teams, ...SETTINGS, situation: dealPosition(request, request, teams, random, runtime) };
    };
    const { worker: judge } = engineWorker();
    let hex: string | null = null;
    for (let n = 1; n <= 8 && !hex; n++) {
      const candidate = `${"f".repeat(30)}${String(n).padStart(2, "0")}`;
      if (await judge.forcedLoss(firstFor(candidate))) hex = candidate;
    }
    expect(hex, "a draw whose first Last one standing · Very hard position is a forced loss").not.toBeNull();
    const { worker, posted } = engineWorker([hex!]);
    worker.receive({ type: "deal", key: "k1", request, settings: SETTINGS });
    const message = await dealt(posted);
    expect(message.type).toBe("dealt");
    const setup = (message as Extract<FromWorker, { type: "dealt" }>).setup;
    expect(setup.situation).not.toEqual(firstFor(hex!).situation);
    expect(situationProblem(setup.situation!, setup)).toBeNull();
    expect(await judge.forcedLoss(setup)).toBe(false);
  }, 300_000);
});
