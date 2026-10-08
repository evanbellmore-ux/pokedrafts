// Addendum A1.1: the "Usage" fact (Reg M-B statistics used for Reg M-C battles).
// model/format-facts.ts
import { infoFact, type InfoSettings } from "./info";
import { USAGE_SOURCE_FACT } from "./usage";
export const TRAINING_LABEL = "Training";
export const FORMAT_FACTS: readonly { term: string; value: string }[] = [
  { term: "Format", value: "[Gen 9 Champions] VGC 2026 Reg M-C" },
  { term: "Battle", value: "Doubles · Level 50" },
  { term: "Teams", value: "Bring 6, pick 4" },
  { term: "Clauses", value: "Species Clause · Item Clause (1 each) · No Mythical or Restricted Legendary" },
  { term: "Mega Evolution", value: "Once per battle" },
  { term: "Terastallization", value: "Not in Champions" },
  { term: "Timer", value: "Off" },
  { term: "AI", value: "Runs in your browser; never sees your choice for the turn or the battle's random rolls" },
  { term: "Battles", value: "Saved in this browser (up to 100)" },
  { term: "Rules", value: "Pokémon Showdown c23d2e94" },
  { term: "Usage", value: USAGE_SOURCE_FACT },
];
/** The static facts plus the two information lines (section 12.2). */
export function formatFacts(info: InfoSettings): { term: string; value: string }[] {
  return [...FORMAT_FACTS, { term: "AI knows", value: infoFact(info.aiKnows) }, { term: "You see", value: infoFact(info.youSee) }];
}
