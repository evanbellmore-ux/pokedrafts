// TurnServices for one AI decision (SPEC §9.4): belief battles built from AiInputs and the belief worlds only, then the
// view, engine worlds (bridge + splits, after a prelude for switches and Mega Evolution), rollouts and the residual
// pass on them. No real battle reaches this file (boundary test; I5, G2).
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { DOUBLES_SLOTS } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { UNSEEN_MEMBER, type AiInputs, type BeliefWorld } from "../model/ai-inputs";
import type { CellActions, EngineWorld, EngineWorlds, MonKey, PostMon, PostState, ReplacePolicy, TurnServices } from "../model/ai-view";
import { seedHex } from "../model/random";
import type { SideID } from "../model/showdown-types";
import { jointActionKey, withoutMega, type JointAction } from "../model/view-types";
import { buildBeliefBattle, type BeliefBattle } from "./belief-battle";
import { bridgeTurn, fieldClock, keyOfPokemon, needsPrelude, startInput, type EarlierThisTurn } from "./bridge";
import { ChoiceBuildError, toChoiceString, type MemberKeys } from "./choices";
import { buildOf, observe, otherSide, revealedKeys } from "./observe";
import { runPreludeWorlds } from "./prelude";
import { runResidual } from "./residual";
import { runRollout } from "./rollout";
import { State, type ClonedBattle } from "./sim";
import { countsOf } from "./tracker";
import { showdownPosition, slotAt } from "../model/positions";
import { splitWorlds } from "./splits";

export type ServicesContext = {
  runtime: BattleRuntime;
  /** The real battle's member keys (worker); the belief battles carry their own for the same names. */
  keys: MemberKeys;
  /** 32 hex digits for this request: seedHex(aiBase, requestId). */
  seedBase: string;
  /** The request is a mid-turn replacement (U-turn, Parting Shot, Eject Button/Pack, Red Card). */
  midTurn?: boolean;
};

/** status2 R-T: with no ReplacePolicy given, the AI's side takes its first options (its request's living bench order). */
const firstOptions: ReplacePolicy = (_side, slots, options) => options.slice(0, slots.length);

const PROTECT_LINE = /^\|-singleturn\|(p[12])([ab]): [^|]*\|(?:move: )?(Protect|Endure|Wide Guard|Quick Guard|King's Shield|Spiky Shield|Baneful Bunker|Obstruct|Silk Trap|Burning Bulwark|Max Guard)/;

export function createTurnServices(inputs: AiInputs, worlds: readonly BeliefWorld[], ctx: ServicesContext): TurnServices {
  const ai = inputs.perspective;
  const other = otherSide(ai);
  const { runtime, seedBase } = ctx;
  if (!worlds.length) throw new Error("No belief worlds.");
  // Builds (about 1.5 ms each). A sampled world that cannot be built is dropped and the weights renormalized.
  const battles: BeliefBattle[] = [];
  const kept: BeliefWorld[] = [];
  const approximations = new Set<string>();
  worlds.forEach((world, index) => {
    try {
      const built = buildBeliefBattle(inputs, world, runtime);
      battles.push(built); kept.push(world);
      for (const note of built.approximations) approximations.add(note);
    } catch (error) {
      if (index === 0) throw error;
      approximations.add("A sampled belief world could not be built.");
    }
  });
  const total = kept.reduce((sum, world) => sum + world.weight, 0) || 1;
  const usedWorlds = kept.map((world) => ({ ...world, weight: world.weight / total }));
  const spent = { builds: battles.length, preludes: 0, rollouts: 0 };
  const view = observe({ inputs, worlds: usedWorlds, battles, runtime, midTurn: !!ctx.midTurn });
  const revealed = revealedKeys(inputs);
  const world0 = battles[0];

  /** UNSEEN_MEMBER → that world's first unrevealed living bench member of the player (SPEC 9.4). */
  const resolve = (joint: JointAction, world: BeliefBattle): JointAction => {
    const unseen = world.battle[other].pokemon.find((pokemon) => !pokemon.fainted && !pokemon.isActive && !revealed.has(world.keys.keyOf(other, pokemon.name)));
    const out: JointAction = {};
    for (const slot of DOUBLES_SLOTS) {
      const each = joint[slot];
      if (!each) continue;
      out[slot] = each.kind === "switch" && each.to === UNSEEN_MEMBER
        ? (unseen ? { kind: "switch", to: world.keys.keyOf(other, unseen.name) } : { kind: "pass" })
        : each;
    }
    return out;
  };
  const choiceFor = (side: SideID, joint: JointAction, world: BeliefBattle): string => {
    const request = world.battle[side].activeRequest;
    if (!request || "wait" in request || "teamPreview" in request) return "";
    return toChoiceString(side, side === ai ? joint : resolve(joint, world), request, world.keys, ai);
  };
  const choicesFor = (cell: CellActions, world: BeliefBattle) => {
    const byAi = choiceFor(ai, cell.opponent, world), byPlayer = choiceFor(other, cell.own, world);
    return ai === "p2" ? { p1: byPlayer, p2: byAi } : { p1: byAi, p2: byPlayer };
  };

  let checker: ClonedBattle | null = null;
  /** World 0's refusal of either string, or null (Side.choose records a choice without committing the turn). */
  const refusal = (choices: { p1: string; p2: string }): string | null => {
    checker ??= (() => { const clone = State.deserializeBattle(world0.json); clone.restart(() => {}); return clone; })();
    let error: string | null = null;
    for (const side of ["p1", "p2"] as const) {
      if (!choices[side]) continue;
      const ok = checker[side].choose(choices[side]) && checker[side].isChoiceDone();
      if (!ok && !error) error = checker[side].choice.error || `${side}: ${choices[side]}`;
      checker[side].clearChoice();
    }
    return error;
  };

  const publicOf = (key: MonKey) => inputs.public.mons[`${key.startsWith("own:") ? other : ai}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
  // status2 R-T: one memo per replacement policy (the AI's ReplacePolicy decides its own replacements in the engine input and
  // the prelude), and one for none.
  const memos = new WeakMap<ReplacePolicy, Map<string, EngineWorlds>>();
  const plain = new Map<string, EngineWorlds>();
  function engineWorlds(cell: CellActions, replace?: ReplacePolicy): EngineWorlds {
    const key = `${jointActionKey(cell.own)}|${jointActionKey(cell.opponent)}`;
    let memo = replace ? memos.get(replace) : plain;
    if (!memo) memos.set(replace!, memo = new Map());
    const known = memo.get(key);
    if (known) return known;
    const result = computeEngineWorlds(cell, key, replace ? memoised(replace) : undefined);
    memo.set(key, result);
    return result;
  }
  /** The policy's pick for each (side, slots, options), kept for the decision (one bridge per cell and prelude world asks it). */
  const picks = new WeakMap<ReplacePolicy, ReplacePolicy>();
  function memoised(replace: ReplacePolicy): ReplacePolicy {
    let known = picks.get(replace);
    if (!known) {
      const cache = new Map<string, MonKey[]>();
      known = (side, slots, options) => {
        const id = `${side}|${slots.join(",")}|${options.join(",")}`;
        let pick = cache.get(id);
        if (!pick) cache.set(id, pick = replace(side, slots, options));
        return pick;
      };
      picks.set(replace, known);
    }
    return known;
  }
  function computeEngineWorlds(cell: CellActions, key: string, replace: ReplacePolicy | undefined): EngineWorlds {
    let choices: { p1: string; p2: string };
    try {
      choices = choicesFor(cell, world0);
    } catch (error) {
      if (error instanceof ChoiceBuildError) return { kind: "skip", reasons: [error.message] };
      throw error;
    }
    const refused = refusal(choices);
    if (refused) return { kind: "skip", reasons: [`Belief world 0 rejects this choice: ${refused.replace(/^[w+ choice] /, "")}`] };
    // status2 Step 1 #15 (T2E §4.8.2): the prelude's tied switches, Mega Evolutions and entry handlers and its samples as
    // weighted prelude worlds, each bridged and split on its own (any one rolling out makes the cell a rollout).
    let preludes: { battle: ClonedBattle; weight: number }[] = [{ battle: world0.battle, weight: 1 }];
    let source: "live" | "prelude" = "live";
    if (needsPrelude(cell)) {
      // status2 R-T (T2E §4.8): a replacement asked before the moves (Emergency Exit after entry hazards) is answered by the
      // rollouts' rules: the AI's ReplacePolicy (its first living bench Pokémon without one), the player's healthiest.
      const prelude = runPreludeWorlds(world0.json, choices, seedHex(seedBase, "prelude", key), { aiSide: ai, keys: world0.keys, replace: replace ?? firstOptions });
      spent.preludes += prelude.kind === "stopped" ? prelude.worlds.length : 1;
      if (prelude.kind === "rollout") return { kind: "rollout", reasons: prelude.reasons };
      preludes = prelude.worlds;
      source = "prelude";
    }
    const chosenSwitches = DOUBLES_SLOTS.filter((slot) => (slot.startsWith("own") ? cell.own : cell.opponent)[slot]?.kind === "switch");
    const engine: EngineWorld[] = [];
    for (const prelude of preludes) {
      // status2 R-T: a Pokémon that came in during the prelude for one that left by a replacement (Eject Pack after an
      // entry's Intimidate or a Mega Evolution's) switched in this turn too, and takes no action: its predecessor's queued
      // move was cancelled as it left (pinned sim/battle-actions.ts switchIn, queue.cancelAction).
      const switched = new Set<DoublesSlotId>([...chosenSwitches, ...(source === "prelude" ? cameIn(prelude.battle) : [])]);
      const earlier = earlierOf(prelude.battle, source === "prelude");
      const bridged = bridgeTurn(prelude.battle, cell, { runtime, keys: world0.keys, aiSide: ai, switched, publicOf, earlier, replace });
      if (bridged.kind === "rollout") return bridged;
      const split = splitWorlds(bridged.input, { runtime, slotKeys: bridged.keys, publicOf });
      if (split.kind === "rollout") return split;
      for (const world of split.worlds) engine.push({ weight: prelude.weight * world.weight, input: world.input, keys: bridged.keys, notes: [...bridged.notes, ...world.notes] });
    }
    return { kind: "engine", source, worlds: engine };
  }

  /** status2 R-T: the slots a prelude copy holds a Pokémon in that is not the one world 0 holds there (a replacement it made). */
  function cameIn(battle: ClonedBattle): DoublesSlotId[] {
    return DOUBLES_SLOTS.filter((slot) => {
      const { side, position } = showdownPosition(slot, ai);
      const now = battle[side].active[position], before = world0.battle[side].active[position];
      return !!now && !now.fainted && (!before || keyOfPokemon(now, ai, world0.keys) !== keyOfPokemon(before, ai, world0.keys));
    });
  }

  /**
   * What happened to each active Pokémon earlier this turn before the moves (status2 Step 1 #11, ADDENDUM2 C19): the
   * tracker's public flags (on the battle's first turn the leads' entry lines before |turn|1; nextTurn clears them from turn
   * 2), and after a prelude its copy's flags (cleared before it ran: this turn's switches and Mega Evolutions).
   */
  function earlierOf(battle: ClonedBattle, prelude: boolean): Partial<Record<DoublesSlotId, EarlierThisTurn>> {
    const out: Partial<Record<DoublesSlotId, EarlierThisTurn>> = {};
    for (const slot of DOUBLES_SLOTS) {
      const { side, position } = showdownPosition(slot, ai);
      const mon = battle[side].active[position];
      if (!mon || mon.fainted) continue;
      const flagged = mon as unknown as { statsRaisedThisTurn?: boolean; statsLoweredThisTurn?: boolean; usedItemThisTurn?: boolean };
      const pub = publicOf(keyOfPokemon(mon, ai, world0.keys));
      const shown = pub ? countsOf(pub).thisTurn ?? {} : {};
      const flags: EarlierThisTurn = {
        ...((shown.statsRaised || (prelude && flagged.statsRaisedThisTurn)) ? { statsRaised: true as const } : {}),
        ...((shown.statsLowered || (prelude && flagged.statsLoweredThisTurn)) ? { statsLowered: true as const } : {}),
        ...((shown.usedItem || (prelude && flagged.usedItemThisTurn)) ? { usedItem: true as const } : {}),
      };
      if (Object.keys(flags).length) out[slot] = flags;
    }
    return out;
  }

  function postState(battle: ClonedBattle, world: BeliefBattle, protectedKeys: ReadonlySet<MonKey>): PostState {
    const mons: PostMon[] = [];
    for (const side of [ai, other]) {
      for (const pokemon of battle[side].pokemon) {
        const key = keyOfPokemon(pokemon, ai, world.keys);
        const memberKey = world.keys.keyOf(side, pokemon.name);
        const active = pokemon.side.active.includes(pokemon as never);
        mons.push({
          key, side: side === ai ? "opponent" : "own", slot: active ? slotAt(side, pokemon.position, ai) : null,
          known: side === ai || revealed.has(memberKey),
          build: buildOf(pokemon, runtime),
          hp: [{ hp: pokemon.hp, chance: 1 }], maxHp: pokemon.maxhp,
          volatiles: Object.keys(pokemon.volatiles),
          ...(pokemon.volatiles.perishsong ? { perishCount: Number(pokemon.volatiles.perishsong.duration ?? 0) } : {}),
          ...(pokemon.status === "slp" ? { sleepTurns: Number(pokemon.statusState.time ?? 0) } : {}),
          protected: protectedKeys.has(key),
        });
      }
    }
    const megaUsed = (side: SideID) => inputs.public.sides[side].megaUsed || battle[side].pokemon.some((pokemon) => !!pokemon.species.isMega);
    const wiped = (side: SideID) => (battle[side].pokemon.every((pokemon) => pokemon.fainted) ? 1 : 0);
    return {
      chance: 1, mons, clock: fieldClock(battle, ai),
      megaUsed: { own: megaUsed(other), opponent: megaUsed(ai) },
      wiped: { own: wiped(other), opponent: wiped(ai) },
      endOfTurn: "applied",
    };
  }

  function rollout(cell: CellActions, sample: number, replace: ReplacePolicy): PostState {
    const index = sample % battles.length;
    const world = battles[index];
    let choices: { p1: string; p2: string };
    try {
      choices = choicesFor(cell, world);
    } catch {
      // This world's believed item cannot Mega Evolve, or its bench differs: the same actions without Mega Evolution.
      try { choices = choicesFor({ own: withoutMega(cell.own), opponent: withoutMega(cell.opponent) }, world); }
      catch { choices = { p1: "default", p2: "default" }; approximations.add("A rollout played default choices."); }
    }
    spent.rollouts++;
    const played = runRollout(world.json, choices, seedHex(seedBase, "rollout", sample), { aiSide: ai, keys: world.keys, replace });
    if (played.error) approximations.add("A rollout stopped early.");
    const start = world.battle.log.length;
    const protectedKeys = new Set<MonKey>();
    for (const line of played.battle.log.slice(start)) {
      const match = PROTECT_LINE.exec(line);
      if (!match) continue;
      const mon = played.battle[match[1] as SideID].active["ab".indexOf(match[2])];
      if (mon) protectedKeys.add(keyOfPokemon(mon, ai, world.keys));
    }
    return postState(played.battle, world, protectedKeys);
  }

  let residualCache: Readonly<Record<MonKey, number>> | null = null;
  return {
    view,
    worlds: usedWorlds,
    engineWorlds,
    rollout,
    residual() {
      residualCache ??= runResidual(world0.json, seedHex(seedBase, "residual"), { aiSide: ai, keys: world0.keys });
      return residualCache;
    },
    startInput: () => startInput(world0.battle, { runtime, aiSide: ai }),
    current: () => postState(world0.battle, world0, new Set()),
    get approximations() { return [...approximations]; },
    spent,
  };
}
