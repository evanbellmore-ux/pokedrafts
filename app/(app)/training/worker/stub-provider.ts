// The worker's stand-in DecisionProvider until the AI track's engine provider is wired in (SPEC §13.2 SIM-5): it plays
// the first legal option of its own request and leads with its first four. It reads only its own request (AiInputs).
import type { HabitsRecord, DecisionProvider, DecisionStats, PreviewDecision, SwitchDecision, TurnDecision } from "../model/decision";
import type { JointAction } from "../model/view-types";
import { identName, legalJointActions, type MemberKeys } from "../sim/choices";
import type { AiInputs } from "../model/ai-inputs";

const ownKeys = (inputs: AiInputs): MemberKeys => {
  const byName = new Map<string, string>();
  for (const { key, set } of inputs.own) { byName.set(set.name, key); byName.set(set.species, key); }
  return {
    keyOf: (_side, name) => byName.get(name) ?? inputs.own.find((each) => each.set.species.startsWith(name))?.key ?? `?${name}`,
    speciesOf: (_side, key) => inputs.own.find((each) => each.key === key)?.set.species ?? key,
  };
};

function firstLegal(inputs: AiInputs): JointAction {
  const keys = ownKeys(inputs);
  const request = inputs.request;
  const side = inputs.perspective;
  const bench = request.side.pokemon.map((each) => keys.keyOf(side, identName(each.ident)));
  const firstTurn = request.side.pokemon.slice(0, 2).map((each) => each.active && (inputs.public.mons[`${side}:${keys.keyOf(side, identName(each.ident))}`]?.actions ?? 0) === 0);
  const legal = legalJointActions({ side, aiSide: side, request, bench, firstTurn, megaUsed: inputs.public.sides[side].megaUsed, keys });
  return legal.find((action) => !Object.values(action).some((each) => each?.kind === "move" && each.mega)) ?? legal[0] ?? {};
}

const emptyStats = (): DecisionStats => ({
  options: { its: 1, yours: 0 }, statusOptions: { its: 0, yours: 0 },
  byMethod: { engine: 0, prelude: 0, rollout: 0, dropped: 0 },
  engineCalls: 0, rolloutSamples: 0, preludes: 0, builds: 0, beliefMs: 0, elapsedMs: 0, valveFired: false,
  exploitability: 0, approximations: [], mega: null,
});

export function createStubProvider(habits: HabitsRecord | null): DecisionProvider {
  let record: HabitsRecord = habits ?? { version: 1, turns: 0, data: null };
  return {
    id: "engine",
    async teamPreview(context): Promise<PreviewDecision> {
      return {
        order: [1, 2, 3, 4].slice(0, Math.min(4, context.ai.members.length)),
        report: { turn: 0, provider: "engine", difficulty: "safe", predicted: [], strategy: [], chosen: 0, actual: null, reason: null, mega: null, assumed: [], elapsedMs: 0, evaluated: { yours: 0, its: 1 } },
      };
    },
    async chooseTurn(context, options): Promise<TurnDecision> {
      const action = firstLegal(context.inputs);
      const turn = context.inputs.public.turn;
      return {
        action,
        report: { turn, provider: "engine", difficulty: options.difficulty, predicted: [], strategy: [{ action, chance: 1 }], chosen: 0, actual: null, reason: null, mega: null, assumed: [], elapsedMs: 0, evaluated: { yours: 0, its: 1 } },
        stats: emptyStats(),
        question: { kind: "turn", turn, options: [], slots: {} },
      };
    },
    async chooseReplacements(context): Promise<SwitchDecision> {
      return { action: firstLegal(context.inputs) };
    },
    observeTurn() { record = { ...record, turns: record.turns + 1 }; },
    observeBattle() {},
    habits() { return record; },
  };
}
