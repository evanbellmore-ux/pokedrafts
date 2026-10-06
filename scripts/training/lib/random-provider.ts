// VAL's own uniform-random seat (runner smoke tests and conformance before or besides ai/baselines.ts): it reads only its
// own AiInputs (its request and its public state), never services or the real battle.
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import type { DecideOptions, DecisionProvider, DecisionStats, HabitsRecord } from "@/app/(app)/training/model/decision";
import type { DecisionReport, JointAction } from "@/app/(app)/training/model/view-types";
import { identName, legalJointActions, type MemberKeys } from "@/app/(app)/training/sim/choices";
import { Dex, FORMAT } from "@/app/(app)/training/sim/sim";

/** A set named as its species is shown under its base species' name (pinned sim/pokemon.ts:329-330: Rotom-Wash → "Rotom"). */
const shownName = (species: string) => Dex.forFormat(FORMAT).species.get(species).baseSpecies;
/** Keys of the seat's own members from its sets (the other side is never switched to by this seat). */
export function ownKeys(inputs: Pick<AiInputs, "own" | "perspective">): MemberKeys {
  return {
    keyOf: (_side, name) => inputs.own.find((entry) => entry.set.name === name || entry.set.species === name || shownName(entry.set.species) === name)?.key ?? `?${name}`,
    speciesOf: (_side, key) => inputs.own.find((entry) => entry.key === key)?.set.species ?? key,
  };
}
/** Every legal joint action of the seat's own request (SPEC 7.4 enumeration). */
export function ownLegal(inputs: AiInputs): JointAction[] {
  const side = inputs.perspective;
  const request = inputs.request;
  if ("teamPreview" in request || "wait" in request) return [];
  const keys = ownKeys(inputs);
  const bench = request.side.pokemon.filter((pokemon) => !pokemon.active).map((pokemon) => keys.keyOf(side, identName(pokemon.ident)));
  const firstTurn = request.side.pokemon.slice(0, 2).map((pokemon) => (inputs.public.mons[`${side}:${keys.keyOf(side, identName(pokemon.ident))}`]?.actions ?? 0) === 0);
  return legalJointActions({ side, aiSide: side, request, bench, firstTurn, megaUsed: inputs.public.sides[side].megaUsed, keys });
}

const emptyStats = (): DecisionStats => ({
  options: { its: 0, yours: 0 }, statusOptions: { its: 0, yours: 0 }, byMethod: { engine: 0, prelude: 0, rollout: 0, dropped: 0 },
  engineCalls: 0, rolloutSamples: 0, preludes: 0, builds: 0, beliefMs: 0, elapsedMs: 0, valveFired: false, exploitability: 0, approximations: [], mega: null,
});
const report = (turn: number, difficulty: DecideOptions["difficulty"]): DecisionReport => ({
  turn, provider: "engine", difficulty, predicted: [], strategy: [], chosen: 0, actual: null, reason: null, mega: null, assumed: [], elapsedMs: 0, evaluated: { yours: 0, its: 0 },
});

export function createRandomSeat(): DecisionProvider {
  const habits: HabitsRecord = { version: 1, turns: 0, data: null };
  return {
    id: "engine",
    async teamPreview(_context, options) {
      const order = [1, 2, 3, 4, 5, 6];
      for (let i = order.length - 1; i > 0; i--) { const j = options.random.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      return { order: order.slice(0, 4), report: report(0, options.difficulty) };
    },
    async chooseTurn(context, options) {
      const legal = ownLegal(context.inputs);
      const action = legal[options.random.int(legal.length)] ?? {};
      return { action, report: report(context.inputs.public.turn, options.difficulty), stats: emptyStats(),
        question: { kind: "turn", turn: context.inputs.public.turn, options: [], slots: {} } };
    },
    async chooseReplacements(context, options) {
      const legal = ownLegal(context.inputs);
      return { action: legal[options.random.int(legal.length)] ?? {} };
    },
    observeTurn() {},
    observeBattle() {},
    habits: () => habits,
  };
}
