// Conformance gate 4b (scripts/training/conformance.ts): the HP range E2 gives each Pokémon after a turn, by MonKey.
import { engineIdKey } from "@/app/(app)/training/ai/evaluate";
import type { EngineWorld } from "@/app/(app)/training/model/ai-view";
import { DOUBLES_SLOTS, type DoublesOutcome } from "@/app/lib/battle/doubles-types";
import { getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";

/** Each Pokémon's lowest and highest HP over the outcomes seen, by MonKey. */
export type HpRanges = Partial<Record<string, [number, number]>>;

const widen = (range: HpRanges, key: string | null | undefined, hp: readonly { hp: number }[]) => {
  if (!key || !hp.length) return;
  const low = Math.min(...hp.map((entry) => entry.hp)), high = Math.max(...hp.map((entry) => entry.hp));
  const known = range[key];
  range[key] = known ? [Math.min(known[0], low), Math.max(known[1], high)] : [low, high];
};

/**
 * Widens `range` with one outcome of `world`'s E2 result: each slot's occupant at the end (a newcomer by its id: a bench id,
 * or the other slot's start id; status2 R-T), each Pokémon that left (benched), and each bench Pokémon of the input that did
 * not come in on that path, at the HP it had on the bench. The last is the outcome's own: a Pokémon that stays on the bench
 * keeps its HP (postFromOutcome keeps it as it was), so a newcomer on some paths only (a Speed tie deciding whether a Baton
 * Pass user moves before its partner's Shadow Ball faints it) has its bench HP in the range too.
 */
export function widenWithOutcome(range: HpRanges, outcome: DoublesOutcome, world: Pick<EngineWorld, "keys" | "input">, runtime: BattleRuntime): void {
  const seen = new Set<string>();
  for (const slot of DOUBLES_SLOTS) {
    const mon = outcome.mons[slot];
    if (!mon) continue;
    const key = mon.id ? engineIdKey(mon.id, world) : world.keys[slot];
    if (key) seen.add(key);
    widen(range, key, mon.hp);
  }
  for (const side of ["own", "opponent"] as const) {
    for (const left of outcome.benched?.[side] ?? []) {
      const key = engineIdKey(left.id, world);
      if (key) seen.add(key);
      widen(range, key, left.hp);
    }
  }
  for (const side of ["own", "opponent"] as const) {
    for (const stayed of world.input.bench?.[side] ?? []) {
      const key = engineIdKey(stayed.id, world);
      if (!key || seen.has(key)) continue;
      const hp = stayed.build.currentHP ?? getBuildStats(stayed.build, runtime)?.hp;
      if (hp !== undefined) widen(range, key, [{ hp }]);
    }
  }
}
