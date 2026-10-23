import { describe, expect, it } from "vitest";
import { GAS_STAND_IN } from "@/app/lib/battle/calculate";
import { createEngineProvider, type TurnTrace } from "@/app/(app)/training/ai/engine-provider";
import type { BeliefWorld } from "@/app/(app)/training/model/ai-inputs";
import { DEFAULT_BUDGET, type DecideOptions } from "@/app/(app)/training/model/decision";
import { OPEN_TEAM_SHEETS } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import type { JointAction } from "@/app/(app)/training/model/view-types";
import { liveBuild } from "@/app/(app)/training/sim/bridge";
import { buildOf } from "@/app/(app)/training/sim/observe";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import type { WritablePokemon } from "@/app/(app)/training/sim/sim";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { AI, PLAYER, memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

// Simple Beam gives Simple, which no Champions species has, so the calculator's catalog lacks it (calculate.ts makePokemon
// refuses it): the AI's own estimates read it as no ability (sim/observe.ts buildOf), and the engine path rolls the turn out.

const sp = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number) => ({ hp, atk, def, spa, spd, spe });
const set = (species: string, item: string, ability: string, moves: string[], nature: string, evs: ReturnType<typeof sp>) =>
  ({ name: species, species, item, ability, moves, nature, evs, ivs: sp(31, 31, 31, 31, 31, 31), level: 50, gender: "" });
/** Training's usage set for Audino (data/champions/training-usage.json). */
const AUDINO = set("Audino", "Mental Herb", "Regenerator", ["Trick Room", "Simple Beam", "Protect", "Heal Pulse"], "Relaxed", sp(32, 0, 32, 0, 2, 0));
const GARDEVOIR = set("Gardevoir", "Choice Specs", "Trace", ["Moonblast", "Psychic", "Dazzling Gleam", "Protect"], "Modest", sp(2, 0, 0, 32, 0, 32));
const usage = loadTrainingUsage();

/** The probe teams with their fifth member (Rotom-Wash, Farigiraf) replaced. */
function battle(fifth: { player?: typeof AUDINO; ai?: typeof AUDINO }) {
  const player = PLAYER.map((each) => memberFromSet(each));
  const ai = AI.map((each) => memberFromSet(each));
  if (fifth.player) player[4] = memberFromSet(fifth.player);
  if (fifth.ai) ai[4] = memberFromSet(fifth.ai);
  return seatBattle([1, 2, 3, 4], { own: toShowdownTeam(player, runtime), opponent: toShowdownTeam(ai, runtime) });
}

/** The engine provider's turn for the AI (p2) on real services: belief battles, the bridge, E2 and simulator rollouts. */
async function decide(s: ReturnType<typeof battle>, seed: number) {
  const provider = createEngineProvider({ runtime, habits: null });
  const inputs = s.inputs(OPEN_TEAM_SHEETS);
  const options: DecideOptions = {
    difficulty: "safe", budget: DEFAULT_BUDGET, deadlineMs: null, random: createRandom("simple-beam", seed, "ai"), seedBase: seedHex("simple-beam", seed),
    signal: new AbortController().signal, yieldNow: async () => {}, now: () => performance.now(),
  };
  const services = (worlds: readonly BeliefWorld[]) => createTurnServices(inputs, worlds, { runtime, keys: s.keys, seedBase: options.seedBase });
  const decision = await provider.chooseTurn({ runtime, inputs, services, usage }, options);
  return { decision, trace: provider.lastTurn()! };
}

/** The engine's own decision, not the fallback (which evaluates nothing and has no value), with a finite value and matrix. */
function expectSolved({ decision, trace }: Awaited<ReturnType<typeof decide>>) {
  expect(decision.report.evaluated.its).toBeGreaterThan(0);
  expect(decision.report.evaluated.yours).toBeGreaterThan(0);
  expect(Number.isFinite(decision.stats.value)).toBe(true);
  expect(trace.matrix.flat().every(Number.isFinite)).toBe(true);
}
const beams = (action: JointAction) => Object.values(action).some((each) => each?.kind === "move" && each.moveId === "simplebeam");
/** The valued cells where either side uses Simple Beam. */
const beamCells = (trace: TurnTrace) =>
  trace.ai.flatMap((a, i) => trace.player.flatMap((b, j) => (beams(a.action) || beams(b.action)) && trace.cells[i][j] ? [trace.cells[i][j]!] : []));

describe("Simple Beam (an ability the Champions catalog does not list)", () => {
  for (const side of ["ai", "player"] as const) {
    it(`a turn where ${side === "ai" ? "the AI's" : "your"} Audino can use it: every cell valued, the beam's on rollouts`, async () => {
      const s = battle({ [side]: AUDINO });
      s.step(side === "player" ? "team 5123" : "team 1234", side === "ai" ? "team 5123" : "team 1234");
      const result = await decide(s, 1);
      expectSolved(result);
      expect(result.decision.stats.byMethod.dropped).toBe(0);
      const cells = beamCells(result.trace);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.every((cell) => Number.isFinite(cell.value))).toBe(true);
      expect(cells.some((cell) => cell.method === "rollout" && cell.notes.includes("Simple Beam giving Simple is not modelled in 2v2."))).toBe(true);
    }, 120_000);
  }

  it("the turn after it landed: the AI reads Gyarados's Simple as no ability, and rolls out the cells it is in", async () => {
    const s = battle({ player: AUDINO });
    s.step("team 5123", "team 1234");
    // Your Audino beams Gyarados (after its Dragon Dance); Incineroar and Pelipper protect.
    s.step("move 2 1, move 4", "move 3, move 4");
    const gyarados = s.battle.p2.active[0]!;
    expect(gyarados.ability).toBe("simple");
    expect(liveBuild(gyarados, runtime)).toMatchObject({ abilityId: "simple", abilityChanged: true });
    const result = await decide(s, 2);
    expectSolved(result);
    const read = result.trace.view.mons.find((mon) => mon.side === "opponent" && mon.build.speciesId === "gyarados")!;
    expect(read.build).toMatchObject({ abilityId: GAS_STAND_IN, abilityChanged: true, boosts: { spe: 1 } });
    expect(result.trace.cells.flat().some((cell) => cell?.method === "rollout" && cell.notes.includes("Gyarados: its ability was changed (simple)."))).toBe(true);
  }, 120_000);

  it("buildOf: a listed ability is the live build; Trace's copy of an unlisted one reads as no ability", () => {
    const s = battle({ player: GARDEVOIR });
    s.step("team 5123", "team 1234");
    const gardevoir = s.battle.p1.active[0]!;
    expect(buildOf(gardevoir, runtime)).toEqual(liveBuild(gardevoir, runtime));
    // Trace's copy (pinned trace onUpdate setAbility): the ability changes, the base ability stays Trace.
    (gardevoir as unknown as WritablePokemon).ability = "simple";
    expect(liveBuild(gardevoir, runtime)).toMatchObject({ abilityId: "trace", tracedAbility: "simple" });
    const read = buildOf(gardevoir, runtime);
    expect(read).toMatchObject({ abilityId: GAS_STAND_IN, abilityActive: false, abilityChanged: true });
    expect(read).not.toHaveProperty("tracedAbility");
  });
});
