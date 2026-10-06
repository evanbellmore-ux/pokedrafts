// SPEC 10.12 the read: one fact sentence about what the AI predicted and did, and (addendum A1.5) one fact about its Mega
// Evolution this turn. Facts only: names, moves and chances from the decision; no advice. worker/redact-report.ts removes
// whatever would show you a closed fact before it leaves the worker.
import { turnPriority, turnSpeed } from "@/app/lib/battle/calculate";
import { chanceText } from "@/app/lib/battle/chance";
import { DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import { UNSEEN_MEMBER } from "../model/ai-inputs";
import type { AiView, MonKey, MonView } from "../model/ai-view";
import type { DecisionOption, JointAction, MegaFact, ReadFact, ReadRefs, SlotAction } from "../model/view-types";
import { megaSlots } from "../model/view-types";
import { isProtectMove, typeEffectiveness } from "./battle-facts";
import { monInSlot } from "./classify";
import { fieldOfAbility, isGroundedBuild, type FieldSetting } from "./field-favor";
import type { MegaOutlook } from "./mega";
import { calcBuild, SPREAD_TARGETS, type RowTable } from "./rows";

/** Rule thresholds (SPEC 10.12). */
export const READ = { switched: 0.4, protectedShare: 0.5, noProtect: 0.15, top: 0.25 } as const;
/** A1.5: a KO chance change below this is "no change" for the Mega facts. */
const KO_CHANGE = 0.05;

export type ReadArgs = {
  view: AiView; rows: RowTable;
  /** The player's predicted joint actions (q), most likely first. */
  q: readonly DecisionOption[];
  /** The AI's played joint action. */
  chosen: JointAction;
  names: (key: MonKey) => string;
  runtime: BattleRuntime;
};

const keyOfSlot = (view: AiView, slot: DoublesSlotId) => monInSlot(view, slot)?.key ?? null;
const moveName = (runtime: BattleRuntime, moveId: string) => runtime.movesById.get(moveId)?.name ?? moveId;

/** The player's damaging moves in `action` that reach `target` (aimed at it, or a spread or random move with it in range). */
function movesInto(view: AiView, action: JointAction, target: DoublesSlotId, runtime: BattleRuntime): { slot: DoublesSlotId; moveId: string }[] {
  const out: { slot: DoublesSlotId; moveId: string }[] = [];
  for (const slot of DOUBLES_SLOTS) {
    const each = action[slot];
    if (each?.kind !== "move" || slotSide(slot) === slotSide(target)) continue;
    const move = runtime.movesById.get(each.moveId);
    if (!move || move.category === "Status") continue;
    const reaches = each.target === target || SPREAD_TARGETS.has(move.target) || move.target === "randomNormal"
      || (!each.target && foesOf(slot).filter((foe) => monInSlot(view, foe)).length === 1 && foesOf(slot).includes(target));
    if (reaches) out.push({ slot, moveId: each.moveId });
  }
  return out;
}
/** The most likely damaging move into `target` under q, with the chance that any reaches it. */
function threatInto(view: AiView, q: readonly DecisionOption[], target: DoublesSlotId, runtime: BattleRuntime) {
  const byMove = new Map<string, number>();
  let any = 0;
  for (const option of q) {
    if (!option.action) continue;
    const hits = movesInto(view, option.action, target, runtime);
    if (!hits.length) continue;
    any += option.chance;
    for (const moveId of new Set(hits.map((hit) => hit.moveId))) byMove.set(moveId, (byMove.get(moveId) ?? 0) + option.chance);
  }
  const top = [...byMove].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return top ? { moveId: top[0], chance: top[1], any } : null;
}

/** One slot's action as read text: "Earthquake", "Moonblast into Garchomp", "Helping Hand on Charizard", "Garchomp to Incineroar". */
function slotText(view: AiView, slot: DoublesSlotId, action: SlotAction, args: ReadArgs): string | null {
  const mon = monInSlot(view, slot);
  if (action.kind === "pass" || !mon) return null;
  if (action.kind === "switch") {
    const incoming = action.to === UNSEEN_MEMBER ? null : view.mons.find((each) => each.side === mon.side && each.memberKey === action.to);
    return `${args.names(mon.key)} to ${incoming ? args.names(incoming.key) : "an unseen Pokémon"}`;
  }
  const name = moveName(args.runtime, action.moveId);
  const target = action.target ? monInSlot(view, action.target) : null;
  if (!target || target.key === mon.key) return name;
  return target.side === mon.side ? `${name} on ${args.names(target.key)}` : `${name} into ${args.names(target.key)}`;
}

const noRefs = (): ReadRefs => ({ inSlot: [], incoming: [], moves: [], stats: false });

/** The AI's members a slot text names as standing in a slot (your moves into its Pokémon). */
function aiTargetsOf(view: AiView, action: JointAction): ReadRefs["inSlot"] {
  const out: ReadRefs["inSlot"] = [];
  for (const slot of DOUBLES_SLOTS) {
    const each = action[slot];
    if (each?.kind !== "move" || !each.target || slotSide(each.target) !== "opponent") continue;
    const target = monInSlot(view, each.target);
    if (target) out.push({ memberKey: target.memberKey, slot: each.target });
  }
  return out;
}

/**
 * SPEC 10.12: every rule that applies, in rule order; the read states the first. Each sentence carries the AI's members
 * and moves it names (worker/redact-report.ts states the first one that shows you no closed fact). The chance next to a
 * named move is that move's own chance of reaching the slot.
 */
export function readFacts(args: ReadArgs): ReadFact[] {
  const { view, q, chosen, runtime, names } = args;
  const facts: ReadFact[] = [];
  const aiSlots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === "opponent");
  // 1. A switch out of a slot your moves were predicted to hit.
  for (const slot of aiSlots) {
    const action = chosen[slot];
    const mon = monInSlot(view, slot);
    if (action?.kind !== "switch" || !mon) continue;
    const threat = threatInto(view, q, slot, runtime);
    if (!threat || threat.any < READ.switched) continue;
    const incoming = view.mons.find((each) => each.side === "opponent" && each.memberKey === action.to);
    facts.push({
      text: `Predicted ${moveName(runtime, threat.moveId)} into ${names(mon.key)} (${chanceText(threat.chance)}), so it switched to ${incoming ? names(incoming.key) : action.to}.`,
      refs: { ...noRefs(), inSlot: [{ memberKey: mon.memberKey, slot }], incoming: [action.to] },
    });
  }
  // 2. A protect where the expected damage into it was at least half its HP.
  for (const slot of aiSlots) {
    const action = chosen[slot];
    const mon = monInSlot(view, slot);
    if (action?.kind !== "move" || !isProtectMove(action.moveId) || !mon) continue;
    let expected = 0;
    for (const option of q) {
      if (!option.action) continue;
      for (const hit of movesInto(view, option.action, slot, runtime)) {
        const attacker = keyOfSlot(view, hit.slot);
        const row = attacker ? args.rows.get(attacker, mon.key, hit.moveId) : null;
        expected += option.chance * (row?.mean ?? 0);
      }
    }
    const threat = threatInto(view, q, slot, runtime);
    if (threat && expected >= READ.protectedShare * Math.max(1, mon.hp)) {
      facts.push({
        text: `Predicted ${moveName(runtime, threat.moveId)} into ${names(mon.key)} (${chanceText(threat.chance)}), so ${names(mon.key)} protected.`,
        refs: { ...noRefs(), inSlot: [{ memberKey: mon.memberKey, slot }], moves: [{ memberKey: mon.memberKey, moveId: action.moveId }] },
      });
    }
  }
  // 3. An attack into one of yours that can Protect, predicted not to.
  for (const slot of aiSlots) {
    const action = chosen[slot];
    if (action?.kind !== "move" || !action.target || slotSide(action.target) !== "own") continue;
    const move = runtime.movesById.get(action.moveId);
    const target = monInSlot(view, action.target);
    const user = monInSlot(view, slot);
    if (!move || move.category === "Status" || !target || !user || !target.moves.some(isProtectMove)) continue;
    const protects = q.reduce((sum, option) => {
      const each = option.action?.[action.target!];
      return sum + (each?.kind === "move" && isProtectMove(each.moveId) ? option.chance : 0);
    }, 0);
    if (protects <= READ.noProtect) {
      facts.push({
        text: `Predicted no Protect from ${names(target.key)} (${chanceText(1 - protects)}).`,
        refs: { ...noRefs(), inSlot: [{ memberKey: user.memberKey, slot }], moves: [{ memberKey: user.memberKey, moveId: action.moveId }] },
      });
    }
  }
  // 4. The top prediction.
  const top = q[0];
  if (top?.action && top.chance >= READ.top) {
    const parts = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === "own").map((slot) => top.action![slot] ? slotText(view, slot, top.action![slot]!, args) : null)
      .filter((part): part is string => !!part);
    if (parts.length) facts.push({ text: `Predicted ${parts.join(" and ")} (${chanceText(top.chance)}).`, refs: { ...noRefs(), inSlot: aiTargetsOf(view, top.action) } });
  }
  return facts;
}

/** SPEC 10.12: the first rule that applies, else null. */
export function readReason(args: ReadArgs): string | null {
  return readFacts(args)[0]?.text ?? null;
}

// ---------- A1.5 Mega facts ----------
export type MegaFactArgs = ReadArgs & {
  mega: MegaOutlook;
  /** The field Showdown's prelude left before the moves for a Mega option of `slot` (belief world 0), when the cell ran one. */
  preludeField?: (slot: DoublesSlotId) => Pick<AiView["field"], "weather" | "terrain"> | null;
};

/** +1 when the setting powers a move of `type` from `user`, −1 when it weakens it (PS/data/conditions.ts sunnyday/raindance onWeatherModifyDamage; terrains onBasePower), else 0. */
export function moveFavor(type: string, setting: FieldSetting, user: BattleBuild, runtime: BattleRuntime): number {
  const weather = setting.weather === "Harsh Sunshine" ? "Sun" : setting.weather === "Heavy Rain" ? "Rain" : setting.weather ?? "";
  if (weather === "Sun") return type === "Fire" ? 1 : type === "Water" ? -1 : 0;
  if (weather === "Rain") return type === "Water" ? 1 : type === "Fire" ? -1 : 0;
  const terrain = setting.terrain ?? "";
  if (!terrain || !isGroundedBuild(user, runtime)) return 0;
  if ((terrain === "Electric" && type === "Electric") || (terrain === "Grassy" && type === "Grass") || (terrain === "Psychic" && type === "Psychic")) return 1;
  return 0;
}
const speciesName = (runtime: BattleRuntime, speciesId: string) => runtime.speciesById.get(speciesId)?.name ?? speciesId;
const abilityName = (runtime: BattleRuntime, abilityId: string) => runtime.abilitiesById.get(abilityId)?.name ?? abilityId;
const effectiveness = (runtime: BattleRuntime, moveId: string, speciesId: string) => {
  const move = runtime.movesById.get(moveId);
  return move ? typeEffectiveness(move.type, runtime.speciesById.get(speciesId)?.types ?? []) : 1;
};
/** Whether `a` moves before `b` this turn on the decision's field (Speed with Tailwind; Trick Room reverses). */
function before(view: AiView, a: { side: MonView["side"]; build: BattleBuild }, b: MonView, runtime: BattleRuntime): boolean {
  const field = { ...view.field, trickRoom: false };
  const tail = (side: MonView["side"]) => side === "own" ? view.field.attackerSide.tailwind : view.field.defenderSide.tailwind;
  const sa = turnSpeed(a.build, tail(a.side), field, runtime), sb = turnSpeed(calcBuild(b), tail(b.side), field, runtime);
  return view.field.trickRoom ? sa < sb : sa > sb;
}
/**
 * A Speed-order fact holds only when Speed decides the order this turn: the AI's move and the foe's predicted move
 * (the top prediction) have the same priority (sim/battle.ts:2919-2925 sorts by priority before Speed), and the foe
 * cannot Mega Evolve this turn (a Mega's Speed applies at once, gen 7+).
 */
function speedDecides(view: AiView, q: readonly DecisionOption[], user: BattleBuild, moveId: string | null, foe: MonView, runtime: BattleRuntime): boolean {
  if (!moveId || !foe.slot) return false;
  if (foe.canMega && !view.megaUsed.own) return false;
  const predicted = q[0]?.action?.[foe.slot];
  if (predicted?.kind !== "move" || predicted.mega) return false;
  const mine = runtime.movesById.get(moveId), theirs = runtime.movesById.get(predicted.moveId);
  if (!mine || !theirs) return false;
  const a = turnPriority(mine, user, view.field, undefined, runtime), b = turnPriority(theirs, calcBuild(foe), view.field, undefined, runtime);
  return typeof a === "number" && typeof b === "number" && a === b;
}

export type RefMegaFact = MegaFact & { refs: ReadRefs };

/**
 * The AI's Mega facts for this turn in rule order (A1.5), each with the members and moves it names; empty when it had no
 * Mega Evolution available. Facts from its Speed or a KO chance rest on its Stat Points and nature (refs.stats); a KO
 * fact also comes without the chance for a reader who does not see them.
 */
export function megaFacts(args: MegaFactArgs): RefMegaFact[] {
  const { view, rows, chosen, runtime, mega, q, names } = args;
  if (view.megaUsed.opponent) return [];
  const aiSlots = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === "opponent");
  const eligible = aiSlots.map((slot) => ({ slot, mon: monInSlot(view, slot) }))
    .filter((entry): entry is { slot: DoublesSlotId; mon: MonView } => !!entry.mon && entry.mon.canMega && !!mega[entry.mon.key]);
  if (!eligible.length) return [];
  const foes = view.mons.filter((mon) => mon.side === "own" && mon.slot !== null && !mon.fainted && mon.hp > 0);
  const evolvedSlot = megaSlots(chosen).find((slot) => slotSide(slot) === "opponent") ?? null;
  const moveOf = (slot: DoublesSlotId) => { const each = chosen[slot]; return each?.kind === "move" ? each : null; };
  const facts: RefMegaFact[] = [];

  if (evolvedSlot) {
    const mon = monInSlot(view, evolvedSlot)!;
    const entry = mega[mon.key];
    const base = speciesName(runtime, mon.build.speciesId);
    const self = { memberKey: mon.memberKey, slot: evolvedSlot };
    const fact = (text: string, moves: { memberKey: string; moveId: string }[], stats = false): RefMegaFact => ({
      memberKey: mon.memberKey, evolved: true, moves: moves.map((each) => each.moveId), text: `Mega Evolved ${base}: ${text}`,
      refs: { inSlot: [self], incoming: [], moves, stats },
    });
    // a. Its ability sets the field before a move it powers.
    const setting = fieldOfAbility(entry.mega.abilityId);
    if (setting) {
      const shown = args.preludeField?.(evolvedSlot);
      const now = { weather: view.field.weather, terrain: view.field.terrain };
      const sets = setting.weather ? (shown?.weather ?? setting.weather) === setting.weather && now.weather !== setting.weather
        : (shown?.terrain ?? setting.terrain) === setting.terrain && now.terrain !== setting.terrain;
      if (sets) {
        for (const slot of aiSlots) {
          const action = moveOf(slot);
          const move = action ? runtime.movesById.get(action.moveId) : null;
          const user = slot === evolvedSlot ? entry.mega : monInSlot(view, slot)?.build;
          const userMon = monInSlot(view, slot);
          if (!action || !move || move.category === "Status" || !user || !userMon) continue;
          if (moveFavor(move.type, setting, user, runtime) > 0) {
            facts.push(fact(`${abilityName(runtime, entry.mega.abilityId)} before ${move.name}.`, [{ memberKey: userMon.memberKey, moveId: action.moveId }]));
            break;
          }
        }
      }
    }
    // b. Its move KOs where the base form's would not.
    const own = moveOf(evolvedSlot);
    if (own) {
      for (const foe of foes) {
        const megaRow = entry.out[foe.key]?.[own.moveId] ?? null;
        const baseRow = rows.get(mon.key, foe.key, own.moveId);
        const aimed = !own.target || own.target === foe.slot || SPREAD_TARGETS.has(runtime.movesById.get(own.moveId)?.target ?? "");
        if (aimed && megaRow && megaRow.koChance >= 0.5 && (baseRow?.koChance ?? 0) < 0.5) {
          const named = [{ memberKey: mon.memberKey, moveId: own.moveId }];
          facts.push(fact(`${moveName(runtime, own.moveId)} KOs ${names(foe.key)} (${chanceText(megaRow.koChance)}).`, named, true));
          facts.push(fact(`${moveName(runtime, own.moveId)} KOs ${names(foe.key)}.`, named));
          break;
        }
      }
    }
    // c. It now moves before a foe the base form did not.
    for (const foe of foes) {
      if (!speedDecides(view, q, entry.mega, own?.moveId ?? null, foe, runtime)) continue;
      if (before(view, { side: mon.side, build: entry.mega }, foe, runtime) && !before(view, { side: mon.side, build: entry.base }, foe, runtime)) {
        facts.push(fact(`moves before ${names(foe.key)}.`, [], true));
        break;
      }
    }
    // d. Its new types take the predicted move better.
    const threat = threatInto(view, q, evolvedSlot, runtime);
    if (threat) {
      const was = effectiveness(runtime, threat.moveId, mon.build.speciesId), now = effectiveness(runtime, threat.moveId, entry.formId);
      if (now === 0 && was > 0) facts.push(fact(`immune to ${moveName(runtime, threat.moveId)}.`, []));
      else if (now < 1 && was >= 1) facts.push(fact(`resists ${moveName(runtime, threat.moveId)}.`, []));
    }
    facts.push(fact(`${abilityName(runtime, entry.mega.abilityId)}.`, []));
    return facts;
  }

  // Kept: the eligible Pokémon with the larger gain.
  const { slot, mon } = [...eligible].sort((a, b) => mega[b.mon.key].gain - mega[a.mon.key].gain || aiSlots.indexOf(a.slot) - aiSlots.indexOf(b.slot))[0];
  const entry = mega[mon.key];
  const form = speciesName(runtime, entry.formId);
  const self = { memberKey: mon.memberKey, slot };
  const fact = (text: string, moves: { memberKey: string; moveId: string }[], stats = false): RefMegaFact => ({
    memberKey: mon.memberKey, evolved: false, moves: moves.map((each) => each.moveId), text: `Kept Mega Evolution: ${text}`,
    refs: { inSlot: [self], incoming: [], moves, stats },
  });
  // a. Its new types would take the predicted move super-effectively.
  const threat = threatInto(view, q, slot, runtime);
  if (threat) {
    const was = effectiveness(runtime, threat.moveId, mon.build.speciesId), now = effectiveness(runtime, threat.moveId, entry.formId);
    if (now > 1 && was <= 1) facts.push(fact(`${form} would take ${moveName(runtime, threat.moveId)} super-effectively.`, []));
  }
  // b. Its ability's weather or terrain would weaken one of the AI's own moves this turn.
  const setting = fieldOfAbility(entry.mega.abilityId);
  if (setting) {
    for (const each of aiSlots) {
      const action = moveOf(each);
      const move = action ? runtime.movesById.get(action.moveId) : null;
      const user = each === slot ? entry.mega : monInSlot(view, each)?.build;
      const userMon = monInSlot(view, each);
      if (!action || !move || move.category === "Status" || !user || !userMon) continue;
      if (moveFavor(move.type, setting, user, runtime) < 0) {
        facts.push(fact(`${abilityName(runtime, entry.mega.abilityId)} would weaken ${names(userMon.key)}'s ${move.name}.`, [{ memberKey: userMon.memberKey, moveId: action.moveId }]));
        break;
      }
    }
  }
  // c. It would move after a foe the base form moves before.
  const own = moveOf(slot);
  for (const foe of foes) {
    if (!speedDecides(view, q, entry.mega, own?.moveId ?? null, foe, runtime)) continue;
    if (before(view, { side: mon.side, build: entry.base }, foe, runtime) && !before(view, { side: mon.side, build: entry.mega }, foe, runtime)) {
      facts.push(fact(`${form} would move after ${names(foe.key)}.`, [], true));
      break;
    }
  }
  // d. Its move this turn would KO no more often in the Mega form.
  const changes = own ? foes.some((foe) => {
    const megaRow = entry.out[foe.key]?.[own.moveId] ?? null;
    const baseRow = rows.get(mon.key, foe.key, own.moveId);
    return Math.abs((megaRow?.koChance ?? 0) - (baseRow?.koChance ?? 0)) >= KO_CHANGE;
  }) : false;
  if (!changes) facts.push(fact(`${form} would not change this turn's KOs.`, []));
  facts.push({ memberKey: mon.memberKey, evolved: false, moves: [], text: "Kept Mega Evolution.", refs: { inSlot: [self], incoming: [], moves: [], stats: false } });
  return facts;
}

/** The AI's Mega fact for this turn (the first of megaFacts), or null when it had no Mega Evolution available (A1.5). */
export function megaFact(args: MegaFactArgs): MegaFact | null {
  const first = megaFacts(args)[0];
  if (!first) return null;
  return { memberKey: first.memberKey, evolved: first.evolved, moves: first.moves, text: first.text };
}
