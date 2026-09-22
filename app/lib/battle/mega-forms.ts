import { champions, speciesById } from "./catalog";

export type MegaOption = {
  baseSpeciesId: string;
  formId: string;
  itemId: string;
  label: string;
};

const byBase = new Map<string, MegaOption[]>();
const byForm = new Map<string, MegaOption>();

// Taxonomic baseSpecies also groups regional forms that cannot use these stones.
for (const item of champions.items) {
  for (const target of item.megaTargets) {
    const form = speciesById.get(target.formId);
    if (!speciesById.has(target.baseSpeciesId) || !form || form.requiredItem !== item.id) continue;
    const variant = form.name.match(/-Mega-(X|Y|Z)$/)?.[1];
    const option = { ...target, itemId: item.id, label: variant ? `Mega ${variant}` : "Mega" };
    const options = byBase.get(target.baseSpeciesId) ?? [];
    options.push(option);
    byBase.set(target.baseSpeciesId, options);
    byForm.set(target.formId, option);
  }
}
for (const options of byBase.values()) options.sort((a, b) => a.label.localeCompare(b.label, "en"));

export function getMegaOptions(speciesId: string): readonly MegaOption[] {
  return byBase.get(byForm.get(speciesId)?.baseSpeciesId ?? speciesId) ?? [];
}
