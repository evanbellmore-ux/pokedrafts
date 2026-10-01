/**
 * A stat with its stage applied, as pinned Showdown does: the stage is clamped to ±6, a raised stat
 * is multiplied by (2 + stage) / 2 and a lowered one by 2 / (2 − stage), rounded down.
 * Returns null without a stat or a whole-number stage.
 */
export function stagedStat(stat: number | null | undefined, stage: number | null | undefined): number | null {
  if (typeof stat !== "number" || !Number.isFinite(stat) || typeof stage !== "number" || !Number.isInteger(stage)) return null;
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? Math.floor(stat * (2 + clamped) / 2) : Math.floor(stat * 2 / (2 - clamped));
}
