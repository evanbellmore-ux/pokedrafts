import type { MoveDamageResult } from "@/app/lib/battle/types";

const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatRange(min: number | null, max: number | null) {
  return min === null || max === null ? "—" : min === max ? String(min) : `${min}–${max}`;
}

export function damagePercent(row: Pick<MoveDamageResult, "minPercent" | "maxPercent">) {
  return row.minPercent === null || row.maxPercent === null ? "—"
    : `${percent.format(row.minPercent)}–${percent.format(row.maxPercent)}% of max HP`;
}

/** A 0–1 chance with up to 2 decimals; "<0.01%" and ">99.99%" never round to 0% or 100%. */
export function chanceText(chance: number) {
  const value = chance * 100;
  if (value > 0 && value < 0.01) return "<0.01%";
  if (value > 99.99 && value < 100) return ">99.99%";
  return `${percent.format(value)}%`;
}

export function koChance(row: MoveDamageResult) {
  if (row.kind !== "calculated" || row.ohkoChance === null) return "Not estimated";
  return chanceText(row.ohkoChance);
}
