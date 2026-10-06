// The habit model's stored data (SPEC 10.9, addendum A1.5), shared by the AI (ai/habits.ts) and the page (the "Your trends"
// panel and the battle-end comparison read it). Types and pure parsing only: no simulator, engine or AI code.
import type { ActionClass, TargetClass } from "./decision";

export type AimClass = "left" | "right" | "ally";
export type HabitsData = {
  v: 1;
  /** Battles started (not decayed). */
  battles: number;
  /** Context key (`${hp}|${threatened}|${protectedLast}`) → class counts; "*" = global. */
  classes: Record<string, Partial<Record<ActionClass, number>>>;
  targets: Partial<Record<ActionClass, Partial<Record<TargetClass, number>>>>;
  /** speciesId → moveId → count. */
  moves: Record<string, Record<string, number>>;
  /** speciesId → battles brought; "a+b" (species ids, sorted) → battles led. */
  brings: Record<string, number>;
  leads: Record<string, number>;
  /** A1.5: turns your side could Mega Evolve, by `${phase}|${threatened}` (phase "first": its first such turn of the battle, else "later") and "*": Mega Evolved or kept. */
  mega: Record<string, { yes: number; no: number }>;
  /**
   * Where your aimed moves went, by class: "left" / "right" = the AI's opponent-left / opponent-right, "ally" = your own
   * partner. A habit of always hitting one position (HabitBot: scripts/.cache/training/review-ai/habit-probe-habit.out)
   * and how rarely you aim at your partner. Absent in older records.
   */
  aims?: Partial<Record<ActionClass, Partial<Record<AimClass, number>>>>;
};

/** Every count × 0.9 at each battle start (SPEC 10.9). */
export const DECAY = 0.9;
export const ACTION_CLASSES: readonly ActionClass[] = ["protect", "switch", "fake-out", "attack-ko", "attack-best", "attack-spread", "attack-other", "speed-control", "support", "status-other"];
export const TARGET_CLASSES: readonly TargetClass[] = ["threat", "weak", "other"];
export const AIM_CLASSES: readonly AimClass[] = ["left", "right", "ally"];

export function emptyHabits(): HabitsData {
  return { v: 1, battles: 0, classes: {}, targets: {}, moves: {}, brings: {}, leads: {}, mega: {}, aims: {} };
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
function counts<K extends string>(value: unknown, allowed?: readonly K[]): Partial<Record<K, number>> | null {
  if (!isRecord(value)) return null;
  const out: Partial<Record<K, number>> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = count(raw);
    if (n === null || (allowed && !allowed.includes(key as K))) return null;
    out[key as K] = n;
  }
  return out;
}
function nested<K extends string>(value: unknown, allowed?: readonly K[]): Record<string, Partial<Record<K, number>>> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, Partial<Record<K, number>>> = {};
  for (const [key, raw] of Object.entries(value)) {
    const inner = counts(raw, allowed);
    if (!inner) return null;
    out[key] = inner;
  }
  return out;
}
/** Stored data back to HabitsData; anything corrupt or of another version → empty. */
export function parseHabits(data: unknown): HabitsData {
  if (!isRecord(data) || data.v !== 1) return emptyHabits();
  const battles = count(data.battles);
  const classes = nested(data.classes, ACTION_CLASSES);
  const targetsRaw = isRecord(data.targets) ? data.targets : null;
  const targets = targetsRaw && Object.keys(targetsRaw).every((key) => ACTION_CLASSES.includes(key as ActionClass)) ? nested(targetsRaw, TARGET_CLASSES) : null;
  const moves = nested<string>(data.moves);
  const brings = counts<string>(data.brings);
  const leads = counts<string>(data.leads);
  const megaRaw = data.mega === undefined ? {} : data.mega;
  let mega: HabitsData["mega"] | null = null;
  if (isRecord(megaRaw)) {
    mega = {};
    for (const [key, raw] of Object.entries(megaRaw)) {
      const yes = isRecord(raw) ? count(raw.yes) : null, no = isRecord(raw) ? count(raw.no) : null;
      if (yes === null || no === null) { mega = null; break; }
      mega[key] = { yes, no };
    }
  }
  const aimsRaw = data.aims === undefined ? {} : data.aims;
  const aims = isRecord(aimsRaw) && Object.keys(aimsRaw).every((key) => ACTION_CLASSES.includes(key as ActionClass)) ? nested(aimsRaw, AIM_CLASSES) : null;
  if (battles === null || !classes || !targets || !moves || !brings || !leads || !mega || !aims) return emptyHabits();
  return {
    v: 1, battles, classes, targets: targets as HabitsData["targets"], moves: moves as HabitsData["moves"], brings: brings as Record<string, number>,
    leads: leads as Record<string, number>, mega, aims: aims as NonNullable<HabitsData["aims"]>,
  };
}
