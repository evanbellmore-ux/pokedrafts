// R-E's probe kit: compact 2v2 inputs with a bench, and a compact print of the turn result and its E2 outcomes.
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesBenchPokemon, DoublesHP, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild, BattleGame } from "@/app/lib/battle/types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";

export type Mon = { species: string; ability: string; item?: string; move?: string | null; target?: DoublesSlotId | null; hp?: number; status?: string; boosts?: Partial<BattleBuild["boosts"]>; evs?: Partial<Record<string, number>>; nature?: string; extra?: Partial<DoublesPokemonInput>; build?: Partial<BattleBuild> };
export const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
export function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const abilityId = m.ability;
  const shared = { abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: m.item ?? "", status: m.status ?? "", currentHP: m.hp ?? null,
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, nature: m.nature ?? "Serious" };
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } };
  return { ...build, ...m.build } as BattleBuild;
}
export function input(runtime: BattleRuntime, slots: Record<DoublesSlotId, Mon | null>, extra: Partial<DoublesTurnInput> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries((Object.entries(slots) as [DoublesSlotId, Mon | null][]).map(([slot, m]) => [slot, m ? {
    build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null }, ...m.extra,
  } : null])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon, ...extra };
}
export const bench = (runtime: BattleRuntime, id: string, m: Mon, extra: Partial<DoublesBenchPokemon> = {}): DoublesBenchPokemon => ({ id, build: buildOf(runtime, m), ...extra });

const hpText = (h: DoublesHP | null | undefined) => !h ? "-" : `${h.min}-${h.max} avg ${+h.average.toFixed(3)} ko ${+h.koChance.toFixed(4)}${h.losses ? ` losses ${h.losses.map((l) => `${l.text}@${+l.chance.toFixed(3)}`).join(";")}` : ""}${h.heals.length ? ` heals ${h.heals.join(";")}` : ""}${h.conditions ? ` cond ${h.conditions.map((c) => `${c.text}@${+c.chance.toFixed(3)}`).join(";")}` : ""}`;
export function show(result: DoublesTurnResult): string {
  const out: string[] = [`status ${result.status}${result.status === "not-estimated" ? `: ${result.reason}` : ""}`];
  if (result.status === "issues") { out.push(JSON.stringify(result.issues)); return out.join("\n"); }
  if (result.status !== "ready") return out.join("\n");
  for (const s of result.steps) {
    out.push(`step ${s.slot} ${s.moveId} order ${s.order.map((o) => `${o.position}@${+o.chance.toFixed(3)}`).join(",")} moves ${+s.moves.toFixed(3)}${s.skipped.length ? ` skipped ${s.skipped.map((f) => `${f.text}@${+f.chance.toFixed(3)}`).join(";")}` : ""}`);
    for (const f of s.facts) out.push(`   fact ${f.text} @${+f.chance.toFixed(4)}`);
    for (const h of s.hits) out.push(`   hit ${h.slot}${h.id ? ` [${h.id}]` : ""} ${h.kind} ${h.min}-${h.max} reached ${+h.reached.toFixed(3)} ko ${+h.koChance.toFixed(4)}${h.facts.length ? ` facts ${h.facts.map((f) => `${f.text}@${+f.chance.toFixed(3)}`).join(";")}` : ""}`);
  }
  for (const [slot, h] of Object.entries(result.hp)) out.push(`hp ${slot} ${hpText(h)}`);
  for (const [slot, r] of Object.entries(result.replaced ?? {})) out.push(`replaced ${slot} left ${r!.left.map((l) => `${l.id}@${+l.chance.toFixed(3)} {${hpText(l.hp)}}`).join(" ")} entered ${r!.entered.map((e) => `${e.id}@${+e.chance.toFixed(3)}`).join(" ")}`);
  for (const [slot, m] of Object.entries(result.hpEntered ?? {})) for (const [id, h] of Object.entries(m!)) out.push(`entered ${slot} ${id} ${hpText(h)}`);
  out.push(`facts ${JSON.stringify(result.facts)}`);
  const e = result.endOfTurn;
  out.push(`end ${e.status}${e.status === "not-estimated" ? `: ${e.reason}` : ""}`);
  if (e.status === "ready") {
    for (const [slot, h] of Object.entries(e.hp)) out.push(`   end hp ${slot} ${hpText(h)}`);
    for (const [slot, m] of Object.entries(e.hpEntered ?? {})) for (const [id, h] of Object.entries(m!)) out.push(`   end entered ${slot} ${id} ${hpText(h)}`);
    for (const r of e.residuals) out.push(`   residual ${r.slot}${r.id ? ` [${r.id}]` : ""} ${r.effect} ${r.min}..${r.max} @${+r.chance.toFixed(3)}${r.facts.length ? ` ${r.facts.map((f) => f.text).join(";")}` : ""}`);
    for (const [slot, r] of Object.entries(e.replaced ?? {})) out.push(`   end replaced ${slot} left ${r!.left.map((l) => `${l.id}@${+l.chance.toFixed(3)}`).join(" ")} entered ${r!.entered.map((x) => `${x.id}@${+x.chance.toFixed(3)}`).join(" ")}`);
  }
  return out.join("\n");
}
export function showOutcomes(inputValue: DoublesTurnInput): string {
  const result = calculateDoublesOutcomes(inputValue);
  if (result.status !== "ready") return `outcomes ${result.status} ${"reason" in result ? result.reason : ""}`;
  const out = [`outcomes ${result.outcomes.length} end ${typeof result.endOfTurn === "string" ? result.endOfTurn : result.endOfTurn.notEstimated}`];
  for (const o of result.outcomes) {
    const mons = Object.entries(o.mons).map(([slot, m]) => `${slot}${m!.id ? `[${m!.id}]` : ""}:${m!.hp.map((h) => `${h.hp}@${+h.chance.toFixed(3)}`).join("/")}`).join(" ");
    const benched = Object.entries(o.benched ?? {}).map(([side, list]) => `${side}:${list!.map((b) => `${b.id}(${b.slot}) ${b.hp.map((h) => `${h.hp}@${+h.chance.toFixed(3)}`).join("/")} ${b.build.status || "-"}`).join(",")}`).join(" ");
    out.push(`  @${+o.chance.toFixed(4)} ${mons}${benched ? ` | benched ${benched}` : ""}`);
  }
  return out.join("\n");
}
export const turn = (value: DoublesTurnInput) => show(calculateDoublesTurn(value));
export type { BattleGame };
