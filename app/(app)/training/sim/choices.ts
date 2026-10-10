// JointAction ↔ pinned Showdown choice strings, and every legal joint action of a request (SPEC §7.4). The only path
// from a Training action (yours or the AI's) to the simulator. Pure: no Battle.
import { allyOf, foesOf, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { UNSEEN_MEMBER } from "../model/ai-inputs";
import { slotAt, targetLoc } from "../model/positions";
import type { ShowdownActiveData, ShowdownMoveData, ShowdownRequest, ShowdownSidePokemon, SideID } from "../model/showdown-types";
import type { JointAction, MegaMechanic, SlotAction } from "../model/view-types";

export type MemberKeys = { keyOf(side: SideID, setSpecies: string): string; speciesOf(side: SideID, key: string): string };

/** A JointAction that cannot be written for this request; `message` is a fact ("Garchomp: no action"). */
export class ChoiceBuildError extends Error {
  constructor(message: string) { super(message); this.name = "ChoiceBuildError"; }
}

/** pinned sim/battle-actions.ts:3 CHOOSABLE_TARGETS: a doubles choice names a target only for these. */
export const CHOOSABLE_TARGETS: ReadonlySet<string> = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);
const FIRST_TURN_ONLY: ReadonlySet<string> = new Set(["fakeout", "firstimpression"]);

/** "team 3152": 1-based indices, the first two lead. */
export function teamChoice(order: readonly number[]): string {
  return `team ${order.join("")}`;
}

export const identName = (ident: string) => ident.replace(/^p[1-4][a-d]?: /, "");
export const isFainted = (pokemon: ShowdownSidePokemon | undefined) => !!pokemon && pokemon.condition.endsWith(" fnt");
const megaOf = (active: ShowdownActiveData | null | undefined): MegaMechanic | null =>
  active?.canMegaEvo ? "mega" : active?.canMegaEvoX ? "megax" : active?.canMegaEvoY ? "megay" : null;
const canMega = (active: ShowdownActiveData | null | undefined, mega: MegaMechanic) =>
  mega === "mega" ? !!active?.canMegaEvo : mega === "megax" ? !!active?.canMegaEvoX : !!active?.canMegaEvoY;

function switchIndex(side: SideID, request: ShowdownRequest, keys: MemberKeys, to: string): number {
  if (to === UNSEEN_MEMBER) throw new ChoiceBuildError("An unseen Pokémon cannot be chosen.");
  const index = request.side.pokemon.findIndex((pokemon) => keys.keyOf(side, identName(pokemon.ident)) === to);
  if (index < 0) throw new ChoiceBuildError(`${keys.speciesOf(side, to)} is not on this team.`);
  const pokemon = request.side.pokemon[index];
  if (pokemon.active) throw new ChoiceBuildError(`${identName(pokemon.ident)} is already in battle.`);
  if (isFainted(pokemon)) throw new ChoiceBuildError(`${identName(pokemon.ident)} has fainted.`);
  return index + 1;
}

/**
 * The choice string for `side` (one part per Showdown position, in position order). Engine orientation: when the AI is
 * `aiSide`, its positions 0 and 1 are opponent-right and opponent-left (model/positions.ts). Throws ChoiceBuildError.
 */
export function toChoiceString(side: SideID, action: JointAction, request: ShowdownRequest, keys: MemberKeys, aiSide: "p1" | "p2"): string {
  if ("teamPreview" in request) throw new ChoiceBuildError("Team preview takes a team order.");
  if ("wait" in request) throw new ChoiceBuildError("Nothing to choose.");
  const chosen = new Set<string>();
  const pick = (to: string) => {
    if (chosen.has(to)) throw new ChoiceBuildError(`${keys.speciesOf(side, to)} is chosen for both`);
    chosen.add(to);
    return `switch ${switchIndex(side, request, keys, to)}`;
  };
  if ("forceSwitch" in request) {
    return request.forceSwitch.map((flagged, position) => {
      const slot = slotAt(side, position, aiSide);
      const each = action[slot];
      if (!flagged || !each || each.kind === "pass") return "pass";
      if (each.kind !== "switch") throw new ChoiceBuildError(`${positionName(request, position)}: needs a switch`);
      return pick(each.to);
    }).join(", ");
  }
  let megaUsed = false;
  return request.active.map((active, position) => {
    const pokemon = request.side.pokemon[position];
    if (!active || isFainted(pokemon) || pokemon?.commanding) return "pass";
    const slot = slotAt(side, position, aiSide);
    const each = action[slot];
    const name = positionName(request, position);
    if (!each) throw new ChoiceBuildError(`${name}: no action`);
    if (each.kind === "pass") return "pass";
    if (each.kind === "switch") {
      if (active.trapped) throw new ChoiceBuildError(`${name} is trapped`);
      return pick(each.to);
    }
    const index = active.moves.findIndex((move) => move.id === each.moveId);
    if (index < 0) throw new ChoiceBuildError(`${name} cannot use that move now`);
    const move = active.moves[index];
    let part = `move ${index + 1}`;
    if (move.target && CHOOSABLE_TARGETS.has(move.target)) {
      // adjacentAlly has one possible target in doubles: the ally (Helping Hand, Instruct).
      const target = each.target ?? (move.target === "adjacentAlly" ? allyOf(slot) : null);
      if (!target) throw new ChoiceBuildError(`${move.move}: no target`);
      part += ` ${targetLoc(target, side, aiSide)}`;
    }
    if (each.mega) {
      if (megaUsed) throw new ChoiceBuildError(`${positionName(request, 0)} is Mega Evolving`);
      if (!canMega(active, each.mega)) throw new ChoiceBuildError(`${name} cannot Mega Evolve`);
      megaUsed = true;
      part += ` ${each.mega}`;
    }
    return part;
  }).join(", ");
}

/** The Pokémon at a request position by name ("—" when the request lists none there). */
function positionName(request: ShowdownRequest, position: number): string {
  const pokemon = request.side.pokemon[position];
  return pokemon ? identName(pokemon.ident) : "—";
}

/** Target options for a request move from `slot` (doublesTargetRule's table keyed by the request's target type). */
function targetsFor(move: ShowdownMoveData, slot: DoublesSlotId, present: (slot: DoublesSlotId) => boolean): (DoublesSlotId | null)[] {
  const [left, right] = foesOf(slot);
  const ally = allyOf(slot);
  const live = (list: DoublesSlotId[]) => list.filter(present);
  switch (move.target) {
    case "normal": case "any": { const options = live([left, right, ally]); return options.length ? options : [left]; }
    case "adjacentFoe": { const options = live([left, right]); return options.length ? options : [left]; }
    case "adjacentAllyOrSelf": return live([ally, slot]).length ? live([ally, slot]) : [slot];
    case "adjacentAlly": return [ally];
    default: return [null];
  }
}

export type LegalArgs = {
  side: SideID; aiSide: "p1" | "p2"; request: ShowdownRequest;
  /** Who may be switched in: the side's own request members, or a restricted list (revealed members + UNSEEN_MEMBER). */
  bench: readonly string[];
  /** Per Showdown position: it has not acted since it came in (Fake Out and First Impression work only then). */
  firstTurn: readonly boolean[];
  megaUsed: boolean;
  keys: MemberKeys;
  /** Engine slots holding a living Pokémon (targets); all present when omitted. */
  present?: Partial<Record<DoublesSlotId, boolean>>;
};

/**
 * Every legal JointAction of `request`: moves × living targets, Mega variants (one per side), switches to distinct
 * allowed members (never when trapped; maybeTrapped is allowed), Fake Out / First Impression only on a first turn,
 * passes for fainted or commanding actives and for flagged slots once the living bench is exhausted.
 */
export function legalJointActions(args: LegalArgs): JointAction[] {
  const { side, aiSide, request, keys } = args;
  if ("teamPreview" in request || "wait" in request) return [];
  const present = (slot: DoublesSlotId) => args.present?.[slot] ?? true;
  const allowed = (key: string) => {
    if (key === UNSEEN_MEMBER) return true;
    const pokemon = request.side.pokemon.find((each) => keys.keyOf(side, identName(each.ident)) === key);
    return !!pokemon && !pokemon.active && !isFainted(pokemon);
  };
  const bench = [...new Set(args.bench)].filter(allowed);
  const perPosition: SlotAction[][] = [];
  const slots: DoublesSlotId[] = [];
  if ("forceSwitch" in request) {
    const flagged = request.forceSwitch.filter(Boolean).length;
    const passes = Math.max(0, flagged - bench.filter((key) => key !== UNSEEN_MEMBER).length - (bench.includes(UNSEEN_MEMBER) ? 1 : 0));
    request.forceSwitch.forEach((flag, position) => {
      slots.push(slotAt(side, position, aiSide));
      if (!flag) { perPosition.push([{ kind: "pass" }]); return; }
      const options: SlotAction[] = bench.map((to) => ({ kind: "switch", to }));
      if (passes > 0 || !options.length) options.push({ kind: "pass" });
      perPosition.push(options);
    });
    return combine(slots, perPosition, (joint) => {
      const switches = Object.values(joint).filter((each): each is Extract<SlotAction, { kind: "switch" }> => each?.kind === "switch");
      if (new Set(switches.map((each) => each.to)).size !== switches.length) return false;
      const passesUsed = request.forceSwitch.filter((flag, position) => flag && joint[slotAt(side, position, aiSide)]?.kind === "pass").length;
      return passesUsed <= passes;
    });
  }
  request.active.forEach((active, position) => {
    const slot = slotAt(side, position, aiSide);
    slots.push(slot);
    const pokemon = request.side.pokemon[position];
    if (!active || isFainted(pokemon) || pokemon?.commanding) { perPosition.push([{ kind: "pass" }]); return; }
    const options: SlotAction[] = [];
    const mega = args.megaUsed ? null : megaOf(active);
    for (const move of active.moves) {
      if (move.disabled || move.pp === 0) continue;
      if (FIRST_TURN_ONLY.has(move.id) && !args.firstTurn[position]) continue;
      for (const target of targetsFor(move, slot, present)) {
        options.push({ kind: "move", moveId: move.id, target });
        if (mega) options.push({ kind: "move", moveId: move.id, target, mega });
      }
    }
    if (!options.length && active.moves[0]) {
      // Every listed move disabled: Showdown runs Struggle for "move 1" (sim/side.ts chooseMove, no enabled moves).
      options.push({ kind: "move", moveId: active.moves[0].id, target: null });
    }
    if (!active.trapped) for (const to of bench) options.push({ kind: "switch", to });
    perPosition.push(options);
  });
  return combine(slots, perPosition, (joint) => {
    const values = Object.values(joint);
    if (values.filter((each) => each?.kind === "move" && each.mega).length > 1) return false;
    const switches = values.filter((each): each is Extract<SlotAction, { kind: "switch" }> => each?.kind === "switch");
    return new Set(switches.map((each) => each.to)).size === switches.length;
  });
}

function combine(slots: DoublesSlotId[], options: SlotAction[][], keep: (joint: JointAction) => boolean): JointAction[] {
  let joints: JointAction[] = [{}];
  slots.forEach((slot, i) => {
    const next: JointAction[] = [];
    for (const joint of joints) for (const option of options[i]) next.push({ ...joint, [slot]: option });
    joints = next;
  });
  return joints.filter(keep);
}
