import type { MoveDamageResult } from "@/app/lib/battle/types";

const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatRange(min: number | null, max: number | null) {
  return min === null || max === null ? "—" : min === max ? String(min) : `${min}–${max}`;
}

export function damagePercent(row: MoveDamageResult) {
  return row.minPercent === null || row.maxPercent === null ? "—"
    : `${percent.format(row.minPercent)}–${percent.format(row.maxPercent)}% of max HP`;
}

export function koChance(row: MoveDamageResult) {
  if (row.kind !== "calculated" || row.ohkoChance === null) return "Not estimated";
  const value = row.ohkoChance * 100;
  if (value > 0 && value < 0.01) return "<0.01%";
  if (value > 99.99 && value < 100) return ">99.99%";
  return `${percent.format(value)}%`;
}
