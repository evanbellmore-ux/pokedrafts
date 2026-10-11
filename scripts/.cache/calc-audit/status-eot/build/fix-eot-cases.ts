// EOT fixer's oracle cases (status-eot review lens eot-training follow-ups). Level 50, 31 IVs, Serious, 0 EVs unless set.
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";

type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const slots = (ownLeft: Slot, ownRight: Slot, oppLeft: Slot, oppRight: Slot): Case["slots"] =>
  ({ "own-left": ownLeft, "own-right": ownRight, "opponent-left": oppLeft, "opponent-right": oppRight });

export const FIX_CASES: Case[] = [
  {
    id: "FX01", title: "Roost this turn, then a Flame Orb under Misty Terrain: Roost ends at order 25, before the Orb (28.3)", game: "sv", outcomes: true,
    field: { terrain: "Misty" },
    slots: slots(act(mon("Corviknight", "Pressure", { item: "Flame Orb", hp: 100 }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Grounded by Roost at 5.2 (no heal: Misty), ungrounded again at 28.3: Misty Terrain does not stop the burn.",
  },
  {
    id: "FX02", title: "Roost this turn, then a Toxic Orb under Misty Terrain on Talonflame", game: "sv", outcomes: true,
    field: { terrain: "Misty" },
    slots: slots(act(mon("Talonflame", "Flame Body", { item: "Toxic Orb", hp: 80 }), "Roost"), idle(mon("Venusaur", "Overgrow")),
      idle(mon("Jolteon", "Volt Absorb")), idle(mon("Snorlax", "Thick Fat"))),
    checks: "Talonflame is badly poisoned at 28.3 (Roost over at 25).",
  },
];
