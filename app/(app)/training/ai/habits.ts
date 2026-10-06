// SPEC 10.9 the habit model (a PlayerModel, id "habits"), with addendum A1.5: it also learns when you Mega Evolve. It
// learns only from what the AI's log showed (I8: a move and its shown target, a switch, a -mega reveal), never from your
// choice string; a Pokémon that could not move teaches nothing that turn. Stored by the page as HabitsRecord.data.
import { allyOf, DOUBLES_SLOTS, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type {
  ActionClass, BattleRecord, HabitsRecord, PlayerModel, PlayerPrediction, PlayerQuestion, SlotContext, TargetClass, TurnRecord,
} from "../model/decision";
import { AIM_CLASSES, DECAY, emptyHabits, parseHabits, TARGET_CLASSES, type AimClass, type HabitsData } from "../model/habits-data";
import { jointActionKey, megaSlots, slotActionKey, type JointAction, type SlotAction } from "../model/view-types";

export { classifySlotAction, situationFeatures } from "./classify";
// The stored data's type and parser live in model/habits-data.ts (the page reads it for "Your trends").
export { DECAY, emptyHabits, parseHabits, type AimClass, type HabitsData };

/** Where a player's aimed move from `slot` goes: one of the AI's positions, or its partner (itself: no aim). */
const aimOf = (target: string | null | undefined, slot: DoublesSlotId): AimClass | null =>
  target === "opponent-left" ? "left" : target === "opponent-right" ? "right" : target && target === allyOf(slot) ? "ally" : null;
/** What observeTurn / observeBattle need from the decision that the record does not carry (the engine provider supplies it). */
export type HabitContext = {
  /** The engine slot a PublicMon key stood in at the turn's start (the decision view). */
  targetSlot?(publicKey: string): DoublesSlotId | null;
  /** The class of an action the question's SlotContext does not list (classifySlotAction on the decision view). */
  classify?(slot: DoublesSlotId, action: SlotAction): { cls: ActionClass; target: TargetClass | null } | null;
  /** A SheetMember key's species id. */
  speciesOf?(key: string): string | null;
};
export type HabitModel = PlayerModel & {
  readonly id: "habits";
  record(): HabitsRecord;
  data(): HabitsData;
  /** At every battle start: every count × DECAY, battles + 1. */
  startBattle(): void;
  /** Every action of every slot in `slots` with its chance (each slot sums to 1), keyed jointActionKey({ [slot]: action }). */
  slotPrediction(slots: Partial<Record<DoublesSlotId, SlotContext>>): Record<string, number>;
  observeTurn(record: TurnRecord, context?: HabitContext): void;
  observeBattle(record: BattleRecord, context?: HabitContext): void;
};

/** Backoff strength β (SPEC 10.9). */
export const BETA = 3;
/** The stored record's cap (SPEC 10.9, 15: 64 KB of JSON). */
export const HABITS_CAP = 64 * 1024;
/** A1.5 prior chance that a side Mega Evolves on a turn it can: at its first chance, and later. */
export const MEGA_PRIOR = { first: 0.7, later: 0.5 } as const;

/** The record under HABITS_CAP: the smallest move counts go first, then the smallest contexts, brings and leads. */
export function capHabits(data: HabitsData, cap = HABITS_CAP): HabitsData {
  const out: HabitsData = structuredClone(data);
  const size = () => JSON.stringify(out).length;
  if (size() <= cap) return out;
  const moveEntries = Object.entries(out.moves).flatMap(([species, moves]) => Object.entries(moves).map(([move, n]) => ({ species, move, n })))
    .sort((a, b) => a.n - b.n || (a.species + a.move < b.species + b.move ? -1 : 1));
  for (let i = 0; i < moveEntries.length; i++) {
    const { species, move } = moveEntries[i];
    delete out.moves[species][move];
    if (!Object.keys(out.moves[species]).length) delete out.moves[species];
    if (i % 32 === 31 && size() <= cap) return out;
  }
  if (size() <= cap) return out;
  const total = (entry: Partial<Record<string, number>>) => Object.values(entry).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const contexts = Object.entries(out.classes).filter(([key]) => key !== "*").sort((a, b) => total(a[1]) - total(b[1]) || (a[0] < b[0] ? -1 : 1));
  for (const [key] of contexts) { delete out.classes[key]; if (size() <= cap) return out; }
  for (const table of [out.leads, out.brings]) {
    for (const [key] of Object.entries(table).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))) { delete table[key]; if (size() <= cap) return out; }
  }
  return out;
}

const contextKey = (slot: SlotContext) => `${slot.features.hp}|${slot.features.threatened}|${slot.features.protectedLast}`;
const sum = (entry: Partial<Record<string, number>> | undefined) => Object.values(entry ?? {}).reduce<number>((total, n) => total + (n ?? 0), 0);
/** "move:id:target[:mega]" → its parts. */
function parseKey(key: string, slot?: DoublesSlotId): { base: string; moveId: string | null; mega: boolean; aim: AimClass | null } {
  const parts = key.split(":");
  if (parts[0] !== "move") return { base: key, moveId: null, mega: false, aim: null };
  return { base: parts.slice(0, 3).join(":"), moveId: parts[1], mega: parts.length > 3, aim: slot ? aimOf(parts[2], slot) : null };
}

export function createHabitModel(record: HabitsRecord | null): HabitModel {
  let data = parseHabits(record?.data);
  let turns = record && typeof record.turns === "number" && Number.isFinite(record.turns) && record.turns >= 0 && data.battles + sum(data.classes["*"]) > 0 ? record.turns : 0;
  /** Turns this battle on which your side could Mega Evolve (the first one is "first", A1.5). */
  let megaTurns = 0;

  /** P(class) for one slot over the classes present, Dirichlet backoff "*" → context (SPEC 10.9). */
  function classChances(slot: SlotContext, present: readonly ActionClass[]): Map<ActionClass, number> {
    const global = data.classes["*"], local = data.classes[contextKey(slot)];
    const nGlobal = sum(global), nLocal = sum(local);
    const out = new Map<ActionClass, number>();
    let total = 0;
    for (const cls of present) {
      const p2 = ((global?.[cls] ?? 0) + BETA / present.length) / (nGlobal + BETA);
      const p1 = ((local?.[cls] ?? 0) + BETA * p2) / (nLocal + BETA);
      out.set(cls, p1);
      total += p1;
    }
    for (const [cls, p] of out) out.set(cls, total > 0 ? p / total : 1 / present.length);
    return out;
  }
  /** One slot's chance per base action (no Mega factor): class chance split by target class and move habits, × its aim. */
  function baseChances(slot: SlotContext, at: DoublesSlotId): Map<string, number> {
    const bases = new Map<string, { cls: ActionClass; target: TargetClass | null; moveId: string | null; aim: AimClass | null }>();
    for (const [key, entry] of Object.entries(slot.classes)) {
      const parsed = parseKey(key, at);
      if (!bases.has(parsed.base)) bases.set(parsed.base, { cls: entry.cls, target: entry.target, moveId: parsed.moveId, aim: parsed.aim });
    }
    const present = [...new Set([...bases.values()].map((entry) => entry.cls))];
    const chances = classChances(slot, present);
    const speciesMoves = data.moves[slot.speciesId] ?? {};
    const moveTotal = sum(speciesMoves);
    const distinct = new Set([...bases.values()].map((entry) => entry.moveId).filter(Boolean)).size || 1;
    const within = (entry: { cls: ActionClass; target: TargetClass | null; moveId: string | null }) => {
      const targets = data.targets[entry.cls];
      const t = entry.target ? ((targets?.[entry.target] ?? 0) + 1) / (sum(targets) + TARGET_CLASSES.length) : 1;
      const m = entry.moveId ? Math.sqrt(((speciesMoves[entry.moveId] ?? 0) + 1) / (moveTotal + distinct)) : 1;
      return t * m;
    };
    // Where it aims, outside the class split (an aim habit moves chance between classes too: HabitBot's fixed position is an
    // attack-ko into one foe and an attack-other into the other), pooled over the classes (a move whose target fainted first
    // is shown hitting the other foe, which blurs one class's aims): P(aim) with +1 smoothing, ×3 so an even split is 1;
    // moves without an aimed target keep 1.
    const allAims: Partial<Record<AimClass, number>> = {};
    for (const table of Object.values(data.aims ?? {})) for (const aim of AIM_CLASSES) allAims[aim] = (allAims[aim] ?? 0) + (table?.[aim] ?? 0);
    const aimFactor = (entry: { aim: AimClass | null }) =>
      entry.aim ? AIM_CLASSES.length * ((allAims[entry.aim] ?? 0) + 1) / (sum(allAims) + AIM_CLASSES.length) : 1;
    const classTotals = new Map<ActionClass, number>();
    for (const entry of bases.values()) classTotals.set(entry.cls, (classTotals.get(entry.cls) ?? 0) + within(entry));
    const out = new Map<string, number>();
    for (const [base, entry] of bases) out.set(base, (chances.get(entry.cls) ?? 0) * within(entry) / (classTotals.get(entry.cls) || 1) * aimFactor(entry));
    return out;
  }
  /** A1.5: the chance your side Mega Evolves this turn, given it can (backoff "*" → first/later). */
  function megaChance(threatened: boolean): number {
    const phase = megaTurns === 0 ? "first" : "later";
    const prior = MEGA_PRIOR[phase];
    const global = data.mega["*"], local = data.mega[`${phase}|${threatened}`];
    const p2 = ((global?.yes ?? 0) + BETA * prior) / ((global?.yes ?? 0) + (global?.no ?? 0) + BETA);
    return ((local?.yes ?? 0) + BETA * p2) / ((local?.yes ?? 0) + (local?.no ?? 0) + BETA);
  }
  const eligibleOf = (slots: Partial<Record<DoublesSlotId, SlotContext>>) => DOUBLES_SLOTS.filter((slot) => slots[slot]?.canMega);

  function slotPrediction(slots: Partial<Record<DoublesSlotId, SlotContext>>): Record<string, number> {
    const eligible = eligibleOf(slots);
    const pm = eligible.length ? megaChance(eligible.some((slot) => slots[slot]!.features.threatened)) / eligible.length : 0;
    const out: Record<string, number> = {};
    for (const slot of DOUBLES_SLOTS) {
      const context = slots[slot];
      if (!context) continue;
      const bases = baseChances(context, slot);
      const entries: [string, number][] = [];
      for (const key of Object.keys(context.classes)) {
        const parsed = parseKey(key);
        const base = bases.get(parsed.base) ?? 0;
        entries.push([key, !context.canMega ? base : parsed.mega ? base * pm : base * (1 - pm)]);
      }
      const total = entries.reduce((acc, [, p]) => acc + p, 0);
      for (const [key, p] of entries) out[jointActionKey({ [slot]: actionOfKey(key) })] = total > 0 ? p / total : 1 / entries.length;
    }
    return out;
  }

  function predictTurn(question: Extract<PlayerQuestion, { kind: "turn" }>): PlayerPrediction {
    const eligible = eligibleOf(question.slots);
    const pm = eligible.length ? megaChance(eligible.some((slot) => question.slots[slot]!.features.threatened)) : 0;
    const perSlot = new Map<DoublesSlotId, Map<string, number>>();
    for (const slot of DOUBLES_SLOTS) { const context = question.slots[slot]; if (context) perSlot.set(slot, baseChances(context, slot)); }
    const scores = question.options.map((option) => {
      let p = 1;
      for (const slot of DOUBLES_SLOTS) {
        const action = option.action[slot];
        const chances = perSlot.get(slot);
        if (!action || !chances) continue;
        p *= chances.get(parseKey(slotActionKey(action)).base) ?? 1e-3;
      }
      if (eligible.length) p *= megaSlots(option.action).length ? pm / eligible.length : 1 - pm;
      return p;
    });
    const total = scores.reduce((acc, p) => acc + p, 0);
    return { probabilities: Object.fromEntries(question.options.map((option, i) => [option.id, total > 0 ? scores[i] / total : 1 / question.options.length])), weight: 1 };
  }

  function bump<K extends string>(table: Partial<Record<K, number>>, key: K, by = 1) { table[key] = (table[key] ?? 0) + by; }

  function observeTurn(record: TurnRecord, context: HabitContext = {}) {
    for (const slot of DOUBLES_SLOTS) {
      const observed = record.observed[slot];
      const slotContext = record.question.slots[slot];
      if (!observed || !slotContext || observed.kind === "none") continue;
      let action: SlotAction;
      let found: { cls: ActionClass; target: TargetClass | null } | null = null;
      if (observed.kind === "switch") {
        action = { kind: "switch", to: observed.toKey };
        found = { cls: "switch", target: null };
      } else {
        const target = observed.spread || !observed.targetKey ? null : context.targetSlot?.(observed.targetKey) ?? null;
        action = { kind: "move", moveId: observed.moveId, target };
        found = slotContext.classes[slotActionKey(action)] ?? null;
        if (!found) {
          // A shown move whose target the question does not list (redirected, a spread move, no target): the one key of that move.
          const same = Object.entries(slotContext.classes).filter(([key]) => { const parsed = parseKey(key); return parsed.moveId === observed.moveId && !parsed.mega; });
          if (same.length === 1) found = same[0][1];
          else if (same.length > 1) found = { cls: same[0][1].cls, target: null };
        }
        found ??= context.classify?.(slot, action) ?? null;
      }
      if (!found) continue;
      bump(data.classes[contextKey(slotContext)] ??= {}, found.cls);
      bump(data.classes["*"] ??= {}, found.cls);
      if (found.target) bump(data.targets[found.cls] ??= {}, found.target);
      const aim = action.kind === "move" ? aimOf(action.target, slot) : null;
      if (aim) bump((data.aims ??= {})[found.cls] ??= {}, aim);
      if (action.kind === "move") bump(data.moves[slotContext.speciesId] ??= {}, action.moveId);
    }
    const eligible = eligibleOf(record.question.slots);
    if (eligible.length) {
      const phase = megaTurns === 0 ? "first" : "later";
      const threatened = eligible.some((slot) => record.question.slots[slot]!.features.threatened);
      const yes = record.observedMega !== null ? 1 : 0;
      for (const key of ["*", `${phase}|${threatened}`]) {
        const entry = data.mega[key] ??= { yes: 0, no: 0 };
        entry.yes += yes;
        entry.no += 1 - yes;
      }
      megaTurns++;
    }
    turns += 1;
    data = capHabits(data);
  }

  function observeBattle(record: BattleRecord, context: HabitContext = {}) {
    const species = (key: string) => context.speciesOf?.(key) ?? key;
    if (record.leads) bump(data.leads, [...record.leads].map(species).sort().join("+"));
    for (const key of new Set(record.revealed)) bump(data.brings, species(key));
    data = capHabits(data);
  }

  return {
    id: "habits",
    async predict(question) {
      if (question.kind === "turn") return predictTurn(question);
      // Preview questions: lead pairs by lead habits (+1 smoothing).
      const scores = question.options.map((option) => (data.leads[[...option.leads].sort().join("+")] ?? 0) + 1);
      const total = scores.reduce((acc, n) => acc + n, 0);
      return { probabilities: Object.fromEntries(question.options.map((option, i) => [option.id, scores[i] / total])), weight: 1 };
    },
    slotPrediction,
    observeTurn,
    observeBattle,
    startBattle() {
      const decay = (table: Partial<Record<string, number>>) => { for (const key of Object.keys(table)) table[key] = (table[key] ?? 0) * DECAY; };
      for (const table of Object.values(data.classes)) decay(table);
      for (const table of Object.values(data.targets)) decay(table ?? {});
      for (const table of Object.values(data.aims ?? {})) decay(table ?? {});
      for (const table of Object.values(data.moves)) decay(table);
      decay(data.brings);
      decay(data.leads);
      for (const entry of Object.values(data.mega)) { entry.yes *= DECAY; entry.no *= DECAY; }
      turns *= DECAY;
      data.battles += 1;
      megaTurns = 0;
    },
    record: () => ({ version: 1, turns, data: structuredClone(data) }),
    data: () => structuredClone(data),
  };
}

/** A slotActionKey back to its SlotAction ("move:id:target[:mega]", "switch:key", "pass"). */
export function actionOfKey(key: string): SlotAction {
  if (key === "pass") return { kind: "pass" };
  if (key.startsWith("switch:")) return { kind: "switch", to: key.slice("switch:".length) };
  const [, moveId, target, mega] = key.split(":");
  return { kind: "move", moveId, target: target === "-" ? null : target as DoublesSlotId, ...(mega ? { mega: mega as "mega" | "megax" | "megay" } : {}) };
}
/** A joint action's per-slot habit chances multiplied (keys of slotPrediction). */
export function jointFromSlots(prediction: Record<string, number>, action: JointAction): number {
  let p = 1;
  for (const slot of DOUBLES_SLOTS) { const each = action[slot]; if (each) p *= prediction[jointActionKey({ [slot]: each })] ?? 1e-3; }
  return p;
}
