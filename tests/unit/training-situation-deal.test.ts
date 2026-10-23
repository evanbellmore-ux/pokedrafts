import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { createRandom } from "@/app/(app)/training/model/random";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import {
  SITUATION_LEVELS, SITUATION_SPOTS, situationProblem, spotInfo, type SituationRequest, type TrainingSituation,
} from "@/app/(app)/training/model/situation";
import type { TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { createSetLegality, toShowdownTeam, validateTeams } from "@/app/(app)/training/sim/showdown-set";
import { FORMAT, TeamValidator } from "@/app/(app)/training/sim/sim";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { attackStat, canHold, dealPosition, drawAny, MAX_MEGAS, readyMadeTeam, TEAM_SIZE, type DealDeps } from "@/app/(app)/training/worker/situation-deal";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { playBattle } from "@/scripts/training/lib/saved-check";
import { createMemorySealer } from "@/app/(app)/training/worker/sealer";

// Situations, worker side: ready-made teams (six usage Pokémon with Training's usage sets, legal for Reg M-C) and the dealt
// position for each request (named situations by their recipe, custom ones by their choices, fully random ones rated by
// the engine), then the worker's deal message end to end.

const validator = new TeamValidator(FORMAT);
const deps: DealDeps = {
  usage: loadTrainingUsage(), legality: createSetLegality(validator, runtime), runtime,
  validate: (team) => { const adapted = toShowdownTeam(team.members, runtime); return validateTeams(adapted, adapted, validator).own; },
};
const teamsFor = (seed: string) => {
  const random = createRandom(seed);
  return { own: readyMadeTeam(random, deps, "Yours", "you"), opponent: readyMadeTeam(random, deps, "Theirs", "ai") };
};
const setupOf = (teams: { own: TrainingTeam; opponent: TrainingTeam }, situation: TrainingSituation): TrainingSetup => ({ ...teams, difficulty: "safe", showRead: true, info: DEFAULT_INFO, situation });
const standing = (side: TrainingSituation["own"]) => side.members.filter((member) => member.hp > 0);
const baseOf = (speciesId: string) => runtime.speciesById.get(speciesId)!.baseSpecies.toLowerCase().replace(/[^a-z0-9]+/g, "");

describe("ready-made teams", () => {
  it("are six usage Pokémon with usage sets, one per species, at most two Megas, legal for the format", () => {
    for (let n = 0; n < 6; n++) {
      const { own, opponent } = teamsFor(`teams-${n}`);
      for (const team of [own, opponent]) {
        expect(team.members).toHaveLength(TEAM_SIZE);
        expect(new Set(team.members.map((member) => baseOf(member.speciesId))).size).toBe(TEAM_SIZE);
        expect(team.members.filter((member) => /ite[xy]?$/.test(member.build.itemId) && member.build.itemId !== "eviolite").length).toBeLessThanOrEqual(MAX_MEGAS);
        expect(new Set(team.members.map((member) => member.build.itemId).filter(Boolean)).size).toBe(team.members.filter((member) => member.build.itemId).length);
        expect(team.members.every((member) => member.origin === "suggested" && member.suggestion?.source === "usage")).toBe(true);
        expect(team.members.every((member) => member.moves.some((slot) => slot.moveId))).toBe(true);
        const problems = deps.validate(team);
        expect(problems.team).toEqual([]);
        expect(Object.values(problems.members).flat()).toEqual([]);
      }
      expect(own.members.every((member) => member.key.startsWith("you-")) && opponent.members.every((member) => member.key.startsWith("ai-"))).toBe(true);
    }
  });

  it("are the same for the same random draws", () => {
    expect(teamsFor("same")).toEqual(teamsFor("same"));
    expect(teamsFor("same")).not.toEqual(teamsFor("other"));
  });

  it("may hold a Simple Beam set: the AI values Simple, which the Champions catalog lacks (sim/observe.ts buildOf)", () => {
    // Six usage rows, Audino's among them, so every draw takes all six.
    const six = ["audino", "incineroar", "garchomp", "whimsicott", "kingambit", "rotomwash"];
    const only: DealDeps = { ...deps, usage: { ...deps.usage, species: Object.fromEntries(six.map((id) => [id, deps.usage.species[id]])) } };
    const team = readyMadeTeam(createRandom("simple-beam"), only, "Yours", "you");
    expect(team.members.map((member) => member.speciesId).sort()).toEqual([...six].sort());
    expect(team.members.find((member) => member.speciesId === "audino")!.moves.map((slot) => slot.moveId)).toContain("simplebeam");
  });
});

describe("dealt positions", () => {
  const teams = teamsFor("positions");
  const random = createRandom("positions-deal");

  it("follow each named situation's recipe at both levels", () => {
    for (const spot of SITUATION_SPOTS) for (const level of SITUATION_LEVELS) {
      for (let n = 0; n < 4; n++) {
        const request: SituationRequest = { kind: "spot", spot, level };
        const dealt = dealPosition(request, request, teams, random, runtime);
        expect(situationProblem(dealt, setupOf(teams, dealt)), `${spot} ${level}`).toBeNull();
        expect(dealt).toMatchObject({ request, spot });
        const recipe = spotInfo(spot).recipes[level];
        for (const role of ["own", "opponent"] as const) {
          const side = dealt[role], rule = recipe[role];
          expect(standing(side), `${spot} ${level} ${role}`).toHaveLength(rule.left);
          for (const member of standing(side)) expect(member.hp >= rule.hp[0] && member.hp <= rule.hp[1]).toBe(true);
          expect(!!side.tailwind).toBe(!!rule.tailwind);
          const leads = standing(side).slice(0, 2);
          if (rule.statusLeads) {
            const statused = leads.filter((member) => member.status);
            expect(statused.length).toBeGreaterThanOrEqual(1);
            expect(statused.length).toBeLessThanOrEqual(rule.statusLeads);
            for (const member of statused) {
              const full = teams[role].members.find((each) => each.key === member.key)!;
              expect(["brn", "par"]).toContain(member.status);
              expect(canHold(full, member.status!, runtime)).toBe(true);
              if (member.status === "brn") expect(attackStat(full, runtime)).toBe("atk");
            }
          } else expect(side.members.some((member) => member.status)).toBe(false);
          const boosted = side.members.filter((member) => member.boosts);
          if (rule.sweeper) {
            expect(boosted).toHaveLength(1);
            expect(leads).toContain(boosted[0]);
            const stages = Object.values(boosted[0].boosts!);
            expect(stages).toContain(2);
            expect(boosted[0].boosts!.spe ?? 0).toBe(rule.sweeper === "attack-speed" ? 1 : 0);
          } else expect(boosted).toEqual([]);
        }
      }
    }
  });

  it("give a custom situation its Pokémon left, HP and the leads' stat stages", () => {
    const request: SituationRequest = {
      kind: "custom",
      custom: { own: { left: 1, hp: 25, leads: [{ atk: 2 }, { spe: 6 }] }, opponent: { left: 3, hp: 75, leads: [{ def: -1, spa: 1 }, { spe: 2 }] } },
    };
    const dealt = dealPosition(request, request, teams, random, runtime);
    expect(situationProblem(dealt, setupOf(teams, dealt))).toBeNull();
    expect(dealt.spot).toBeNull();
    expect(dealt.own.members.map((member) => member.hp)).toEqual([25, 0, 0, 0]);
    expect(dealt.own.members.map((member) => member.boosts ?? null)).toEqual([{ atk: 2 }, null, null, null]);
    expect(dealt.opponent.members.map((member) => member.hp)).toEqual([75, 75, 75, 0]);
    expect(dealt.opponent.members.map((member) => member.boosts ?? null)).toEqual([{ def: -1, spa: 1 }, { spe: 2 }, null, null]);
  });

  it("deal a fully random position the teams can hold, the AI never behind on Pokémon left", () => {
    for (const level of SITUATION_LEVELS) for (let n = 0; n < 20; n++) {
      const request: SituationRequest = { kind: "random", level };
      const dealt = dealPosition(request, request, teams, random, runtime);
      expect(situationProblem(dealt, setupOf(teams, dealt))).toBeNull();
      expect(standing(dealt.opponent).length).toBeGreaterThanOrEqual(standing(dealt.own).length);
    }
    const draws = Array.from({ length: 90 }, () => drawAny("hard", random));
    expect(new Set(draws.map((each) => each.kind === "spot" ? each.spot : "random")).size).toBe(SITUATION_SPOTS.length + 1);
  });

  it("deal statuses only where they hurt", () => {
    const member = (speciesId: string, abilityId: string, itemId = "") => ({ ...teams.own.members[0], speciesId, build: { ...teams.own.members[0].build, speciesId, abilityId, itemId } });
    expect(canHold(member("charizard", "blaze"), "brn", runtime)).toBe(false);
    expect(canHold(member("raichu", "lightningrod"), "par", runtime)).toBe(false);
    expect(canHold(member("garchomp", "roughskin"), "par", runtime)).toBe(true);
    expect(canHold(member("garchomp", "roughskin", "lumberry"), "par", runtime)).toBe(false);
    expect(canHold(member("ursaluna", "guts"), "brn", runtime)).toBe(false);
    expect(canHold(member("kingambit", "defiant"), "psn", runtime)).toBe(false);
  });
});

describe("the worker's deal", () => {
  async function dealt(request: SituationRequest, createProvider = createStubProvider): Promise<FromWorker> {
    const posted: FromWorker[] = [];
    let hex = 0;
    const worker = createTrainingWorker({ post: (message) => posted.push(message), createProvider, now: () => 0, randomHex: () => String(++hex).padStart(32, "0"), deadlineMs: null });
    worker.receive({ type: "load" });
    worker.receive({ type: "deal", key: "k1", request, settings: { difficulty: "reads", showRead: false, info: DEFAULT_INFO } });
    for (let wait = 0; wait < 600 && !posted.some((message) => message.type === "dealt" || message.type === "deal-error"); wait++) await new Promise((resolve) => setTimeout(resolve, 5));
    return posted.find((message) => message.type === "dealt" || message.type === "deal-error")!;
  }

  it("posts a legal setup with the battle settings and the position, which then plays to the end", async () => {
    const message = await dealt({ kind: "any", level: "very-hard" });
    expect(message.type).toBe("dealt");
    const setup = (message as Extract<FromWorker, { type: "dealt" }>).setup;
    expect(setup).toMatchObject({ difficulty: "reads", showRead: false, info: DEFAULT_INFO, situation: { request: { kind: "any", level: "very-hard" } } });
    expect(situationProblem(setup.situation!, setup)).toBeNull();
    const played = await playBattle({ run: "situation-deal", index: 0, setup, seat: "random", sealer: createMemorySealer() });
    expect(played.errors).toEqual([]);
    expect(played.ended).not.toBeNull();
  }, 60_000);

  it("deals a fully random position (the stub AI rates none: the first of its tries is kept)", async () => {
    const message = await dealt({ kind: "random", level: "hard" });
    expect(message.type).toBe("dealt");
    const setup = (message as Extract<FromWorker, { type: "dealt" }>).setup;
    expect(setup.situation).toMatchObject({ request: { kind: "random", level: "hard" }, spot: null });
  }, 60_000);
});
