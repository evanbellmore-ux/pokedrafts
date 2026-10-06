// Addendum A1.3: the set editor's move list for one species: every move the validator lets it use in Reg M-C (any category),
// the species' usage moves first in usage order, then the rest A–Z by catalog name.
import type { EditorMoveOption, EditorMoveOptions } from "../model/usage";
import { speciesUsage } from "./species-usage";

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Moves the catalog does not know (no name, no engine data) are left out; the validator's list for Champions has none. */
export const editorMoveOptions: EditorMoveOptions = (speciesId, { usage, legality, runtime }) => {
  const legal = [...new Set(legality.legalMoves(speciesId))].filter((id) => runtime.movesById.has(id));
  const row = speciesUsage(usage, speciesId, runtime);
  const usageOrder = new Map((row?.moves ?? []).map((entry, index) => [entry.id, { index, weight: entry.weight }]));
  const name = (id: string) => runtime.movesById.get(id)!.name;
  const used: EditorMoveOption[] = legal.filter((id) => usageOrder.has(id))
    .sort((a, b) => usageOrder.get(a)!.index - usageOrder.get(b)!.index)
    .map((id) => ({ id, weight: usageOrder.get(id)!.weight }));
  const rest: EditorMoveOption[] = legal.filter((id) => !usageOrder.has(id))
    .sort((a, b) => name(a).localeCompare(name(b), "en") || compareIds(a, b))
    .map((id) => ({ id, weight: null }));
  return [...used, ...rest];
};
