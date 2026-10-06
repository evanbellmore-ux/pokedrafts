// A fake TurnServices for the Training AI unit tests (SPEC §13: unit tests use fake AiInputs/TurnServices; the SIM track's
// sim/services.ts is the real one). Engine worlds are built straight from the AiView: a switch or a Mega Evolution is a
// "prelude" that puts the incoming Pokémon or the Mega form in its slot, with the entry effects the tests need (Intimidate,
// and the Mega form's weather or terrain ability); a Protect with a streak splits into success and failure. Rollouts sample
// one E2 outcome per sample (unmodelled status moves applied as their status first). No simulator.
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { DOUBLES_SLOTS, foesOf, slotSide, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import { UNSEEN_MEMBER } from "@/app/(app)/training/model/ai-inputs";
import type { AiView, CellActions, EngineWorld, EngineWorlds, MonKey, MonView, PostState, ReplacePolicy, TurnServices } from "@/app/(app)/training/model/ai-view";
import { createRandom } from "@/app/(app)/training/model/random";
import { jointActionKey, type SlotAction } from "@/app/(app)/training/model/view-types";
import { inForm, isProtectMove, megaFormFor } from "@/app/(app)/training/ai/battle-facts";
import { postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import { fieldOfAbility } from "@/app/(app)/training/ai/field-favor";
import { calcBuild } from "@/app/(app)/training/ai/rows";
import { postOf, runtime } from "./training-ai";

export type FakeServices = TurnServices & {
  calls: { engineWorlds: number; rollouts: number; preludes: number };
  /** Cells whose rollouts were asked for, by jointActionKey pair. */
  rolled: Map<string, number>;
};
export type FakeOptions = {
  residual?: Record<MonKey, number>;
  /** Cells that world 0 rejects (kind "skip"). */
  skip?: (cell: CellActions) => boolean;
  /** Cells sent to rollouts whatever the engine could do. */
  forceRollout?: (cell: CellActions) => boolean;
};

const STATUS_EFFECT: Record<string, BattleBuild["status"]> = { willowisp: "brn", thunderwave: "par", glare: "par", stunspore: "par", spore: "slp", sleeppowder: "slp", hypnosis: "slp", toxic: "tox" };
const monAt = (view: AiView, slot: DoublesSlotId) => view.mons.find((mon) => mon.slot === slot && !mon.fainted) ?? null;

export function fakeServices(view: AiView, options: FakeOptions = {}): FakeServices {
  const calls = { engineWorlds: 0, rollouts: 0, preludes: 0 };
  const rolled = new Map<string, number>();
  const start = postOf(view);
  const residual = options.residual ?? {};

  /** The engine input for a cell, or a reason it needs a rollout. */
  function inputOf(cell: CellActions): { input: DoublesTurnInput; keys: Record<DoublesSlotId, MonKey | null>; prelude: boolean } | { reason: string } {
    const field: BattleConditions = structuredClone(view.field);
    const pokemon: Record<DoublesSlotId, DoublesPokemonInput | null> = { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null };
    const keys: Record<DoublesSlotId, MonKey | null> = { "own-left": null, "own-right": null, "opponent-left": null, "opponent-right": null };
    const intimidate: DoublesSlotId[] = [];
    let prelude = false;
    for (const slot of DOUBLES_SLOTS) {
      const mon = monAt(view, slot);
      if (!mon) continue;
      const action: SlotAction | undefined = slotSide(slot) === "own" ? cell.own[slot] : cell.opponent[slot];
      let entry: MonView = mon;
      let build = calcBuild(mon);
      let move: { moveId: string | null; target: DoublesSlotId | null } = { moveId: null, target: null };
      if (action?.kind === "switch") {
        if (action.to === UNSEEN_MEMBER) return { reason: "An unseen Pokémon enters." };
        const incoming = view.mons.find((each) => each.side === mon.side && each.memberKey === action.to);
        if (!incoming) return { reason: "Unknown switch." };
        entry = incoming;
        build = calcBuild(incoming);
        prelude = true;
        if (build.abilityId === "intimidate") intimidate.push(slot);
      } else if (action?.kind === "move") {
        if (action.mega) {
          const form = megaFormFor(build.speciesId, build.itemId, runtime);
          if (form) {
            build = inForm(build, form, runtime);
            prelude = true;
            const setting = fieldOfAbility(build.abilityId);
            if (setting?.weather) field.weather = setting.weather;
            if (setting?.terrain) field.terrain = setting.terrain;
            if (build.abilityId === "intimidate") intimidate.push(slot);
          }
        }
        const firstOnly = action.moveId === "fakeout" || action.moveId === "firstimpression";
        move = { moveId: firstOnly && !mon.firstTurn ? null : action.moveId, target: action.target };
      }
      pokemon[slot] = { build, contexts: {}, charged: false, action: move };
      keys[slot] = entry.key;
    }
    for (const slot of intimidate) for (const foe of foesOf(slot)) {
      const entry = pokemon[foe];
      if (entry) entry.build = { ...entry.build, boosts: { ...entry.build.boosts, atk: Math.max(-6, (entry.build.boosts.atk ?? 0) - 1) } };
    }
    if (prelude) calls.preludes++;
    return { input: { runtime, field, pokemon }, keys, prelude };
  }

  function engineWorlds(cell: CellActions): EngineWorlds {
    calls.engineWorlds++;
    if (options.skip?.(cell)) return { kind: "skip", reasons: ["World 0 rejects the choice."] };
    if (options.forceRollout?.(cell)) return { kind: "rollout", reasons: ["Forced rollout."] };
    const built = inputOf(cell);
    if ("reason" in built) return { kind: "rollout", reasons: [built.reason] };
    let worlds: EngineWorld[] = [{ weight: 1, input: built.input, keys: built.keys, notes: [] }];
    for (const slot of DOUBLES_SLOTS) {
      const entry = built.input.pokemon[slot];
      const mon = monAt(view, slot);
      if (!entry?.action.moveId || !mon || !isProtectMove(entry.action.moveId) || mon.protectStreak < 1) continue;
      const success = 1 / 3 ** mon.protectStreak;
      worlds = worlds.flatMap((world) => [
        { ...world, weight: world.weight * success },
        { ...world, weight: world.weight * (1 - success), notes: [...world.notes, "Protect fails."], input: { ...world.input, pokemon: { ...world.input.pokemon, [slot]: { ...entry, action: { moveId: null, target: null } } } } },
      ]);
    }
    return { kind: "engine", source: built.prelude ? "prelude" : "live", worlds };
  }

  function rollout(cell: CellActions, sample: number, replace: ReplacePolicy): PostState {
    void replace;
    calls.rollouts++;
    const id = `${jointActionKey(cell.opponent)}|${jointActionKey(cell.own)}`;
    rolled.set(id, (rolled.get(id) ?? 0) + 1);
    const built = inputOf(cell);
    if ("reason" in built) return structuredClone(start);
    const random = createRandom("fake-rollout", id, sample);
    // Unmodelled status moves: their status lands first (as if they moved first), then the move is "No move".
    const input = structuredClone({ field: built.input.field, pokemon: built.input.pokemon });
    for (const slot of DOUBLES_SLOTS) {
      const entry = input.pokemon[slot];
      const moveId = entry?.action.moveId;
      const status = moveId ? STATUS_EFFECT[moveId] : undefined;
      if (!entry || !moveId) continue;
      if (status) {
        const target = entry.action.target ? input.pokemon[entry.action.target] : null;
        if (target && !target.build.status) target.build = { ...target.build, status };
        entry.action = { moveId: null, target: null };
      } else if (runtime.movesById.get(moveId)?.category === "Status" && !["protect", "detect", "tailwind", "trickroom", "helpinghand", "followme", "ragepowder", "reflect", "lightscreen", "auroraveil", "sunnyday", "raindance", "wideguard", "quickguard"].includes(moveId)) {
        entry.action = { moveId: null, target: null };
      }
    }
    const result = calculateDoublesOutcomes({ runtime, field: input.field, pokemon: input.pokemon });
    if (result.status !== "ready") return structuredClone(start);
    let u = random.float(), outcome = result.outcomes[result.outcomes.length - 1];
    for (const each of result.outcomes) { u -= each.chance; if (u < 0) { outcome = each; break; } }
    const world: EngineWorld = { weight: 1, input: { runtime, ...input }, keys: built.keys, notes: [] };
    const post = postFromOutcome({ view, base: start, residual, outcome, start: result.start, world, cell });
    // One sampled HP per Pokémon (a rollout is one battle).
    const mons = post.mons.map((mon) => {
      let v = random.float(), hp = mon.hp[mon.hp.length - 1]?.hp ?? 0;
      for (const entry of mon.hp) { v -= entry.chance; if (v < 0) { hp = entry.hp; break; } }
      return { ...mon, hp: [{ hp, chance: 1 }] };
    });
    return { ...post, mons, chance: 1, wiped: { own: post.wiped.own >= 0.5 ? 1 : 0, opponent: post.wiped.opponent >= 0.5 ? 1 : 0 }, endOfTurn: "applied" };
  }

  return {
    view, worlds: [], calls, rolled,
    engineWorlds,
    rollout,
    residual: () => residual,
    startInput: () => {
      const built = inputOf({ own: {}, opponent: {} });
      if ("reason" in built) throw new Error(built.reason);
      return built.input;
    },
    current: () => structuredClone(start),
    approximations: [],
    get spent() { return { builds: 1, preludes: calls.preludes, rollouts: calls.rollouts }; },
  };
}
