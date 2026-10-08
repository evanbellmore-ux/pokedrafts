import type { ActionClass, TargetClass } from "../model/decision";
import { ACTION_CLASSES, AIM_CLASSES, DECAY, TARGET_CLASSES, type AimClass, type HabitsData } from "../model/habits-data";

// "Your trends" (setup) and "This battle compared with your usual" (battle end): the habits the AI recorded (ai/habits.ts,
// stored by the page) as plain facts. Counts are recency-weighted (× DECAY at every battle start), so percentages come from
// the weighted counts and counts are rounded for display. A share is stated only when its denominator, rounded as the panel
// shows it, is at least MIN_TOTAL actions, turns or battles: "Fewer than 3 battles" never stands next to a stated "(… of 3
// battles)" or under "3 battles recorded" (3 battles weigh 2.71). Page-side and pure: no simulator, engine or AI code.

export const MIN_TOTAL = 3;
export const DECAY_FACT = `Recent battles count more (×${DECAY} per battle).`;
export const MOVES_SHOWN = 6;

export const ACTION_LABEL: Record<ActionClass, string> = {
  protect: "Protect", switch: "Switch", "fake-out": "Fake Out", "attack-ko": "KO attempts", "attack-best": "Best attack",
  "attack-spread": "Spread attacks", "attack-other": "Other attacks", "speed-control": "Speed control", support: "Support",
  "status-other": "Other status moves",
};
const TARGET_LABEL: Record<TargetClass, string> = { threat: "The biggest threat", weak: "The lower-HP foe", other: "Other" };
const AIM_LABEL: Record<AimClass, string> = { left: "Left foe", right: "Right foe", ally: "Your partner" };
const ATTACKS: readonly ActionClass[] = ["attack-ko", "attack-best", "attack-spread", "attack-other"];

export type TrendUnit = "actions" | "attacks" | "moves aimed at a foe" | "aimed moves" | "moves used" | "battles" | "turns";
/** count / total are weighted (unrounded); percent is a whole number, or null when the rounded total is under MIN_TOTAL. */
export type ShareLine = { id: string; label: string; unit: TrendUnit; count: number; total: number; percent: number | null };
/** Lines over one shared denominator; `lines` is empty when the rounded total is under MIN_TOTAL. */
export type ShareGroup = { unit: TrendUnit; total: number; lines: ShareLine[] };
export type CountItem = { id: string; name: string; count: number };
export type MoveTrend = { speciesId: string; name: string; total: number; moves: (CountItem & { percent: number })[] | null };
export type TrendsView = {
  /** Battles started (not weighted). */
  battles: number;
  /** Each class's share of all actions, most first (classes whose rounded count is 0 left out). */
  actions: ShareGroup;
  situations: ShareLine[];
  targets: ShareGroup;
  aims: ShareGroup;
  /** Every species with moves, most used first; the panel shows MOVES_SHOWN and the rest behind a disclosure. */
  moves: MoveTrend[];
  /** Weighted battles (Σ 0.9^k over the battles started): the team preview lines' denominator. */
  weightedBattles: number;
  /** null: fewer than MIN_TOTAL weighted battles (rounded). */
  brought: CountItem[] | null;
  leads: CountItem[] | null;
  mega: ShareLine[];
};
export type TrendNames = { species(id: string): string; move(id: string): string };

const add = (values: Iterable<number | undefined>) => { let total = 0; for (const value of values) total += value ?? 0; return total; };
const sumOf = (table: Partial<Record<string, number>> | undefined) => add(Object.values(table ?? {}));
export const whole = (value: number) => Math.round(value);
/** A weighted denominator large enough to state a share: at least MIN_TOTAL once rounded, as the panel shows counts. */
export const enough = (total: number) => whole(total) >= MIN_TOTAL;
const percentOf = (count: number, total: number) => total > 0 ? Math.round(100 * count / total) : 0;
const byName = (a: { name: string }, b: { name: string }) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function line(id: string, label: string, unit: TrendUnit, count: number, total: number): ShareLine {
  return { id, label, unit, count, total, percent: enough(total) ? percentOf(count, total) : null };
}
function group(unit: TrendUnit, total: number, lines: ShareLine[]): ShareGroup {
  return { unit, total, lines: enough(total) ? lines : [] };
}

const SINGULAR: Record<TrendUnit, string> = {
  actions: "action", attacks: "attack", "moves aimed at a foe": "move aimed at a foe", "aimed moves": "aimed move", "moves used": "move used",
  battles: "battle", turns: "turn",
};
/** "22% (9 of 41 actions)", "0% (0 of 1 turn)", or "Fewer than 3 actions". */
export function shareText(share: Pick<ShareLine, "unit" | "count" | "total" | "percent">): string {
  if (share.percent === null) return fewerText(share.unit);
  const total = whole(share.total);
  return `${share.percent}% (${whole(share.count)} of ${total} ${total === 1 ? SINGULAR[share.unit] : share.unit})`;
}
export const fewerText = (unit: TrendUnit) => `Fewer than ${MIN_TOTAL} ${unit}`;

/** The class counts over the contexts that match (context key `${hp}|${threatened}|${protectedLast}`; "*" is the global row). */
function contextCounts(data: HabitsData, match: (hp: string, threatened: string, protectedLast: string) => boolean) {
  const out: Partial<Record<ActionClass, number>> = {};
  for (const [key, table] of Object.entries(data.classes)) {
    if (key === "*") continue;
    const [hp, threatened, protectedLast] = key.split("|");
    if (!match(hp, threatened, protectedLast)) continue;
    for (const cls of ACTION_CLASSES) if (table[cls]) out[cls] = (out[cls] ?? 0) + table[cls]!;
  }
  return out;
}
function targetTotals(data: HabitsData) {
  const out: Record<TargetClass, number> = { threat: 0, weak: 0, other: 0 };
  for (const table of Object.values(data.targets)) for (const target of TARGET_CLASSES) out[target] += table?.[target] ?? 0;
  return out;
}
function aimTotals(data: HabitsData) {
  const out: Record<AimClass, number> = { left: 0, right: 0, ally: 0 };
  for (const table of Object.values(data.aims ?? {})) for (const aim of AIM_CLASSES) out[aim] += table?.[aim] ?? 0;
  return out;
}
/** Mega chances by phase: "first|true" + "first|false" → first, "later|…" → later. */
function megaTotals(data: HabitsData) {
  const out = { first: { yes: 0, no: 0 }, later: { yes: 0, no: 0 } };
  for (const [key, entry] of Object.entries(data.mega)) {
    const phase = key.split("|")[0];
    if (phase !== "first" && phase !== "later") continue;
    out[phase].yes += entry.yes;
    out[phase].no += entry.no;
  }
  return out;
}
/** Σ DECAY^k over the battles started: the weight every battle's counts add up to now. */
export function weightedBattles(battles: number) {
  return battles > 0 ? (1 - DECAY ** battles) / (1 - DECAY) : 0;
}

export function isEmptyHabits(data: HabitsData | null | undefined): boolean {
  if (!data) return true;
  const mega = Object.values(data.mega).reduce((total, entry) => total + entry.yes + entry.no, 0);
  return sumOf(data.classes["*"]) <= 0 && sumOf(data.brings) <= 0 && sumOf(data.leads) <= 0 && mega <= 0;
}

function actionGroup(data: HabitsData): ShareGroup {
  const global = data.classes["*"] ?? {};
  const total = sumOf(global);
  const lines = ACTION_CLASSES.map((cls) => line(cls, ACTION_LABEL[cls], "actions", global[cls] ?? 0, total))
    .filter((each) => whole(each.count) >= 1)
    .sort((a, b) => b.count - a.count || ACTION_CLASSES.indexOf(a.id as ActionClass) - ACTION_CLASSES.indexOf(b.id as ActionClass));
  return group("actions", total, lines);
}
function megaLines(data: HabitsData): ShareLine[] {
  const mega = megaTotals(data);
  return [
    line("mega-first", "At the first chance", "battles", mega.first.yes, mega.first.yes + mega.first.no),
    line("mega-later", "At a later chance", "turns", mega.later.yes, mega.later.yes + mega.later.no),
  ];
}
function targetGroup(data: HabitsData): ShareGroup {
  const targets = targetTotals(data);
  const total = add(Object.values(targets));
  return group("moves aimed at a foe", total, TARGET_CLASSES.map((target) => line(target, TARGET_LABEL[target], "moves aimed at a foe", targets[target], total)));
}

/** The "Your trends" panel's facts from the stored habits; null when nothing is recorded. */
export function habitTrends(data: HabitsData | null | undefined, names: TrendNames): TrendsView | null {
  if (!data || isEmptyHabits(data)) return null;
  const threatened = contextCounts(data, (_hp, threatened) => threatened === "true");
  const calm = contextCounts(data, (_hp, threatened) => threatened === "false");
  const afterProtect = contextCounts(data, (_hp, _threatened, protectedLast) => protectedLast === "true");
  const lowHp = contextCounts(data, (hp) => hp === "low");
  const global = data.classes["*"] ?? {};
  const attacks = add(ATTACKS.map((cls) => global[cls]));
  const situations = [
    line("protect-threatened", "Protect when threatened", "actions", threatened.protect ?? 0, sumOf(threatened)),
    line("protect-calm", "Protect when not threatened", "actions", calm.protect ?? 0, sumOf(calm)),
    line("protect-again", "Protect right after a Protect", "actions", afterProtect.protect ?? 0, sumOf(afterProtect)),
    line("switch-low", "Switch at low HP (under 33%)", "actions", lowHp.switch ?? 0, sumOf(lowHp)),
    line("ko-share", "KO attempts among attacks", "attacks", global["attack-ko"] ?? 0, attacks),
  ];
  const aims = aimTotals(data);
  const aimTotal = add(Object.values(aims));
  const moves: MoveTrend[] = Object.entries(data.moves).map(([speciesId, table]) => {
    const total = sumOf(table);
    const top = Object.entries(table).map(([moveId, n]) => ({ id: moveId, name: names.move(moveId), count: n }))
      .filter((each) => whole(each.count) >= 1)
      .sort((a, b) => b.count - a.count || byName(a, b)).slice(0, 3)
      .map((each) => ({ ...each, percent: percentOf(each.count, total) }));
    return { speciesId, name: names.species(speciesId), total, moves: enough(total) ? top : null };
  }).filter((each) => each.total > 0).sort((a, b) => b.total - a.total || byName(a, b));
  const battles = weightedBattles(data.battles);
  const counted = (table: Record<string, number>, name: (key: string) => string, limit: number): CountItem[] | null => enough(battles)
    ? Object.entries(table).map(([id, n]) => ({ id, name: name(id), count: n })).filter((each) => whole(each.count) >= 1)
      .sort((a, b) => b.count - a.count || byName(a, b)).slice(0, limit)
    : null;
  return {
    battles: data.battles,
    actions: actionGroup(data),
    situations,
    targets: targetGroup(data),
    aims: group("aimed moves", aimTotal, AIM_CLASSES.map((aim) => line(aim, AIM_LABEL[aim], "aimed moves", aims[aim], aimTotal))),
    moves,
    weightedBattles: battles,
    brought: counted(data.brings, names.species, 6),
    leads: counted(data.leads, (key) => key.split("+").map(names.species).join(" + "), 3),
    mega: megaLines(data),
  };
}

// ---------- This battle compared with your usual ----------

/**
 * This battle's own counts (global classes, targets, Mega chances): the habits after it minus the habits before it × DECAY,
 * since the model multiplies every count by DECAY when the battle starts and then adds this battle's observations (whole
 * numbers). Null when that does not hold exactly (the record was cleared or replaced meanwhile).
 */
export function battleHabits(before: HabitsData, after: HabitsData): HabitsData | null {
  const started = after.battles - before.battles;
  const factor = started === 1 ? DECAY : started === 0 ? 1 : null;
  if (factor === null) return null;
  let exact = true;
  const diff = <K extends string>(a: Partial<Record<K, number>> | undefined, b: Partial<Record<K, number>> | undefined) => {
    const out: Partial<Record<K, number>> = {};
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]) as Set<K>) {
      const raw = (a?.[key] ?? 0) - factor * (b?.[key] ?? 0);
      const n = Math.round(raw);
      if (Math.abs(raw - n) > 1e-6 || n < 0) exact = false;
      if (n > 0) out[key] = n;
    }
    return out;
  };
  const targets: HabitsData["targets"] = {};
  for (const cls of ACTION_CLASSES) {
    const table = diff(after.targets[cls], before.targets[cls]);
    if (Object.keys(table).length) targets[cls] = table;
  }
  const mega: HabitsData["mega"] = {};
  for (const key of new Set([...Object.keys(after.mega), ...Object.keys(before.mega)])) {
    const yes = diff({ n: after.mega[key]?.yes ?? 0 }, { n: before.mega[key]?.yes ?? 0 }).n ?? 0;
    const no = diff({ n: after.mega[key]?.no ?? 0 }, { n: before.mega[key]?.no ?? 0 }).n ?? 0;
    if (yes || no) mega[key] = { yes, no };
  }
  const global = diff(after.classes["*"], before.classes["*"]);
  if (!exact) return null;
  return { v: 1, battles: started, classes: { "*": global }, targets, moves: {}, brings: {}, leads: {}, mega, aims: {} };
}

export type ComparisonRow = { id: string; label: string; battle: string; usual: string };
const COMPARED: readonly ActionClass[] = ["protect", "switch", "fake-out", "attack-ko", "speed-control"];

/** The battle-end table: this battle's exact shares next to the habits before it; lines without data this battle left out. */
export function battleComparison(before: HabitsData, after: HabitsData): ComparisonRow[] | null {
  const battle = battleHabits(before, after);
  if (!battle) return null;
  const rows: ComparisonRow[] = [];
  // This battle's counts are exact: every share is stated, whatever its denominator.
  const exact = (count: number, total: number, unit: TrendUnit) => shareText({ unit, count, total, percent: percentOf(count, total) });
  const mine = actionGroup(battle).total, usual = actionGroup(before).total;
  if (mine > 0) {
    for (const cls of COMPARED) {
      rows.push({
        id: cls, label: ACTION_LABEL[cls],
        battle: exact(battle.classes["*"]?.[cls] ?? 0, mine, "actions"),
        usual: shareText(line(cls, ACTION_LABEL[cls], "actions", before.classes["*"]?.[cls] ?? 0, usual)),
      });
    }
  }
  const myTargets = targetGroup(battle), usualTargets = targetGroup(before);
  if (myTargets.total > 0) {
    rows.push({
      id: "threat", label: "The biggest threat targeted",
      battle: exact(targetTotals(battle).threat, myTargets.total, "moves aimed at a foe"),
      usual: shareText(line("threat", "", "moves aimed at a foe", targetTotals(before).threat, usualTargets.total)),
    });
  }
  const [myFirst, myLater] = megaLines(battle), [usualFirst, usualLater] = megaLines(before);
  if (myFirst.total > 0) rows.push({ id: "mega-first", label: "Mega Evolution at the first chance", battle: myFirst.count > 0 ? "Yes" : "No", usual: shareText(usualFirst) });
  if (myLater.total > 0) rows.push({ id: "mega-later", label: "Mega Evolution at a later chance", battle: exact(myLater.count, myLater.total, "turns"), usual: shareText(usualLater) });
  return rows;
}
