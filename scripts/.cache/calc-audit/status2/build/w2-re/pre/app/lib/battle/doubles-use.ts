import { DOUBLES_SLOTS, sideCanSwitch, slotSide, type DoublesSideId, type DoublesSlotId } from "./doubles-types";
import type { EotState, MoveVolatiles, PendingAction, Stage, World } from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { statusEntry, type StatusEntry } from "./status-table";
import type { BattleGame, ChampionsMove, CombatStat } from "./types";

// The status-move use and the small helpers the status pipeline (doubles-status.ts) and its hook modules share (status2
// Step 0a): moved verbatim out of doubles-status.ts so that the hook modules (doubles-stages.ts, doubles-calling.ts...) need
// not import it (no import cycles). Frozen with the kernel after Step 1: only the integrator edits it.

export const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
export const STAGE_NAMES: Record<Stage, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion" };
/** U+2212 for a lowered stage, + for a raised one ("−2 Attack.", "+1 Speed."). */
export const signed = (amount: number) => (amount < 0 ? `−${-amount}` : `+${amount}`);
export const stageFact = (stat: Stage, amount: number) => `${signed(amount)} ${STAGE_NAMES[stat]}.`;

/** A BeforeMove check's result (doubles-status.ts beforeMove): the worlds that go on to the move, and those whose action ends there. */
export type Gate = { go: World[]; stopped: World[] };

/** The moves-phase volatiles this file writes (doubles-world.ts MoveVolatiles, Encore's move included). cloneMon copies them. */
export type Vol = MoveVolatiles;
export const setVol = (w: World, slot: DoublesSlotId, change: Partial<Vol>) => {
  const mon = w.mons[slot]!;
  const next = { ...mon.vol, ...change } as Vol;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete (next as Record<string, unknown>)[key];
  mon.vol = next as MoveVolatiles;
};
export const setEot = (w: World, slot: DoublesSlotId, change: Partial<EotState>) => {
  const mon = w.mons[slot]!;
  const next = { ...mon.eot, ...change } as Record<string, unknown>;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete next[key];
  mon.eot = next as EotState;
};
export const gameOf = (kernel: TurnKernel) => kernel.runtime.profile.id as BattleGame;
/** The mechanics' generation: Champions (profile generation 0) is generation 9's (data/mods/champions inherits gen9). */
export const generation = (kernel: TurnKernel) => (kernel.champions ? 9 : kernel.runtime.profile.generation);
/** The move's status-table entry in this game (undefined: not a catalog Status move here). */
export function tableEntry(kernel: TurnKernel, moveId: string): StatusEntry | undefined {
  return statusEntry(moveId, gameOf(kernel));
}

/** The prior of a sleep's length S (its startTime): data/conditions.ts slp random(2, 5); Champions sample([2, 3, 3]); Rest 3. */
export function sleepPrior(champions: boolean, rest: boolean): [number, number][] {
  if (rest) return [[3, 1]];
  return champions ? [[2, 1 / 3], [3, 2 / 3]] : [[2, 1 / 3], [3, 1 / 3], [4, 1 / 3]];
}
/** The chance a sleeper wakes at this BeforeMove: P(e < S ≤ e + d) / P(S > e), e its counter's decrease so far, d 2 with Early Bird. */
export function wakeChance(champions: boolean, rest: boolean, elapsed: number, step: number): number {
  let alive = 0, wakes = 0;
  for (const [length, chance] of sleepPrior(champions, rest)) {
    if (length <= elapsed) continue;
    alive += chance;
    if (length <= elapsed + step) wakes += chance;
  }
  return alive > 0 ? (wakes === alive ? 1 : wakes / alive) : 1;
}
/** The expected sleep counter left, E[ceil((S − e) / d) | S > e] (DoublesOutcomeMon.sleepTurns). */
export function sleepTurnsLeft(champions: boolean, rest: boolean, elapsed: number, step: number): number {
  let alive = 0, sum = 0;
  for (const [length, chance] of sleepPrior(champions, rest)) {
    if (length <= elapsed) continue;
    alive += chance;
    sum += chance * Math.ceil((length - elapsed) / step);
  }
  return alive > 0 ? sum / alive : 0;
}
/** Confusion's snap-out chance at its attempt-th BeforeMove: P(T = a) / P(T ≥ a), T uniform on min..5 (data/conditions.ts confusion random(min, 6)). */
export function snapChance(attempt: number, min: 2 | 3): number {
  if (attempt < min) return 0;
  if (attempt >= 5) return 1;
  return 1 / (5 - attempt + 1);
}

/** One use of a status move: who uses it, its data in this game, its type and priority as used. */
export type Use = {
  /** The action the step statistics record it under (a bounced move's: the original action's). */
  action: PendingAction;
  user: DoublesSlotId;
  move: ChampionsMove;
  entry: StatusEntry;
  info: TurnMoveInfo;
  /** The move's type after ModifyType (Normalize, Liquid Voice, the -ate abilities). */
  type: string;
  /** move.priority (Prankster's +1, Triage's +3 included): Quick Guard, Psychic Terrain and the priority shields read it. */
  priority: number;
  /** pranksterBoosted (sim/battle-actions.ts hitStepTryImmunity): Prankster raised it; never for a bounced move. */
  prankster: boolean;
  bounced: boolean;
  /** Infiltrator (move.infiltrates): it passes Substitute, and a foe's Safeguard. */
  infiltrates: boolean;
  /** The target type it is used with (Curse's: the user's, or a random foe's). */
  targetType: string;
  /** The Pokémon it reached (its hit entries); a fact on another (its user, by Mirror Armor or Synchronize) is a step fact. */
  reached: Set<DoublesSlotId>;
  /** status2 A3 (Snatch): the use was stolen by its user (`user`) from the action's own Pokémon. Absent: not snatched. */
  snatched?: true;
};

/**
 * A status move's own handler from a family module (status2 SPEC2 §3.5: doubles-abilities.ts, doubles-typing.ts and
 * doubles-field.ts export `HANDLERS`, keyed by the table's `handler`; doubles-status.ts dispatches to them at its own steps).
 * Each part is optional; a part that returns null (moveTry, tryImmunity) leaves today's code to run. Step 0 registers none.
 */
export type StatusHandler = {
  /** The move's own Try and its TryHit on the user (doubles-status.ts moveTry), split where it reads HP; null: today's checks. */
  moveTry?: (kernel: TurnKernel, w: World, use: Use, targets: DoublesSlotId[]) => { world: World; ok: boolean }[] | null;
  /** The move's single-target TryHit on `slot` (doubles-status.ts hitOne): the failure's text after "{Move} fails: ", or null. */
  tryHit?: (kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) => string | null;
  /** TryImmunity (doubles-status.ts tryImmunity): false when `slot` is immune (its fact written), true when it passes, null: today's checks. */
  tryImmunity?: (kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) => boolean | null;
  /** The move's volatile on `slot` (doubles-status.ts volatile): whether it was added. */
  volatile?: (kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) => boolean;
  /** The move's onHit on `slot` (doubles-status.ts onHit). */
  onHit?: (kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) => World[];
  /** A side or field move's own effect (doubles-status.ts sideOrField). */
  sideOrField?: (kernel: TurnKernel, w: World, use: Use) => World[];
};

/** A fact on `slot`: on its hit entry where the use reached it, otherwise a step fact naming it (aboutSlot). */
export const hitFact = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, text: string, w: World) => {
  if (use.reached.has(slot)) kernel.hitFact(use.action, slot, text, w.mass);
  else kernel.stepFact(use.action, aboutSlot(kernel.names[slot], text), w.mass);
};
/** A hit fact as a step fact about `name`: "Is paralysed." → "Clefable is paralysed.", "Its Attack cannot go lower." → "Clefable's Attack cannot go lower.", "Defiant: +2 Attack." → "Kingambit's Defiant: +2 Attack.", "−2 Attack." → "Clefable: −2 Attack.". */
export function aboutSlot(name: string, text: string): string {
  if (text.startsWith("Is ")) return `${name} is ${text.slice(3)}`;
  if (text.startsWith("Its ")) return `${name}'s ${text.slice(4)}`;
  const source = /^([^:]+): (.*)$/.exec(text);
  return source ? `${name}'s ${source[1]}: ${source[2]}` : `${name}: ${text}`;
}
/**
 * Whether the user's Mold Breaker passes `holder`'s breakable ability (its own never, from generation 8: sim/battle.ts
 * suppressingAbility), or its Mycelium Might on a status move (data/abilities.ts myceliummight onModifyMove: ignoreAbility),
 * but not through an Ability Shield that works (suppressingAbility: hasItem, not under Magic Room).
 */
export const breaks = (kernel: TurnKernel, w: World, use: Use, holder: DoublesSlotId) => {
  if (holder === use.user) return false;
  if (kernel.breaks(w, use.user, holder, use.info)) return true;
  const shielded = w.mons[holder]!.build.itemId === "abilityshield" && !w.field.magicRoom;
  return use.move.category === "Status" && w.mons[use.user]!.build.abilityId === "myceliummight" && !shielded;
};

/** Whether `side` has a Pokémon left to switch in (DoublesTurnInput.canSwitch, or status2 R's bench where given: sideCanSwitch; absent: true, with a turn fact). */
export function canSwitch(kernel: TurnKernel, side: DoublesSideId): boolean {
  const given = sideCanSwitch(kernel.input, side);
  if (given !== undefined) return given;
  if (DOUBLES_SLOTS.some((slot) => slotSide(slot) === side && !kernel.input.pokemon[slot])) return false;
  kernel.turnFact(`Assumes ${side === "own" ? "your side" : "the opponent's side"} has a Pokémon left to switch in.`);
  return true;
}
