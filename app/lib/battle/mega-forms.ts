import { championsRuntime, type BattleRuntime } from "./runtime";

export type MegaOption = {
  baseSpeciesId: string;
  formId: string;
  itemId: string;
  label: string;
  requiredMove?: string;
};

type FormIndex = { byBase: Map<string, MegaOption[]>; byForm: Map<string, MegaOption[]> };
const indexes = new WeakMap<BattleRuntime, FormIndex>();

function indexForms(runtime: BattleRuntime): FormIndex {
  const previous = indexes.get(runtime);
  if (previous) return previous;
  const byBase = new Map<string, MegaOption[]>();
  const byForm = new Map<string, MegaOption[]>();
  const add = (option: MegaOption) => {
    if (!runtime.speciesById.has(option.baseSpeciesId) || !runtime.speciesById.has(option.formId)) return;
    const options = byBase.get(option.baseSpeciesId) ?? [];
    if (options.some((entry) => entry.formId === option.formId)) return;
    options.push(option);
    byBase.set(option.baseSpeciesId, options);
    byForm.set(option.formId, [...(byForm.get(option.formId) ?? []), option]);
  };
  if (runtime.profile.mega) {
    // Taxonomic baseSpecies also groups regional forms which cannot use these stones.
    for (const item of runtime.catalog.items) {
      for (const target of item.megaTargets) {
        const form = runtime.speciesById.get(target.formId);
        if (!form || form.requiredItem !== item.id) continue;
        const variant = form.name.match(/-Mega-(X|Y|Z)$/)?.[1];
        add({ ...target, itemId: item.id, label: variant ? `Mega ${variant}` : "Mega" });
      }
    }
  }
  if (runtime.profile.id === "ultra_sun_ultra_moon") {
    for (const formId of ["rayquazamega", "kyogreprimal", "groudonprimal", "necrozmaultra"]) {
      const form = runtime.speciesById.get(formId);
      if (!form) continue;
      const bases = form.battleOnly?.length ? form.battleOnly : form.changesFrom ? [form.changesFrom] : [];
      for (const baseSpeciesId of bases) {
        add({ baseSpeciesId, formId, itemId: form.requiredItem ?? "",
          label: formId === "necrozmaultra" ? "Ultra Burst" : formId.endsWith("primal") ? "Primal" : "Mega",
          ...(form.requiredMove ? { requiredMove: form.requiredMove } : {}),
        });
      }
    }
  }
  for (const options of byBase.values()) options.sort((a, b) => a.label.localeCompare(b.label, "en"));
  const index = { byBase, byForm };
  indexes.set(runtime, index);
  return index;
}

export function getMegaOptions(speciesId: string, runtime: BattleRuntime = championsRuntime, originalBaseId?: string): readonly MegaOption[] {
  const { byBase, byForm } = indexForms(runtime);
  const direct = byBase.get(speciesId);
  if (direct) return direct;
  const candidates = byForm.get(speciesId) ?? [];
  const base = candidates.find((entry) => entry.baseSpeciesId === originalBaseId) ?? candidates[0];
  return base ? byBase.get(base.baseSpeciesId) ?? [] : [];
}
