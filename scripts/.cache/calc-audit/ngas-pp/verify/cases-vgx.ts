// ngas-pp VERIFY: controls without Neutralizing Gas for the start-row findings (VG35 redirect, VG38 Power Spot).
import type { Case, CaseAction, CaseMon, SlotId } from "../../2v2/verify/case-types";
type Slot = CaseMon & { action: CaseAction };
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: SlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const S = (a: Slot, b: Slot, c: Slot, d: Slot): Case["slots"] => ({ "own-left": a, "own-right": b, "opponent-left": c, "opponent-right": d });
const snorlax = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", { evs: { spe: 4 }, ...extra });
const chomp0 = mon("Garchomp", "Rough Skin");
export const VGX_CASES: Case[] = [
  { id: "VGX35", title: "No gas: Lightning Rod Raichu draws Magnezone's Thunderbolt from Snorlax", game: "sv",
    slots: S(act(mon("Magnezone", "Magnet Pull", { evs: { spe: 4 } }), "Thunderbolt", "opponent-right"), idle(mon("Venusaur", "Overgrow")), idle(mon("Raichu", "Lightning Rod")), idle(snorlax())),
    checks: "control: redirect start row" },
  { id: "VGX38", title: "No gas: Power Spot beside Garchomp", game: "sv", // startrows fix: the partner boost is modelled (was: not estimated)
    slots: S(act(chomp0, "Dragon Claw", "opponent-right"), idle(mon("Stonjourner", "Power Spot")), idle(mon("Venusaur", "Overgrow")), idle(snorlax())),
    checks: "control: presence guard start row" },
  { id: "VGX38b", title: "No gas: Battery beside Charizard", game: "sv", // startrows fix: the partner boost is modelled (was: not estimated)
    slots: S(act(mon("Charizard", "Blaze"), "Flamethrower", "opponent-right"), idle(mon("Charjabug", "Battery")), idle(mon("Venusaur", "Overgrow")), idle(snorlax())),
    checks: "control: presence guard start row" },
];
