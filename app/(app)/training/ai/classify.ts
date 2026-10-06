// SPEC 10.9 situation features and action classes of one slot (the habit model's vocabulary; candidates fill SlotContext with
// them). Pure functions of the AiView and its rows.
import { allyOf, foesOf, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiView, MonView } from "../model/ai-view";
import type { ActionClass, SituationFeatures, TargetClass } from "../model/decision";
import type { SlotAction } from "../model/view-types";
import { isProtectMove } from "./battle-facts";
import { SPREAD_TARGETS, threatFrom, type RowTable } from "./rows";

/** SPEC 10.9 speed-control and support moves. */
export const SPEED_CONTROL: ReadonlySet<string> = new Set(["tailwind", "trickroom", "icywind", "electroweb", "thunderwave", "rocktomb", "bulldoze", "scaryface", "stringshot"]);
export const SUPPORT: ReadonlySet<string> = new Set(["helpinghand", "followme", "ragepowder", "reflect", "lightscreen", "auroraveil", "wideguard", "quickguard"]);

export const monInSlot = (view: AiView, slot: DoublesSlotId): MonView | null => view.mons.find((mon) => mon.slot === slot && !mon.fainted) ?? null;

/** hp high > 66% shown, low < 33%, else mid; threatened: a foe's best fraction into it ≥ 0.5; protectedLast: its last move protected. */
export function situationFeatures(view: AiView, rows: RowTable, slot: DoublesSlotId): SituationFeatures {
  const mon = monInSlot(view, slot);
  if (!mon) return { hp: "high", threatened: false, protectedLast: false };
  const percent = 100 * mon.hp / Math.max(1, mon.maxHp);
  const threatened = foesOf(slot).some((foe) => {
    const other = monInSlot(view, foe);
    return !!other && (rows.best(other.key, mon.key)?.fraction ?? 0) >= 0.5;
  });
  return { hp: percent > 66 ? "high" : percent < 33 ? "low" : "mid", threatened, protectedLast: !!mon.lastMove && isProtectMove(mon.lastMove) };
}

type Scorer = (slot: DoublesSlotId, action: Extract<SlotAction, { kind: "move" }>) => number;

/**
 * The class of one slot action (SPEC 10.9), first that applies: switch; protect; fake-out; speed-control; support; for a
 * damaging move attack-ko (a target's KO chance ≥ 0.5), attack-best (the slot's highest-prior damaging option, by `score`),
 * attack-spread, attack-other; else status-other. Target class: threat (the foe whose threat to the slot's side is higher),
 * weak (the foe with the lower HP share), else other; null without a chosen foe target.
 */
export function classifySlotAction(view: AiView, rows: RowTable, slot: DoublesSlotId, action: SlotAction, runtime: BattleRuntime,
  options: { worth?: Record<string, number>; score?: Scorer; legal?: readonly SlotAction[] } = {}): { cls: ActionClass; target: TargetClass | null } {
  if (action.kind === "switch") return { cls: "switch", target: null };
  if (action.kind === "pass") return { cls: "status-other", target: null };
  const mon = monInSlot(view, slot);
  const move = runtime.movesById.get(action.moveId);
  const target = targetClass(view, rows, slot, action.target, runtime, options.worth);
  if (!mon || !move) return { cls: "status-other", target };
  if (isProtectMove(move.id)) return { cls: "protect", target: null };
  if (move.id === "fakeout") return { cls: "fake-out", target };
  if (SPEED_CONTROL.has(move.id)) return { cls: "speed-control", target };
  if (SUPPORT.has(move.id)) return { cls: "support", target };
  if (move.category === "Status") return { cls: "status-other", target };
  const targets = action.target ? [action.target] : foesOf(slot);
  const ko = targets.some((each) => {
    const foe = monInSlot(view, each);
    return !!foe && foe.side !== mon.side && (rows.get(mon.key, foe.key, move.id)?.koChance ?? 0) >= 0.5;
  });
  if (ko) return { cls: "attack-ko", target };
  if (options.score && options.legal) {
    const damaging = options.legal.filter((each): each is Extract<SlotAction, { kind: "move" }> => each.kind === "move" && runtime.movesById.get(each.moveId)?.category !== "Status");
    const mine = options.score(slot, action);
    if (damaging.length && damaging.every((each) => options.score!(slot, each) <= mine + 1e-12)) return { cls: "attack-best", target };
  }
  if (SPREAD_TARGETS.has(move.target)) return { cls: "attack-spread", target };
  return { cls: "attack-other", target };
}

function targetClass(view: AiView, rows: RowTable, slot: DoublesSlotId, target: DoublesSlotId | null, runtime: BattleRuntime, worth: Record<string, number> = {}): TargetClass | null {
  if (!target || target === slot || target === allyOf(slot)) return null;
  const foes = foesOf(slot).map((each) => monInSlot(view, each)).filter((mon): mon is MonView => !!mon);
  const chosen = monInSlot(view, target);
  if (!chosen || foes.length < 2) return chosen ? "threat" : null;
  const [a, b] = foes;
  const threatA = threatFrom(view, rows, worth, a.key, runtime), threatB = threatFrom(view, rows, worth, b.key, runtime);
  if (threatA !== threatB && chosen.key === (threatA > threatB ? a.key : b.key)) return "threat";
  const share = (mon: MonView) => mon.hp / Math.max(1, mon.maxHp);
  if (share(a) !== share(b) && chosen.key === (share(a) < share(b) ? a.key : b.key)) return "weak";
  return "other";
}
