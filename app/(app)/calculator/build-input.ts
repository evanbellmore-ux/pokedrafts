import { parseIntegerInput } from "@/app/lib/battle/model";

export function parseBuildInput(text: string, fullHP = false) {
  const parsed = parseIntegerInput(text);
  return fullHP && text !== "" ? parsed ?? Number.NaN : parsed;
}

export function formatHPInput(value: number | null) {
  return value === null ? "" : String(value);
}
