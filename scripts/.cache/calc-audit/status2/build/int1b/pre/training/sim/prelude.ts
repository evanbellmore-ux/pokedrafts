// The start of a turn on a reseeded copy of a belief battle (SPEC §9.4, C2): Showdown runs switches, entry abilities and
// items, hazards and Mega Evolution exactly, and the copy stops at its first action of order ≥ 200 (moves; pinned
// sim/battle-queue.ts:174-195), so the bridge reads the field the moves will see. Prototype: design probe/prelude-probe.ts.
//
// status2 Step 1 #15 (T2E §4.8.2, finding 2): the prelude's own random events are enumerated, each prelude world with its
// weight: the speedSort shuffles of the actions before the first move (switches 103, Mega Evolutions 104) and of the
// SwitchIn handlers (entry abilities and items at one Speed), each order at 1/k!; `sample` (Trace's copy, Forewarn's pick)
// 1/n. Not branched: the queue's move actions (the engine sorts and branches them itself); getRandomTarget's sample while
// the queue resolves an action or reads its Speed (a target for a spread or random-target move, picked again when it runs);
// an eachEvent's tie (Update, BeforeTurn, WeatherChange...) among Pokémon of which at most one has a handler for that event
// (pinned sim/battle.ts eachEvent, findEventHandlers: the order of no-ops cannot matter). Quick Claw's and Quick Draw's
// rolls at queue time are answered false (the engine's fractionalOutcomes branches them); any other random draw before the
// moves is a rollout. At most PRELUDE_WORLDS_BOUND worlds per cell, above it the old text. The per-turn flags
// (statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn) are cleared on the copy first (status2 Step 1 #11, C19: a
// belief battle's are not this turn's), so after the prelude they are what this turn's switches and Mega Evolutions did.
import { PRNG, State, type BattleAction, type ClonedBattle, type PRNGSeed } from "./sim";

const STOP = { stop: "prelude" } as const;

export type PreludeWorld = { battle: ClonedBattle; weight: number };
export type PreludeResult = { kind: "stopped"; worlds: PreludeWorld[] } | { kind: "rollout"; reasons: string[] };
/** At most this many weighted prelude worlds per cell (three or four tied switches with entry effects go above it). */
export const PRELUDE_WORLDS_BOUND = 8;
/** The randomChance effects answered false at queue time (the engine's fractionalOutcomes branches them). */
const QUEUE_CHANCES: ReadonlySet<string> = new Set(["quickclaw", "quickdraw"]);

class RandomDraw extends Error {
  constructor(readonly kind: string) { super(`random ${kind} before the moves`); }
}

/** A decision-prefix chooser over uniform picks (status2/design/guards-sim.ts's Chooser, uniform only). */
class Chooser {
  trail: number[] = [];
  sizes: number[] = [];
  weight = 1;
  constructor(readonly prefix: readonly number[]) {}
  pick(n: number): number {
    if (n <= 1) return 0;
    const depth = this.trail.length;
    const i = depth < this.prefix.length ? this.prefix[depth] : 0;
    this.trail.push(i);
    this.sizes.push(n);
    this.weight /= n;
    return i;
  }
  next(): number[] | null {
    for (let j = this.trail.length - 1; j >= 0; j--) if (this.trail[j] + 1 < this.sizes[j]) return [...this.trail.slice(0, j), this.trail[j] + 1];
    return null;
  }
}

function factorial(k: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}
/** The idx-th permutation (Lehmer code) of list[start..end). */
function permute(list: unknown[], start: number, end: number, idx: number) {
  const pool = list.slice(start, end);
  const out: unknown[] = [];
  for (let k = pool.length; k > 0; k--) {
    const f = factorial(k - 1);
    const j = Math.floor(idx / f);
    idx %= f;
    out.push(pool.splice(j, 1)[0]);
  }
  list.splice(start, end - start, ...out);
}
const isMoveAction = (item: unknown) => !!item && typeof item === "object" && "choice" in item && Number((item as { order?: number }).order ?? 0) >= 200;
const isPokemon = (item: unknown) => !!item && typeof item === "object" && "species" in item && "side" in item;

/** One run of the prelude under `ch`'s choices: the stopped copy, or a rollout. */
function runOnce(json: string, choices: { p1: string; p2: string }, seed: string, ch: Chooser): { kind: "stopped"; battle: ClonedBattle } | { kind: "rollout"; reasons: string[] } {
  const clone = State.deserializeBattle(json);
  clone.restart(() => {});
  clone.prng = new PRNG(`sodium,${seed}` as PRNGSeed);
  const prng = clone.prng as unknown as { shuffle: (list: unknown[], start?: number, end?: number) => void };
  const events = clone as unknown as { eachEvent: (id: string, ...rest: unknown[]) => unknown; findEventHandlers: (target: unknown, id: string) => unknown[] };
  // The eachEvent running now (its speedSort of the active Pokémon is the shuffle of Pokémon below).
  const eachIds: string[] = [];
  const eachEvent = events.eachEvent.bind(clone);
  events.eachEvent = (id: string, ...rest: unknown[]) => {
    eachIds.push(id);
    try { return eachEvent(id, ...rest); } finally { eachIds.pop(); }
  };
  prng.shuffle = (list: unknown[], start = 0, end = list.length) => {
    const k = end - start;
    const tied = list.slice(start, end);
    if (k < 2 || tied.every(isMoveAction)) return;
    const id = eachIds[eachIds.length - 1];
    if (id && tied.every(isPokemon) && tied.filter((mon) => events.findEventHandlers(mon, id).length > 0).length <= 1) return;
    permute(list, start, end, ch.pick(factorial(k)));
  };
  const battle = clone as unknown as {
    sample: (items: readonly unknown[]) => unknown; random: (m?: number, n?: number) => number; randomChance: (n: number, d: number) => boolean;
    effect?: { id?: string } | null;
  };
  // A sample while the queue resolves an action or reads an action's Speed (getActionSpeed after a Mega Evolution) is
  // getRandomTarget's pick of a target for a move without a chosen one (a spread move, or a random-target move, which pinned
  // sim/battle.ts getTarget picks again when it runs): no prelude effect reads it, so it is not branched (and draws nothing).
  let resolving = 0;
  const during = <T extends (...args: never[]) => unknown>(f: T) => ((...args: Parameters<T>) => {
    resolving++;
    try { return f(...args); } finally { resolving--; }
  }) as T;
  const queue = (clone as unknown as { queue: { resolveAction: (...args: unknown[]) => unknown } }).queue;
  queue.resolveAction = during(queue.resolveAction.bind(queue));
  const speeds = clone as unknown as { getActionSpeed: (...args: unknown[]) => unknown };
  speeds.getActionSpeed = during(speeds.getActionSpeed.bind(clone));
  battle.sample = (items) => items[resolving ? 0 : ch.pick(items.length)];
  battle.random = () => { throw new RandomDraw("draw"); };
  battle.randomChance = (n, d) => {
    if (n <= 0) return false;
    if (n >= d) return true;
    if (QUEUE_CHANCES.has(String(battle.effect?.id ?? ""))) return false;
    throw new RandomDraw("chance");
  };
  // This turn's flags only (C19).
  for (const side of [clone.p1, clone.p2]) {
    for (const mon of side.pokemon) Object.assign(mon, { statsRaisedThisTurn: false, statsLoweredThisTurn: false, usedItemThisTurn: false, hurtThisTurn: null });
  }
  const runAction = clone.runAction.bind(clone);
  clone.runAction = (action: BattleAction) => {
    if (action.order >= 200) throw STOP;
    runAction(action);
  };
  try {
    clone.makeChoices(choices.p1, choices.p2);
  } catch (error) {
    clone.runAction = runAction;
    if (error === STOP) return { kind: "stopped", battle: clone };
    return { kind: "rollout", reasons: [`Prelude failed: ${String((error as Error)?.message ?? error).slice(0, 80)}`] };
  }
  // No move was reached: the turn ended (all switches) or a replacement is asked mid-turn (Eject Pack, Emergency Exit).
  clone.runAction = runAction;
  return { kind: "rollout", reasons: [clone.ended ? "The battle ended before the moves." : "A replacement is needed before the moves."] };
}

/** Every prelude world of the cell (status2 Step 1 #15), each with its weight (summing to 1), or a rollout. */
export function runPreludeWorlds(json: string, choices: { p1: string; p2: string }, seed: string): PreludeResult {
  const worlds: PreludeWorld[] = [];
  let prefix: number[] | null = [];
  while (prefix) {
    const ch: Chooser = new Chooser(prefix);
    const run = runOnce(json, choices, seed, ch);
    if (run.kind === "rollout") return run;
    worlds.push({ battle: run.battle, weight: ch.weight });
    if (worlds.length > PRELUDE_WORLDS_BOUND) return { kind: "rollout", reasons: ["Speed tie between switches with an entry effect."] };
    prefix = ch.next();
  }
  return { kind: "stopped", worlds };
}
