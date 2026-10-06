// Addendum A1.1: the Training worker's loader for data/champions/training-usage.json (npm run data:champions:move-usage).
// Only worker-side modules import this file; the page reaches usage through the worker's messages (boundary test).
import data from "@/data/champions/training-usage.json";
import type { TrainingUsageData } from "../model/usage";
import { parseTrainingUsage } from "./species-usage";

export { speciesUsage, usageRowId } from "./species-usage";

let loaded: TrainingUsageData | null = null;

/** The generated Reg M-B Doubles usage, shape-checked once (a throw becomes the worker's load-error). */
export function loadTrainingUsage(): TrainingUsageData {
  loaded ??= parseTrainingUsage(data);
  return loaded;
}
