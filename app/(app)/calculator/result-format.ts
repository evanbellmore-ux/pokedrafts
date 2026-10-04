import { chanceText } from "@/app/lib/battle/chance";
import { hitCountsText } from "@/app/lib/battle/hit-count";
import type { MoveDamageResult } from "@/app/lib/battle/types";

export { chanceText };

const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatRange(min: number | null, max: number | null) {
  return min === null || max === null ? "—" : min === max ? String(min) : `${min}–${max}`;
}

export function damagePercent(row: Pick<MoveDamageResult, "minPercent" | "maxPercent">) {
  return row.minPercent === null || row.maxPercent === null ? "—"
    : `${percent.format(row.minPercent)}–${percent.format(row.maxPercent)}% of max HP`;
}

/** The exact chance one use knocks the target out (MoveDamageResult.afterUse), or null. */
export function afterUseKOChance(row: Pick<MoveDamageResult, "afterUse">): number | null {
  const chance = row.afterUse?.koChance;
  return typeof chance === "number" && Number.isFinite(chance) && chance >= 0 && chance <= 1 ? chance : null;
}

/** The row's one-use KO chance, or its first use's exact one (afterUse) when the row has none. */
export function koChance(row: MoveDamageResult) {
  const chance = row.kind !== "calculated" ? null : row.ohkoChance ?? afterUseKOChance(row);
  return chance === null ? "Not estimated" : chanceText(chance);
}

type HitRow = Pick<MoveDamageResult, "hits" | "hitChances" | "attackerFaintsOnHit">;

/**
 * The hits that land: the random range ("2–5", after any faint), the hit the attacker faints on out of the
 * count or counts it would make ("9 of 10", "1 of 4 or 5"), or the count. null: no count resolved.
 */
export function hitCountText(row: HitRow): string | null {
  if (row.hits === null) return null;
  const chances = row.hitChances;
  if (chances && chances.length > 1) return `${chances[0].hits}–${chances[chances.length - 1].hits}`;
  const faint = row.attackerFaintsOnHit;
  if (faint) return `${row.hits} of ${hitCountsText(faint.ofMin ?? faint.of, faint.of)}`;
  return String(row.hits);
}

/**
 * The damage line's hit count, only for a random count, one the attacker's faint cuts short, or a `chosen`
 * count of a move whose count can be chosen: "2–5 hits", "9 of 10 hits", "3 hits".
 */
export function hitRangeText(row: HitRow, chosen = false): string | null {
  if (!row.hitChances?.length && !row.attackerFaintsOnHit && !chosen) return null;
  const text = hitCountText(row);
  return text && `${text} ${text === "1" ? "hit" : "hits"}`;
}

/**
 * Each random hit count with its chance and damage range: a count deals the sum of its first hits, so its
 * range runs from those hits' lowest rolls to their highest. null without hitChances or per-hit rolls for
 * the largest count.
 */
export function hitCountRanges(row: Pick<MoveDamageResult, "hitChances" | "rolls">): { hits: number; chance: number; min: number; max: number }[] | null {
  const { hitChances, rolls } = row;
  if (!hitChances?.length || !Array.isArray(rolls) || !rolls.every((hit) => Array.isArray(hit) && hit.length > 0)) return null;
  const perHit = rolls as number[][];
  if (perHit.length < hitChances[hitChances.length - 1].hits) return null;
  let landed = 0, min = 0, max = 0;
  return hitChances.map(({ hits, chance }) => {
    for (; landed < hits; landed++) {
      min += Math.min(...perHit[landed]);
      max += Math.max(...perHit[landed]);
    }
    return { hits, chance, min, max };
  });
}
