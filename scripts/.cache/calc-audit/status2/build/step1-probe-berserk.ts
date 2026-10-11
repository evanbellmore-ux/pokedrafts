// Step 1 side probe: does the pair's step give Berserk's +1 Sp. Atk when its holder falls to half (a later special move reads it)?
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
type Slot = CaseMon & { action: CaseAction };
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const slots = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const cases: Case[] = [
  { id: "PB-1", title: "Berserk Drampa hit to half, then its Dragon Pulse", game: "usum", checks: "", outcomes: true,
    slots: slots(act({ species: "Drampa", ability: "Berserk", hp: 100 }, "Dragon Pulse", "opponent-left"), act({ species: "Venusaur", ability: "Overgrow", evs: { spe: 4 } }, null),
      act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 60 } }, null), act({ species: "Snorlax", ability: "Thick Fat", evs: { spe: 252 } }, "Body Slam", "own-left")) },
];
(async () => {
  for (const c of cases) {
    const o = oracle(c); const app = await appTurn(c); const rt = await runtimeFor(c);
    const mm = compareCase(c, o, app.result, (id) => rt.movesById.get(id)?.category === "Status", app.outcomes);
    console.log(c.id, app.result?.status, mm.length, JSON.stringify(mm.slice(0, 8)));
    console.log("oracle drampa boosts", JSON.stringify(o.walks.all.slots["own-left"].boosts));
  }
})();
