import { allyOf, SLOT_POSITION, type DoublesSlotId, type DoublesTargetRule } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BoardView, JointAction, MegaMechanic, MoveRequest, RequestActive, RequestPokemon, SlotAction, SwitchRequest } from "../model/view-types";
import { capitalize } from "../board/board-format";
import { onlyTarget, requestTargetRule } from "./request-targets";

// Your turn's choices, built from the Showdown request (moves, PP, target type, disabled, trapped, canMegaEvo*) as
// JointActions; the worker writes the choice string (sim/choices.ts toChoiceString). No string building here.

/** Your Showdown positions in request order: position 0 is your left (SHOWDOWN_POSITION). */
export const OWN_SLOTS = ["own-left", "own-right"] as const;
export type OwnSlot = (typeof OWN_SLOTS)[number];

export type MoveOption = {
  id: string; name: string; type: string | null; pp: number | null; maxpp: number | null;
  /** The request's target type. */
  target: string;
  rule: DoublesTargetRule;
  /**
   * A locked move (Recharge, the second turn of a two-turn move, Outrage): its request entry has no target, Showdown
   * keeps the target it already has (PS/sim/pokemon.ts:964-985), and the choice string is "move 1" (sim/choices.ts).
   */
  locked: boolean;
  disabledReason: "No PP" | "Disabled" | null;
};
export type SwitchOption = { key: string; ident: string; name: string; condition: string; disabledReason: string | null };
export type SlotOptions = {
  slot: OwnSlot;
  /** "Aerodactyl (your left)". */
  label: string;
  name: string;
  /** Fainted or commanding: the slot passes (pinned sim/side.ts:1305-1330). */
  passes: boolean;
  moves: MoveOption[];
  switches: SwitchOption[];
  mega: MegaMechanic[];
  trapped: boolean;
};

export type SlotChoice = { kind: "move"; moveId: string } | { kind: "switch"; key: string };
export type SlotSelection = { choice: SlotChoice | null; target: DoublesSlotId | null; mega: MegaMechanic | null };
export const EMPTY_SELECTION: SlotSelection = { choice: null, target: null, mega: null };

export function isFainted(pokemon: Pick<RequestPokemon, "condition"> | undefined) {
  return !!pokemon && /(^| )fnt$/.test(pokemon.condition.trim());
}

/** The board member a request Pokémon is (same Showdown ident; names as a fallback). */
export function memberKeyOf(pokemon: RequestPokemon, board: BoardView): string | null {
  const exact = board.team.own.find((mon) => mon.ident === pokemon.ident);
  if (exact) return exact.key;
  const name = pokemon.ident.replace(/^p[12][ab]?:\s*/, "");
  return board.team.own.find((mon) => mon.ident.replace(/^p[12][ab]?:\s*/, "") === name)?.key ?? null;
}

function positionWords(slot: DoublesSlotId) {
  return SLOT_POSITION[slot];
}

/** The board's name for the Pokémon in one of your positions ("Indeedee-F", not the request's "Indeedee"). */
function nameAt(board: BoardView, slot: DoublesSlotId, pokemon: RequestPokemon | undefined): string {
  const onBoard = board.active[slot]?.name;
  if (onBoard) return onBoard;
  const key = pokemon ? memberKeyOf(pokemon, board) : null;
  return (key && board.team.own.find((mon) => mon.key === key)?.name) || pokemon?.ident.replace(/^p[12][ab]?:\s*/, "") || capitalize(positionWords(slot));
}

/** Who is present (not fainted) at a slot, for target rules. */
export function presentOn(board: BoardView) {
  return (slot: DoublesSlotId) => {
    const mon = board.active[slot];
    return !!mon && !mon.fainted;
  };
}

function benchOf(side: readonly RequestPokemon[], activeCount: number, board: BoardView): SwitchOption[] {
  return side.slice(activeCount).flatMap((pokemon) => {
    if (pokemon.active || isFainted(pokemon)) return [];
    const key = memberKeyOf(pokemon, board);
    if (!key) return [];
    const name = board.team.own.find((mon) => mon.key === key)?.name ?? pokemon.ident.replace(/^p[12][ab]?:\s*/, "");
    return [{ key, ident: pokemon.ident, name, condition: pokemon.condition, disabledReason: null }];
  });
}

export function slotOptions(request: MoveRequest, board: BoardView, index: 0 | 1, runtime: BattleRuntime): SlotOptions {
  const slot = OWN_SLOTS[index];
  const active: RequestActive | null = request.active[index] ?? null;
  const pokemon = request.side[index];
  const name = nameAt(board, slot, pokemon);
  const passes = !active || !pokemon || isFainted(pokemon) || !!pokemon.commanding;
  const present = presentOn(board);
  const moves: MoveOption[] = passes ? [] : (active?.moves ?? []).map((move) => {
    const catalog = runtime.movesById.get(move.id);
    const locked = move.target === undefined;
    const target = move.target ?? catalog?.target ?? "self";
    const noPP = typeof move.pp === "number" && move.pp <= 0;
    return {
      id: move.id, name: move.move || catalog?.name || move.id, type: catalog?.type ?? null,
      pp: move.pp ?? null, maxpp: move.maxpp ?? null, target, locked,
      rule: locked ? { kind: "none", scope: "self" } : requestTargetRule(target, slot, present),
      disabledReason: noPP ? "No PP" : move.disabled ? "Disabled" : null,
    };
  });
  const trapped = !!active?.trapped;
  const switches = passes ? [] : benchOf(request.side, request.active.length, board)
    .map((option) => trapped ? { ...option, disabledReason: "Trapped" } : option);
  const mega: MegaMechanic[] = passes || board.megaUsed.own ? [] : [
    ...(active?.canMegaEvo ? ["mega" as const] : []),
    ...(active?.canMegaEvoX ? ["megax" as const] : []),
    ...(active?.canMegaEvoY ? ["megay" as const] : []),
  ];
  return { slot, label: `${name} (${positionWords(slot)})`, name, passes, moves, switches, mega, trapped };
}

/** The Pokémon a slot's move aims at: the pick for a choose rule (or its only option), the ally for adjacentAlly. */
export function actionTarget(option: MoveOption, picked: DoublesSlotId | null, slot: DoublesSlotId): DoublesSlotId | null {
  if (option.locked) return null;
  if (option.rule.kind === "choose") return picked && option.rule.options.includes(picked) ? picked : onlyTarget(option.rule);
  if (option.target === "adjacentAlly") return option.rule.kind === "auto" && option.rule.hits.length ? allyOf(slot) : null;
  return null;
}

export const MEGA_LABEL: Record<MegaMechanic, string> = { mega: "Mega Evolve", megax: "Mega Evolve X", megay: "Mega Evolve Y" };

/** "{position} is Mega Evolving": the partner already chose Mega Evolution this turn (once per side, sim/side.ts:779-781). */
export function megaBlockedBy(selections: readonly SlotSelection[], index: 0 | 1): string | null {
  const other = selections[index === 0 ? 1 : 0];
  return other?.mega && other.choice?.kind === "move" ? `${capitalize(positionWords(OWN_SLOTS[index === 0 ? 1 : 0]))} is Mega Evolving` : null;
}

/** "Garchomp is chosen for both": two slots switching to one Pokémon. */
export function duplicateSwitch(options: readonly SwitchOption[], keys: readonly (string | null)[]): string | null {
  const picked = keys.filter((key): key is string => !!key);
  const twice = picked.find((key, index) => picked.indexOf(key) !== index);
  if (!twice) return null;
  return `${options.find((option) => option.key === twice)?.name ?? twice} is chosen for both`;
}

export function buildMoveAction(request: MoveRequest, board: BoardView, selections: readonly SlotSelection[], runtime: BattleRuntime): { action: JointAction } | { missing: string[] } {
  const options = [slotOptions(request, board, 0, runtime), slotOptions(request, board, 1, runtime)];
  const action: JointAction = {};
  const missing: string[] = [];
  options.forEach((option, index) => {
    if (index >= request.active.length) return;
    if (option.passes) { action[option.slot] = { kind: "pass" }; return; }
    const selection = selections[index] ?? EMPTY_SELECTION;
    const choice = selection.choice;
    if (!choice) { missing.push(`${option.name}: no action`); return; }
    if (choice.kind === "switch") {
      const target = option.switches.find((each) => each.key === choice.key);
      if (!target || target.disabledReason) { missing.push(`${option.name}: no action`); return; }
      action[option.slot] = { kind: "switch", to: choice.key };
      return;
    }
    const move = option.moves.find((each) => each.id === choice.moveId);
    if (!move || move.disabledReason) { missing.push(`${option.name}: no action`); return; }
    const target = actionTarget(move, selection.target, option.slot);
    if (move.rule.kind === "choose" && !target) { missing.push(`${move.name}: no target`); return; }
    const each: SlotAction = { kind: "move", moveId: move.id, target };
    if (selection.mega && option.mega.includes(selection.mega)) each.mega = selection.mega;
    action[option.slot] = each;
  });
  const switches = OWN_SLOTS.map((slot) => { const each = action[slot]; return each?.kind === "switch" ? each.to : null; });
  const duplicate = duplicateSwitch(options.flatMap((option) => option.switches), switches);
  if (duplicate) missing.push(duplicate);
  const megas = OWN_SLOTS.filter((slot) => { const each = action[slot]; return each?.kind === "move" && !!each.mega; });
  if (megas.length > 1) missing.push(`${capitalize(positionWords(megas[0]))} is Mega Evolving`);
  return missing.length ? { missing } : { action };
}

export type ReplaceSlot = { slot: OwnSlot; index: number; label: string; name: string; flagged: boolean; options: SwitchOption[] };

/** Forced and mid-turn replacements: one per flagged position (pinned sim/side.ts:936, a flagged slot passes once the living bench is used up). */
export function replaceSlots(request: SwitchRequest, board: BoardView): ReplaceSlot[] {
  const bench = benchOf(request.side, request.forceSwitch.length, board);
  return request.forceSwitch.map((flagged, index) => {
    const slot = OWN_SLOTS[index] ?? "own-left";
    const pokemon = request.side[index];
    const name = nameAt(board, slot, pokemon);
    return { slot, index, label: `${name} (${positionWords(slot)})`, name, flagged, options: flagged ? bench : [] };
  });
}

export function buildSwitchAction(request: SwitchRequest, board: BoardView, picks: readonly (string | null)[]): { action: JointAction } | { missing: string[] } {
  const slots = replaceSlots(request, board);
  const bench = slots.find((slot) => slot.flagged)?.options.length ?? 0;
  const action: JointAction = {};
  const missing: string[] = [];
  let flaggedSeen = 0;
  for (const each of slots) {
    if (!each.flagged) { action[each.slot] = { kind: "pass" }; continue; }
    flaggedSeen += 1;
    // More flagged slots than living bench members: the extra ones pass.
    if (flaggedSeen > bench) { action[each.slot] = { kind: "pass" }; continue; }
    const pick = picks[each.index] ?? null;
    if (!pick || !each.options.some((option) => option.key === pick)) { missing.push(`${each.name}: no action`); continue; }
    action[each.slot] = { kind: "switch", to: pick };
  }
  const duplicate = duplicateSwitch(slots.flatMap((slot) => slot.options), slots.map((slot) => {
    const each = action[slot.slot];
    return each?.kind === "switch" ? each.to : null;
  }));
  if (duplicate) missing.push(duplicate);
  return missing.length ? { missing } : { action };
}
