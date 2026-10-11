import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = { id: string; ability?: string; item?: string; move?: string | null; target?: DoublesSlotId | null; extra?: Partial<DoublesPokemonInput> };
function turn(slots: Record<DoublesSlotId, P | null>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const runtime = championsRuntime;
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: "", currentHP: null } as BattleBuild;
    return [slot, { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...p.extra } as DoublesPokemonInput];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const lax = (extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", move: null, ...extra });
const show = (label: string, input: DoublesTurnInput) => {
  const r = calculateDoublesTurn(input);
  if (r.status !== "ready") { console.log(label, r.status, r.status === "issues" ? JSON.stringify(r.issues) : (r as { reason: string }).reason); return; }
  console.log(label, JSON.stringify(Object.fromEntries(SLOTS.map((s) => [s, r.hp[s] && { start: r.hp[s]!.start, min: r.hp[s]!.min, max: r.hp[s]!.max }]))), JSON.stringify(r.facts));
  for (const step of r.steps) console.log("   step", step.slot, step.moveId, JSON.stringify(step.hits.map((h) => [h.slot, h.reached, h.min, h.max])), JSON.stringify(step.facts));
};
show("TR06a", turn({ "own-left": { id: "tyranitar", ability: "unnerve", move: "payback", target: "opponent-left" }, "own-right": lax(), "opponent-left": lax({ extra: { switchedIn: true } }), "opponent-right": lax() }));
show("TR06 not switched", turn({ "own-left": { id: "tyranitar", ability: "unnerve", move: "payback", target: "opponent-left" }, "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
show("TR09", turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": { id: "gengar", ability: "cursedbody", move: null }, "opponent-right": lax() }));
show("TR09c", turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": lax({ move: "protect" }), "opponent-right": null }));
show("TR09b", turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": lax({ extra: { carried: { substitute: 40 } } }), "opponent-right": null }));
show("TR10 switched", turn({ "own-left": { id: "starmie", ability: "analytic", move: "hydropump", target: "opponent-left" }, "own-right": lax(), "opponent-left": { id: "jolteon", ability: "voltabsorb", move: null, extra: { switchedIn: true } }, "opponent-right": lax() }, { trickRoom: true }));
show("TR10 control", turn({ "own-left": { id: "starmie", ability: "analytic", move: "hydropump", target: "opponent-left" }, "own-right": lax(), "opponent-left": { id: "jolteon", ability: "voltabsorb", move: null }, "opponent-right": lax() }, { trickRoom: true }));
show("issue switchedIn+move", turn({ "own-left": lax({ move: "tackle", target: "opponent-left", extra: { switchedIn: true } }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
show("mustRecharge fact", turn({ "own-left": lax({ extra: { carried: { mustRecharge: true } } }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
show("stall carried", turn({ "own-left": lax({ move: "protect", extra: { carried: { stall: 1 } } }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
show("stall absent", turn({ "own-left": lax({ move: "protect" }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
